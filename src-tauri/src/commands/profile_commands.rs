use tauri::{AppHandle, State};
use crate::error::AppError;
use crate::state::DbState;
use crate::database::connection::DbConnectionManager;

#[tauri::command]
pub fn switch_company_profile(
    app_handle: AppHandle,
    state: State<'_, DbState>,
    company_code: String,
    encryption_key: String,
) -> Result<(), AppError> {
    log::info!("Switching company profile to: {}", company_code);
    
    // Acquire the connection mutex lock
    let mut conn_guard = state.conn.lock().map_err(|e| {
        AppError::Internal(format!("Failed to acquire connection lock: {}", e))
    })?;

    // Close any existing active connection pool
    if conn_guard.is_some() {
        log::info!("Closing active database connection");
        *conn_guard = None;
    }

    // Open connection to the new database file and run migrations
    let conn = DbConnectionManager::connect(&app_handle, &company_code, &encryption_key)?;
    *conn_guard = Some(conn);

    log::info!("Successfully connected and migrated database for: {}", company_code);
    Ok(())
}

#[tauri::command]
pub fn close_active_profile(
    state: State<'_, DbState>,
) -> Result<(), AppError> {
    log::info!("Closing active company profile");
    let mut conn_guard = state.conn.lock().map_err(|e| {
        AppError::Internal(format!("Failed to acquire connection lock: {}", e))
    })?;

    *conn_guard = None;
    Ok(())
}
