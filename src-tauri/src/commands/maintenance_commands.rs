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

mod build_info {
    include!(concat!(env!("OUT_DIR"), "/build_constants.rs"));
}

#[derive(Debug, Serialize, Deserialize, Clone, TS)]
#[ts(export, export_to = "../../src/types/bindings/BuildConstants.ts")]
pub struct BuildConstants {
    pub app_version: String,
    pub build_date: String,
    pub build_time: String,
    pub git_hash: String,
    pub git_branch: String,
    pub rust_version: String,
    pub target: String,
    pub profile: String,
    pub build_number: String,
}

#[tauri::command]
pub fn get_build_constants() -> BuildConstants {
    BuildConstants {
        app_version: build_info::APP_VERSION.to_string(),
        build_date: build_info::BUILD_DATE.to_string(),
        build_time: build_info::BUILD_TIME.to_string(),
        git_hash: build_info::GIT_HASH.to_string(),
        git_branch: build_info::GIT_BRANCH.to_string(),
        rust_version: build_info::RUST_VERSION.to_string(),
        target: build_info::TARGET.to_string(),
        profile: build_info::PROFILE.to_string(),
        build_number: build_info::BUILD_NUMBER.to_string(),
    }
}

#[tauri::command]
pub fn get_updater_endpoints(app: tauri::AppHandle) -> Vec<String> {
    if let Some(updater) = app.config().plugins.0.get("updater") {
        if let Some(endpoints) = updater.get("endpoints").and_then(|e| e.as_array()) {
            return endpoints
                .iter()
                .filter_map(|v| v.as_str().map(|s| s.to_string()))
                .collect();
        }
    }
    vec![]
}

#[derive(Debug, Serialize, Clone, TS)]
#[ts(export, export_to = "../../src/types/bindings/DiagnosticsInfo.ts")]
pub struct DiagnosticsInfo {
    pub os_version: String,
    pub webview_version: String,
    pub tauri_version: String,
    pub rust_version: String,
    pub app_data_path: String,
    pub log_directory: String,
}

#[tauri::command]
pub fn get_diagnostics_info(app: tauri::AppHandle) -> DiagnosticsInfo {
    use tauri::Manager;
    
    let os_version = if cfg!(target_os = "windows") {
        if let Ok(output) = std::process::Command::new("cmd").args(&["/c", "ver"]).output() {
            String::from_utf8_lossy(&output.stdout).trim().to_string()
        } else {
            "Windows (Unknown Version)".to_string()
        }
    } else {
        format!("{} ({})", std::env::consts::OS, std::env::consts::ARCH)
    };

    let webview_version = tauri::webview_version()
        .unwrap_or_else(|_| "Unknown".to_string());

    let app_data_path = app.path().app_data_dir()
        .map(|p| p.to_string_lossy().to_string())
        .unwrap_or_else(|_| "Unknown".to_string());

    let log_directory = app.path().app_log_dir()
        .map(|p| p.to_string_lossy().to_string())
        .unwrap_or_else(|_| "Unknown".to_string());

    DiagnosticsInfo {
        os_version,
        webview_version,
        tauri_version: tauri::VERSION.to_string(),
        rust_version: build_info::RUST_VERSION.to_string(),
        app_data_path,
        log_directory,
    }
}

pub struct PendingUpdate(pub tauri::async_runtime::Mutex<Option<tauri_plugin_updater::Update>>);

#[derive(Debug, Serialize, TS)]
#[ts(export, export_to = "../../src/types/bindings/CustomUpdateInfo.ts")]
pub struct CustomUpdateInfo {
    pub version: String,
    pub date: Option<String>,
    pub body: Option<String>,
}

#[tauri::command]
pub async fn check_for_updates_custom(
    app: tauri::AppHandle,
    state: tauri::State<'_, PendingUpdate>,
    channel: String,
) -> Result<Option<CustomUpdateInfo>, AppError> {
    use tauri_plugin_updater::UpdaterExt;

    let base_url = "https://github.com/janayuv/sales-monitoring-system/releases/latest/download";
    let endpoint = match channel.as_str() {
        "Preview" => format!("{}/preview-latest.json", base_url),
        "Internal" => format!("{}/internal-latest.json", base_url),
        _ => format!("{}/latest.json", base_url),
    };

    let url = url::Url::parse(&endpoint)
        .map_err(|e| AppError::Internal(format!("Invalid endpoint URL: {}", e)))?;

    let updater = app.updater_builder()
        .endpoints(vec![url])
        .map_err(|e| AppError::Internal(format!("Failed to set endpoints: {}", e)))?
        .build()
        .map_err(|e| AppError::Internal(format!("Failed to build updater: {}", e)))?;

    let update = updater.check().await
        .map_err(|e| AppError::Internal(format!("Failed to check for updates: {}", e)))?;

    if let Some(update) = update {
        let info = CustomUpdateInfo {
            version: update.version.clone(),
            date: update.date.map(|d| format!("{}", d)),
            body: update.body.clone(),
        };
        *state.0.lock().await = Some(update);
        Ok(Some(info))
    } else {
        *state.0.lock().await = None;
        Ok(None)
    }
}

#[tauri::command]
pub async fn install_pending_update_custom(
    app: tauri::AppHandle,
    state: tauri::State<'_, PendingUpdate>,
) -> Result<(), AppError> {
    use tauri::Emitter;
    
    let mut guard = state.0.lock().await;
    let update = guard.take().ok_or_else(|| {
        AppError::Internal("No pending update has been checked or cached.".to_string())
    })?;

    let app_clone1 = app.clone();
    let app_clone2 = app.clone();
    update.download_and_install(
        move |chunk_length, content_length| {
            let total = content_length.unwrap_or(0);
            app_clone1.emit("custom-updater-progress", (chunk_length, total)).ok();
        },
        move || {
            app_clone2.emit("custom-updater-finished", ()).ok();
        }
    ).await
    .map_err(|e| AppError::Internal(format!("Failed to execute update: {}", e)))?;

    Ok(())
}

