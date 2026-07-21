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

    // Get active FY
    let active_fy_id: i64 = conn
        .query_row(
            "SELECT id FROM financial_years WHERE is_active = 1",
            [],
            |row| row.get(0),
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

        // Extract Part details
        let part_code = row_data
            .get("part_code")
            .map(cell_to_string)
            .unwrap_or_default();
        let part_name = row_data
            .get("part_name")
            .map(cell_to_string)
            .unwrap_or_default();
        let part_exists: bool = tx
            .query_row(
                "SELECT EXISTS(SELECT 1 FROM items WHERE part_code = ?)",
                [&part_code],
                |row| row.get(0),
            )
            .unwrap_or(false);

        if !part_exists && !part_code.is_empty() {
            // Part does not exist in master table - Add to review queue
            tx.execute(
                "INSERT INTO items (part_code, part_name, hsn_code, uom_code, default_gst_rate, status)
                 VALUES (?, ?, '8708.99.00', 'PCS', 18.0, 'Pending_Review')",
                params![part_code, part_name],
            )
            .map_err(|e| AppError::Db {
                code: "ERR_DB_003".to_string(),
                message: format!("Failed to insert item review registry: {}", e),
            })?;
            warning_count += 1;
        }

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
        let mut total_val = row_data.get("total_value").map(cell_to_f64).unwrap_or(0.0);
        if total_val == 0.0 {
            total_val = ass_val + cgst + sgst + igst;
        }

        let item_row = InvoiceItemRow {
            id: None,
            invoice_number: inv_no.clone(),
            part_code,
            quantity: qty,
            rate_pre_unit: rate,
            assessable_value: ass_val,
            cgst_rate,
            cgst_amount: cgst,
            sgst_rate,
            sgst_amount: sgst,
            igst_rate,
            igst_amount: igst,
            total_value: total_val,
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
            });

        header.total_taxable += ass_val;
        header.total_cgst += cgst;
        header.total_sgst += sgst;
        header.total_igst += igst;
        header.total_value += total_val;

        success_count += 1;
    }

    // Flush buffers into database transactions
    for (inv_no, mut header) in invoice_headers_buffer {
        // Imported invoices default to "Imported" status for immediate active visibility
        header.status = "Imported".to_string();

        // Delete existing invoice lines if overwriting
        tx.execute(
            "DELETE FROM invoice_items WHERE invoice_number = ?",
            [&inv_no],
        )
        .map_err(|e| AppError::Db {
            code: "ERR_DB_003".to_string(),
            message: format!("Failed to clear old invoice lines: {}", e),
        })?;
        tx.execute("DELETE FROM invoices WHERE invoice_number = ?", [&inv_no])
            .map_err(|e| AppError::Db {
                code: "ERR_DB_003".to_string(),
                message: format!("Failed to clear old invoice header: {}", e),
            })?;

        // Re-insert header
        tx.execute(
            "INSERT INTO invoices (invoice_number, invoice_date, customer_id, financial_year_id,
                                  total_taxable, total_cgst, total_sgst, total_igst, total_cess, total_value,
                                  reverse_charge, invoice_type, status, import_batch_id)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
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
                                                cgst_rate, cgst_amount, sgst_rate, sgst_amount, igst_rate, igst_amount, total_value)
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
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
                        item.total_value
                    ],
                )
                .map_err(|e| AppError::Db {
                    code: "ERR_DB_003".to_string(),
                    message: format!("Failed to commit invoice line item: {}", e),
                })?;
            }
        }
    }

    // Rebuild materialized summary rollups for the active financial year (Phase 5 rollup)
    let report_repo = SqliteReportRepository;
    report_repo.refresh_monthly_summary(&tx, active_fy_id)?;
    report_repo.refresh_customer_summary(&tx, active_fy_id)?;
    report_repo.refresh_supplier_summary(&tx, active_fy_id)?;

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
