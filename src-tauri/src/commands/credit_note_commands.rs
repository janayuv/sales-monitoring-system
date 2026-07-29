use crate::error::AppError;
use crate::state::DbState;
use crate::models::database_models::{CreditNoteHeader, CreditNoteDetails, CreditNoteUpdatePayload};
use crate::services::credit_note_service::CreditNoteService;
use crate::repositories::credit_note_repository::SqliteCreditNoteRepository;
use crate::repositories::CreditNoteRepository;
use crate::services::financial_period_service::FinancialPeriodService;
use tauri::State;
use rusqlite::params;

fn publish_reporting_refresh_events(conn: &rusqlite::Connection, fy_id: i64) -> Result<(), AppError> {
    use crate::repositories::report_repo::SqliteReportRepository;
    use crate::repositories::ReportRepository;
    let report_repo = SqliteReportRepository;
    report_repo.refresh_monthly_summary(conn, fy_id)?;
    report_repo.refresh_customer_summary(conn, fy_id)?;
    report_repo.refresh_supplier_summary(conn, fy_id)?;
    Ok(())
}

fn clear_dashboard_cache(state: &State<'_, DbState>) {
    if let Ok(mut cache) = state.dashboard_cache.lock() {
        *cache = None;
    }
}

#[tauri::command]
pub fn list_credit_notes(
    state: State<'_, DbState>,
    include_deleted: bool,
) -> Result<Vec<CreditNoteHeader>, AppError> {
    let mut conn_guard = state
        .conn
        .lock()
        .map_err(|e| AppError::Internal(format!("Failed to acquire connection lock: {}", e)))?;
    let conn = conn_guard.as_mut().ok_or_else(|| AppError::Db {
        code: "ERR_DB_002".to_string(),
        message: "No active database connection profile".to_string(),
    })?;

    let repo = SqliteCreditNoteRepository;
    repo.list_credit_notes(conn, include_deleted)
}

#[tauri::command]
pub fn get_credit_note_details(
    state: State<'_, DbState>,
    credit_note_number: String,
) -> Result<Option<CreditNoteDetails>, AppError> {
    let mut conn_guard = state
        .conn
        .lock()
        .map_err(|e| AppError::Internal(format!("Failed to acquire connection lock: {}", e)))?;
    let conn = conn_guard.as_mut().ok_or_else(|| AppError::Db {
        code: "ERR_DB_002".to_string(),
        message: "No active database connection profile".to_string(),
    })?;

    CreditNoteService::get_credit_note_details(conn, &credit_note_number)
}

#[tauri::command]
pub fn generate_credit_note_record(
    state: State<'_, DbState>,
    invoice_number: String,
    date: String,
    remarks: Option<String>,
    reason: Option<String>,
    user_name: String,
) -> Result<String, AppError> {
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

    // Call service to generate note
    let cn_number = CreditNoteService::generate_credit_note(
        &tx,
        &invoice_number,
        &date,
        remarks,
        reason,
        &user_name,
    )?;

    // Fetch financial year for events
    let fy_id = FinancialPeriodService::get_financial_year_id_by_date(&tx, &date)?;
    publish_reporting_refresh_events(&tx, fy_id)?;

    tx.commit().map_err(|e| AppError::Db {
        code: "ERR_DB_003".to_string(),
        message: format!("Failed to commit credit note generation: {}", e),
    })?;

    clear_dashboard_cache(&state);

    Ok(cn_number)
}

#[tauri::command]
pub fn update_credit_note_record(
    state: State<'_, DbState>,
    payload: CreditNoteUpdatePayload,
    user_name: String,
) -> Result<(), AppError> {
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

    CreditNoteService::update_credit_note(&tx, payload.clone(), &user_name)?;

    // Fetch financial year for events
    let fy_id = FinancialPeriodService::get_financial_year_id_by_date(&tx, &payload.credit_note_date)?;
    publish_reporting_refresh_events(&tx, fy_id)?;

    tx.commit().map_err(|e| AppError::Db {
        code: "ERR_DB_003".to_string(),
        message: format!("Failed to commit credit note update: {}", e),
    })?;

    clear_dashboard_cache(&state);

    Ok(())
}

#[tauri::command]
pub fn submit_credit_note_for_review(
    state: State<'_, DbState>,
    credit_note_number: String,
    user_name: String,
) -> Result<(), AppError> {
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

    CreditNoteService::submit_for_review(&tx, &credit_note_number, &user_name)?;

    tx.commit().map_err(|e| AppError::Db {
        code: "ERR_DB_003".to_string(),
        message: format!("Failed to commit status change: {}", e),
    })?;

    Ok(())
}

#[tauri::command]
pub fn reject_credit_note_to_draft(
    state: State<'_, DbState>,
    credit_note_number: String,
    user_name: String,
) -> Result<(), AppError> {
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

    CreditNoteService::reject_to_draft(&tx, &credit_note_number, &user_name)?;

    tx.commit().map_err(|e| AppError::Db {
        code: "ERR_DB_003".to_string(),
        message: format!("Failed to commit status change: {}", e),
    })?;

    Ok(())
}

#[tauri::command]
pub fn approve_credit_note_record(
    state: State<'_, DbState>,
    credit_note_number: String,
    user_name: String,
) -> Result<(), AppError> {
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

    CreditNoteService::approve_credit_note(&tx, &credit_note_number, &user_name)?;

    // Fetch financial year for events
    let header = SqliteCreditNoteRepository.load_header(&tx, &credit_note_number)?
        .ok_or_else(|| AppError::Validation {
            code: "ERR_VAL_006".to_string(),
            message: "Credit Note not found".to_string(),
        })?;
    let fy_id = FinancialPeriodService::get_financial_year_id_by_date(&tx, &header.credit_note_date)?;
    publish_reporting_refresh_events(&tx, fy_id)?;

    tx.commit().map_err(|e| AppError::Db {
        code: "ERR_DB_003".to_string(),
        message: format!("Failed to commit approval: {}", e),
    })?;

    clear_dashboard_cache(&state);

    Ok(())
}

#[tauri::command]
pub fn export_credit_note_record(
    state: State<'_, DbState>,
    credit_note_number: String,
    user_name: String,
) -> Result<(), AppError> {
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

    CreditNoteService::export_credit_note(&tx, &credit_note_number, &user_name)?;

    tx.commit().map_err(|e| AppError::Db {
        code: "ERR_DB_003".to_string(),
        message: format!("Failed to commit export: {}", e),
    })?;

    Ok(())
}

#[tauri::command]
pub fn delete_credit_note_record(
    state: State<'_, DbState>,
    credit_note_number: String,
    user_name: String,
    confirmation_number: String,
) -> Result<(), AppError> {
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

    // Call service to soft delete CN and revert invoice status
    CreditNoteService::delete_credit_note(&tx, &credit_note_number, &user_name, &confirmation_number)?;

    let header = SqliteCreditNoteRepository.load_header(&tx, &credit_note_number)?
        .ok_or_else(|| AppError::Validation {
            code: "ERR_VAL_006".to_string(),
            message: "Credit Note not found".to_string(),
        })?;
    let fy_id = FinancialPeriodService::get_financial_year_id_by_date(&tx, &header.credit_note_date)?;
    publish_reporting_refresh_events(&tx, fy_id)?;

    tx.commit().map_err(|e| AppError::Db {
        code: "ERR_DB_003".to_string(),
        message: format!("Failed to commit credit note deletion: {}", e),
    })?;

    clear_dashboard_cache(&state);

    Ok(())
}

#[tauri::command]
pub fn restore_credit_note_record(
    state: State<'_, DbState>,
    credit_note_number: String,
    user_name: String,
) -> Result<(), AppError> {
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

    // Call service to restore
    CreditNoteService::restore_credit_note(&tx, &credit_note_number, &user_name)?;

    let header = SqliteCreditNoteRepository.load_header(&tx, &credit_note_number)?
        .ok_or_else(|| AppError::Validation {
            code: "ERR_VAL_006".to_string(),
            message: "Credit Note not found".to_string(),
        })?;
    let fy_id = FinancialPeriodService::get_financial_year_id_by_date(&tx, &header.credit_note_date)?;
    publish_reporting_refresh_events(&tx, fy_id)?;

    tx.commit().map_err(|e| AppError::Db {
        code: "ERR_DB_003".to_string(),
        message: format!("Failed to commit credit note restoration: {}", e),
    })?;

    clear_dashboard_cache(&state);

    Ok(())
}

#[tauri::command]
pub fn log_credit_note_print(
    state: State<'_, DbState>,
    credit_note_number: String,
    user_name: String,
    action_type: String,
) -> Result<(), AppError> {
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

    let repo = SqliteCreditNoteRepository;
    
    // Preview opened does NOT increment print count in database, only Dialog & PDF do!
    if action_type == "PrintDialogInvoked" || action_type == "PdfExported" {
        repo.increment_print_count(&tx, &credit_note_number, &user_name, &action_type)?;
    }

    // Write specific print audit event log
    let event_desc = format!("Credit Note printed (Action: {}) by {}", action_type, user_name);
    tx.execute(
        "INSERT INTO audit_log (user_action, table_name, record_id, old_value, new_value)
         VALUES (?, 'credit_notes', ?, NULL, NULL)",
        params![event_desc, credit_note_number],
    ).map_err(|e| AppError::Db {
        code: "ERR_DB_003".to_string(),
        message: format!("Failed to write print audit log: {}", e),
    })?;

    tx.commit().map_err(|e| AppError::Db {
        code: "ERR_DB_003".to_string(),
        message: format!("Failed to commit print print count: {}", e),
    })?;

    Ok(())
}
