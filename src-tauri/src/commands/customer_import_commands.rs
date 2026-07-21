use crate::error::AppError;
use crate::models::domain_models::{CustomerImportPreview, CustomerImportResult};
use crate::services::customer_import_service::{commit_import, preview_import};
use crate::state::DbState;
use tauri::State;

#[tauri::command]
pub fn preview_customer_master_import(
    state: State<'_, DbState>,
    file_path: String,
) -> Result<CustomerImportPreview, AppError> {
    let guard = state
        .conn
        .lock()
        .map_err(|e| AppError::Internal(format!("lock: {e}")))?;
    let conn = guard.as_ref().ok_or_else(|| AppError::Db {
        code: "ERR_DB_002".to_string(),
        message: "No active database connection profile".to_string(),
    })?;
    preview_import(conn, &file_path)
}

#[tauri::command]
pub fn commit_customer_master_import(
    state: State<'_, DbState>,
    file_path: String,
    user: String,
) -> Result<CustomerImportResult, AppError> {
    let mut guard = state
        .conn
        .lock()
        .map_err(|e| AppError::Internal(format!("lock: {e}")))?;
    let conn = guard.as_mut().ok_or_else(|| AppError::Db {
        code: "ERR_DB_002".to_string(),
        message: "No active database connection profile".to_string(),
    })?;
    commit_import(conn, &file_path, &user)
}
