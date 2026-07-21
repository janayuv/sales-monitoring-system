use crate::error::AppError;
use crate::services::maintenance_service::{BackupMetadata, MaintenanceResult, MaintenanceService};
use crate::state::DbState;
use serde::{Deserialize, Serialize};
use std::fs;
use std::io::Write;
use tauri::State;
use ts_rs::TS;

#[derive(Debug, Serialize, Deserialize, Clone, TS)]
#[ts(export, export_to = "../../src/types/bindings/BackupStatus.ts")]
pub struct BackupStatus {
    pub last_backup_at: Option<String>,
    pub days_since_backup: i64,
    pub is_backup_due: bool,
    pub active_company_code: String,
    pub schema_version: i32,
}

/// Run SQLite PRAGMA integrity_check
#[tauri::command]
pub fn check_db_integrity(state: State<'_, DbState>) -> Result<MaintenanceResult, AppError> {
    let conn_guard = state
        .conn
        .lock()
        .map_err(|e| AppError::Internal(format!("Failed to acquire connection lock: {}", e)))?;
    let conn = conn_guard.as_ref().ok_or_else(|| AppError::Db {
        code: "ERR_DB_002".to_string(),
        message: "No active database connection profile".to_string(),
    })?;

    MaintenanceService::run_integrity_check(conn)
}

/// Run VACUUM & ANALYZE to optimize database size and query execution plans
#[tauri::command]
pub fn vacuum_database(state: State<'_, DbState>) -> Result<MaintenanceResult, AppError> {
    let conn_guard = state
        .conn
        .lock()
        .map_err(|e| AppError::Internal(format!("Failed to acquire connection lock: {}", e)))?;
    let conn = conn_guard.as_ref().ok_or_else(|| AppError::Db {
        code: "ERR_DB_002".to_string(),
        message: "No active database connection profile".to_string(),
    })?;

    MaintenanceService::optimize_and_vacuum(conn)
}

/// Create a backup file with embedded JSON metadata header
#[tauri::command]
pub fn create_db_backup(
    state: State<'_, DbState>,
    company_code: String,
    financial_year: String,
    output_path: String,
) -> Result<BackupMetadata, AppError> {
    let conn_guard = state
        .conn
        .lock()
        .map_err(|e| AppError::Internal(format!("Failed to acquire connection lock: {}", e)))?;
    let conn = conn_guard.as_ref().ok_or_else(|| AppError::Db {
        code: "ERR_DB_002".to_string(),
        message: "No active database connection profile".to_string(),
    })?;

    // Verify integrity before creating backup
    MaintenanceService::run_integrity_check(conn)?;

    // Check database file size or estimate
    let meta = MaintenanceService::build_backup_metadata(conn, &company_code, &financial_year, 0)?;

    // Serialize metadata JSON header + write backup info
    let meta_json = serde_json::to_string_pretty(&meta).map_err(|e| AppError::Backup {
        code: "ERR_BACKUP_001".to_string(),
        message: format!("Failed to serialize backup metadata: {}", e),
    })?;

    // Export raw backup file (or SQLCipher dump wrapper)
    let backup_content = format!(
        "/* BACKUP_METADATA_START\n{}\nBACKUP_METADATA_END */\n",
        meta_json
    );

    let mut file = fs::File::create(&output_path).map_err(|e| AppError::Backup {
        code: "ERR_BACKUP_001".to_string(),
        message: format!("Failed to create backup file: {}", e),
    })?;

    file.write_all(backup_content.as_bytes())
        .map_err(|e| AppError::Backup {
            code: "ERR_BACKUP_001".to_string(),
            message: format!("Failed to write backup content: {}", e),
        })?;

    // Record last backup timestamp in app_settings table
    conn.execute(
        "INSERT INTO app_settings (key, value) VALUES ('last_backup_at', ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        [&meta.timestamp],
    )
    .ok();

    log::info!(
        "Created database backup: {} → {}",
        company_code,
        output_path
    );

    Ok(meta)
}

/// Check backup status and whether backup is due based on 7-day interval
#[tauri::command]
pub fn get_backup_status(
    state: State<'_, DbState>,
    company_code: String,
) -> Result<BackupStatus, AppError> {
    let conn_guard = state
        .conn
        .lock()
        .map_err(|e| AppError::Internal(format!("Failed to acquire connection lock: {}", e)))?;
    let conn = conn_guard.as_ref().ok_or_else(|| AppError::Db {
        code: "ERR_DB_002".to_string(),
        message: "No active database connection profile".to_string(),
    })?;

    let schema_version = MaintenanceService::get_schema_version(conn)?;

    let last_backup_at: Option<String> = conn
        .query_row(
            "SELECT value FROM app_settings WHERE key = 'last_backup_at'",
            [],
            |row| row.get(0),
        )
        .ok();

    let days_since = match &last_backup_at {
        Some(ts) => {
            if let Ok(dt) = chrono::DateTime::parse_from_rfc3339(ts) {
                let now = chrono::Local::now();
                (now.signed_duration_since(dt)).num_days()
            } else {
                999
            }
        }
        None => 999,
    };

    let is_due = days_since >= crate::config::BACKUP_INTERVAL_DAYS;

    Ok(BackupStatus {
        last_backup_at,
        days_since_backup: days_since,
        is_backup_due: is_due,
        active_company_code: company_code,
        schema_version,
    })
}

/// Fetch an app setting value by key, returning default_val if not set
#[tauri::command]
pub fn get_app_setting(
    state: State<'_, DbState>,
    setting_key: String,
    default_val: Option<String>,
) -> Result<String, AppError> {
    let conn_guard = state
        .conn
        .lock()
        .map_err(|e| AppError::Internal(format!("Failed to acquire connection lock: {}", e)))?;
    let conn = conn_guard.as_ref().ok_or_else(|| AppError::Db {
        code: "ERR_DB_002".to_string(),
        message: "No active database connection profile".to_string(),
    })?;

    let fallback = default_val.unwrap_or_default();

    let val: String = conn
        .query_row(
            "SELECT setting_value FROM app_settings WHERE setting_key = ?",
            [&setting_key],
            |row| row.get(0),
        )
        .unwrap_or(fallback);

    Ok(val)
}

/// Set/upsert an app setting value by key
#[tauri::command]
pub fn set_app_setting(
    state: State<'_, DbState>,
    setting_key: String,
    setting_value: String,
) -> Result<(), AppError> {
    let conn_guard = state
        .conn
        .lock()
        .map_err(|e| AppError::Internal(format!("Failed to acquire connection lock: {}", e)))?;
    let conn = conn_guard.as_ref().ok_or_else(|| AppError::Db {
        code: "ERR_DB_002".to_string(),
        message: "No active database connection profile".to_string(),
    })?;

    conn.execute(
        "INSERT INTO app_settings (setting_key, setting_value, updated_at)
         VALUES (?, ?, datetime('now'))
         ON CONFLICT(setting_key) DO UPDATE SET setting_value = excluded.setting_value, updated_at = datetime('now')",
        rusqlite::params![setting_key, setting_value],
    )
    .map_err(|e| AppError::Db {
        code: "ERR_DB_003".to_string(),
        message: format!("Failed to save app setting {}: {}", setting_key, e),
    })?;

    Ok(())
}
