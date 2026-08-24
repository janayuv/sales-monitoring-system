use crate::error::AppError;
use chrono::Local;
use rusqlite::Connection;
use std::fs;
use std::path::{Path, PathBuf};

pub const DEFAULT_MAX_MIGRATION_SNAPSHOTS: usize = 5;

/// Creates an encrypted pre-migration snapshot of the target company database file.
///
/// Ensures all WAL pages are checkpointed into the main database file before copying,
/// preserving full SQLCipher encryption without ever exposing plaintext pages.
pub fn create_pre_migration_snapshot(
    conn: &Connection,
    db_path: &Path,
    backup_dir: &Path,
    company_code: &str,
    target_version: i32,
) -> Result<PathBuf, AppError> {
    if !db_path.exists() {
        return Err(AppError::Backup {
            code: "ERR_BACKUP_001".to_string(),
            message: format!("Source database file does not exist: {:?}", db_path),
        });
    }

    // 1. Truncate WAL to flush all encrypted dirty pages to main database file
    conn.query_row("PRAGMA wal_checkpoint(TRUNCATE);", [], |_| Ok(()))
        .map_err(|e| AppError::Backup {
            code: "ERR_BACKUP_001".to_string(),
            message: format!("Failed to checkpoint WAL before migration snapshot: {}", e),
        })?;

    // 2. Ensure the backups directory exists
    if !backup_dir.exists() {
        fs::create_dir_all(backup_dir).map_err(|e| AppError::Backup {
            code: "ERR_BACKUP_001".to_string(),
            message: format!("Failed to create migration backup directory: {}", e),
        })?;
    }

    // 3. Generate snapshot filename
    let timestamp = Local::now().format("%Y%m%d_%H%M%S").to_string();
    let snapshot_name = format!(
        "company_{}_pre_v{}_{}.db",
        company_code, target_version, timestamp
    );
    let snapshot_path = backup_dir.join(&snapshot_name);

    // 4. Perform atomic copy of the encrypted database file
    fs::copy(db_path, &snapshot_path).map_err(|e| AppError::Backup {
        code: "ERR_BACKUP_001".to_string(),
        message: format!("Failed to copy database snapshot to {:?}: {}", snapshot_path, e),
    })?;

    log::info!(
        "Created pre-migration encrypted snapshot for {} at {:?}",
        company_code,
        snapshot_path
    );

    // 5. Enforce snapshot retention policy (keep latest 5)
    if let Err(e) = enforce_snapshot_retention(backup_dir, company_code, DEFAULT_MAX_MIGRATION_SNAPSHOTS) {
        log::warn!("Failed to enforce migration snapshot retention for {}: {:?}", company_code, e);
    }

    Ok(snapshot_path)
}

/// Enforces retention policy by keeping only the newest `max_retention` snapshots for a company.
pub fn enforce_snapshot_retention(
    backup_dir: &Path,
    company_code: &str,
    max_retention: usize,
) -> Result<usize, AppError> {
    if !backup_dir.exists() {
        return Ok(0);
    }

    let prefix = format!("company_{}_pre_v", company_code);
    let mut snapshots: Vec<(PathBuf, std::time::SystemTime)> = Vec::new();

    let entries = fs::read_dir(backup_dir).map_err(|e| AppError::Backup {
        code: "ERR_BACKUP_001".to_string(),
        message: format!("Failed to read migration backups directory: {}", e),
    })?;

    for entry in entries.filter_map(|e| e.ok()) {
        let path = entry.path();
        if path.is_file() {
            if let Some(file_name) = path.file_name().and_then(|n| n.to_str()) {
                if file_name.starts_with(&prefix) && file_name.ends_with(".db") {
                    let modified = entry
                        .metadata()
                        .and_then(|m| m.modified())
                        .unwrap_or(std::time::SystemTime::UNIX_EPOCH);
                    snapshots.push((path, modified));
                }
            }
        }
    }

    // Sort newest to oldest
    snapshots.sort_by(|a, b| b.1.cmp(&a.1));

    let mut deleted_count = 0;
    if snapshots.len() > max_retention {
        for (old_path, _) in snapshots.iter().skip(max_retention) {
            if let Ok(_) = fs::remove_file(old_path) {
                log::info!("Pruned old migration snapshot: {:?}", old_path);
                deleted_count += 1;
            }
        }
    }

    Ok(deleted_count)
}

/// Lists all migration snapshots available for a given company code.
pub fn list_migration_snapshots(
    backup_dir: &Path,
    company_code: &str,
) -> Result<Vec<PathBuf>, AppError> {
    if !backup_dir.exists() {
        return Ok(Vec::new());
    }

    let prefix = format!("company_{}_pre_v", company_code);
    let mut snapshots = Vec::new();

    let entries = fs::read_dir(backup_dir).map_err(|e| AppError::Backup {
        code: "ERR_BACKUP_001".to_string(),
        message: format!("Failed to read migration backups directory: {}", e),
    })?;

    for entry in entries.filter_map(|e| e.ok()) {
        let path = entry.path();
        if path.is_file() {
            if let Some(file_name) = path.file_name().and_then(|n| n.to_str()) {
                if file_name.starts_with(&prefix) && file_name.ends_with(".db") {
                    snapshots.push(path);
                }
            }
        }
    }

    snapshots.sort();
    Ok(snapshots)
}

/// Restores a snapshot file back to the target database location.
pub fn restore_snapshot(snapshot_path: &Path, target_db_path: &Path) -> Result<(), AppError> {
    if !snapshot_path.exists() {
        return Err(AppError::Backup {
            code: "ERR_BACKUP_001".to_string(),
            message: format!("Snapshot file does not exist: {:?}", snapshot_path),
        });
    }

    fs::copy(snapshot_path, target_db_path).map_err(|e| AppError::Backup {
        code: "ERR_BACKUP_001".to_string(),
        message: format!("Failed to restore snapshot to {:?}: {}", target_db_path, e),
    })?;

    log::info!("Successfully restored snapshot from {:?} to {:?}", snapshot_path, target_db_path);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use rusqlite::Connection;
    use std::env::temp_dir;

    fn get_unique_test_dir(name: &str) -> PathBuf {
        let dir = temp_dir().join(format!("sms_snap_test_{}_{}", name, chrono::Local::now().timestamp_nanos_opt().unwrap_or(0)));
        let _ = fs::create_dir_all(&dir);
        dir
    }

    #[test]
    fn test_create_pre_migration_snapshot() {
        let test_dir = get_unique_test_dir("create");
        let db_path = test_dir.join("company_DEMO.db");
        let backup_dir = test_dir.join("backups").join("migrations");

        let conn = Connection::open(&db_path).unwrap();
        conn.execute("CREATE TABLE test_tbl (id INTEGER, name TEXT);", []).unwrap();
        conn.execute("INSERT INTO test_tbl VALUES (1, 'Initial Data');", []).unwrap();

        let snapshot_path = create_pre_migration_snapshot(
            &conn,
            &db_path,
            &backup_dir,
            "DEMO",
            14,
        ).unwrap();

        assert!(snapshot_path.exists(), "Snapshot file should exist");
        let filename = snapshot_path.file_name().unwrap().to_str().unwrap();
        assert!(filename.starts_with("company_DEMO_pre_v14_"));
        assert!(filename.ends_with(".db"));

        // Verify snapshot content matches
        let snap_conn = Connection::open(&snapshot_path).unwrap();
        let name: String = snap_conn.query_row("SELECT name FROM test_tbl WHERE id = 1", [], |r| r.get(0)).unwrap();
        assert_eq!(name, "Initial Data");

        let _ = fs::remove_dir_all(&test_dir);
    }

    #[test]
    fn test_snapshot_preserves_sqlcipher_encryption() {
        let test_dir = get_unique_test_dir("encrypt");
        let db_path = test_dir.join("company_SECURE.db");
        let backup_dir = test_dir.join("backups").join("migrations");
        let key = "SecretPassphrase123!";

        let conn = Connection::open(&db_path).unwrap();
        conn.pragma_update(None, "key", key).unwrap();
        conn.execute("CREATE TABLE secret_data (secret TEXT);", []).unwrap();
        conn.execute("INSERT INTO secret_data VALUES ('TopSecretInvoice');", []).unwrap();

        let snapshot_path = create_pre_migration_snapshot(
            &conn,
            &db_path,
            &backup_dir,
            "SECURE",
            14,
        ).unwrap();

        assert!(snapshot_path.exists());

        // Opening snapshot without key should fail to read
        let unauth_conn = Connection::open(&snapshot_path).unwrap();
        let unauth_read = unauth_conn.query_row("SELECT secret FROM secret_data", [], |r| r.get::<_, String>(0));
        assert!(unauth_read.is_err(), "Snapshot must remain encrypted and cannot be read without SQLCipher key");

        // Opening snapshot with correct key must succeed
        let auth_conn = Connection::open(&snapshot_path).unwrap();
        auth_conn.pragma_update(None, "key", key).unwrap();
        let secret: String = auth_conn.query_row("SELECT secret FROM secret_data", [], |r| r.get(0)).unwrap();
        assert_eq!(secret, "TopSecretInvoice");

        let _ = fs::remove_dir_all(&test_dir);
    }

    #[test]
    fn test_snapshot_retention_policy_limits_to_5() {
        let test_dir = get_unique_test_dir("retention");
        let backup_dir = test_dir.join("backups").join("migrations");
        fs::create_dir_all(&backup_dir).unwrap();

        // Create 8 dummy snapshot files
        for i in 1..=8 {
            let file_path = backup_dir.join(format!("company_TEST_pre_v14_20260824_12000{}.db", i));
            fs::write(&file_path, format!("snapshot {}", i)).unwrap();
            // Stagger timestamp slightly
            std::thread::sleep(std::time::Duration::from_millis(15));
        }

        let initial_snapshots = list_migration_snapshots(&backup_dir, "TEST").unwrap();
        assert_eq!(initial_snapshots.len(), 8);

        let deleted = enforce_snapshot_retention(&backup_dir, "TEST", 5).unwrap();
        assert_eq!(deleted, 3, "Should delete exactly 3 oldest snapshots");

        let remaining = list_migration_snapshots(&backup_dir, "TEST").unwrap();
        assert_eq!(remaining.len(), 5, "Should retain exactly 5 newest snapshots");

        let _ = fs::remove_dir_all(&test_dir);
    }

    #[test]
    fn test_backup_failure_handling_on_nonexistent_source() {
        let test_dir = get_unique_test_dir("fail");
        let non_existent_db = test_dir.join("non_existent.db");
        let backup_dir = test_dir.join("backups").join("migrations");
        let conn = Connection::open_in_memory().unwrap();

        let res = create_pre_migration_snapshot(
            &conn,
            &non_existent_db,
            &backup_dir,
            "FAIL",
            14,
        );

        assert!(res.is_err(), "Expected error when source DB does not exist");
        match res.unwrap_err() {
            AppError::Backup { code, message } => {
                assert_eq!(code, "ERR_BACKUP_001");
                assert!(message.contains("Source database file does not exist"));
            }
            other => panic!("Expected AppError::Backup, got {:?}", other),
        }

        let _ = fs::remove_dir_all(&test_dir);
    }

    #[test]
    fn test_snapshot_recovery_path_restores_clean_state() {
        let test_dir = get_unique_test_dir("recovery");
        let db_path = test_dir.join("company_RECOVER.db");
        let backup_dir = test_dir.join("backups").join("migrations");

        let conn = Connection::open(&db_path).unwrap();
        conn.execute("CREATE TABLE account (balance INTEGER);", []).unwrap();
        conn.execute("INSERT INTO account VALUES (1000);", []).unwrap();

        let snapshot_path = create_pre_migration_snapshot(
            &conn,
            &db_path,
            &backup_dir,
            "RECOVER",
            14,
        ).unwrap();
        drop(conn);

        // Simulate corrupted / failed update in live db
        let conn2 = Connection::open(&db_path).unwrap();
        conn2.execute("UPDATE account SET balance = 0;", []).unwrap();
        conn2.execute("DROP TABLE account;", []).unwrap();
        drop(conn2);

        // Recover from snapshot
        restore_snapshot(&snapshot_path, &db_path).unwrap();

        // Verify recovered state
        let conn3 = Connection::open(&db_path).unwrap();
        let balance: i64 = conn3.query_row("SELECT balance FROM account", [], |r| r.get(0)).unwrap();
        assert_eq!(balance, 1000, "Database balance should be fully restored to pre-migration state");

        let _ = fs::remove_dir_all(&test_dir);
    }
}
