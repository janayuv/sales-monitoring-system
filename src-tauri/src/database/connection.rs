use crate::database::migrate::run_migrations;
use crate::error::AppError;
use rusqlite::Connection;
use std::fs;
use tauri::AppHandle;
use tauri::Manager;

pub struct DbConnectionManager;

impl DbConnectionManager {
    /// Establishes an encrypted SQLCipher connection to a company's database file.
    /// The database is saved under the user AppData directory dynamically resolved by Tauri.
    pub fn connect(
        app_handle: &AppHandle,
        company_code: &str,
        encryption_key: &str,
    ) -> Result<Connection, AppError> {
        let app_data_dir = app_handle
            .path()
            .app_data_dir()
            .map_err(|e| AppError::Internal(format!("Failed to resolve AppData path: {}", e)))?;

        let db_dir = app_data_dir.join("databases");
        if !db_dir.exists() {
            fs::create_dir_all(&db_dir).map_err(|e| AppError::Io(e))?;
        }

        let db_path = db_dir.join(format!("company_{}.db", company_code));
        log::info!("Connecting to database: {:?}", db_path);

        let mut conn = Connection::open(&db_path).map_err(|e| AppError::Db {
            code: "ERR_DB_002".to_string(),
            message: format!("Failed to open database file: {}", e),
        })?;

        // Authenticate with SQLCipher key
        conn.pragma_update(None, "key", encryption_key)
            .map_err(|e| AppError::Db {
                code: "ERR_DB_002".to_string(),
                message: format!("SQLCipher authentication failed: {}", e),
            })?;

        // Initialize connection optimizations
        conn.execute_batch(
            "PRAGMA journal_mode = WAL;
             PRAGMA synchronous = NORMAL;
             PRAGMA temp_store = MEMORY;
             PRAGMA cache_size = -64000;
             PRAGMA foreign_keys = ON;",
        )
        .map_err(|e| AppError::Db {
            code: "ERR_DB_003".to_string(),
            message: format!("Failed to configure connection PRAGMAs: {}", e),
        })?;

        // Check if there are pending migrations on an existing populated database
        let current_version: i32 = conn
            .query_row(
                "SELECT COALESCE(MAX(version), 0) FROM schema_migrations",
                [],
                |row| row.get(0),
            )
            .unwrap_or(0);

        let target_version = crate::database::migrate::get_migrations()
            .iter()
            .map(|m| m.version)
            .max()
            .unwrap_or(0);

        // If an existing database has pending migrations, take an encrypted snapshot before proceeding
        if current_version > 0 && current_version < target_version && db_path.exists() {
            let backup_dir = app_data_dir.join("backups").join("migrations");
            log::info!(
                "Existing database version (v{}) is behind target (v{}). Creating pre-migration snapshot for {}...",
                current_version,
                target_version,
                company_code
            );
            crate::database::snapshot::create_pre_migration_snapshot(
                &conn,
                &db_path,
                &backup_dir,
                company_code,
                target_version,
            )?;
        }

        // Run migrations
        run_migrations(&mut conn)?;

        Ok(conn)
    }

    /// Verifies database file health before restoring a backup.
    pub fn verify_integrity(conn: &Connection) -> Result<bool, AppError> {
        let integrity: String = conn
            .query_row("PRAGMA integrity_check;", [], |row| row.get(0))
            .map_err(|e| AppError::Db {
                code: "ERR_BACKUP_001".to_string(),
                message: format!("Integrity check failed: {}", e),
            })?;

        Ok(integrity == "ok")
    }

    /// Runs database optimization: VACUUM, ANALYZE and PRAGMA optimize.
    pub fn optimize(conn: &Connection) -> Result<(), AppError> {
        conn.execute("VACUUM;", []).map_err(|e| AppError::Db {
            code: "ERR_DB_003".to_string(),
            message: format!("VACUUM failed: {}", e),
        })?;

        conn.execute("ANALYZE;", []).map_err(|e| AppError::Db {
            code: "ERR_DB_003".to_string(),
            message: format!("ANALYZE failed: {}", e),
        })?;

        conn.execute("PRAGMA optimize;", [])
            .map_err(|e| AppError::Db {
                code: "ERR_DB_003".to_string(),
                message: format!("PRAGMA optimize failed: {}", e),
            })?;

        Ok(())
    }
}
