use crate::error::AppError;
use crate::models::database_models::{ImportTemplateRow, InvoiceItemRow, InvoiceRow};
use crate::models::domain_models::ImportPreview;
use crate::repositories::report_repo::SqliteReportRepository;
use crate::repositories::ReportRepository;
use crate::services::import_service::{cell_to_f64, cell_to_string, ImportService};
use crate::state::DbState;
use crate::utils::dates::format_db_date;
use crate::utils::dates::parse_date;
use crate::utils::hash::compute_file_hash;
use calamine::{open_workbook_auto, Reader};
use rusqlite::params;
use std::collections::HashMap;
use std::path::Path;
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
) -> Result<i64, AppError> {
    log::info!("Committing import batch from file: {}", file_path);

    let mut conn_guard = state
        .conn
        .lock()
        .map_err(|e| AppError::Internal(format!("Failed to acquire connection lock: {}", e)))?;
    let conn = conn_guard.as_mut().ok_or_else(|| AppError::Db {
        code: "ERR_DB_002".to_string(),
        message: "No active database connection profile".to_string(),
    })?;

    let clean_file_path = file_path.trim().trim_matches('"').trim_matches('\'');
    let path = Path::new(clean_file_path);
    if !path.exists() {
        return Err(AppError::Excel(format!(
            "File does not exist or cannot be accessed: {}",
            clean_file_path
        )));
    }

    let file_hash = compute_file_hash(path)
        .map_err(|e| AppError::Excel(format!("Failed to read file hash: {}", e)))?;
    let file_size = path.metadata().map(|m| m.len() as i64).unwrap_or(0);
    let file_name = path
        .file_name()
        .unwrap_or_default()
        .to_string_lossy()
        .into_owned();

    // 1. Double check duplicates in WAL isolation
    let is_duplicate: bool = conn
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM import_batches WHERE file_hash = ? AND status = 'completed')",
            [&file_hash],
            |row| row.get(0),
        )
        .unwrap_or(false);

    if is_duplicate {
        return Err(AppError::Validation {
            code: "ERR_IMPORT_002".to_string(),
            message: "This file has already been imported".to_string(),
        });
    }

    // Load active template mappings
    let mappings = ImportService::load_mappings(conn, template_id)?;

    let source_type: String = conn
        .query_row(
            "SELECT source_type FROM import_templates WHERE id = ?",
            [template_id],
            |row| row.get(0),
        )
        .map_err(|_| AppError::Excel("Template source type lookup failed".to_string()))?;

    // Open workbook
    let mut workbook = open_workbook_auto(path)
        .map_err(|e| AppError::Excel(format!("Failed to open Excel: {}", e)))?;
    let sheet_name = workbook
        .sheet_names()
        .first()
        .cloned()
        .ok_or_else(|| AppError::Excel("Workbook contains no sheets".to_string()))?;

    let range = workbook
        .worksheet_range(&sheet_name)
        .map_err(|e| AppError::Excel(format!("Failed to read sheet {}: {}", sheet_name, e)))?;

    let mut rows_iter = range.rows();
    let headers_row = rows_iter
        .next()
        .ok_or_else(|| AppError::Excel("Missing headers row".to_string()))?;

    let mut col_index_to_key = HashMap::new();
    for (idx, cell) in headers_row.iter().enumerate() {
        let header_str = cell_to_string(cell);
        let header_clean = header_str.trim().to_lowercase();
        if let Some(key) = mappings.get(&header_clean) {
            col_index_to_key.insert(idx, key.clone());
        }
    }

    // Verify at least one financial year exists
    let _ = conn
        .query_row(
            "SELECT id FROM financial_years WHERE is_active = 1",
            [],
            |row| row.get::<_, i64>(0),
        )
        .map_err(|_| AppError::Db {
            code: "ERR_DB_001".to_string(),
            message: "No active financial year defined. Create an active financial year first."
                .to_string(),
        })?;

    // Wrap operations inside a single database transaction (Unit of Work)
    let tx = conn.transaction().map_err(|e| AppError::Db {
        code: "ERR_DB_003".to_string(),
        message: format!("Failed to start transaction: {}", e),
    })?;

    // Insert import batch record
    tx.execute(
        "INSERT INTO import_batches (source_type, file_name, file_size_bytes, template_version_id, file_hash, row_count, imported_by, user_remarks, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'staged')",
        params![source_type, file_name, file_size, template_id, file_hash, (range.height() - 1) as u32, user_name, user_remarks, ],
    )
    .map_err(|e| AppError::Db {
        code: "ERR_DB_003".to_string(),
        message: format!("Failed to create batch record: {}", e),
    })?;

    let batch_id = tx.last_insert_rowid();

    let mut success_count = 0;
    let mut warning_count = 0;
    let mut error_count = 0;

    let mut invoice_items_buffer: HashMap<String, Vec<InvoiceItemRow>> = HashMap::new();
    let mut invoice_headers_buffer: HashMap<String, InvoiceRow> = HashMap::new();

    for row in rows_iter {
        let mut row_data = HashMap::new();
        for (col_idx, cell) in row.iter().enumerate() {
            if let Some(key) = col_index_to_key.get(&col_idx) {
                row_data.insert(key.as_str(), cell.clone());
            }
        }

        let inv_no = row_data
            .get("invoice_number")
            .map(cell_to_string)
            .unwrap_or_default();
        if inv_no.is_empty() {
            continue; // Skip empty rows
        }

        let inv_date_str = row_data
            .get("invoice_date")
            .map(cell_to_string)
            .unwrap_or_default();
        let parsed_inv_date = parse_date(&inv_date_str);
        if parsed_inv_date.is_none() {
            error_count += 1;
            continue; // Skip invalid date line
        }
        let inv_date_obj = parsed_inv_date.unwrap();
        let inv_date = format_db_date(inv_date_obj);

        // Resolve or create Financial Year dynamically based on invoice date
        use chrono::Datelike;
        let year = inv_date_obj.year();
        let month = inv_date_obj.month();
        let (fy_start_year, fy_end_year) = if month >= 4 {
            (year, year + 1)
        } else {
            (year - 1, year)
        };
        let fy_label = format!("FY {}-{}", fy_start_year, fy_end_year % 100);
        let fy_start = format!("{}-04-01", fy_start_year);
        let fy_end = format!("{}-03-31", fy_end_year);

        let active_fy_id: i64 = match tx.query_row(
            "SELECT id FROM financial_years WHERE label = ?",
            [&fy_label],
            |row| row.get(0),
        ) {
            Ok(id) => {
                tx.execute("UPDATE financial_years SET is_active = (id = ?)", [id])
                    .ok();
                id
            }
            Err(_) => {
                tx.execute("UPDATE financial_years SET is_active = 0", [])
                    .ok();
                tx.execute(
                    "INSERT INTO financial_years (label, start_date, end_date, is_active, is_locked) VALUES (?, ?, ?, 1, 0)",
                    params![fy_label, fy_start, fy_end],
                )
                .map_err(|e| AppError::Db {
                    code: "ERR_DB_003".to_string(),
                    message: format!("Failed to create financial year: {}", e),
                })?;
                tx.last_insert_rowid()
            }
        };

        // Extract Customer Code
        let cust_code = row_data
            .get("customer_code")
            .map(cell_to_string)
            .unwrap_or_default();
        let cust_name = row_data
            .get("customer_name")
            .map(cell_to_string)
            .unwrap_or_default();
        let customer_id: i64 = match tx.query_row(
            "SELECT id FROM customers WHERE customer_code = ?",
            [&cust_code],
            |row| row.get(0),
        ) {
            Ok(id) => id,
            Err(_) => {
                // Customer does not exist in master table - Add to queue
                tx.execute(
                    "INSERT INTO customers (customer_code, report_name, status) VALUES (?, ?, 'Pending_Review')",
                    params![cust_code, cust_name],
                )
                .map_err(|e| AppError::Db {
                    code: "ERR_DB_003".to_string(),
                    message: format!("Failed to insert customer review registry: {}", e),
                })?;
                warning_count += 1;
                tx.last_insert_rowid()
            }
        };

        // Values
        let qty = row_data.get("quantity").map(cell_to_f64).unwrap_or(0.0);
        let rate = row_data
            .get("rate_pre_unit")
            .map(cell_to_f64)
            .unwrap_or(0.0);
        let ass_val = row_data
            .get("assessable_value")
            .map(cell_to_f64)
            .unwrap_or(0.0);
        let cgst_rate = row_data.get("cgst_rate").map(cell_to_f64).unwrap_or(0.0);
        let cgst = row_data.get("cgst_amount").map(cell_to_f64).unwrap_or(0.0);
        let sgst_rate = row_data.get("sgst_rate").map(cell_to_f64).unwrap_or(0.0);
        let sgst = row_data.get("sgst_amount").map(cell_to_f64).unwrap_or(0.0);
        let igst_rate = row_data.get("igst_rate").map(cell_to_f64).unwrap_or(0.0);
        let igst = row_data.get("igst_amount").map(cell_to_f64).unwrap_or(0.0);
        let line_item_total = ((ass_val + cgst + sgst + igst) * 100.0).round() / 100.0;

        let total_gst_rate = if igst_rate > 0.0 {
            igst_rate
        } else if cgst_rate + sgst_rate > 0.0 {
            cgst_rate + sgst_rate
        } else {
            18.0
        };

        // Extract HSN details
        let raw_hsn = row_data
            .get("hsn_code")
            .or_else(|| row_data.get("tariff_code"))
            .or_else(|| row_data.get("tariff"))
            .map(cell_to_string)
            .unwrap_or_default();
        let clean_hsn = raw_hsn.trim().to_string();

        // Extract Part details
        let part_code = row_data
            .get("part_code")
            .map(cell_to_string)
            .unwrap_or_default();
        let part_name = row_data
            .get("part_name")
            .map(cell_to_string)
            .unwrap_or_default();

        let target_hsn = if !clean_hsn.is_empty() {
            // Ensure GST rate exists in gst_rates
            tx.execute(
                "INSERT OR IGNORE INTO gst_rates (rate, description) VALUES (?, ?)",
                params![total_gst_rate, format!("{}% GST", total_gst_rate)],
            )
            .map_err(|e| AppError::Db {
                code: "ERR_DB_003".to_string(),
                message: format!("Failed to ensure gst_rate: {}", e),
            })?;

            // Auto-populate unknown HSN in hsn_master without overwriting existing description or rate
            let hsn_desc = if !part_name.is_empty() {
                part_name.clone()
            } else {
                format!("HSN {}", clean_hsn)
            };
            tx.execute(
                "INSERT OR IGNORE INTO hsn_master (hsn_code, description, gst_rate) VALUES (?, ?, ?)",
                params![clean_hsn, hsn_desc, total_gst_rate],
            )
            .map_err(|e| AppError::Db {
                code: "ERR_DB_003".to_string(),
                message: format!("Failed to auto-populate hsn_master: {}", e),
            })?;

            clean_hsn.clone()
        } else {
            // Ensure UNASSIGNED exists in hsn_master
            tx.execute(
                "INSERT OR IGNORE INTO gst_rates (rate, description) VALUES (18.0, '18% GST')",
                [],
            )
            .ok();
            tx.execute(
                "INSERT OR IGNORE INTO hsn_master (hsn_code, description, gst_rate) VALUES ('UNASSIGNED', 'Unassigned HSN', 18.0)",
                [],
            )
            .ok();
            "UNASSIGNED".to_string()
        };

        let part_exists: bool = tx
            .query_row(
                "SELECT EXISTS(SELECT 1 FROM items WHERE part_code = ?)",
                [&part_code],
                |row| row.get(0),
            )
            .unwrap_or(false);

        if !part_exists && !part_code.is_empty() {
            // Part does not exist in master table - Add to review queue with incoming HSN and rate
            tx.execute(
                "INSERT INTO items (part_code, part_name, hsn_code, uom_code, default_gst_rate, status)
                 VALUES (?, ?, ?, 'PCS', ?, 'Pending_Review')",
                params![part_code, part_name, target_hsn, total_gst_rate],
            )
            .map_err(|e| AppError::Db {
                code: "ERR_DB_003".to_string(),
                message: format!("Failed to insert item review registry: {}", e),
            })?;
            warning_count += 1;
        }

        let item_hsn = if !clean_hsn.is_empty() {
            Some(clean_hsn.clone())
        } else {
            None
        };

        let item_row = InvoiceItemRow {
            id: None,
            invoice_number: inv_no.clone(),
            part_code,
            description: None,
            quantity: qty,
            rate_pre_unit: rate,
            assessable_value: ass_val,
            cgst_rate,
            cgst_amount: cgst,
            sgst_rate,
            sgst_amount: sgst,
            igst_rate,
            igst_amount: igst,
            total_value: line_item_total,
            hsn_code: item_hsn,
        };

        invoice_items_buffer
            .entry(inv_no.clone())
            .or_insert_with(Vec::new)
            .push(item_row);


        // Update header accumulation
        let header = invoice_headers_buffer
            .entry(inv_no.clone())
            .or_insert_with(|| InvoiceRow {
                invoice_number: inv_no.clone(),
                invoice_no_long: None,
                invoice_date: inv_date.clone(),
                customer_id,
                financial_year_id: active_fy_id,
                total_taxable: 0.0,
                total_cgst: 0.0,
                total_sgst: 0.0,
                total_igst: 0.0,
                total_cess: 0.0,
                total_value: 0.0,
                irn: None,
                irn_date: None,
                place_of_supply: None,
                reverse_charge: Some("N".to_string()),
                invoice_type: Some("Regular B2B".to_string()),
                status: "Imported".to_string(),
                cancellation_date: None,
                import_batch_id: Some(batch_id),
                created_at: "".to_string(),
                updated_at: "".to_string(),
                version: 1,
            });

        header.total_taxable += ass_val;
        header.total_cgst += cgst;
        header.total_sgst += sgst;
        header.total_igst += igst;
        header.total_value += line_item_total;

        success_count += 1;
    }

    // Clean up rounding on all accumulated invoice headers
    for header in invoice_headers_buffer.values_mut() {
        header.total_taxable = (header.total_taxable * 100.0).round() / 100.0;
        header.total_cgst = (header.total_cgst * 100.0).round() / 100.0;
        header.total_sgst = (header.total_sgst * 100.0).round() / 100.0;
        header.total_igst = (header.total_igst * 100.0).round() / 100.0;
        header.total_value = (header.total_value * 100.0).round() / 100.0;
    }

    let mut affected_fy_ids = std::collections::HashSet::new();

    for (inv_no, header) in invoice_headers_buffer {
        affected_fy_ids.insert(header.financial_year_id);

        // Delete existing items for clean replace
        tx.execute(
            "DELETE FROM invoice_items WHERE invoice_number = ?",
            [&inv_no],
        )
        .map_err(|e| AppError::Db {
            code: "ERR_DB_003".to_string(),
            message: format!("Failed to clear existing invoice items: {}", e),
        })?;

        // Insert or replace header
        tx.execute(
            "INSERT INTO invoices (
                invoice_number, invoice_date, customer_id, financial_year_id,
                total_taxable, total_cgst, total_sgst, total_igst, total_cess, total_value,
                reverse_charge, invoice_type, status, import_batch_id
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(invoice_number) DO UPDATE SET
                invoice_date = excluded.invoice_date,
                customer_id = excluded.customer_id,
                financial_year_id = excluded.financial_year_id,
                total_taxable = excluded.total_taxable,
                total_cgst = excluded.total_cgst,
                total_sgst = excluded.total_sgst,
                total_igst = excluded.total_igst,
                total_cess = excluded.total_cess,
                total_value = excluded.total_value,
                reverse_charge = excluded.reverse_charge,
                invoice_type = excluded.invoice_type,
                status = CASE 
                    WHEN invoices.status IN ('Cancelled', 'Cancelled_Audit') THEN invoices.status 
                    ELSE excluded.status 
                END,
                import_batch_id = excluded.import_batch_id,
                updated_at = datetime('now'),
                version = invoices.version + 1",
            params![
                header.invoice_number,
                header.invoice_date,
                header.customer_id,
                header.financial_year_id,
                header.total_taxable,
                header.total_cgst,
                header.total_sgst,
                header.total_igst,
                header.total_cess,
                header.total_value,
                header.reverse_charge,
                header.invoice_type,
                header.status,
                header.import_batch_id
            ],
        )
        .map_err(|e| AppError::Db {
            code: "ERR_DB_003".to_string(),
            message: format!("Failed to commit invoice header: {}", e),
        })?;

        // Insert items
        if let Some(items) = invoice_items_buffer.get(&inv_no) {
            for item in items {
                tx.execute(
                    "INSERT INTO invoice_items (invoice_number, part_code, quantity, rate_pre_unit, assessable_value,
                                                cgst_rate, cgst_amount, sgst_rate, sgst_amount, igst_rate, igst_amount, total_value, hsn_code)
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                    params![
                        item.invoice_number,
                        item.part_code,
                        item.quantity,
                        item.rate_pre_unit,
                        item.assessable_value,
                        item.cgst_rate,
                        item.cgst_amount,
                        item.sgst_rate,
                        item.sgst_amount,
                        item.igst_rate,
                        item.igst_amount,
                        item.total_value,
                        item.hsn_code
                    ],
                )
                .map_err(|e| AppError::Db {
                    code: "ERR_DB_003".to_string(),
                    message: format!("Failed to commit invoice line item: {}", e),
                })?;
            }
        }
    }

    // Rebuild materialized summary rollups for all affected financial years (Phase 5 rollup)
    let report_repo = SqliteReportRepository;
    for fy_id in affected_fy_ids {
        report_repo.refresh_monthly_summary(&tx, fy_id)?;
        report_repo.refresh_customer_summary(&tx, fy_id)?;
        report_repo.refresh_supplier_summary(&tx, fy_id)?;
    }

    // Update batch status to completed
    tx.execute(
        "UPDATE import_batches 
         SET status = 'completed', success_count = ?, warning_count = ?, error_count = ?
         WHERE id = ?",
        params![success_count, warning_count, error_count, batch_id],
    )
    .map_err(|e| AppError::Db {
        code: "ERR_DB_003".to_string(),
        message: format!("Failed to finalize batch record counts: {}", e),
    })?;

    // Central Audit log logging
    tx.execute(
        "INSERT INTO audit_log (user_action, table_name, record_id, old_value, new_value)
         VALUES (?, 'import_batches', ?, NULL, ?)",
        params![
            "Excel Outward Invoices Import Batch Committed",
            batch_id.to_string(),
            format!("Committed: {} rows. File: {}", success_count, file_name)
        ],
    )
    .map_err(|e| AppError::Db {
        code: "ERR_DB_003".to_string(),
        message: format!("Failed to write audit logs: {}", e),
    })?;

    // Commit Transaction
    tx.commit().map_err(|e| AppError::Db {
        code: "ERR_DB_003".to_string(),
        message: format!("Failed to commit import transaction: {}", e),
    })?;

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
    use rusqlite::Connection;

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


