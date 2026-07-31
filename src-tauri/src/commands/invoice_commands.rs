use crate::error::AppError;
use crate::models::database_models::{
    AuditLogRow, CustomerRow, InvoiceItemRow, InvoiceRow, SupplierRow,
};
use crate::models::domain_models::InvoiceSummary;
use crate::repositories::invoice_repo::SqliteInvoiceRepository;
use crate::repositories::report_repo::SqliteReportRepository;
use crate::repositories::InvoiceRepository;
use crate::repositories::ReportRepository;
use crate::state::DbState;
use rusqlite::params;
use tauri::State;

#[tauri::command]
pub fn list_invoices_paginated(
    state: State<'_, DbState>,
    cursor_date: Option<String>,
    cursor_no: Option<String>,
    limit: u32,
) -> Result<Vec<InvoiceSummary>, AppError> {
    let conn_guard = state
        .conn
        .lock()
        .map_err(|e| AppError::Internal(format!("Failed to acquire connection lock: {}", e)))?;
    let conn = conn_guard.as_ref().ok_or_else(|| AppError::Db {
        code: "ERR_DB_002".to_string(),
        message: "No active database connection profile".to_string(),
    })?;

    let repo = SqliteInvoiceRepository;
    repo.list_invoices_paginated(conn, cursor_date.as_deref(), cursor_no.as_deref(), limit)
}

#[tauri::command]
pub fn get_invoice_details(
    state: State<'_, DbState>,
    invoice_number: String,
) -> Result<(InvoiceRow, Vec<InvoiceItemRow>), AppError> {
    let conn_guard = state
        .conn
        .lock()
        .map_err(|e| AppError::Internal(format!("Failed to acquire connection lock: {}", e)))?;
    let conn = conn_guard.as_ref().ok_or_else(|| AppError::Db {
        code: "ERR_DB_002".to_string(),
        message: "No active database connection profile".to_string(),
    })?;

    let repo = SqliteInvoiceRepository;
    let header = repo
        .find_invoice(conn, &invoice_number)?
        .ok_or_else(|| AppError::Validation {
            code: "ERR_DB_003".to_string(),
            message: format!("Invoice not found: {}", invoice_number),
        })?;

    let items = repo.get_invoice_items(conn, &invoice_number)?;
    Ok((header, items))
}

#[tauri::command]
pub fn update_invoice_status(
    state: State<'_, DbState>,
    invoice_number: String,
    status: String,
    user_name: String,
) -> Result<(), AppError> {
    log::info!(
        "Updating status of invoice {} to {}",
        invoice_number,
        status
    );

    let mut conn_guard = state
        .conn
        .lock()
        .map_err(|e| AppError::Internal(format!("Failed to acquire connection lock: {}", e)))?;
    let conn = conn_guard.as_mut().ok_or_else(|| AppError::Db {
        code: "ERR_DB_002".to_string(),
        message: "No active database connection profile".to_string(),
    })?;

    let tx = conn.transaction().map_err(|e| AppError::Db {
        code: "ERR_DB_003".to_string(),
        message: format!("Failed to begin transaction: {}", e),
    })?;

    let repo = SqliteInvoiceRepository;
    let old_invoice =
        repo.find_invoice(&tx, &invoice_number)?
            .ok_or_else(|| AppError::Validation {
                code: "ERR_DB_003".to_string(),
                message: format!("Invoice not found: {}", invoice_number),
            })?;

    // Check financial year locks
    let is_locked: i32 = tx
        .query_row(
            "SELECT is_locked FROM financial_years WHERE id = ?",
            [old_invoice.financial_year_id],
            |row| row.get(0),
        )
        .unwrap_or(0);

    if is_locked == 1 {
        return Err(AppError::Db {
            code: "ERR_DB_001".to_string(),
            message: "Cannot modify invoices in a locked financial year".to_string(),
        });
    }

    // Run status update
    let cancel_date = if status == "Cancelled" {
        "datetime('now')"
    } else {
        "NULL"
    };

    let query = format!(
        "UPDATE invoices SET status = ?, cancellation_date = {}, updated_at = datetime('now') WHERE invoice_number = ?",
        cancel_date
    );

    tx.execute(&query, params![status, invoice_number])
        .map_err(|e| AppError::Db {
            code: "ERR_DB_003".to_string(),
            message: format!("Failed to update invoice status: {}", e),
        })?;

    let old_val_json = serde_json::to_string(&old_invoice).unwrap_or_default();
    let new_invoice = repo.find_invoice(&tx, &invoice_number)?.unwrap();
    let new_val_json = serde_json::to_string(&new_invoice).unwrap_or_default();

    // Central Audit Logging Interceptor
    tx.execute(
        "INSERT INTO audit_log (user_action, table_name, record_id, old_value, new_value)
         VALUES (?, 'invoices', ?, ?, ?)",
        params![
            format!("Invoice status modified to {} by {}", status, user_name),
            invoice_number,
            old_val_json,
            new_val_json
        ],
    )
    .map_err(|e| AppError::Db {
        code: "ERR_DB_003".to_string(),
        message: format!("Failed to write audit logs: {}", e),
    })?;

    let report_repo = SqliteReportRepository;
    report_repo.refresh_monthly_summary(&tx, old_invoice.financial_year_id)?;
    report_repo.refresh_customer_summary(&tx, old_invoice.financial_year_id)?;
    report_repo.refresh_supplier_summary(&tx, old_invoice.financial_year_id)?;

    tx.commit().map_err(|e| AppError::Db {
        code: "ERR_DB_003".to_string(),
        message: format!("Failed to commit status change: {}", e),
    })?;

    if let Ok(mut cache) = state.dashboard_cache.lock() {
        *cache = None;
    }

    Ok(())
}

#[tauri::command]
pub fn delete_invoice_record(
    state: State<'_, DbState>,
    invoice_number: String,
    user_name: String,
) -> Result<(), AppError> {
    log::info!("Deleting invoice record: {}", invoice_number);

    let mut conn_guard = state
        .conn
        .lock()
        .map_err(|e| AppError::Internal(format!("Failed to acquire connection lock: {}", e)))?;
    let conn = conn_guard.as_mut().ok_or_else(|| AppError::Db {
        code: "ERR_DB_002".to_string(),
        message: "No active database connection profile".to_string(),
    })?;

    let tx = conn.transaction().map_err(|e| AppError::Db {
        code: "ERR_DB_003".to_string(),
        message: format!("Failed to begin transaction: {}", e),
    })?;

    let repo = SqliteInvoiceRepository;
    let old_invoice =
        repo.find_invoice(&tx, &invoice_number)?
            .ok_or_else(|| AppError::Validation {
                code: "ERR_DB_003".to_string(),
                message: format!("Invoice not found: {}", invoice_number),
            })?;

    // Check financial year locks
    let is_locked: i32 = tx
        .query_row(
            "SELECT is_locked FROM financial_years WHERE id = ?",
            [old_invoice.financial_year_id],
            |row| row.get(0),
        )
        .unwrap_or(0);

    if is_locked == 1 {
        return Err(AppError::Db {
            code: "ERR_DB_001".to_string(),
            message: "Cannot delete invoices in a locked financial year".to_string(),
        });
    }

    // Delete items first (enforced by foreign keys cascade, but clean to run explicitly)
    tx.execute(
        "DELETE FROM invoice_items WHERE invoice_number = ?",
        [&invoice_number],
    )
    .map_err(|e| AppError::Db {
        code: "ERR_DB_003".to_string(),
        message: format!("Failed to clear invoice line items: {}", e),
    })?;

    tx.execute(
        "DELETE FROM invoices WHERE invoice_number = ?",
        [&invoice_number],
    )
    .map_err(|e| AppError::Db {
        code: "ERR_DB_003".to_string(),
        message: format!("Failed to delete invoice record: {}", e),
    })?;

    let old_val_json = serde_json::to_string(&old_invoice).unwrap_or_default();

    // Central Audit Logging Interceptor
    tx.execute(
        "INSERT INTO audit_log (user_action, table_name, record_id, old_value, new_value)
         VALUES (?, 'invoices', ?, ?, NULL)",
        params![
            format!("Invoice deleted by {}", user_name),
            invoice_number,
            old_val_json
        ],
    )
    .map_err(|e| AppError::Db {
        code: "ERR_DB_003".to_string(),
        message: format!("Failed to write audit logs: {}", e),
    })?;

    let report_repo = SqliteReportRepository;
    report_repo.refresh_monthly_summary(&tx, old_invoice.financial_year_id)?;
    report_repo.refresh_customer_summary(&tx, old_invoice.financial_year_id)?;
    report_repo.refresh_supplier_summary(&tx, old_invoice.financial_year_id)?;

    tx.commit().map_err(|e| AppError::Db {
        code: "ERR_DB_003".to_string(),
        message: format!("Failed to commit delete transaction: {}", e),
    })?;

    if let Ok(mut cache) = state.dashboard_cache.lock() {
        *cache = None;
    }

    Ok(())
}

#[tauri::command]
pub fn get_record_audit_logs(
    state: State<'_, DbState>,
    table_name: String,
    record_id: String,
) -> Result<Vec<AuditLogRow>, AppError> {
    let conn_guard = state
        .conn
        .lock()
        .map_err(|e| AppError::Internal(format!("Failed to acquire connection lock: {}", e)))?;
    let conn = conn_guard.as_ref().ok_or_else(|| AppError::Db {
        code: "ERR_DB_002".to_string(),
        message: "No active database connection profile".to_string(),
    })?;

    let mut stmt = conn
        .prepare(
            "SELECT id, timestamp, user_action, table_name, record_id, old_value, new_value 
             FROM audit_log 
             WHERE table_name = ? AND record_id = ? 
             ORDER BY timestamp DESC",
        )
        .map_err(|e| AppError::Db {
            code: "ERR_DB_003".to_string(),
            message: format!("Failed to prepare audit query: {}", e),
        })?;

    let rows = stmt
        .query_map([table_name, record_id], |row| {
            Ok(AuditLogRow {
                id: Some(row.get(0)?),
                timestamp: row.get(1)?,
                user_action: row.get(2)?,
                table_name: row.get(3)?,
                record_id: row.get(4)?,
                old_value: row.get(5)?,
                new_value: row.get(6)?,
            })
        })
        .map_err(|e| AppError::Db {
            code: "ERR_DB_003".to_string(),
            message: format!("Failed to execute audit query: {}", e),
        })?;

    let mut list = Vec::new();
    for r in rows {
        list.push(r.map_err(|e| AppError::Db {
            code: "ERR_DB_003".to_string(),
            message: format!("Failed to parse audit log row: {}", e),
        })?);
    }

    Ok(list)
}

#[tauri::command]
pub fn get_suppliers_list(state: State<'_, DbState>) -> Result<Vec<SupplierRow>, AppError> {
    let conn_guard = state
        .conn
        .lock()
        .map_err(|e| AppError::Internal(e.to_string()))?;
    let conn = conn_guard.as_ref().ok_or_else(|| AppError::Db {
        code: "ERR_DB_002".to_string(),
        message: "No active database connection profile".to_string(),
    })?;

    let mut stmt = conn.prepare(
        "SELECT id, supplier_code, supplier_name, gstin, state_code, address, status FROM suppliers ORDER BY supplier_name ASC"
    ).map_err(|e| AppError::Db {
        code: "ERR_DB_003".to_string(),
        message: format!("Failed to prepare query: {}", e),
    })?;

    let rows = stmt
        .query_map([], |row| {
            Ok(SupplierRow {
                id: Some(row.get(0)?),
                supplier_code: row.get(1)?,
                supplier_name: row.get(2)?,
                gstin: row.get(3)?,
                state_code: row.get(4)?,
                address: row.get(5)?,
                status: row.get(6)?,
            })
        })
        .map_err(|e| AppError::Db {
            code: "ERR_DB_003".to_string(),
            message: format!("Failed to execute query: {}", e),
        })?;

    let mut list = Vec::new();
    for r in rows {
        list.push(r.map_err(|e| AppError::Db {
            code: "ERR_DB_003".to_string(),
            message: format!("Failed to read supplier row: {}", e),
        })?);
    }
    Ok(list)
}

#[tauri::command]
pub fn get_customers_list(state: State<'_, DbState>) -> Result<Vec<CustomerRow>, AppError> {
    let conn_guard = state
        .conn
        .lock()
        .map_err(|e| AppError::Internal(e.to_string()))?;
    let conn = conn_guard.as_ref().ok_or_else(|| AppError::Db {
        code: "ERR_DB_002".to_string(),
        message: "No active database connection profile".to_string(),
    })?;

    let mut stmt = conn.prepare(
        "SELECT id, customer_code, report_name, tally_customer_name, gstin, state_code, address1, status FROM customers ORDER BY report_name ASC"
    ).map_err(|e| AppError::Db {
        code: "ERR_DB_003".to_string(),
        message: format!("Failed to prepare query: {}", e),
    })?;

    let rows = stmt
        .query_map([], |row| {
            Ok(CustomerRow {
                id: Some(row.get(0)?),
                customer_code: row.get(1)?,
                report_name: row.get(2)?,
                tally_customer_name: row.get(3)?,
                gstin: row.get(4)?,
                state_code: row.get(5)?,
                address1: row.get(6)?,
                status: row.get(7)?,
            })
        })
        .map_err(|e| AppError::Db {
            code: "ERR_DB_003".to_string(),
            message: format!("Failed to execute query: {}", e),
        })?;

    let mut list = Vec::new();
    for r in rows {
        list.push(r.map_err(|e| AppError::Db {
            code: "ERR_DB_003".to_string(),
            message: format!("Failed to read customer row: {}", e),
        })?);
    }
    Ok(list)
}

#[tauri::command]
pub fn bulk_verify_invoices(
    state: State<'_, DbState>,
    selection: crate::models::bulk_action_dto::SelectionModeDTO,
    user_name: Option<String>,
) -> Result<crate::models::bulk_action::BulkActionResult, AppError> {
    let mut conn_guard = state
        .conn
        .lock()
        .map_err(|e| AppError::Internal(format!("Failed to acquire connection lock: {}", e)))?;
    let conn = conn_guard.as_mut().ok_or_else(|| AppError::Db {
        code: "ERR_DB_002".to_string(),
        message: "No active database connection profile".to_string(),
    })?;

    let effective_user = user_name.unwrap_or_else(|| "System User".to_string());
    crate::services::bulk_action_service::BulkActionService::execute_bulk_verify(
        conn,
        &selection,
        &effective_user,
    )
}

#[tauri::command]
pub fn validate_invoice_edit_eligibility(
    state: State<'_, DbState>,
    invoice_number: String,
) -> Result<(), AppError> {
    let conn_guard = state
        .conn
        .lock()
        .map_err(|e| AppError::Internal(format!("Failed to acquire connection lock: {}", e)))?;
    let conn = conn_guard.as_ref().ok_or_else(|| AppError::Db {
        code: "ERR_DB_002".to_string(),
        message: "No active database connection profile".to_string(),
    })?;

    let repo = SqliteInvoiceRepository;
    let inv = repo
        .find_invoice(conn, &invoice_number)?
        .ok_or_else(|| AppError::Validation {
            code: "ERR_DB_003".to_string(),
            message: format!("Invoice not found: {}", invoice_number),
        })?;

    // Check financial year lock
    let is_locked: i32 = conn
        .query_row(
            "SELECT is_locked FROM financial_years WHERE id = ?",
            [inv.financial_year_id],
            |row| row.get(0),
        )
        .unwrap_or(0);

    if is_locked == 1 {
        return Err(AppError::Validation {
            code: "ERR_FY_LOCKED".to_string(),
            message: "Cannot edit invoice in a locked financial year or closed period.".to_string(),
        });
    }

    // Check status eligibility
    if inv.status == "Cancelled" || inv.status == "Closed" {
        return Err(AppError::Validation {
            code: "ERR_INVOICE_STATUS".to_string(),
            message: format!("Invoice with status '{}' cannot be edited.", inv.status),
        });
    }

    // Check references in credit_notes or customer_debit_note_invoice_map
    let cn_count: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM credit_notes WHERE invoice_number = ? AND is_deleted = 0",
            [&invoice_number],
            |row| row.get(0),
        )
        .unwrap_or(0);

    if cn_count > 0 {
        return Err(AppError::Validation {
            code: "ERR_INVOICE_REFERENCED".to_string(),
            message: "Invoice is referenced by an active Credit Note and cannot be edited.".to_string(),
        });
    }

    let dn_count: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM customer_debit_note_invoice_map WHERE invoice_number = ?",
            [&invoice_number],
            |row| row.get(0),
        )
        .unwrap_or(0);

    if dn_count > 0 {
        return Err(AppError::Validation {
            code: "ERR_INVOICE_REFERENCED".to_string(),
            message: "Invoice is referenced by an active Debit Note and cannot be edited.".to_string(),
        });
    }

    Ok(())
}

#[tauri::command]
pub fn update_invoice_record(
    state: State<'_, DbState>,
    payload: crate::models::database_models::InvoiceUpdatePayload,
    user_name: String,
) -> Result<(InvoiceRow, Vec<InvoiceItemRow>), AppError> {
    log::info!("Updating invoice record: {}", payload.invoice_number);

    let trimmed_reason = payload.edit_reason.trim();
    if trimmed_reason.is_empty() {
        return Err(AppError::Validation {
            code: "ERR_VALIDATION_001".to_string(),
            message: "A mandatory modification reason / justification is required.".to_string(),
        });
    }

    let mut conn_guard = state
        .conn
        .lock()
        .map_err(|e| AppError::Internal(format!("Failed to acquire connection lock: {}", e)))?;
    let conn = conn_guard.as_mut().ok_or_else(|| AppError::Db {
        code: "ERR_DB_002".to_string(),
        message: "No active database connection profile".to_string(),
    })?;

    // 1. Transaction Phase
    let tx = conn.transaction().map_err(|e| AppError::Db {
        code: "ERR_DB_003".to_string(),
        message: format!("Failed to begin transaction: {}", e),
    })?;

    let repo = SqliteInvoiceRepository;
    let old_invoice = repo
        .find_invoice(&tx, &payload.invoice_number)?
        .ok_or_else(|| AppError::Validation {
            code: "ERR_DB_003".to_string(),
            message: format!("Invoice not found: {}", payload.invoice_number),
        })?;

    // Optimistic Concurrency Check
    if old_invoice.version != payload.expected_version {
        return Err(AppError::Validation {
            code: "ERR_CONCURRENCY_CONFLICT".to_string(),
            message: "Invoice was modified by another user. Please reload and try again.".to_string(),
        });
    }

    // Financial Year Lock Check
    let is_locked: i32 = tx
        .query_row(
            "SELECT is_locked FROM financial_years WHERE id = ?",
            [old_invoice.financial_year_id],
            |row| row.get(0),
        )
        .unwrap_or(0);

    if is_locked == 1 {
        return Err(AppError::Validation {
            code: "ERR_FY_LOCKED".to_string(),
            message: "Cannot modify invoices in a locked financial year".to_string(),
        });
    }

    // Master Reference Check: Customer
    let cust_count: i64 = tx
        .query_row(
            "SELECT COUNT(*) FROM customers WHERE id = ?",
            [payload.customer_id],
            |row| row.get(0),
        )
        .unwrap_or(0);
    if cust_count == 0 {
        return Err(AppError::Validation {
            code: "ERR_VALIDATION_002".to_string(),
            message: format!("Selected Customer ID ({}) does not exist in master records.", payload.customer_id),
        });
    }

    // Reference Check: Credit / Debit Notes
    let cn_count: i64 = tx
        .query_row(
            "SELECT COUNT(*) FROM credit_notes WHERE invoice_number = ? AND is_deleted = 0",
            [&payload.invoice_number],
            |row| row.get(0),
        )
        .unwrap_or(0);
    if cn_count > 0 {
        return Err(AppError::Validation {
            code: "ERR_INVOICE_REFERENCED".to_string(),
            message: "Invoice is referenced by an active Credit Note and cannot be edited.".to_string(),
        });
    }

    let old_items = repo.get_invoice_items(&tx, &payload.invoice_number)?;

    // Line item validations & calculation
    if payload.items.is_empty() {
        return Err(AppError::Validation {
            code: "ERR_VALIDATION_003".to_string(),
            message: "Invoice must contain at least one line item.".to_string(),
        });
    }

    let mut calc_taxable = 0.0;
    let mut calc_cgst = 0.0;
    let mut calc_sgst = 0.0;
    let mut calc_igst = 0.0;

    struct ProcessedItem {
        id: Option<i64>,
        part_code: String,
        quantity: f64,
        rate_pre_unit: f64,
        assessable_value: f64,
        cgst_rate: f64,
        cgst_amount: f64,
        sgst_rate: f64,
        sgst_amount: f64,
        igst_rate: f64,
        igst_amount: f64,
        total_value: f64,
    }

    let mut processed_items = Vec::new();

    for (idx, item) in payload.items.iter().enumerate() {
        if item.part_code.trim().is_empty() {
            return Err(AppError::Validation {
                code: "ERR_VALIDATION_004".to_string(),
                message: format!("Line item #{}: Part code is required.", idx + 1),
            });
        }
        if item.quantity <= 0.0 {
            return Err(AppError::Validation {
                code: "ERR_VALIDATION_005".to_string(),
                message: format!("Line item #{} ({}): Quantity must be greater than 0.", idx + 1, item.part_code),
            });
        }
        if item.rate_pre_unit < 0.0 {
            return Err(AppError::Validation {
                code: "ERR_VALIDATION_006".to_string(),
                message: format!("Line item #{} ({}): Rate per unit cannot be negative.", idx + 1, item.part_code),
            });
        }

        // Tax Exclusivity Check
        let has_intra = item.cgst_rate > 0.0 || item.sgst_rate > 0.0;
        let has_inter = item.igst_rate > 0.0;
        if has_intra && has_inter {
            return Err(AppError::Validation {
                code: "ERR_TAX_INVALID".to_string(),
                message: format!(
                    "Line item #{} ({}): Cannot apply both CGST/SGST and IGST taxes on the same line item.",
                    idx + 1, item.part_code
                ),
            });
        }

        let assessable = (item.quantity * item.rate_pre_unit * 100.0).round() / 100.0;
        let cgst = (assessable * item.cgst_rate).round() / 100.0;
        let sgst = (assessable * item.sgst_rate).round() / 100.0;
        let igst = (assessable * item.igst_rate).round() / 100.0;
        let line_total = assessable + cgst + sgst + igst;

        calc_taxable += assessable;
        calc_cgst += cgst;
        calc_sgst += sgst;
        calc_igst += igst;

        processed_items.push(ProcessedItem {
            id: item.id,
            part_code: item.part_code.trim().to_string(),
            quantity: item.quantity,
            rate_pre_unit: item.rate_pre_unit,
            assessable_value: assessable,
            cgst_rate: item.cgst_rate,
            cgst_amount: cgst,
            sgst_rate: item.sgst_rate,
            sgst_amount: sgst,
            igst_rate: item.igst_rate,
            igst_amount: igst,
            total_value: line_total,
        });
    }

    let calc_total_value = calc_taxable + calc_cgst + calc_sgst + calc_igst;

    // Update Header with Version Increment
    let rows_updated = tx.execute(
        "UPDATE invoices
         SET customer_id = ?,
             place_of_supply = ?,
             reverse_charge = ?,
             invoice_type = ?,
             irn = ?,
             irn_date = ?,
             status = ?,
             total_taxable = ?,
             total_cgst = ?,
             total_sgst = ?,
             total_igst = ?,
             total_value = ?,
             updated_at = datetime('now'),
             version = version + 1
         WHERE invoice_number = ? AND version = ?",
        params![
            payload.customer_id,
            payload.place_of_supply,
            payload.reverse_charge.unwrap_or_else(|| "N".to_string()),
            payload.invoice_type.unwrap_or_else(|| "Regular B2B".to_string()),
            payload.irn,
            payload.irn_date,
            payload.status,
            calc_taxable,
            calc_cgst,
            calc_sgst,
            calc_igst,
            calc_total_value,
            payload.invoice_number,
            payload.expected_version,
        ],
    )
    .map_err(|e| AppError::Db {
        code: "ERR_DB_003".to_string(),
        message: format!("Failed to update invoice header: {}", e),
    })?;

    if rows_updated == 0 {
        return Err(AppError::Validation {
            code: "ERR_CONCURRENCY_CONFLICT".to_string(),
            message: "Invoice version conflict: The invoice was updated by another user or session.".to_string(),
        });
    }

    // Differential Line Items Update
    let payload_ids: Vec<i64> = processed_items.iter().filter_map(|pi| pi.id).collect();

    // 1. Delete removed items
    if payload_ids.is_empty() {
        tx.execute(
            "DELETE FROM invoice_items WHERE invoice_number = ?",
            [&payload.invoice_number],
        ).map_err(|e| AppError::Db {
            code: "ERR_DB_003".to_string(),
            message: format!("Failed to clear items: {}", e),
        })?;
    } else {
        let query = format!(
            "DELETE FROM invoice_items WHERE invoice_number = ? AND id NOT IN ({})",
            payload_ids.iter().map(|_| "?").collect::<Vec<_>>().join(",")
        );
        let mut params_vec: Vec<rusqlite::types::Value> = Vec::new();
        params_vec.push(payload.invoice_number.clone().into());
        for id in &payload_ids {
            params_vec.push((*id).into());
        }
        tx.execute(&query, rusqlite::params_from_iter(params_vec))
            .map_err(|e| AppError::Db {
                code: "ERR_DB_003".to_string(),
                message: format!("Failed to delete removed items: {}", e),
            })?;
    }

    // 2. Update existing / Insert new items
    for item in &processed_items {
        if let Some(item_id) = item.id {
            tx.execute(
                "UPDATE invoice_items
                 SET part_code = ?, quantity = ?, rate_pre_unit = ?, assessable_value = ?,
                     cgst_rate = ?, cgst_amount = ?, sgst_rate = ?, sgst_amount = ?,
                     igst_rate = ?, igst_amount = ?, total_value = ?
                 WHERE id = ? AND invoice_number = ?",
                params![
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
                    item_id,
                    payload.invoice_number,
                ],
            )
            .map_err(|e| AppError::Db {
                code: "ERR_DB_003".to_string(),
                message: format!("Failed to update invoice item #{}: {}", item_id, e),
            })?;
        } else {
            tx.execute(
                "INSERT INTO invoice_items (invoice_number, part_code, quantity, rate_pre_unit, assessable_value,
                                            cgst_rate, cgst_amount, sgst_rate, sgst_amount, igst_rate, igst_amount, total_value)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                params![
                    payload.invoice_number,
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
                ],
            )
            .map_err(|e| AppError::Db {
                code: "ERR_DB_003".to_string(),
                message: format!("Failed to insert new invoice item: {}", e),
            })?;
        }
    }

    // Build Audit Trail Summary
    let old_val_json = serde_json::to_string(&serde_json::json!({
        "header": old_invoice,
        "items": old_items
    })).unwrap_or_default();

    let new_invoice = repo.find_invoice(&tx, &payload.invoice_number)?.unwrap();
    let new_items = repo.get_invoice_items(&tx, &payload.invoice_number)?;

    let new_val_json = serde_json::to_string(&serde_json::json!({
        "header": new_invoice,
        "items": new_items
    })).unwrap_or_default();

    let audit_action = format!(
        "Invoice #{} updated by {}. Reason: {}. Customer ID: {} -> {}. Status: {} -> {}. Items count: {} -> {}.",
        payload.invoice_number,
        user_name,
        trimmed_reason,
        old_invoice.customer_id,
        new_invoice.customer_id,
        old_invoice.status,
        new_invoice.status,
        old_items.len(),
        new_items.len()
    );

    tx.execute(
        "INSERT INTO audit_log (user_action, table_name, record_id, old_value, new_value)
         VALUES (?, 'invoices', ?, ?, ?)",
        params![audit_action, payload.invoice_number, old_val_json, new_val_json],
    )
    .map_err(|e| AppError::Db {
        code: "ERR_DB_003".to_string(),
        message: format!("Failed to log edit audit: {}", e),
    })?;

    tx.commit().map_err(|e| AppError::Db {
        code: "ERR_DB_003".to_string(),
        message: format!("Failed to commit edit transaction: {}", e),
    })?;

    // 2. Post-Commit Phase: Refreshes & Cache Invalidation
    let conn_guard_read = state
        .conn
        .lock()
        .map_err(|e| AppError::Internal(format!("Failed to re-acquire lock: {}", e)))?;
    if let Some(ref conn_ref) = *conn_guard_read {
        let report_repo = SqliteReportRepository;
        let _ = report_repo.refresh_monthly_summary(conn_ref, new_invoice.financial_year_id);
        let _ = report_repo.refresh_customer_summary(conn_ref, new_invoice.financial_year_id);
        let _ = report_repo.refresh_supplier_summary(conn_ref, new_invoice.financial_year_id);
    }

    if let Ok(mut cache) = state.dashboard_cache.lock() {
        *cache = None;
    }

    Ok((new_invoice, new_items))
}

