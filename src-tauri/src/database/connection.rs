use std::fs;
use std::path::PathBuf;
use rusqlite::Connection;
use tauri::AppHandle;
use tauri::Manager;
use crate::error::AppError;
use crate::database::migrate::run_migrations;

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
            fs::create_dir_all(&db_dir)
                .map_err(|e| AppError::Io(e))?;
        }
        
        let db_path = db_dir.join(format!("company_{}.db", company_code));
        log::info!("Connecting to database: {:?}", db_path);

        let mut conn = Connection::open(&db_path)
            .map_err(|e| AppError::Db {
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
        conn.execute("VACUUM;", [])
            .map_err(|e| AppError::Db {
                code: "ERR_DB_003".to_string(),
                message: format!("VACUUM failed: {}", e),
            })?;
            
        conn.execute("ANALYZE;", [])
            .map_err(|e| AppError::Db {
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
