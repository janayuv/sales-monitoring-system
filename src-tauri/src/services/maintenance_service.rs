use crate::error::AppError;
use rusqlite::Connection;
use serde::{Deserialize, Serialize};
use ts_rs::TS;

/// Header metadata stored inside backup archives for verification
#[derive(Debug, Serialize, Deserialize, Clone, TS)]
#[ts(export, export_to = "../../src/types/bindings/BackupMetadata.ts")]
pub struct BackupMetadata {
    pub schema_version: i32,
    pub app_version: String,
    pub timestamp: String,
    pub company_code: String,
    pub financial_year: String,
    pub db_file_name: String,
    pub db_size_bytes: u64,
}

/// Result payload for database maintenance routines
#[derive(Debug, Serialize, Deserialize, Clone, TS)]
#[ts(export, export_to = "../../src/types/bindings/MaintenanceResult.ts")]
pub struct MaintenanceResult {
    pub routine: String,
    pub status: String,
    pub details: String,
    pub duration_ms: u64,
}

pub struct MaintenanceService;

impl MaintenanceService {
    /// Runs SQLite PRAGMA integrity_check to verify database file health.
    pub fn run_integrity_check(conn: &Connection) -> Result<MaintenanceResult, AppError> {
        let start = std::time::Instant::now();
        let mut stmt = conn
            .prepare("PRAGMA integrity_check")
            .map_err(|e| AppError::Db {
                code: "ERR_DB_003".to_string(),
                message: format!("Failed to prepare integrity check: {}", e),
            })?;

        let result_str: String =
            stmt.query_row([], |row| row.get(0))
                .map_err(|e| AppError::Db {
                    code: "ERR_DB_003".to_string(),
                    message: format!("Failed to run integrity check: {}", e),
                })?;

        let duration = start.elapsed().as_millis() as u64;

        if result_str == "ok" {
            Ok(MaintenanceResult {
                routine: "PRAGMA integrity_check".to_string(),
                status: "HEALTHY".to_string(),
                details: "Database file passed integrity verification with zero errors."
                    .to_string(),
                duration_ms: duration,
            })
        } else {
            Err(AppError::Backup {
                code: "ERR_BACKUP_001".to_string(),
                message: format!("Database integrity check failed: {}", result_str),
            })
        }
    }

    /// Runs VACUUM and ANALYZE to defragment SQLite storage and rebuild query optimizer statistics.
    pub fn optimize_and_vacuum(conn: &Connection) -> Result<MaintenanceResult, AppError> {
        let start = std::time::Instant::now();

        // Run ANALYZE first to gather statistics
        conn.execute("ANALYZE", []).map_err(|e| AppError::Db {
            code: "ERR_DB_003".to_string(),
            message: format!("Failed to run ANALYZE: {}", e),
        })?;

        // Run VACUUM to reclaim free pages and defragment
        conn.execute("VACUUM", []).map_err(|e| AppError::Db {
            code: "ERR_DB_003".to_string(),
            message: format!("Failed to run VACUUM: {}", e),
        })?;

        let duration = start.elapsed().as_millis() as u64;

        Ok(MaintenanceResult {
            routine: "VACUUM & ANALYZE".to_string(),
            status: "OPTIMIZED".to_string(),
            details: "Database storage defragmented and query execution plans updated.".to_string(),
            duration_ms: duration,
        })
    }

    /// Fetches the current database schema version from schema_migrations table.
    pub fn get_schema_version(conn: &Connection) -> Result<i32, AppError> {
        let version: i32 = conn
            .query_row(
                "SELECT COALESCE(MAX(version), 0) FROM schema_migrations",
                [],
                |row| row.get(0),
            )
            .unwrap_or(0);
        Ok(version)
    }

    /// Generates backup metadata for a given company profile connection.
    pub fn build_backup_metadata(
        conn: &Connection,
        company_code: &str,
        financial_year: &str,
        db_size_bytes: u64,
    ) -> Result<BackupMetadata, AppError> {
        let schema_version = Self::get_schema_version(conn)?;
        let timestamp = chrono::Local::now().to_rfc3339();

        Ok(BackupMetadata {
            schema_version,
            app_version: "0.1.0".to_string(),
            timestamp,
            company_code: company_code.to_string(),
            financial_year: financial_year.to_string(),
            db_file_name: format!("{}.db", company_code.to_lowercase()),
            db_size_bytes,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_integrity_check_on_in_memory_db() {
        let conn = Connection::open_in_memory().unwrap();
        let res = MaintenanceService::run_integrity_check(&conn).unwrap();
        assert_eq!(res.status, "HEALTHY");
        assert_eq!(res.routine, "PRAGMA integrity_check");
    }

    #[test]
    fn test_vacuum_and_analyze_on_in_memory_db() {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute("CREATE TABLE test_tbl (id INT PRIMARY KEY, val TEXT)", [])
            .unwrap();
        conn.execute("INSERT INTO test_tbl VALUES (1, 'hello')", [])
            .unwrap();

        let res = MaintenanceService::optimize_and_vacuum(&conn).unwrap();
        assert_eq!(res.status, "OPTIMIZED");
    }

    #[test]
    fn test_schema_version_lookup() {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute(
            "CREATE TABLE schema_migrations (version INT PRIMARY KEY, applied_at TEXT)",
            [],
        )
        .unwrap();
        conn.execute("INSERT INTO schema_migrations VALUES (1, '2026-07-20')", [])
            .unwrap();

        let ver = MaintenanceService::get_schema_version(&conn).unwrap();
        assert_eq!(ver, 1);
    }
}
