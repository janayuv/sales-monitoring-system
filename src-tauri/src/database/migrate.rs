use rusqlite::{params, Connection};
use crate::error::AppError;

pub struct Migration {
    pub version: i32,
    pub description: &'static str,
    pub sql: &'static str,
}

pub fn run_migrations(conn: &mut Connection) -> Result<(), AppError> {
    // 1. Create migrations tracking table if not present
    conn.execute(
        "CREATE TABLE IF NOT EXISTS schema_migrations (
            version INTEGER PRIMARY KEY,
            applied_at TEXT NOT NULL DEFAULT (datetime('now')),
            description TEXT
         )",
        [],
    )
    .map_err(|e| AppError::Db {
        code: "ERR_DB_003".to_string(),
        message: format!("Failed to create schema_migrations table: {}", e),
    })?;
    
    // 2. Fetch last applied migration version
    let current_version: i32 = conn
        .query_row(
            "SELECT COALESCE(MAX(version), 0) FROM schema_migrations",
            [],
            |row| row.get(0),
        )
        .map_err(|e| AppError::Db {
            code: "ERR_DB_003".to_string(),
            message: format!("Failed to fetch current schema version: {}", e),
        })?;

    // 3. Define migrations list
    let migrations = vec![
        Migration {
            version: 1,
            description: "Initial schema migrations containing all master and transactional tables",
            sql: include_str!("../migrations/0001_init.sql"),
        },
    ];

    // 4. Apply migrations sequentially
    for migration in migrations {
        if migration.version > current_version {
            log::info!("Applying migration v{}: {}", migration.version, migration.description);
            let tx = conn.transaction().map_err(|e| AppError::Db {
                code: "ERR_DB_003".to_string(),
                message: format!("Failed to begin transaction: {}", e),
            })?;
            
            tx.execute_batch(migration.sql).map_err(|e| AppError::Db {
                code: "ERR_DB_003".to_string(),
                message: format!("Failed to execute migration script: {}", e),
            })?;
            
            tx.execute(
                "INSERT INTO schema_migrations (version, description) VALUES (?, ?)",
                params![migration.version, migration.description],
            )
            .map_err(|e| AppError::Db {
                code: "ERR_DB_003".to_string(),
                message: format!("Failed to log migration status: {}", e),
            })?;
            
            tx.commit().map_err(|e| AppError::Db {
                code: "ERR_DB_003".to_string(),
                message: format!("Failed to commit migration transaction: {}", e),
            })?;
        }
    }
    
    Ok(())
}
