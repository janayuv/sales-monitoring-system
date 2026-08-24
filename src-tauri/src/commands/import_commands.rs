use crate::error::AppError;
use crate::models::database_models::ImportTemplateRow;
use crate::models::domain_models::{ImportMode, ImportPreview};
use crate::services::import_service::ImportService;
use crate::state::DbState;
use tauri::State;

#[tauri::command]
pub fn get_import_templates(state: State<'_, DbState>) -> Result<Vec<ImportTemplateRow>, AppError> {
    let conn_guard = state
        .conn
        .lock()
        .map_err(|e| AppError::Internal(format!("Failed to acquire connection lock: {}", e)))?;
    let conn = conn_guard.as_ref().ok_or_else(|| AppError::Db {
        code: "ERR_DB_002".to_string(),
        message: "No active database connection profile".to_string(),
    })?;

    let mut stmt = conn
        .prepare("SELECT id, template_name, source_type, is_active FROM import_templates")
        .map_err(|e| AppError::Db {
            code: "ERR_DB_003".to_string(),
            message: format!("Failed to prepare templates query: {}", e),
        })?;

    let rows = stmt
        .query_map([], |row| {
            Ok(ImportTemplateRow {
                id: Some(row.get(0)?),
                template_name: row.get(1)?,
                source_type: row.get(2)?,
                is_active: row.get(3)?,
            })
        })
        .map_err(|e| AppError::Db {
            code: "ERR_DB_003".to_string(),
            message: format!("Failed to execute templates query: {}", e),
        })?;

    let mut templates = Vec::new();
    for r in rows {
        templates.push(r.map_err(|e| AppError::Db {
            code: "ERR_DB_003".to_string(),
            message: format!("Failed to parse template row: {}", e),
        })?);
    }

    Ok(templates)
}

#[tauri::command]
pub fn preview_import_file(
    state: State<'_, DbState>,
    file_path: String,
    template_id: i64,
    user_name: String,
) -> Result<ImportPreview, AppError> {
    let conn_guard = state
        .conn
        .lock()
        .map_err(|e| AppError::Internal(format!("Failed to acquire connection lock: {}", e)))?;
    let conn = conn_guard.as_ref().ok_or_else(|| AppError::Db {
        code: "ERR_DB_002".to_string(),
        message: "No active database connection profile".to_string(),
    })?;

    ImportService::parse_and_preview(conn, &file_path, template_id, &user_name)
}

#[tauri::command]
pub fn commit_import_batch(
    state: State<'_, DbState>,
    file_path: String,
    template_id: i64,
    user_name: String,
    user_remarks: Option<String>,
    mode: Option<ImportMode>,
) -> Result<i64, AppError> {
    log::info!("Committing import batch from file: {} with mode: {:?}", file_path, mode);

    let mut conn_guard = state
        .conn
        .lock()
        .map_err(|e| AppError::Internal(format!("Failed to acquire connection lock: {}", e)))?;
    let conn = conn_guard.as_mut().ok_or_else(|| AppError::Db {
        code: "ERR_DB_002".to_string(),
        message: "No active database connection profile".to_string(),
    })?;

    let batch_id = ImportService::execute_import(
        conn,
        &file_path,
        template_id,
        &user_name,
        user_remarks.as_deref(),
        mode.unwrap_or_default(),
    )?;

    if let Ok(mut cache) = state.dashboard_cache.lock() {
        *cache = None;
    }

    log::info!("Successfully committed import batch ID: {}", batch_id);
    Ok(batch_id)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::database::migrate::run_migrations;
    use rusqlite::{params, Connection};

    #[test]
    fn test_unknown_hsn_auto_populated_and_assigned_to_item() {
        let mut conn = Connection::open_in_memory().unwrap();
        run_migrations(&mut conn).unwrap();

        // Ensure HSN 35069999 does not exist initially
        let exists: bool = conn
            .query_row(
                "SELECT EXISTS(SELECT 1 FROM hsn_master WHERE hsn_code = '35069999')",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert!(!exists);

        // Simulate incoming import row processing logic inside a transaction
        let tx = conn.transaction().unwrap();

        let part_code = "ADH-001".to_string();
        let part_name = "Industrial Adhesive 500ml".to_string();
        let raw_hsn = " 35069999 ".to_string();
        let clean_hsn = raw_hsn.trim().to_string();
        let total_gst_rate = 18.0;

        // Auto-populate logic
        let target_hsn = if !clean_hsn.is_empty() {
            tx.execute(
                "INSERT OR IGNORE INTO gst_rates (rate, description) VALUES (?, ?)",
                params![total_gst_rate, format!("{}% GST", total_gst_rate)],
            )
            .unwrap();

            let hsn_desc = if !part_name.is_empty() {
                part_name.clone()
            } else {
                format!("HSN {}", clean_hsn)
            };
            tx.execute(
                "INSERT OR IGNORE INTO hsn_master (hsn_code, description, gst_rate) VALUES (?, ?, ?)",
                params![clean_hsn, hsn_desc, total_gst_rate],
            )
            .unwrap();
            clean_hsn
        } else {
            "UNASSIGNED".to_string()
        };

        tx.execute(
            "INSERT INTO items (part_code, part_name, hsn_code, uom_code, default_gst_rate, status)
             VALUES (?, ?, ?, 'PCS', ?, 'Pending_Review')",
            params![part_code, part_name, target_hsn, total_gst_rate],
        )
        .unwrap();

        tx.commit().unwrap();

        // Verify hsn_master contains the new HSN
        let (stored_desc, stored_rate): (String, f64) = conn
            .query_row(
                "SELECT description, gst_rate FROM hsn_master WHERE hsn_code = '35069999'",
                [],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .unwrap();
        assert_eq!(stored_desc, "Industrial Adhesive 500ml");
        assert_eq!(stored_rate, 18.0);

        // Verify item was created with the exact HSN code, NOT 8708.99.00
        let item_hsn: String = conn
            .query_row(
                "SELECT hsn_code FROM items WHERE part_code = 'ADH-001'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(item_hsn, "35069999");
        assert_ne!(item_hsn, "8708.99.00");
    }

    #[test]
    fn test_multiple_distinct_hsns_remain_distinct_and_preserve_master_data() {
        let mut conn = Connection::open_in_memory().unwrap();
        run_migrations(&mut conn).unwrap();

        // 8708.99.00 is seeded in 0001_init.sql with description 'Motor vehicle parts and accessories'
        let initial_desc: String = conn
            .query_row(
                "SELECT description FROM hsn_master WHERE hsn_code = '8708.99.00'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(initial_desc, "Motor vehicle parts and accessories");

        let tx = conn.transaction().unwrap();

        // Row 1: Part using pre-existing 8708.99.00 but with specific part name
        let part1_code = "BRK-100".to_string();
        let part1_name = "Brake Bracket".to_string();
        let clean_hsn1 = "8708.99.00".to_string();
        let rate1 = 18.0;

        tx.execute(
            "INSERT OR IGNORE INTO hsn_master (hsn_code, description, gst_rate) VALUES (?, ?, ?)",
            params![clean_hsn1, part1_name, rate1],
        )
        .unwrap();

        tx.execute(
            "INSERT INTO items (part_code, part_name, hsn_code, uom_code, default_gst_rate, status)
             VALUES (?, ?, ?, 'PCS', ?, 'Pending_Review')",
            params![part1_code, part1_name, clean_hsn1, rate1],
        )
        .unwrap();

        // Row 2: Part using novel HSN 3902.10.00 (Polypropylene) with 12% GST
        let part2_code = "PLAS-200".to_string();
        let part2_name = "PP Granules".to_string();
        let clean_hsn2 = "3902.10.00".to_string();
        let rate2 = 12.0;

        tx.execute(
            "INSERT OR IGNORE INTO gst_rates (rate, description) VALUES (?, ?)",
            params![rate2, format!("{}% GST", rate2)],
        )
        .unwrap();

        tx.execute(
            "INSERT OR IGNORE INTO hsn_master (hsn_code, description, gst_rate) VALUES (?, ?, ?)",
            params![clean_hsn2, part2_name, rate2],
        )
        .unwrap();

        tx.execute(
            "INSERT INTO items (part_code, part_name, hsn_code, uom_code, default_gst_rate, status)
             VALUES (?, ?, ?, 'KGS', ?, 'Pending_Review')",
            params![part2_code, part2_name, clean_hsn2, rate2],
        )
        .unwrap();

        tx.commit().unwrap();

        // 1. Authoritative seeded description for 8708.99.00 must remain preserved
        let desc_after: String = conn
            .query_row(
                "SELECT description FROM hsn_master WHERE hsn_code = '8708.99.00'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(desc_after, "Motor vehicle parts and accessories");

        // 2. Novel HSN 3902.10.00 is stored with its 12% rate
        let (desc_hsn2, rate_hsn2): (String, f64) = conn
            .query_row(
                "SELECT description, gst_rate FROM hsn_master WHERE hsn_code = '3902.10.00'",
                [],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .unwrap();
        assert_eq!(desc_hsn2, "PP Granules");
        assert_eq!(rate_hsn2, 12.0);

        // 3. Items have distinct HSNs
        let hsn_item1: String = conn
            .query_row(
                "SELECT hsn_code FROM items WHERE part_code = 'BRK-100'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        let hsn_item2: String = conn
            .query_row(
                "SELECT hsn_code FROM items WHERE part_code = 'PLAS-200'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(hsn_item1, "8708.99.00");
        assert_eq!(hsn_item2, "3902.10.00");
        assert_ne!(hsn_item1, hsn_item2);
    }

    #[test]
    fn test_transaction_level_hsn_persistence_and_multi_hsn_per_part() {
        let mut conn = Connection::open_in_memory().unwrap();
        run_migrations(&mut conn).unwrap();

        // 1. Seed customer
        conn.execute(
            "INSERT INTO customers (id, customer_code, report_name, status) VALUES (1, 'CUST-001', 'Test Customer', 'Approved')",
            [],
        ).unwrap();

        let tx = conn.transaction().unwrap();

        // 2. Simulate Invoice 1: Part 'PART-X' invoiced with HSN '8409.91.99'
        let raw_hsn1 = "  8409.91.99  ";
        let clean_hsn1 = raw_hsn1.trim().to_string();
        let hsn_line1 = if !clean_hsn1.is_empty() { Some(clean_hsn1) } else { None };

        // 3. Simulate Invoice 2: SAME Part 'PART-X' invoiced with HSN '8708.99.00'
        let raw_hsn2 = "8708.99.00";
        let clean_hsn2 = raw_hsn2.trim().to_string();
        let hsn_line2 = if !clean_hsn2.is_empty() { Some(clean_hsn2) } else { None };

        // 4. Simulate Invoice 3: Part 'PART-Y' invoiced with MISSING HSN
        let raw_hsn3 = "   ";
        let clean_hsn3 = raw_hsn3.trim().to_string();
        let hsn_line3 = if !clean_hsn3.is_empty() { Some(clean_hsn3) } else { None };

        // Create headers
        tx.execute(
            "INSERT INTO invoices (invoice_number, invoice_date, customer_id, financial_year_id, total_taxable, total_cgst, total_sgst, total_igst, total_value, status)
             VALUES ('INV-1', '2026-07-10', 1, 1, 1000.0, 90.0, 90.0, 0.0, 1180.0, 'Imported')",
            [],
        ).unwrap();
        tx.execute(
            "INSERT INTO invoices (invoice_number, invoice_date, customer_id, financial_year_id, total_taxable, total_cgst, total_sgst, total_igst, total_value, status)
             VALUES ('INV-2', '2026-07-15', 1, 1, 2000.0, 180.0, 180.0, 0.0, 2360.0, 'Imported')",
            [],
        ).unwrap();
        tx.execute(
            "INSERT INTO invoices (invoice_number, invoice_date, customer_id, financial_year_id, total_taxable, total_cgst, total_sgst, total_igst, total_value, status)
             VALUES ('INV-3', '2026-07-20', 1, 1, 500.0, 45.0, 45.0, 0.0, 590.0, 'Imported')",
            [],
        ).unwrap();

        // Create base item records
        tx.execute(
            "INSERT OR IGNORE INTO hsn_master (hsn_code, description, gst_rate) VALUES ('UNASSIGNED', 'Unassigned HSN', 18.0)",
            [],
        ).unwrap();
        tx.execute(
            "INSERT INTO items (part_code, part_name, hsn_code, uom_code, default_gst_rate, status)
             VALUES ('PART-X', 'Multi HSN Component', '8409.91.99', 'PCS', 18.0, 'Approved')",
            [],
        ).unwrap();
        tx.execute(
            "INSERT INTO items (part_code, part_name, hsn_code, uom_code, default_gst_rate, status)
             VALUES ('PART-Y', 'Unassigned Component', 'UNASSIGNED', 'PCS', 18.0, 'Pending_Review')",
            [],
        ).unwrap();

        // Insert invoice lines with transaction HSNs
        tx.execute(
            "INSERT INTO invoice_items (invoice_number, part_code, quantity, rate_pre_unit, assessable_value,
                                        cgst_rate, cgst_amount, sgst_rate, sgst_amount, igst_rate, igst_amount, total_value, hsn_code)
             VALUES ('INV-1', 'PART-X', 10.0, 100.0, 1000.0, 9.0, 90.0, 9.0, 90.0, 0.0, 0.0, 1180.0, ?)",
            params![hsn_line1],
        ).unwrap();

        tx.execute(
            "INSERT INTO invoice_items (invoice_number, part_code, quantity, rate_pre_unit, assessable_value,
                                        cgst_rate, cgst_amount, sgst_rate, sgst_amount, igst_rate, igst_amount, total_value, hsn_code)
             VALUES ('INV-2', 'PART-X', 20.0, 100.0, 2000.0, 9.0, 180.0, 9.0, 180.0, 0.0, 0.0, 2360.0, ?)",
            params![hsn_line2],
        ).unwrap();

        tx.execute(
            "INSERT INTO invoice_items (invoice_number, part_code, quantity, rate_pre_unit, assessable_value,
                                        cgst_rate, cgst_amount, sgst_rate, sgst_amount, igst_rate, igst_amount, total_value, hsn_code)
             VALUES ('INV-3', 'PART-Y', 5.0, 100.0, 500.0, 9.0, 45.0, 9.0, 45.0, 0.0, 0.0, 590.0, ?)",
            params![hsn_line3],
        ).unwrap();

        tx.commit().unwrap();

        // 1. Verify two invoices using SAME part_code have different transaction HSNs
        let hsn_inv1: Option<String> = conn
            .query_row(
                "SELECT hsn_code FROM invoice_items WHERE invoice_number = 'INV-1' AND part_code = 'PART-X'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        let hsn_inv2: Option<String> = conn
            .query_row(
                "SELECT hsn_code FROM invoice_items WHERE invoice_number = 'INV-2' AND part_code = 'PART-X'",
                [],
                |r| r.get(0),
            )
            .unwrap();

        assert_eq!(hsn_inv1, Some("8409.91.99".to_string()));
        assert_eq!(hsn_inv2, Some("8708.99.00".to_string()));
        assert_ne!(hsn_inv1, hsn_inv2);

        // 2. Verify imported HSN values are preserved exactly after normalization (leading/trailing whitespace trimmed)
        assert_eq!(hsn_inv1.unwrap(), "8409.91.99");

        // 3. Verify missing source HSN becomes NULL in invoice_items
        let hsn_inv3: Option<String> = conn
            .query_row(
                "SELECT hsn_code FROM invoice_items WHERE invoice_number = 'INV-3' AND part_code = 'PART-Y'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(hsn_inv3, None);

        // 4. Verify invoice financial totals remain unchanged
        let (taxable1, total1): (f64, f64) = conn
            .query_row(
                "SELECT total_taxable, total_value FROM invoices WHERE invoice_number = 'INV-1'",
                [],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .unwrap();
        assert_eq!(taxable1, 1000.0);
        assert_eq!(total1, 1180.0);

        let (line_ass_val, line_total): (f64, f64) = conn
            .query_row(
                "SELECT assessable_value, total_value FROM invoice_items WHERE invoice_number = 'INV-1'",
                [],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .unwrap();
        assert_eq!(line_ass_val, 1000.0);
        assert_eq!(line_total, 1180.0);
    }
}


