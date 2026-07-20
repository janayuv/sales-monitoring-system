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
        "SELECT id, customer_code, customer_name, gstin, state_code, address, status FROM customers ORDER BY customer_name ASC"
    ).map_err(|e| AppError::Db {
        code: "ERR_DB_003".to_string(),
        message: format!("Failed to prepare query: {}", e),
    })?;

    let rows = stmt
        .query_map([], |row| {
            Ok(CustomerRow {
                id: Some(row.get(0)?),
                customer_code: row.get(1)?,
                customer_name: row.get(2)?,
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
            message: format!("Failed to read customer row: {}", e),
        })?);
    }
    Ok(list)
}
