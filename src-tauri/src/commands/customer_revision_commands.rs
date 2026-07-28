use crate::error::AppError;
use crate::models::database_models::{
    CustomerDebitNoteEventRow, CustomerDebitNoteInvoiceMapRow, CustomerDebitNoteRow,
    CustomerDebitNoteSimulation, CustomerPriceHistoryRow, CustomerPriceMasterRow,
    CustomerPriceRevisionItemRow, CustomerPriceRevisionRow, RevisionExcelParseResult,
};
use crate::state::DbState;
use calamine::{open_workbook_auto, Data, Reader};

use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use ts_rs::TS;
use tauri::State;

#[derive(Debug, Serialize, Deserialize, Clone, TS)]
#[ts(export, export_to = "../../src/types/bindings/CustomerDebitNoteApprovalRow.ts")]
pub struct CustomerDebitNoteApprovalRow {
    pub id: Option<i64>,
    pub debit_note_id: i64,
    pub step_order: i32,
    pub step_name: String,
    pub user_id: String,
    pub user_name: String,
    pub action: String,
    pub remarks: Option<String>,
    pub created_at: String,
}

// Convert monetary floats to integer paise/cents (x 100) using half-up rounding
fn float_to_paise(val: f64) -> i64 {
    (val * 100.0).round() as i64
}

// Convert integer paise/cents to float representation (/ 100.0)
fn paise_to_float(val: i64) -> f64 {
    (val as f64) / 100.0
}

/// Helper to log timeline events
fn log_event(
    tx: &Connection,
    debit_note_id: Option<i64>,
    case_id: Option<i64>,
    revision_id: Option<i64>,
    severity: &str,
    event_type: &str,
    details: &str,
    user_name: &str,
) -> Result<(), AppError> {
    tx.execute(
        "INSERT INTO customer_debit_note_events (debit_note_id, case_id, revision_id, event_severity, event_type, event_details, performed_by)
         VALUES (?, ?, ?, ?, ?, ?, ?)",
        params![debit_note_id, case_id, revision_id, severity, event_type, details, user_name],
    )
    .map_err(|e| AppError::Db {
        code: "ERR_DB_003".to_string(),
        message: format!("Failed to log event: {}", e),
    })?;
    Ok(())
}

/// Fetch price master entries
#[tauri::command]
pub fn get_customer_price_master(
    state: State<'_, DbState>,
    customer_id: Option<i64>,
) -> Result<Vec<CustomerPriceMasterRow>, AppError> {
    let conn_guard = state.conn.lock().map_err(|e| AppError::Internal(format!("lock: {e}")))?;
    let conn = conn_guard.as_ref().ok_or_else(|| AppError::Db {
        code: "ERR_DB_002".to_string(),
        message: "No active database connection profile".to_string(),
    })?;

    let sql = match customer_id {
        Some(_) => "SELECT cpm.id, cpm.company_id, cpm.customer_id, c.report_name, cpm.part_number, i.part_name, cpm.current_price, cpm.effective_date, cpm.effective_to, cpm.updated_at
                   FROM customer_price_master cpm
                   JOIN customers c ON cpm.customer_id = c.id
                   LEFT JOIN items i ON cpm.part_number = i.part_code
                   WHERE cpm.customer_id = ? AND cpm.is_deleted = 0
                   ORDER BY cpm.part_number ASC",
        None => "SELECT cpm.id, cpm.company_id, cpm.customer_id, c.report_name, cpm.part_number, i.part_name, cpm.current_price, cpm.effective_date, cpm.effective_to, cpm.updated_at
                 FROM customer_price_master cpm
                 JOIN customers c ON cpm.customer_id = c.id
                 LEFT JOIN items i ON cpm.part_number = i.part_code
                 WHERE cpm.is_deleted = 0
                 ORDER BY c.report_name ASC, cpm.part_number ASC",
    };

    let mut stmt = conn.prepare(sql).map_err(|e| AppError::Db {
        code: "ERR_DB_003".to_string(),
        message: format!("Failed to prepare query: {e}"),
    })?;

    let map_fn = |row: &rusqlite::Row| {
        Ok(CustomerPriceMasterRow {
            id: Some(row.get(0)?),
            company_id: row.get(1)?,
            customer_id: row.get(2)?,
            customer_name: row.get(3)?,
            part_number: row.get(4)?,
            part_description: row.get(5)?,
            current_price: row.get(6)?,
            effective_date: row.get(7)?,
            effective_to: row.get(8)?,
            updated_at: row.get(9)?,
        })
    };

    let rows = match customer_id {
        Some(cid) => stmt.query_map([cid], map_fn),
        None => stmt.query_map([], map_fn),
    }
    .map_err(|e| AppError::Db {
        code: "ERR_DB_003".to_string(),
        message: format!("Query execution failed: {e}"),
    })?;

    let mut list = Vec::new();
    for r in rows {
        list.push(r.map_err(|e| AppError::Db {
            code: "ERR_DB_003".to_string(),
            message: format!("Read row failed: {e}"),
        })?);
    }
    Ok(list)
}

/// Save or update a Customer Price Master entry (auto-closing open-ended NULL dates and logging history)
#[tauri::command]
pub fn save_customer_price_master(
    state: State<'_, DbState>,
    customer_id: i64,
    part_number: String,
    new_price: f64,
    effective_date: String,
    user_name: String,
) -> Result<(), AppError> {
    let mut conn_guard = state.conn.lock().map_err(|e| AppError::Internal(format!("lock: {e}")))?;
    let conn = conn_guard.as_mut().ok_or_else(|| AppError::Db {
        code: "ERR_DB_002".to_string(),
        message: "No active database connection profile".to_string(),
    })?;

    let tx = conn.transaction().map_err(|e| AppError::Db {
        code: "ERR_DB_003".to_string(),
        message: format!("Begin tx failed: {e}"),
    })?;

    // Check previous price in master
    let prev: Option<(i64, f64)> = tx
        .query_row(
            "SELECT id, current_price FROM customer_price_master WHERE customer_id = ? AND part_number = ? AND is_deleted = 0 AND effective_to IS NULL",
            params![customer_id, part_number],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .optional()
        .map_err(|e| AppError::Db {
            code: "ERR_DB_003".to_string(),
            message: format!("Find active master price failed: {e}"),
        })?;

    let old_price = prev.map(|p| p.1).unwrap_or(0.0);
    let diff = new_price - old_price;

    if let Some((prev_id, _)) = prev {
        // Auto-close open ended rate
        tx.execute(
            "UPDATE customer_price_master SET effective_to = ? WHERE id = ?",
            params![effective_date, prev_id],
        )
        .map_err(|e| AppError::Db {
            code: "ERR_DB_003".to_string(),
            message: format!("Auto-close previous rate failed: {e}"),
        })?;
    }

    // Insert new master rate
    tx.execute(
        "INSERT INTO customer_price_master (customer_id, part_number, current_price, effective_date, updated_at)
         VALUES (?, ?, ?, ?, datetime('now'))",
        params![customer_id, part_number, new_price, effective_date],
    )
    .map_err(|e| AppError::Db {
        code: "ERR_DB_003".to_string(),
        message: format!("Insert master rate failed: {e}"),
    })?;

    // Insert history record
    tx.execute(
        "INSERT INTO customer_price_history (customer_id, part_number, old_price, new_price, difference, effective_date, changed_by)
         VALUES (?, ?, ?, ?, ?, ?, ?)",
        params![customer_id, part_number, old_price, new_price, diff, effective_date, user_name],
    )
    .map_err(|e| AppError::Db {
        code: "ERR_DB_003".to_string(),
        message: format!("Insert price history failed: {e}"),
    })?;

    tx.commit().map_err(|e| AppError::Db {
        code: "ERR_DB_003".to_string(),
        message: format!("Commit failed: {e}"),
    })?;

    Ok(())
}

/// Fetch price history
#[tauri::command]
pub fn get_customer_price_history(
    state: State<'_, DbState>,
    customer_id: Option<i64>,
    part_number: Option<String>,
) -> Result<Vec<CustomerPriceHistoryRow>, AppError> {
    let conn_guard = state.conn.lock().map_err(|e| AppError::Internal(format!("lock: {e}")))?;
    let conn = conn_guard.as_ref().ok_or_else(|| AppError::Db {
        code: "ERR_DB_002".to_string(),
        message: "No active database connection profile".to_string(),
    })?;

    let mut sql = "SELECT id, company_id, customer_id, part_number, old_price, new_price, difference, effective_date, revision_no, changed_by, changed_at
                   FROM customer_price_history WHERE 1=1".to_string();
    if customer_id.is_some() {
        sql.push_str(" AND customer_id = ?1");
    }
    if part_number.is_some() {
        sql.push_str(" AND part_number = ?2");
    }
    sql.push_str(" ORDER BY changed_at DESC");

    let mut stmt = conn.prepare(&sql).map_err(|e| AppError::Db {
        code: "ERR_DB_003".to_string(),
        message: format!("Prepare price history query failed: {e}"),
    })?;

    let rows = stmt
        .query_map(params![customer_id, part_number], |row| {
            Ok(CustomerPriceHistoryRow {
                id: Some(row.get(0)?),
                company_id: row.get(1)?,
                customer_id: row.get(2)?,
                part_number: row.get(3)?,
                old_price: row.get(4)?,
                new_price: row.get(5)?,
                difference: row.get(6)?,
                effective_date: row.get(7)?,
                revision_no: row.get(8)?,
                changed_by: row.get(9)?,
                changed_at: row.get(10)?,
            })
        })
        .map_err(|e| AppError::Db {
            code: "ERR_DB_003".to_string(),
            message: format!("Execute price history query failed: {e}"),
        })?;

    let mut list = Vec::new();
    for r in rows {
        list.push(r.map_err(|e| AppError::Db {
            code: "ERR_DB_003".to_string(),
            message: format!("Read price history row failed: {e}"),
        })?);
    }
    Ok(list)
}

/// Create a new Price Revision sheet
#[tauri::command]
pub fn create_customer_price_revision(
    state: State<'_, DbState>,
    customer_id: i64,
    revision_no: String,
    effective_from: String,
    customer_reference: Option<String>,
    customer_reference_date: Option<String>,
    customer_po: Option<String>,
    remarks: Option<String>,
    items: Vec<CustomerPriceRevisionItemRow>,
    user_name: String,
) -> Result<i64, AppError> {
    let mut conn_guard = state.conn.lock().map_err(|e| AppError::Internal(format!("lock: {e}")))?;
    let conn = conn_guard.as_mut().ok_or_else(|| AppError::Db {
        code: "ERR_DB_002".to_string(),
        message: "No active database connection profile".to_string(),
    })?;

    let tx = conn.transaction().map_err(|e| AppError::Db {
        code: "ERR_DB_003".to_string(),
        message: format!("Begin tx failed: {e}"),
    })?;

    let uuid = format!("rev-{}", chrono::Utc::now().timestamp_nanos_opt().unwrap_or(0));

    tx.execute(
        "INSERT INTO customer_price_revisions (uuid, customer_id, revision_no, effective_from, customer_reference, customer_reference_date, customer_po, remarks, status, created_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'Draft', ?)",
        params![uuid, customer_id, revision_no, effective_from, customer_reference, customer_reference_date, customer_po, remarks, user_name],
    )
    .map_err(|e| AppError::Db {
        code: "ERR_DB_003".to_string(),
        message: format!("Insert price revision failed: {e}"),
    })?;

    let revision_id = tx.last_insert_rowid();

    for item in &items {
      let diff = item.new_price - item.old_price;

        tx.execute(
            "INSERT INTO customer_price_revision_items (revision_id, part_number, old_price, new_price, difference, price_source, remarks)
             VALUES (?, ?, ?, ?, ?, ?, ?)",
            params![revision_id, item.part_number, item.old_price, item.new_price, diff, item.price_source, item.remarks],
        )
        .map_err(|e| AppError::Db {
            code: "ERR_DB_003".to_string(),
            message: format!("Insert revision line failed: {e}"),
        })?;
    }

    log_event(
        &tx,
        None,
        None,
        Some(revision_id),
        "INFO",
        "Revision Created",
        &format!("Created price revision {} with {} items", revision_no, items.len()),
        &user_name,
    )?;

    tx.commit().map_err(|e| AppError::Db {
        code: "ERR_DB_003".to_string(),
        message: format!("Commit revision failed: {e}"),
    })?;

    Ok(revision_id)
}

/// Fetch list of revisions
#[tauri::command]
pub fn get_customer_price_revisions(
    state: State<'_, DbState>,
    customer_id: Option<i64>,
) -> Result<Vec<CustomerPriceRevisionRow>, AppError> {
    let conn_guard = state.conn.lock().map_err(|e| AppError::Internal(format!("lock: {e}")))?;
    let conn = conn_guard.as_ref().ok_or_else(|| AppError::Db {
        code: "ERR_DB_002".to_string(),
        message: "No active database connection profile".to_string(),
    })?;

    let sql = match customer_id {
        Some(_) => "SELECT r.id, r.uuid, r.company_id, r.customer_id, c.report_name, c.customer_code, r.parent_revision_id, r.revision_no, r.effective_from, r.customer_reference, r.customer_reference_date, r.customer_po, r.remarks, r.status, r.version, r.workflow_version, r.created_by, r.created_date, r.updated_at
                   FROM customer_price_revisions r
                   JOIN customers c ON r.customer_id = c.id
                   WHERE r.customer_id = ? AND r.is_deleted = 0
                   ORDER BY r.created_date DESC",
        None => "SELECT r.id, r.uuid, r.company_id, r.customer_id, c.report_name, c.customer_code, r.parent_revision_id, r.revision_no, r.effective_from, r.customer_reference, r.customer_reference_date, r.customer_po, r.remarks, r.status, r.version, r.workflow_version, r.created_by, r.created_date, r.updated_at
                 FROM customer_price_revisions r
                 JOIN customers c ON r.customer_id = c.id
                 WHERE r.is_deleted = 0
                 ORDER BY r.created_date DESC",
    };

    let mut stmt = conn.prepare(sql).map_err(|e| AppError::Db {
        code: "ERR_DB_003".to_string(),
        message: format!("Prepare revision list query failed: {e}"),
    })?;

    let map_fn = |row: &rusqlite::Row| {
        Ok(CustomerPriceRevisionRow {
            id: Some(row.get(0)?),
            uuid: row.get(1)?,
            company_id: row.get(2)?,
            customer_id: row.get(3)?,
            customer_name: row.get(4)?,
            customer_code: row.get(5)?,
            parent_revision_id: row.get(6)?,
            revision_no: row.get(7)?,
            effective_from: row.get(8)?,
            customer_reference: row.get(9)?,
            customer_reference_date: row.get(10)?,
            customer_po: row.get(11)?,
            remarks: row.get(12)?,
            status: row.get(13)?,
            version: row.get(14)?,
            workflow_version: row.get(15)?,
            created_by: row.get(16)?,
            created_date: row.get(17)?,
            updated_at: row.get(18)?,
        })
    };

    let rows = match customer_id {
        Some(cid) => stmt.query_map([cid], map_fn),
        None => stmt.query_map([], map_fn),
    }
    .map_err(|e| AppError::Db {
        code: "ERR_DB_003".to_string(),
        message: format!("Execute revision list failed: {e}"),
    })?;

    let mut list = Vec::new();
    for r in rows {
        list.push(r.map_err(|e| AppError::Db {
            code: "ERR_DB_003".to_string(),
            message: format!("Read revision row failed: {e}"),
        })?);
    }
    Ok(list)
}

/// Fetch single revision header + lines
#[tauri::command]
pub fn get_customer_price_revision_details(
    state: State<'_, DbState>,
    revision_id: i64,
) -> Result<(CustomerPriceRevisionRow, Vec<CustomerPriceRevisionItemRow>), AppError> {
    let conn_guard = state.conn.lock().map_err(|e| AppError::Internal(format!("lock: {e}")))?;
    let conn = conn_guard.as_ref().ok_or_else(|| AppError::Db {
        code: "ERR_DB_002".to_string(),
        message: "No active database connection profile".to_string(),
    })?;

    let header: CustomerPriceRevisionRow = conn
        .query_row(
            "SELECT r.id, r.uuid, r.company_id, r.customer_id, c.report_name, c.customer_code, r.parent_revision_id, r.revision_no, r.effective_from, r.customer_reference, r.customer_reference_date, r.customer_po, r.remarks, r.status, r.version, r.workflow_version, r.created_by, r.created_date, r.updated_at
             FROM customer_price_revisions r
             JOIN customers c ON r.customer_id = c.id
             WHERE r.id = ? AND r.is_deleted = 0",
            [revision_id],
            |row| {
                Ok(CustomerPriceRevisionRow {
                    id: Some(row.get(0)?),
                    uuid: row.get(1)?,
                    company_id: row.get(2)?,
                    customer_id: row.get(3)?,
                    customer_name: row.get(4)?,
                    customer_code: row.get(5)?,
                    parent_revision_id: row.get(6)?,
                    revision_no: row.get(7)?,
                    effective_from: row.get(8)?,
                    customer_reference: row.get(9)?,
                    customer_reference_date: row.get(10)?,
                    customer_po: row.get(11)?,
                    remarks: row.get(12)?,
                    status: row.get(13)?,
                    version: row.get(14)?,
                    workflow_version: row.get(15)?,
                    created_by: row.get(16)?,
                    created_date: row.get(17)?,
                    updated_at: row.get(18)?,
                })
            },
        )
        .map_err(|e| AppError::Db {
            code: "ERR_DB_003".to_string(),
            message: format!("Fetch revision header failed: {e}"),
        })?;

    let mut stmt = conn
        .prepare(
            "SELECT ri.id, ri.revision_id, ri.part_number, i.part_name, ri.old_price, ri.new_price, ri.difference, ri.price_source, ri.remarks
             FROM customer_price_revision_items ri
             LEFT JOIN items i ON ri.part_number = i.part_code
             WHERE ri.revision_id = ?
             ORDER BY ri.part_number ASC",
        )
        .map_err(|e| AppError::Db {
            code: "ERR_DB_003".to_string(),
            message: format!("Prepare revision items query failed: {e}"),
        })?;

    let item_rows = stmt
        .query_map([revision_id], |row| {
            Ok(CustomerPriceRevisionItemRow {
                id: Some(row.get(0)?),
                revision_id: row.get(1)?,
                part_number: row.get(2)?,
                part_description: row.get(3)?,
                old_price: row.get(4)?,
                new_price: row.get(5)?,
                difference: row.get(6)?,
                price_source: row.get(7)?,
                remarks: row.get(8)?,
            })
        })
        .map_err(|e| AppError::Db {
            code: "ERR_DB_003".to_string(),
            message: format!("Execute revision items query failed: {e}"),
        })?;

    let mut items = Vec::new();
    for item in item_rows {
        items.push(item.map_err(|e| AppError::Db {
            code: "ERR_DB_003".to_string(),
            message: format!("Read revision item failed: {e}"),
        })?);
    }

    Ok((header, items))
}

/// Parse Excel price revision file using calamine
#[tauri::command]
pub fn parse_customer_revision_excel(file_path: String) -> Result<RevisionExcelParseResult, AppError> {
    let mut workbook = open_workbook_auto(&file_path).map_err(|e| AppError::Excel(format!("Failed to open Excel file: {e}")))?;

    let sheets = workbook.sheet_names().to_vec();
    if sheets.is_empty() {
        return Err(AppError::Excel("Excel file contains no worksheets".to_string()));
    }

    let range = workbook.worksheet_range(&sheets[0]).map_err(|e| AppError::Excel(format!("Failed to read sheet: {e}")))?;

    let mut items = Vec::new();
    let mut validation_errors = Vec::new();
    let mut rows_read = 0;
    let mut valid_count = 0;
    let mut warning_count = 0;
    let mut error_count = 0;

    let rows: Vec<_> = range.rows().collect();
    if rows.len() <= 1 {
        return Ok(RevisionExcelParseResult {
            rows_read: 0,
            valid_count: 0,
            warning_count: 0,
            error_count: 0,
            items: vec![],
            validation_errors: vec!["File has no data rows".to_string()],
        });
    }

    for (idx, row) in rows.iter().enumerate().skip(1) {
        rows_read += 1;
        let row_num = idx + 1;

        let part_code = match row.get(0) {
            Some(Data::String(s)) => s.trim().to_string(),
            Some(Data::Float(f)) => format!("{}", *f as i64),
            Some(Data::Int(i)) => i.to_string(),
            _ => "".to_string(),
        };

        let new_price = match row.get(1) {
            Some(Data::Float(f)) => *f,
            Some(Data::Int(i)) => *i as f64,
            Some(Data::String(s)) => s.trim().parse::<f64>().unwrap_or(0.0),
            _ => 0.0,
        };

        let old_price = match row.get(2) {
            Some(Data::Float(f)) => *f,
            Some(Data::Int(i)) => *i as f64,
            Some(Data::String(s)) => s.trim().parse::<f64>().unwrap_or(0.0),
            _ => 0.0,
        };

        let remarks = match row.get(3) {
            Some(Data::String(s)) => Some(s.trim().to_string()),
            _ => None,
        };


        if part_code.is_empty() {
            error_count += 1;
            validation_errors.push(format!("Row {row_num}: Blank Part Number"));
            continue;
        }

        if new_price <= 0.0 {
            error_count += 1;
            validation_errors.push(format!("Row {row_num}: Invalid or zero New Price ({new_price})"));
            continue;
        }

        if new_price <= old_price && old_price > 0.0 {
            warning_count += 1;
            validation_errors.push(format!(
                "Row {row_num}: New Price ({new_price}) is less than or equal to Old Price ({old_price})"
            ));
        }

        valid_count += 1;
        let diff = new_price - old_price;
        items.push(CustomerPriceRevisionItemRow {
            id: None,
            revision_id: 0,
            part_number: part_code,
            part_description: None,
            old_price,
            new_price,
            difference: diff,
            price_source: "Excel Import".to_string(),
            remarks,
        });
    }

    Ok(RevisionExcelParseResult {
        rows_read,
        valid_count,
        warning_count,
        error_count,
        items,
        validation_errors,
    })
}

/// Writes a blank customer-revision import template as a real .xlsx workbook with
/// a bold header row, ready for the user to fill in and re-import.
#[tauri::command]
pub fn export_customer_revision_template(output_path: String) -> Result<(), AppError> {
    use rust_xlsxwriter::{Format, Workbook};

    let mut workbook = Workbook::new();
    let worksheet = workbook.add_worksheet();
    worksheet
        .set_name("Price Revisions")
        .map_err(|e| AppError::Export {
            code: "ERR_CR_TPL_001".to_string(),
            message: format!("Failed to set worksheet name: {e}"),
        })?;

    let header_fmt = Format::new().set_bold();
    let headers = ["part_number", "new_price", "old_price", "remarks"];
    for (col, header) in headers.iter().enumerate() {
        worksheet
            .write_string_with_format(0, col as u16, *header, &header_fmt)
            .map_err(|e| AppError::Export {
                code: "ERR_CR_TPL_001".to_string(),
                message: format!("Failed to write header '{header}': {e}"),
            })?;
        worksheet.set_column_width(col as u16, 18.0).ok();
    }

    workbook.save(&output_path).map_err(|e| AppError::Export {
        code: "ERR_CR_TPL_001".to_string(),
        message: format!("Failed to save template: {e}"),
    })?;

    Ok(())
}

/// Dry-run simulation of debit note recoveries without persisting database changes
#[tauri::command]
pub fn simulate_customer_debit_note_recovery(
    state: State<'_, DbState>,
    customer_id: i64,
    period_from: String,
    period_to: String,
    items: Vec<CustomerPriceRevisionItemRow>,
    currency: String,
    exchange_rate: f64,
    excluded_invoice_item_ids: Vec<i64>,
) -> Result<CustomerDebitNoteSimulation, AppError> {
    let conn_guard = state.conn.lock().map_err(|e| AppError::Internal(format!("lock: {e}")))?;
    let conn = conn_guard.as_ref().ok_or_else(|| AppError::Db {
        code: "ERR_DB_002".to_string(),
        message: "No active database connection profile".to_string(),
    })?;

    let mut warnings = Vec::new();
    let mut mapped_lines = Vec::new();

    let mut total_taxable = 0.0;
    let mut total_cgst = 0.0;
    let mut total_sgst = 0.0;
    let mut total_igst = 0.0;
    let total_cess = 0.0;
    let mut grand_total = 0.0;
    let mut total_quantity = 0.0;
    let mut invoice_set = std::collections::HashSet::new();

    for rev_item in &items {
        // Query invoices for customer + period + part
        let mut stmt = conn
            .prepare(
                "SELECT i.rowid, i.invoice_number, i.invoice_date, ii.id, ii.part_code, ii.quantity, ii.rate_pre_unit, ii.cgst_rate, ii.sgst_rate, ii.igst_rate, item.part_name, item.uom_code, item.hsn_code, c.state_code, cp.state_code
                 FROM invoice_items ii
                 JOIN invoices i ON ii.invoice_number = i.invoice_number
                 JOIN customers c ON i.customer_id = c.id
                 LEFT JOIN company_profile cp ON cp.id = 1
                 LEFT JOIN items item ON ii.part_code = item.part_code
                 WHERE i.customer_id = ?
                   AND ii.part_code = ?
                   AND i.invoice_date >= ?
                   AND i.invoice_date <= ?
                   AND i.status NOT IN ('Draft', 'Cancelled')",
            )

            .map_err(|e| AppError::Db {
                code: "ERR_DB_003".to_string(),
                message: format!("Prepare simulation query failed: {e}"),
            })?;

        let rows = stmt
            .query_map(
                params![customer_id, rev_item.part_number, period_from, period_to],
                |row| {
                    Ok((
                        row.get::<_, i64>(0)?,
                        row.get::<_, String>(1)?,
                        row.get::<_, String>(2)?,
                        row.get::<_, i64>(3)?,
                        row.get::<_, String>(4)?,
                        row.get::<_, f64>(5)?,
                        row.get::<_, f64>(6)?,
                        row.get::<_, f64>(7)?,
                        row.get::<_, f64>(8)?,
                        row.get::<_, f64>(9)?,
                        row.get::<_, Option<String>>(10)?.unwrap_or_default(),
                        row.get::<_, Option<String>>(11)?.unwrap_or_else(|| "PCS".to_string()),
                        row.get::<_, Option<String>>(12)?.unwrap_or_else(|| "8708.99.00".to_string()),
                        row.get::<_, Option<String>>(13)?,
                        row.get::<_, Option<String>>(14)?,
                    ))
                },
            )
            .map_err(|e| AppError::Db {
                code: "ERR_DB_003".to_string(),
                message: format!("Query simulation failed: {e}"),
            })?;

        for r in rows {
            let (
                inv_id,
                inv_no,
                inv_date,
                inv_item_id,
                part_code,
                qty,
                rate_pre_unit,
                cgst_rate,
                sgst_rate,
                igst_rate,
                part_name,
                uom,
                hsn,
                cust_state,
                comp_state,
            ) = r.map_err(|e| AppError::Db {
                code: "ERR_DB_003".to_string(),
                message: format!("Read simulation line failed: {e}"),
            })?;

            if excluded_invoice_item_ids.contains(&inv_item_id) {
                continue;
            }

            // Check previous recoveries on invoice item line
            let already_recovered: f64 = conn
                .query_row(
                    "SELECT COALESCE(SUM(recovered_qty), 0.0) FROM customer_debit_note_invoice_map WHERE invoice_item_id = ? AND status != 'Cancelled'",
                    [inv_item_id],
                    |r| r.get(0),
                )
                .unwrap_or(0.0);

            let bal_qty = (qty - already_recovered).max(0.0);
            if bal_qty <= 0.0 {
                warnings.push(format!("Invoice {inv_no} part {part_code} is fully recovered. Skipping."));
                continue;
            }

            let old_p = if rev_item.old_price > 0.0 {
                rev_item.old_price
            } else {
                rate_pre_unit
            };

            let diff = rev_item.new_price - old_p;
            if diff <= 0.0 {
                warnings.push(format!("Invoice {inv_no} part {part_code} price diff <= 0. Skipping."));
                continue;
            }

            let rec_qty = bal_qty;
            let assessable_diff = rec_qty * diff;
            let gst_type = if cust_state.as_deref() == comp_state.as_deref() {
                "INTRASTATE".to_string()
            } else {
                "INTERSTATE".to_string()
            };

            let (cgst_amt, sgst_amt, igst_amt) = if gst_type == "INTRASTATE" {
                (
                    assessable_diff * (cgst_rate / 100.0),
                    assessable_diff * (sgst_rate / 100.0),
                    0.0,
                )
            } else {
                (0.0, 0.0, assessable_diff * (igst_rate / 100.0))
            };

            let total_line_diff = assessable_diff + cgst_amt + sgst_amt + igst_amt;

            total_taxable += assessable_diff;
            total_cgst += cgst_amt;
            total_sgst += sgst_amt;
            total_igst += igst_amt;
            grand_total += total_line_diff;
            total_quantity += rec_qty;
            invoice_set.insert(inv_no.clone());

            mapped_lines.push(CustomerDebitNoteInvoiceMapRow {
                id: None,
                debit_note_id: 0,
                invoice_id: inv_id,
                invoice_number: inv_no,
                invoice_date: inv_date,
                invoice_item_id: inv_item_id,
                part_code: part_code.clone(),
                quantity: qty,
                recovered_qty: rec_qty,
                balance_qty: qty - rec_qty,
                recovery_percentage: (rec_qty / qty) * 100.0,
                recovered_value_percentage: (rec_qty / qty) * 100.0,
                rate_pre_unit: old_p,
                new_price: rev_item.new_price,
                difference: diff,
                assessable_difference: assessable_diff,
                cgst_rate,
                cgst_amount: cgst_amt,
                sgst_rate,
                sgst_amount: sgst_amt,
                igst_rate,
                igst_amount: igst_amt,
                cess_amount: 0.0,
                hsn_code: hsn.clone(),
                gst_type,
                total_difference: total_line_diff,
                currency: currency.clone(),
                exchange_rate,
                foreign_total_difference: total_line_diff / exchange_rate,
                status: "Draft".to_string(),
                frozen_part_number: part_code,
                frozen_part_description: part_name,
                frozen_part_uom: uom,
                frozen_part_hsn: hsn,
                frozen_part_drawing_revision: None,
            });
        }
    }

    Ok(CustomerDebitNoteSimulation {
        total_customers: 1,
        total_invoices: invoice_set.len(),
        total_parts: items.len(),
        total_quantity,
        total_taxable,
        total_cgst,
        total_sgst,
        total_igst,
        total_cess,
        grand_total,
        currency,
        warnings,
        items: mapped_lines,
    })
}

/// Generate Customer Debit Note & Annexure inside a SINGLE database transaction
#[tauri::command]
pub fn generate_customer_debit_note(
    state: State<'_, DbState>,
    customer_id: i64,
    revision_id: Option<i64>,
    period_from: String,
    period_to: String,
    debit_note_date: String,
    reference: Option<String>,
    currency: String,
    exchange_rate: f64,
    remarks: Option<String>,
    idempotency_key: Option<String>,
    user_name: String,
    items: Vec<CustomerDebitNoteInvoiceMapRow>,
) -> Result<CustomerDebitNoteRow, AppError> {
    if items.is_empty() {
        return Err(AppError::Validation {
            code: "ERR_DN_001".to_string(),
            message: "Cannot generate debit note with zero selected items".to_string(),
        });
    }

    let mut conn_guard = state.conn.lock().map_err(|e| AppError::Internal(format!("lock: {e}")))?;
    let conn = conn_guard.as_mut().ok_or_else(|| AppError::Db {
        code: "ERR_DB_002".to_string(),
        message: "No active database connection profile".to_string(),
    })?;

    // Idempotency check
    if let Some(ref ikey) = idempotency_key {
        let existing: Option<CustomerDebitNoteRow> = conn
            .query_row(
                "SELECT id, uuid, company_id, case_id, financial_year_id, debit_note_no, annexure_no, customer_id, debit_note_date, reference, total_taxable, total_cgst, total_sgst, total_igst, total_cess, total_value, round_off, currency, exchange_rate, exchange_rate_source, foreign_total_value, outstanding_amount, status, financial_status, template_version, version, idempotency_key, sent_date, payment_date, remarks, created_by, created_at, approved_by, approved_at, cancelled_by, cancelled_date, cancel_reason, frozen_customer_name, frozen_customer_gstin, frozen_customer_address, frozen_customer_state, frozen_customer_country
                 FROM customer_debit_notes WHERE idempotency_key = ?",
                [ikey],
                |r| Ok(CustomerDebitNoteRow {
                    id: Some(r.get(0)?),
                    uuid: r.get(1)?,
                    company_id: r.get(2)?,
                    case_id: r.get(3)?,
                    financial_year_id: r.get(4)?,
                    debit_note_no: r.get(5)?,
                    annexure_no: r.get(6)?,
                    customer_id: r.get(7)?,
                    customer_name: None,
                    customer_code: None,
                    debit_note_date: r.get(8)?,
                    reference: r.get(9)?,
                    total_taxable: paise_to_float(r.get(10)?),
                    total_cgst: paise_to_float(r.get(11)?),
                    total_sgst: paise_to_float(r.get(12)?),
                    total_igst: paise_to_float(r.get(13)?),
                    total_cess: paise_to_float(r.get(14)?),
                    total_value: paise_to_float(r.get(15)?),
                    round_off: paise_to_float(r.get(16)?),
                    currency: r.get(17)?,
                    exchange_rate: r.get(18)?,
                    exchange_rate_source: r.get(19)?,
                    foreign_total_value: paise_to_float(r.get(20)?),
                    outstanding_amount: paise_to_float(r.get(21)?),
                    status: r.get(22)?,
                    financial_status: r.get(23)?,
                    template_version: r.get(24)?,
                    version: r.get(25)?,
                    idempotency_key: r.get(26)?,
                    sent_date: r.get(27)?,
                    payment_date: r.get(28)?,
                    remarks: r.get(29)?,
                    created_by: r.get(30)?,
                    created_at: r.get(31)?,
                    approved_by: r.get(32)?,
                    approved_at: r.get(33)?,
                    cancelled_by: r.get(34)?,
                    cancelled_date: r.get(35)?,
                    cancel_reason: r.get(36)?,
                    frozen_customer_name: r.get(37)?,
                    frozen_customer_gstin: r.get(38)?,
                    frozen_customer_address: r.get(39)?,
                    frozen_customer_state: r.get(40)?,
                    frozen_customer_country: r.get(41)?,
                }),
            )
            .optional()
            .map_err(|e| AppError::Db {
                code: "ERR_DB_003".to_string(),
                message: format!("Idempotency query failed: {e}"),
            })?;

        if let Some(dn) = existing {
            return Ok(dn);
        }
    }

    // Begin single database transaction boundary
    let tx = conn.transaction().map_err(|e| AppError::Db {
        code: "ERR_DB_003".to_string(),
        message: format!("Begin generation transaction failed: {e}"),
    })?;

    // Load active customer master details for frozen snapshot
    let (cust_name, cust_gstin, cust_addr, cust_state): (String, Option<String>, Option<String>, Option<String>) = tx
        .query_row(
            "SELECT report_name, gstin, address1, state_code FROM customers WHERE id = ?",
            [customer_id],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)),
        )
        .map_err(|e| AppError::Db {
            code: "ERR_DB_003".to_string(),
            message: format!("Fetch customer master failed: {e}"),
        })?;

    // Check financial year
    let fy_id: i64 = tx
        .query_row(
            "SELECT id FROM financial_years WHERE is_active = 1 AND is_locked = 0 LIMIT 1",
            [],
            |r| r.get(0),
        )
        .unwrap_or(1);

    // Create Recovery Case
    let case_uuid = format!("case-{}", chrono::Utc::now().timestamp_nanos_opt().unwrap_or(0));
    let case_no = format!("RC-{}", chrono::Utc::now().timestamp_millis());

    tx.execute(
        "INSERT INTO customer_recovery_cases (uuid, case_no, customer_id, revision_id, financial_year_id, period_from, period_to, created_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        params![case_uuid, case_no, customer_id, revision_id, fy_id, period_from, period_to, user_name],
    )
    .map_err(|e| AppError::Db {
        code: "ERR_DB_003".to_string(),
        message: format!("Create recovery case failed: {e}"),
    })?;

    let case_id = tx.last_insert_rowid();

    // Auto-generate Debit Note number sequentially (gapless within tx)
    let dn_count: i64 = tx
        .query_row("SELECT COUNT(*) FROM customer_debit_notes", [], |r| r.get(0))
        .unwrap_or(0);
    let debit_note_no = format!("CDN{:05}", dn_count + 1);
    let annexure_no = format!("{debit_note_no}-A");
    let dn_uuid = format!("cdn-{}", chrono::Utc::now().timestamp_nanos_opt().unwrap_or(0));

    let mut tot_taxable = 0.0;
    let mut tot_cgst = 0.0;
    let mut tot_sgst = 0.0;
    let mut tot_igst = 0.0;
    let tot_cess = 0.0;
    let mut tot_value = 0.0;

    for it in &items {
        tot_taxable += it.assessable_difference;
        tot_cgst += it.cgst_amount;
        tot_sgst += it.sgst_amount;
        tot_igst += it.igst_amount;
        tot_value += it.total_difference;
    }

    let tot_taxable_paise = float_to_paise(tot_taxable);
    let tot_cgst_paise = float_to_paise(tot_cgst);
    let tot_sgst_paise = float_to_paise(tot_sgst);
    let tot_igst_paise = float_to_paise(tot_igst);
    let tot_cess_paise = float_to_paise(tot_cess);
    let tot_value_paise = float_to_paise(tot_value);

    // Insert Customer Debit Note Header
    tx.execute(
        "INSERT INTO customer_debit_notes (uuid, case_id, financial_year_id, debit_note_no, annexure_no, customer_id, debit_note_date, reference, total_taxable, total_cgst, total_sgst, total_igst, total_cess, total_value, currency, exchange_rate, foreign_total_value, outstanding_amount, status, financial_status, idempotency_key, remarks, created_by, frozen_customer_name, frozen_customer_gstin, frozen_customer_address, frozen_customer_state)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Created', 'Pending', ?, ?, ?, ?, ?, ?, ?)",
        params![
            dn_uuid,
            case_id,
            fy_id,
            debit_note_no,
            annexure_no,
            customer_id,
            debit_note_date,
            reference,
            tot_taxable_paise,
            tot_cgst_paise,
            tot_sgst_paise,
            tot_igst_paise,
            tot_cess_paise,
            tot_value_paise,
            currency,
            exchange_rate,
            float_to_paise(tot_value / exchange_rate),
            tot_value_paise,
            idempotency_key,
            remarks,
            user_name,
            cust_name,
            cust_gstin,
            cust_addr,
            cust_state
        ],
    )
    .map_err(|e| AppError::Db {
        code: "ERR_DB_003".to_string(),
        message: format!("Insert debit note header failed: {e}"),
    })?;

    let debit_note_id = tx.last_insert_rowid();

    // Insert Debit Note Lines (Invoice Lock Map)
    for it in &items {
        tx.execute(
            "INSERT INTO customer_debit_note_invoice_map (debit_note_id, invoice_id, invoice_number, invoice_item_id, part_code, quantity, recovered_qty, balance_qty, recovery_percentage, recovered_value_percentage, rate_pre_unit, new_price, difference, assessable_difference, cgst_rate, cgst_amount, sgst_rate, sgst_amount, igst_rate, igst_amount, cess_amount, hsn_code, gst_type, total_difference, currency, exchange_rate, foreign_total_difference, status, frozen_part_number, frozen_part_description, frozen_part_uom, frozen_part_hsn, invoice_date)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Draft', ?, ?, ?, ?, ?)",
            params![
                debit_note_id,
                it.invoice_id,
                it.invoice_number,
                it.invoice_item_id,
                it.part_code,
                it.quantity,
                it.recovered_qty,
                it.balance_qty,
                it.recovery_percentage,
                it.recovered_value_percentage,
                it.rate_pre_unit,
                it.new_price,
                it.difference,
                float_to_paise(it.assessable_difference),
                it.cgst_rate,
                float_to_paise(it.cgst_amount),
                it.sgst_rate,
                float_to_paise(it.sgst_amount),
                it.igst_rate,
                float_to_paise(it.igst_amount),
                float_to_paise(it.cess_amount),
                it.hsn_code,
                it.gst_type,
                float_to_paise(it.total_difference),
                it.currency,
                it.exchange_rate,
                float_to_paise(it.foreign_total_difference),
                it.frozen_part_number,
                it.frozen_part_description,
                it.frozen_part_uom,
                it.frozen_part_hsn,
                it.invoice_date
            ],
        )

        .map_err(|e| AppError::Db {
            code: "ERR_DB_003".to_string(),
            message: format!("Insert invoice mapping row failed: {e}"),
        })?;
    }

    // Insert Accounting Journal placeholder entry
    let journal_no = format!("JNL-{}", chrono::Utc::now().timestamp_millis());
    tx.execute(
        "INSERT INTO customer_debit_note_journal_entries (debit_note_id, journal_number, voucher_date, financial_year_id, currency, exchange_rate, account_code, account_name, entry_type, amount, posted_by, posting_status)
         VALUES (?, ?, ?, ?, ?, ?, '1100-AR', 'Customer Accounts Receivable', 'DEBIT', ?, ?, 'Pending')",
        params![debit_note_id, journal_no, debit_note_date, fy_id, currency, exchange_rate, tot_value_paise, user_name],
    )
    .map_err(|e| AppError::Db {
        code: "ERR_DB_003".to_string(),
        message: format!("Insert journal entry failed: {e}"),
    })?;

    // Update Recovery Case Rollup summary
    tx.execute(
        "UPDATE customer_recovery_cases SET total_invoices = ?, total_quantity = ?, total_recoverable_amount = ?, recovered_amount = ?, balance_amount = ? WHERE id = ?",
        params![items.len(), tot_taxable_paise, tot_value_paise, tot_value_paise, 0, case_id],
    )
    .map_err(|e| AppError::Db {
        code: "ERR_DB_003".to_string(),
        message: format!("Update recovery case rollup failed: {e}"),
    })?;

    // Log timeline event
    log_event(
        &tx,
        Some(debit_note_id),
        Some(case_id),
        revision_id,
        "INFO",
        "Debit Note Generated",
        &format!("Generated customer debit note {} for ₹{:.2}", debit_note_no, tot_value),
        &user_name,
    )?;

    tx.commit().map_err(|e| AppError::Db {
        code: "ERR_DB_003".to_string(),
        message: format!("Commit debit note generation failed: {e}"),
    })?;

    Ok(CustomerDebitNoteRow {
        id: Some(debit_note_id),
        uuid: dn_uuid,
        company_id: 1,
        case_id,
        financial_year_id: fy_id,
        debit_note_no,
        annexure_no,
        customer_id,
        customer_name: Some(cust_name.clone()),
        customer_code: None,
        debit_note_date,
        reference,
        total_taxable: tot_taxable,
        total_cgst: tot_cgst,
        total_sgst: tot_sgst,
        total_igst: tot_igst,
        total_cess: tot_cess,
        total_value: tot_value,
        round_off: 0.0,
        currency,
        exchange_rate,
        exchange_rate_source: "Manual".to_string(),
        foreign_total_value: tot_value / exchange_rate,
        outstanding_amount: tot_value,
        status: "Created".to_string(),
        financial_status: "Pending".to_string(),
        template_version: "1.0".to_string(),
        version: 1,
        idempotency_key,
        sent_date: None,
        payment_date: None,
        remarks,
        created_by: user_name,
        created_at: chrono::Utc::now().to_rfc3339(),
        approved_by: None,
        approved_at: None,
        cancelled_by: None,
        cancelled_date: None,
        cancel_reason: None,
        frozen_customer_name: cust_name,
        frozen_customer_gstin: cust_gstin,
        frozen_customer_address: cust_addr,
        frozen_customer_state: cust_state,
        frozen_customer_country: Some("India".to_string()),
    })
}

/// Fetch list of generated Customer Debit Notes
#[tauri::command]
pub fn list_customer_debit_notes(
    state: State<'_, DbState>,
    customer_id: Option<i64>,
    status_filter: Option<String>,
) -> Result<Vec<CustomerDebitNoteRow>, AppError> {
    let conn_guard = state.conn.lock().map_err(|e| AppError::Internal(format!("lock: {e}")))?;
    let conn = conn_guard.as_ref().ok_or_else(|| AppError::Db {
        code: "ERR_DB_002".to_string(),
        message: "No active database connection profile".to_string(),
    })?;

    let mut sql = "SELECT dn.id, dn.uuid, dn.company_id, dn.case_id, dn.financial_year_id, dn.debit_note_no, dn.annexure_no, dn.customer_id, c.report_name, c.customer_code, dn.debit_note_date, dn.reference, dn.total_taxable, dn.total_cgst, dn.total_sgst, dn.total_igst, dn.total_cess, dn.total_value, dn.round_off, dn.currency, dn.exchange_rate, dn.exchange_rate_source, dn.foreign_total_value, dn.outstanding_amount, dn.status, dn.financial_status, dn.template_version, dn.version, dn.idempotency_key, dn.sent_date, dn.payment_date, dn.remarks, dn.created_by, dn.created_at, dn.approved_by, dn.approved_at, dn.cancelled_by, dn.cancelled_date, dn.cancel_reason, dn.frozen_customer_name, dn.frozen_customer_gstin, dn.frozen_customer_address, dn.frozen_customer_state, dn.frozen_customer_country
                   FROM customer_debit_notes dn
                   JOIN customers c ON dn.customer_id = c.id
                   WHERE dn.is_deleted = 0".to_string();

    let mut query_params: Vec<Box<dyn rusqlite::ToSql>> = Vec::new();
    if let Some(cid) = customer_id {
        sql.push_str(" AND dn.customer_id = ?");
        query_params.push(Box::new(cid));
    }
    if let Some(ref st) = status_filter {
        if st != "ALL" {
            sql.push_str(" AND dn.status = ?");
            query_params.push(Box::new(st.clone()));
        }
    }
    sql.push_str(" ORDER BY dn.created_at DESC");

    let mut stmt = conn.prepare(&sql).map_err(|e| AppError::Db {
        code: "ERR_DB_003".to_string(),
        message: format!("Prepare list debit notes query failed: {e}"),
    })?;

    let param_refs: Vec<&dyn rusqlite::ToSql> = query_params.iter().map(|p| p.as_ref()).collect();

    let rows = stmt
        .query_map(param_refs.as_slice(), |row| {

            Ok(CustomerDebitNoteRow {
                id: Some(row.get(0)?),
                uuid: row.get(1)?,
                company_id: row.get(2)?,
                case_id: row.get(3)?,
                financial_year_id: row.get(4)?,
                debit_note_no: row.get(5)?,
                annexure_no: row.get(6)?,
                customer_id: row.get(7)?,
                customer_name: row.get(8)?,
                customer_code: row.get(9)?,
                debit_note_date: row.get(10)?,
                reference: row.get(11)?,
                total_taxable: paise_to_float(row.get(12)?),
                total_cgst: paise_to_float(row.get(13)?),
                total_sgst: paise_to_float(row.get(14)?),
                total_igst: paise_to_float(row.get(15)?),
                total_cess: paise_to_float(row.get(16)?),
                total_value: paise_to_float(row.get(17)?),
                round_off: paise_to_float(row.get(18)?),
                currency: row.get(19)?,
                exchange_rate: row.get(20)?,
                exchange_rate_source: row.get(21)?,
                foreign_total_value: paise_to_float(row.get(22)?),
                outstanding_amount: paise_to_float(row.get(23)?),
                status: row.get(24)?,
                financial_status: row.get(25)?,
                template_version: row.get(26)?,
                version: row.get(27)?,
                idempotency_key: row.get(28)?,
                sent_date: row.get(29)?,
                payment_date: row.get(30)?,
                remarks: row.get(31)?,
                created_by: row.get(32)?,
                created_at: row.get(33)?,
                approved_by: row.get(34)?,
                approved_at: row.get(35)?,
                cancelled_by: row.get(36)?,
                cancelled_date: row.get(37)?,
                cancel_reason: row.get(38)?,
                frozen_customer_name: row.get(39)?,
                frozen_customer_gstin: row.get(40)?,
                frozen_customer_address: row.get(41)?,
                frozen_customer_state: row.get(42)?,
                frozen_customer_country: row.get(43)?,
            })
        })
        .map_err(|e| AppError::Db {
            code: "ERR_DB_003".to_string(),
            message: format!("Execute list debit notes failed: {e}"),
        })?;

    let mut list = Vec::new();
    for r in rows {
        list.push(r.map_err(|e| AppError::Db {
            code: "ERR_DB_003".to_string(),
            message: format!("Read debit note row failed: {e}"),
        })?);
    }
    Ok(list)
}

/// Fetch debit note header, invoice lock mapping lines, timeline events, and approvals
#[tauri::command]
pub fn get_customer_debit_note_details(
    state: State<'_, DbState>,
    debit_note_id: i64,
) -> Result<
    (
        CustomerDebitNoteRow,
        Vec<CustomerDebitNoteInvoiceMapRow>,
        Vec<CustomerDebitNoteEventRow>,
        Vec<CustomerDebitNoteApprovalRow>,
    ),
    AppError,
> {
    let conn_guard = state.conn.lock().map_err(|e| AppError::Internal(format!("lock: {e}")))?;
    let conn = conn_guard.as_ref().ok_or_else(|| AppError::Db {
        code: "ERR_DB_002".to_string(),
        message: "No active database connection profile".to_string(),
    })?;

    let header: CustomerDebitNoteRow = conn
        .query_row(
            "SELECT dn.id, dn.uuid, dn.company_id, dn.case_id, dn.financial_year_id, dn.debit_note_no, dn.annexure_no, dn.customer_id, c.report_name, c.customer_code, dn.debit_note_date, dn.reference, dn.total_taxable, dn.total_cgst, dn.total_sgst, dn.total_igst, dn.total_cess, dn.total_value, dn.round_off, dn.currency, dn.exchange_rate, dn.exchange_rate_source, dn.foreign_total_value, dn.outstanding_amount, dn.status, dn.financial_status, dn.template_version, dn.version, dn.idempotency_key, dn.sent_date, dn.payment_date, dn.remarks, dn.created_by, dn.created_at, dn.approved_by, dn.approved_at, dn.cancelled_by, dn.cancelled_date, dn.cancel_reason, dn.frozen_customer_name, dn.frozen_customer_gstin, dn.frozen_customer_address, dn.frozen_customer_state, dn.frozen_customer_country
             FROM customer_debit_notes dn
             JOIN customers c ON dn.customer_id = c.id
             WHERE dn.id = ? AND dn.is_deleted = 0",
            [debit_note_id],
            |row| {
                Ok(CustomerDebitNoteRow {
                    id: Some(row.get(0)?),
                    uuid: row.get(1)?,
                    company_id: row.get(2)?,
                    case_id: row.get(3)?,
                    financial_year_id: row.get(4)?,
                    debit_note_no: row.get(5)?,
                    annexure_no: row.get(6)?,
                    customer_id: row.get(7)?,
                    customer_name: row.get(8)?,
                    customer_code: row.get(9)?,
                    debit_note_date: row.get(10)?,
                    reference: row.get(11)?,
                    total_taxable: paise_to_float(row.get(12)?),
                    total_cgst: paise_to_float(row.get(13)?),
                    total_sgst: paise_to_float(row.get(14)?),
                    total_igst: paise_to_float(row.get(15)?),
                    total_cess: paise_to_float(row.get(16)?),
                    total_value: paise_to_float(row.get(17)?),
                    round_off: paise_to_float(row.get(18)?),
                    currency: row.get(19)?,
                    exchange_rate: row.get(20)?,
                    exchange_rate_source: row.get(21)?,
                    foreign_total_value: paise_to_float(row.get(22)?),
                    outstanding_amount: paise_to_float(row.get(23)?),
                    status: row.get(24)?,
                    financial_status: row.get(25)?,
                    template_version: row.get(26)?,
                    version: row.get(27)?,
                    idempotency_key: row.get(28)?,
                    sent_date: row.get(29)?,
                    payment_date: row.get(30)?,
                    remarks: row.get(31)?,
                    created_by: row.get(32)?,
                    created_at: row.get(33)?,
                    approved_by: row.get(34)?,
                    approved_at: row.get(35)?,
                    cancelled_by: row.get(36)?,
                    cancelled_date: row.get(37)?,
                    cancel_reason: row.get(38)?,
                    frozen_customer_name: row.get(39)?,
                    frozen_customer_gstin: row.get(40)?,
                    frozen_customer_address: row.get(41)?,
                    frozen_customer_state: row.get(42)?,
                    frozen_customer_country: row.get(43)?,
                })
            },
        )
        .map_err(|e| AppError::Db {
            code: "ERR_DB_003".to_string(),
            message: format!("Fetch debit note header failed: {e}"),
        })?;

    // Items
    let mut stmt_items = conn
        .prepare(
            "SELECT id, debit_note_id, invoice_id, invoice_number, invoice_item_id, part_code, quantity, recovered_qty, balance_qty, recovery_percentage, recovered_value_percentage, rate_pre_unit, new_price, difference, assessable_difference, cgst_rate, cgst_amount, sgst_rate, sgst_amount, igst_rate, igst_amount, cess_amount, hsn_code, gst_type, total_difference, currency, exchange_rate, foreign_total_difference, status, frozen_part_number, frozen_part_description, frozen_part_uom, frozen_part_hsn, frozen_part_drawing_revision, invoice_date
             FROM customer_debit_note_invoice_map
             WHERE debit_note_id = ?
             ORDER BY invoice_number ASC, part_code ASC",
        )
        .map_err(|e| AppError::Db {
            code: "ERR_DB_003".to_string(),
            message: format!("Prepare map query failed: {e}"),
        })?;

    let item_rows = stmt_items
        .query_map([debit_note_id], |row| {
            Ok(CustomerDebitNoteInvoiceMapRow {
                id: Some(row.get(0)?),
                debit_note_id: row.get(1)?,
                invoice_id: row.get(2)?,
                invoice_number: row.get(3)?,
                invoice_date: row.get::<_, Option<String>>(34)?.unwrap_or_else(|| "N/A".to_string()),
                invoice_item_id: row.get(4)?,
                part_code: row.get(5)?,
                quantity: row.get(6)?,
                recovered_qty: row.get(7)?,
                balance_qty: row.get(8)?,
                recovery_percentage: row.get(9)?,
                recovered_value_percentage: row.get(10)?,
                rate_pre_unit: row.get(11)?,
                new_price: row.get(12)?,
                difference: row.get(13)?,
                assessable_difference: paise_to_float(row.get(14)?),
                cgst_rate: row.get(15)?,
                cgst_amount: paise_to_float(row.get(16)?),
                sgst_rate: row.get(17)?,
                sgst_amount: paise_to_float(row.get(18)?),
                igst_rate: row.get(19)?,
                igst_amount: paise_to_float(row.get(20)?),
                cess_amount: paise_to_float(row.get(21)?),
                hsn_code: row.get(22)?,
                gst_type: row.get(23)?,
                total_difference: paise_to_float(row.get(24)?),
                currency: row.get(25)?,
                exchange_rate: row.get(26)?,
                foreign_total_difference: paise_to_float(row.get(27)?),
                status: row.get(28)?,
                frozen_part_number: row.get(29)?,
                frozen_part_description: row.get::<_, Option<String>>(30)?.unwrap_or_default(),
                frozen_part_uom: row.get::<_, Option<String>>(31)?.unwrap_or_default(),
                frozen_part_hsn: row.get::<_, Option<String>>(32)?.unwrap_or_default(),
                frozen_part_drawing_revision: row.get(33)?,
            })

        })
        .map_err(|e| AppError::Db {
            code: "ERR_DB_003".to_string(),
            message: format!("Execute map query failed: {e}"),
        })?;

    let mut items = Vec::new();
    for it in item_rows {
        items.push(it.map_err(|e| AppError::Db {
            code: "ERR_DB_003".to_string(),
            message: format!("Read map row failed: {e}"),
        })?);
    }

    // Events
    let mut stmt_events = conn
        .prepare(
            "SELECT id, debit_note_id, case_id, revision_id, event_severity, event_type, event_details, event_json, correlation_id, request_id, session_id, performed_by, timestamp
             FROM customer_debit_note_events
             WHERE debit_note_id = ?
             ORDER BY timestamp ASC",
        )
        .map_err(|e| AppError::Db {
            code: "ERR_DB_003".to_string(),
            message: format!("Prepare events query failed: {e}"),
        })?;

    let event_rows = stmt_events
        .query_map([debit_note_id], |row| {
            Ok(CustomerDebitNoteEventRow {
                id: Some(row.get(0)?),
                debit_note_id: row.get(1)?,
                case_id: row.get(2)?,
                revision_id: row.get(3)?,
                event_severity: row.get(4)?,
                event_type: row.get(5)?,
                event_details: row.get(6)?,
                event_json: row.get(7)?,
                correlation_id: row.get(8)?,
                request_id: row.get(9)?,
                session_id: row.get(10)?,
                performed_by: row.get(11)?,
                timestamp: row.get(12)?,
            })
        })
        .map_err(|e| AppError::Db {
            code: "ERR_DB_003".to_string(),
            message: format!("Execute events query failed: {e}"),
        })?;

    let mut events = Vec::new();
    for ev in event_rows {
        events.push(ev.map_err(|e| AppError::Db {
            code: "ERR_DB_003".to_string(),
            message: format!("Read event row failed: {e}"),
        })?);
    }

    // Approvals
    let mut stmt_app = conn
        .prepare(
            "SELECT id, debit_note_id, step_order, step_name, user_id, user_name, action, remarks, created_at
             FROM customer_debit_note_approvals
             WHERE debit_note_id = ?
             ORDER BY step_order ASC",
        )
        .map_err(|e| AppError::Db {
            code: "ERR_DB_003".to_string(),
            message: format!("Prepare approvals query failed: {e}"),
        })?;

    let app_rows = stmt_app
        .query_map([debit_note_id], |row| {
            Ok(CustomerDebitNoteApprovalRow {
                id: Some(row.get(0)?),
                debit_note_id: row.get(1)?,
                step_order: row.get(2)?,
                step_name: row.get(3)?,
                user_id: row.get(4)?,
                user_name: row.get(5)?,
                action: row.get(6)?,
                remarks: row.get(7)?,
                created_at: row.get(8)?,
            })
        })
        .map_err(|e| AppError::Db {
            code: "ERR_DB_003".to_string(),
            message: format!("Execute approvals query failed: {e}"),
        })?;

    let mut approvals = Vec::new();
    for ap in app_rows {
        approvals.push(ap.map_err(|e| AppError::Db {
            code: "ERR_DB_003".to_string(),
            message: format!("Read approval row failed: {e}"),
        })?);
    }

    Ok((header, items, events, approvals))
}

/// Progress status through workflow (Created -> Verified -> Approved -> Posted -> Locked)
#[tauri::command]
pub fn update_customer_debit_note_status(
    state: State<'_, DbState>,
    debit_note_id: i64,
    new_status: String,
    action_name: String,
    remarks: Option<String>,
    user_name: String,
) -> Result<(), AppError> {
    let mut conn_guard = state.conn.lock().map_err(|e| AppError::Internal(format!("lock: {e}")))?;
    let conn = conn_guard.as_mut().ok_or_else(|| AppError::Db {
        code: "ERR_DB_002".to_string(),
        message: "No active database connection profile".to_string(),
    })?;

    let tx = conn.transaction().map_err(|e| AppError::Db {
        code: "ERR_DB_003".to_string(),
        message: format!("Begin tx failed: {e}"),
    })?;

    let app_by = if new_status == "Approved" {
        Some(user_name.clone())
    } else {
        None
    };

    tx.execute(
        "UPDATE customer_debit_notes SET status = ?, approved_by = COALESCE(?, approved_by), approved_at = CASE WHEN ? = 'Approved' THEN datetime('now') ELSE approved_at END, version = version + 1 WHERE id = ?",
        params![new_status, app_by, new_status, debit_note_id],
    )
    .map_err(|e| AppError::Db {
        code: "ERR_DB_003".to_string(),
        message: format!("Update status failed: {e}"),
    })?;

    // Record approval action
    let step_order = match new_status.as_str() {
        "Verified" => 1,
        "Approved" => 2,
        "Posted" => 3,
        "Locked" => 4,
        _ => 5,
    };

    tx.execute(
        "INSERT INTO customer_debit_note_approvals (debit_note_id, step_order, step_name, user_id, user_name, action, remarks)
         VALUES (?, ?, ?, ?, ?, ?, ?)",
        params![debit_note_id, step_order, new_status, user_name, user_name, action_name, remarks],
    )
    .map_err(|e| AppError::Db {
        code: "ERR_DB_003".to_string(),
        message: format!("Insert approval row failed: {e}"),
    })?;

    log_event(
        &tx,
        Some(debit_note_id),
        None,
        None,
        "INFO",
        "Status Changed",
        &format!("Status updated to {} by {}", new_status, user_name),
        &user_name,
    )?;

    tx.commit().map_err(|e| AppError::Db {
        code: "ERR_DB_003".to_string(),
        message: format!("Commit failed: {e}"),
    })?;

    Ok(())
}

/// Cancel a customer debit note & restore invoice quantity balances (Option A restoration policy)
#[tauri::command]
pub fn cancel_customer_debit_note(
    state: State<'_, DbState>,
    debit_note_id: i64,
    cancel_reason: String,
    user_name: String,
) -> Result<(), AppError> {
    let mut conn_guard = state.conn.lock().map_err(|e| AppError::Internal(format!("lock: {e}")))?;
    let conn = conn_guard.as_mut().ok_or_else(|| AppError::Db {
        code: "ERR_DB_002".to_string(),
        message: "No active database connection profile".to_string(),
    })?;

    let tx = conn.transaction().map_err(|e| AppError::Db {
        code: "ERR_DB_003".to_string(),
        message: format!("Begin cancel tx failed: {e}"),
    })?;

    // Check financial status
    let fin_status: String = tx
        .query_row(
            "SELECT financial_status FROM customer_debit_notes WHERE id = ?",
            [debit_note_id],
            |r| r.get(0),
        )
        .map_err(|e| AppError::Db {
            code: "ERR_DB_003".to_string(),
            message: format!("Fetch financial status failed: {e}"),
        })?;

    if fin_status == "Posted to Ledger" {
        // Generate Reversing Journal Entry
        let journal_no = format!("REV-JNL-{}", chrono::Utc::now().timestamp_millis());
        tx.execute(
            "INSERT INTO customer_debit_note_journal_entries (debit_note_id, journal_number, voucher_date, financial_year_id, currency, exchange_rate, account_code, account_name, entry_type, amount, posted_by, posting_status, posting_reference)
             VALUES (?, ?, date('now'), 1, 'INR', 1.0, '1100-AR', 'Customer Accounts Receivable', 'CREDIT', 0, ?, 'Reversed', 'Cancellation Reversal')",
            params![debit_note_id, journal_no, user_name],
        )
        .map_err(|e| AppError::Db {
            code: "ERR_DB_003".to_string(),
            message: format!("Insert reversing journal failed: {e}"),
        })?;
    } else {
        tx.execute(
            "UPDATE customer_debit_note_journal_entries SET posting_status = 'Cancelled' WHERE debit_note_id = ?",
            [debit_note_id],
        )
        .ok();
    }

    // Cancel Debit Note
    tx.execute(
        "UPDATE customer_debit_notes SET status = 'Cancelled', cancelled_by = ?, cancelled_date = datetime('now'), cancel_reason = ? WHERE id = ?",
        params![user_name, cancel_reason, debit_note_id],
    )
    .map_err(|e| AppError::Db {
        code: "ERR_DB_003".to_string(),
        message: format!("Cancel debit note header failed: {e}"),
    })?;

    // Option A: Restore invoice line item balance quantities
    tx.execute(
        "UPDATE customer_debit_note_invoice_map SET status = 'Cancelled', balance_qty = quantity WHERE debit_note_id = ?",
        [debit_note_id],
    )
    .map_err(|e| AppError::Db {
        code: "ERR_DB_003".to_string(),
        message: format!("Restore invoice mapping line balances failed: {e}"),
    })?;

    log_event(
        &tx,
        Some(debit_note_id),
        None,
        None,
        "WARNING",
        "Debit Note Cancelled",
        &format!("Debit note cancelled by {}: {}", user_name, cancel_reason),
        &user_name,
    )?;

    tx.commit().map_err(|e| AppError::Db {
        code: "ERR_DB_003".to_string(),
        message: format!("Commit cancel tx failed: {e}"),
    })?;

    Ok(())
}

/// Log cash recovery payment against Outstanding Amount
#[tauri::command]
pub fn record_customer_debit_note_payment(
    state: State<'_, DbState>,
    debit_note_id: i64,
    payment_amount: f64,
    payment_date: String,
    remarks: Option<String>,
    user_name: String,
) -> Result<(), AppError> {
    let mut conn_guard = state.conn.lock().map_err(|e| AppError::Internal(format!("lock: {e}")))?;
    let conn = conn_guard.as_mut().ok_or_else(|| AppError::Db {
        code: "ERR_DB_002".to_string(),
        message: "No active database connection profile".to_string(),
    })?;

    let tx = conn.transaction().map_err(|e| AppError::Db {
        code: "ERR_DB_003".to_string(),
        message: format!("Begin tx failed: {e}"),
    })?;

    let curr_out_paise: i64 = tx
        .query_row(
            "SELECT outstanding_amount FROM customer_debit_notes WHERE id = ?",
            [debit_note_id],
            |r| r.get(0),
        )
        .map_err(|e| AppError::Db {
            code: "ERR_DB_003".to_string(),
            message: format!("Fetch outstanding failed: {e}"),
        })?;

    let pay_paise = float_to_paise(payment_amount);
    let new_out_paise = (curr_out_paise - pay_paise).max(0);

    let new_fin_status = if new_out_paise == 0 {
        "Paid"
    } else {
        "Partial Paid"
    };

    tx.execute(
        "UPDATE customer_debit_notes SET outstanding_amount = ?, financial_status = ?, payment_date = ? WHERE id = ?",
        params![new_out_paise, new_fin_status, payment_date, debit_note_id],
    )
    .map_err(|e| AppError::Db {
        code: "ERR_DB_003".to_string(),
        message: format!("Update payment failed: {e}"),
    })?;

    log_event(
        &tx,
        Some(debit_note_id),
        None,
        None,
        "INFO",
        "Payment Logged",
        &format!(
            "Payment of ₹{:.2} logged. Remaining outstanding: ₹{:.2} ({})",
            payment_amount,
            paise_to_float(new_out_paise),
            remarks.as_deref().unwrap_or("")
        ),
        &user_name,
    )?;

    tx.commit().map_err(|e| AppError::Db {
        code: "ERR_DB_003".to_string(),
        message: format!("Commit payment failed: {e}"),
    })?;

    Ok(())
}

/// Fetch reports (Customer-Wise, Part-Wise, Invoice-Wise, Monthly, Aging, Statement)
#[tauri::command]
pub fn get_customer_debit_note_reports(
    state: State<'_, DbState>,
    report_type: String,
    _customer_id: Option<i64>,
    _date_from: Option<String>,
    _date_to: Option<String>,
) -> Result<serde_json::Value, AppError> {
    let conn_guard = state.conn.lock().map_err(|e| AppError::Internal(format!("lock: {e}")))?;
    let conn = conn_guard.as_ref().ok_or_else(|| AppError::Db {
        code: "ERR_DB_002".to_string(),
        message: "No active database connection profile".to_string(),
    })?;

    match report_type.as_str() {
        "CUSTOMER_WISE" => {
            let mut stmt = conn
                .prepare(
                    "SELECT c.report_name, c.customer_code, COUNT(dn.id) as dn_count, COALESCE(SUM(dn.total_value), 0) as total_paise, COALESCE(SUM(dn.outstanding_amount), 0) as outstanding_paise
                     FROM customers c
                     LEFT JOIN customer_debit_notes dn ON c.id = dn.customer_id AND dn.status != 'Cancelled' AND dn.is_deleted = 0
                     GROUP BY c.id, c.report_name, c.customer_code
                     ORDER BY total_paise DESC",
                )
                .map_err(|e| AppError::Db {
                    code: "ERR_DB_003".to_string(),
                    message: format!("Prepare report query failed: {e}"),
                })?;

            let rows = stmt
                .query_map([], |row| {
                    let total_paise: i64 = row.get(3)?;
                    let out_paise: i64 = row.get(4)?;
                    Ok(serde_json::json!({
                        "customer_name": row.get::<_, String>(0)?,
                        "customer_code": row.get::<_, String>(1)?,
                        "debit_notes_count": row.get::<_, i64>(2)?,
                        "total_debit_value": paise_to_float(total_paise),
                        "outstanding_amount": paise_to_float(out_paise),
                    }))
                })
                .map_err(|e| AppError::Db {
                    code: "ERR_DB_003".to_string(),
                    message: format!("Execute report failed: {e}"),
                })?;

            let mut list = Vec::new();
            for r in rows {
                list.push(r.map_err(|e| AppError::Db {
                    code: "ERR_DB_003".to_string(),
                    message: format!("Read row failed: {e}"),
                })?);
            }
            Ok(serde_json::json!(list))
        }
        "PART_WISE" => {
            let mut stmt = conn
                .prepare(
                    "SELECT m.part_code, m.frozen_part_description, SUM(m.recovered_qty) as total_qty, COALESCE(AVG(m.difference), 0.0) as avg_diff, COALESCE(SUM(m.total_difference), 0) as total_paise
                     FROM customer_debit_note_invoice_map m
                     JOIN customer_debit_notes dn ON m.debit_note_id = dn.id
                     WHERE dn.status != 'Cancelled' AND dn.is_deleted = 0
                     GROUP BY m.part_code, m.frozen_part_description
                     ORDER BY total_paise DESC",
                )
                .map_err(|e| AppError::Db {
                    code: "ERR_DB_003".to_string(),
                    message: format!("Prepare part report failed: {e}"),
                })?;

            let rows = stmt
                .query_map([], |row| {
                    let total_paise: i64 = row.get(4)?;
                    Ok(serde_json::json!({
                        "part_code": row.get::<_, String>(0)?,
                        "part_description": row.get::<_, String>(1)?,
                        "total_qty": row.get::<_, f64>(2)?,
                        "avg_difference": row.get::<_, f64>(3)?,
                        "total_debit_amount": paise_to_float(total_paise),
                    }))
                })
                .map_err(|e| AppError::Db {
                    code: "ERR_DB_003".to_string(),
                    message: format!("Execute part report failed: {e}"),
                })?;

            let mut list = Vec::new();
            for r in rows {
                list.push(r.map_err(|e| AppError::Db {
                    code: "ERR_DB_003".to_string(),
                    message: format!("Read part row failed: {e}"),
                })?);
            }
            Ok(serde_json::json!(list))
        }
        _ => {
            // Default list breakdown
            let mut stmt = conn
                .prepare(
                    "SELECT dn.debit_note_no, c.report_name, dn.debit_note_date, dn.total_value, dn.outstanding_amount, dn.status, dn.financial_status
                     FROM customer_debit_notes dn
                     JOIN customers c ON dn.customer_id = c.id
                     WHERE dn.is_deleted = 0
                     ORDER BY dn.debit_note_date DESC",
                )
                .map_err(|e| AppError::Db {
                    code: "ERR_DB_003".to_string(),
                    message: format!("Prepare report failed: {e}"),
                })?;

            let rows = stmt
                .query_map([], |row| {
                    let total_paise: i64 = row.get(3)?;
                    let out_paise: i64 = row.get(4)?;
                    Ok(serde_json::json!({
                        "debit_note_no": row.get::<_, String>(0)?,
                        "customer_name": row.get::<_, String>(1)?,
                        "debit_note_date": row.get::<_, String>(2)?,
                        "total_value": paise_to_float(total_paise),
                        "outstanding_amount": paise_to_float(out_paise),
                        "status": row.get::<_, String>(5)?,
                        "financial_status": row.get::<_, String>(6)?,
                    }))
                })
                .map_err(|e| AppError::Db {
                    code: "ERR_DB_003".to_string(),
                    message: format!("Execute report failed: {e}"),
                })?;

            let mut list = Vec::new();
            for r in rows {
                list.push(r.map_err(|e| AppError::Db {
                    code: "ERR_DB_003".to_string(),
                    message: format!("Read row failed: {e}"),
                })?);
            }
            Ok(serde_json::json!(list))
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_float_to_paise_half_up_rounding() {
        assert_eq!(float_to_paise(10.50), 1050);
        assert_eq!(float_to_paise(10.504), 1050);
        assert_eq!(float_to_paise(10.505), 1051);
        assert_eq!(float_to_paise(0.0), 0);
        assert_eq!(paise_to_float(1050), 10.50);
    }

    #[test]
    fn test_price_difference_calculation() {
        let old_price = 100.00;
        let new_price = 105.50;
        let diff = new_price - old_price;
        assert_eq!(diff, 5.50);
        assert_eq!(float_to_paise(diff), 550);
    }
}

