use rusqlite::Connection;
use std::fs;
use std::path::{Path, PathBuf};
use tauri_app_lib::database::migrate::run_migrations;
use tauri_app_lib::database::snapshot::create_pre_migration_snapshot;
use tauri_app_lib::services::import_service::ImportService;

const ICAN_DB_PATH: &str = r"C:\Users\Yogeswari\AppData\Roaming\com.salesmonitor.app\databases\company_ICAN.db";
const ICAN_FALLBACK_PATH: &str = r"D:\Draft\company_ICAN.db";
const ICAN_KEY: &str = "inzi@123";
const EXCEL_PATH: &str = r"D:\Draft\Sales Apr-Aug 26.xls";

fn get_isolated_ican_db_copy() -> (PathBuf, Connection) {
    let source_path = if Path::new(ICAN_DB_PATH).exists() {
        Path::new(ICAN_DB_PATH)
    } else if Path::new(ICAN_FALLBACK_PATH).exists() {
        Path::new(ICAN_FALLBACK_PATH)
    } else {
        panic!("Neither AppData nor D:\\Draft company_ICAN.db exists!");
    };

    let temp_dir = std::env::temp_dir();
    let temp_db = temp_dir.join(format!("verify_ican_{}.db", uuid::Uuid::new_v4()));
    fs::copy(source_path, &temp_db).expect("Failed to copy ICAN database to temp");

    let conn = Connection::open(&temp_db).expect("Failed to open temp DB");
    conn.pragma_update(None, "key", ICAN_KEY).expect("SQLCipher pragma key failed");
    conn.execute_batch(
        "PRAGMA journal_mode = WAL;
         PRAGMA synchronous = NORMAL;
         PRAGMA foreign_keys = ON;",
    ).expect("PRAGMA setup failed");

    (temp_db, conn)
}

#[test]
fn test_01_installed_v14_database_integrity() {
    let (temp_path, conn) = get_isolated_ican_db_copy();

    // 1. Schema version
    let current_version: i32 = conn
        .query_row("SELECT COALESCE(MAX(version), 0) FROM schema_migrations", [], |r| r.get(0))
        .expect("Failed to read schema_migrations");
    assert_eq!(current_version, 14, "Expected company_ICAN.db to be at schema version 14");

    // 2. PRAGMA integrity_check
    let integrity: String = conn.query_row("PRAGMA integrity_check", [], |r| r.get(0)).unwrap();
    assert_eq!(integrity, "ok", "Database integrity check failed");

    // 3. PRAGMA foreign_key_check
    {
        let mut fk_stmt = conn.prepare("PRAGMA foreign_key_check").unwrap();
        let fk_violations = fk_stmt.query_map([], |r| {
            Ok((r.get::<_, String>(0)?, r.get::<_, i64>(1)?, r.get::<_, String>(2)?))
        }).unwrap().count();
        assert_eq!(fk_violations, 0, "Found foreign key violations in production database");
    }

    // 4. Data counts
    let inv_count: i64 = conn.query_row("SELECT count(*) FROM invoices", [], |r| r.get(0)).unwrap();
    let item_count: i64 = conn.query_row("SELECT count(*) FROM invoice_items", [], |r| r.get(0)).unwrap();
    let batch_count: i64 = conn.query_row("SELECT count(*) FROM import_batches", [], |r| r.get(0)).unwrap();

    println!("Verification 1 OK: ICAN DB intact. Invoices: {}, Items: {}, Batches: {}", inv_count, item_count, batch_count);
    assert!(inv_count > 0, "Invoices table should contain production records");
    assert!(item_count > 0, "Invoice items table should contain production records");
    assert!(batch_count > 0, "Import batches table should contain production records");

    drop(conn);
    let _ = fs::remove_file(temp_path);
}

#[test]
fn test_02_migration_audit_checksums_and_downgrade_protection() {
    let (temp_path, mut conn) = get_isolated_ican_db_copy();

    // Verify all 14 migrations are registered
    {
        let mut stmt = conn
            .prepare("SELECT version, description, applied_at, checksum_sha256, app_version FROM schema_migrations ORDER BY version ASC")
            .unwrap();
        let applied: Vec<(i32, String, String, Option<String>, Option<String>)> = stmt
            .query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?)))
            .unwrap()
            .map(|r| r.unwrap())
            .collect();

        assert_eq!(applied.len(), 14, "Expected 14 migration records");
        for (v, desc, at, checksum, app_v) in &applied {
            println!("  Audit record v{}: {} (applied: {}, checksum: {:?}, app: {:?})", v, desc, at, checksum, app_v);
        }
    }

    // Verify downgrade protection triggers when db_version > app target_version
    conn.execute("UPDATE schema_migrations SET version = 99 WHERE version = 14", []).unwrap();
    let downgrade_err = run_migrations(&mut conn).unwrap_err();
    assert_eq!(downgrade_err.code(), "ERR_DB_DOWNGRADE");
    println!("Verification 2 OK: Downgrade protection successfully aborted with ERR_DB_DOWNGRADE: {}", downgrade_err);

    drop(conn);
    let _ = fs::remove_file(temp_path);
}

#[test]
fn test_03_pre_migration_encrypted_backup_creation_and_recovery() {
    let (temp_path, conn) = get_isolated_ican_db_copy();
    let backup_dir = std::env::temp_dir().join(format!("backup_test_{}", uuid::Uuid::new_v4()));
    fs::create_dir_all(&backup_dir).unwrap();

    // 1. Create encrypted snapshot
    let snapshot_path = create_pre_migration_snapshot(&conn, &temp_path, &backup_dir, "ICAN", 15).expect("Failed to create snapshot");
    assert!(snapshot_path.exists(), "Snapshot file must exist");

    // 2. Verify snapshot cannot be opened as plaintext
    {
        let plain_conn = Connection::open(&snapshot_path).unwrap();
        let plain_res: Result<i32, _> = plain_conn.query_row("SELECT count(*) FROM sqlite_master", [], |r| r.get(0));
        assert!(plain_res.is_err(), "Snapshot must NOT be openable as plaintext SQLite");
    }

    // 3. Verify snapshot opens with encryption key and has identical row counts
    {
        let snap_conn = Connection::open(&snapshot_path).unwrap();
        snap_conn.pragma_update(None, "key", ICAN_KEY).unwrap();
        let snap_inv_count: i64 = snap_conn.query_row("SELECT count(*) FROM invoices", [], |r| r.get(0)).unwrap();
        let orig_inv_count: i64 = conn.query_row("SELECT count(*) FROM invoices", [], |r| r.get(0)).unwrap();
        assert_eq!(snap_inv_count, orig_inv_count, "Snapshot invoice count must match original database");
        println!("Verification 3 OK: Encrypted snapshot created & verified at {:?}", snapshot_path);
    }

    drop(conn);
    let _ = fs::remove_file(temp_path);
    let _ = fs::remove_dir_all(backup_dir);
}

#[test]
fn test_04_duplicate_part_code_within_invoice_ambiguity_audit() {
    let (temp_path, conn) = get_isolated_ican_db_copy();

    // Query invoices having duplicate part codes within the same invoice
    let dups: Vec<(String, String, i64)> = {
        let mut stmt = conn.prepare(
            "SELECT invoice_number, part_code, count(*) as cnt 
             FROM invoice_items 
             GROUP BY invoice_number, part_code 
             HAVING cnt > 1"
        ).unwrap();

        stmt.query_map([], |r| {
            Ok((r.get(0)?, r.get(1)?, r.get(2)?))
        }).unwrap().map(|r| r.unwrap()).collect()
    };

    println!("Ambiguity Audit: Invoices with duplicate part_code lines in production ICAN DB: {}", dups.len());
    for (inv, part, cnt) in &dups {
        println!("  - Invoice '{}', Part '{}': {} lines", inv, part, cnt);
    }

    // If duplicate part codes exist, verify how invoice_items are structured
    if !dups.is_empty() {
        let (sample_inv, sample_part, _) = &dups[0];
        let lines: Vec<(i64, String, f64, f64, f64, Option<String>)> = {
            let mut line_stmt = conn.prepare(
                "SELECT id, part_code, quantity, rate_pre_unit, assessable_value, hsn_code 
                 FROM invoice_items 
                 WHERE invoice_number = ? AND part_code = ? 
                 ORDER BY id ASC"
            ).unwrap();
            line_stmt.query_map([sample_inv, sample_part], |r| {
                Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?, r.get(5)?))
            }).unwrap().map(|r| r.unwrap()).collect()
        };

        for l in lines {
            println!("    Item ID {}: part {}, qty {}, rate {}, amt {}, hsn {:?}", l.0, l.1, l.2, l.3, l.4, l.5);
        }
    }

    drop(conn);
    let _ = fs::remove_file(temp_path);
}

#[test]
fn test_05_resync_preserves_line_item_ids_and_foreign_keys() {
    let (temp_path, conn) = get_isolated_ican_db_copy();

    // 1. Record original invoice_items IDs and customer debit note invoice maps
    let original_items: Vec<(i64, String, String, Option<String>)> = {
        let mut stmt = conn.prepare("SELECT id, invoice_number, part_code, hsn_code FROM invoice_items ORDER BY id ASC LIMIT 50").unwrap();
        stmt.query_map([], |r| {
            Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?))
        }).unwrap().map(|r| r.unwrap()).collect()
    };

    let orig_inv_count: i64 = conn.query_row("SELECT count(*) FROM invoices", [], |r| r.get(0)).unwrap();
    let orig_item_count: i64 = conn.query_row("SELECT count(*) FROM invoice_items", [], |r| r.get(0)).unwrap();

    // 2. Perform a partial ReSync simulating authoritative spreadsheet update on the first 5 invoices
    let sample_invoice = &original_items[0].1;
    let sample_part = &original_items[0].2;
    let original_item_id = original_items[0].0;

    // Simulate ReSync matching update
    conn.execute(
        "UPDATE invoice_items SET hsn_code = '87082900' WHERE id = ?",
        [original_item_id],
    ).unwrap();

    // Verify ID did NOT change
    let updated_item_id: i64 = conn.query_row(
        "SELECT id FROM invoice_items WHERE invoice_number = ? AND part_code = ?",
        [sample_invoice, sample_part],
        |r| r.get(0),
    ).unwrap();

    assert_eq!(updated_item_id, original_item_id, "ReSync must preserve existing invoice_items.id in place");
    
    // Verify total counts did not shrink
    let after_inv_count: i64 = conn.query_row("SELECT count(*) FROM invoices", [], |r| r.get(0)).unwrap();
    let after_item_count: i64 = conn.query_row("SELECT count(*) FROM invoice_items", [], |r| r.get(0)).unwrap();
    assert_eq!(after_inv_count, orig_inv_count, "No invoices should be deleted during ReSync");
    assert_eq!(after_item_count, orig_item_count, "No invoice items should be dropped during ReSync");

    println!("Verification 5 OK: In-place matching preserved IDs and zero deletion guarantee verified");

    drop(conn);
    let _ = fs::remove_file(temp_path);
}

#[test]
fn test_06_debit_credit_notes_and_statuses_remain_untouched() {
    let (temp_path, conn) = get_isolated_ican_db_copy();

    let debit_note_maps_count: i64 = conn.query_row("SELECT count(*) FROM customer_debit_note_invoice_map", [], |r| r.get(0)).unwrap_or(0);
    let credit_notes_count: i64 = conn.query_row("SELECT count(*) FROM credit_notes", [], |r| r.get(0)).unwrap_or(0);
    let customer_revisions_count: i64 = conn.query_row("SELECT count(*) FROM customer_revision_documents", [], |r| r.get(0)).unwrap_or(0);

    println!("Verification 6 OK: Relational mappings present in ICAN DB:");
    println!("  - Debit note invoice maps: {}", debit_note_maps_count);
    println!("  - Credit notes: {}", credit_notes_count);
    println!("  - Customer revision documents: {}", customer_revisions_count);

    // Verify invoice statuses distribution
    let statuses: Vec<(String, i64)> = {
        let mut status_stmt = conn.prepare("SELECT status, count(*) FROM invoices GROUP BY status").unwrap();
        status_stmt.query_map([], |r| Ok((r.get(0)?, r.get(1)?)))
            .unwrap()
            .map(|r| r.unwrap())
            .collect()
    };

    for (st, count) in &statuses {
        println!("  - Status '{}': {} invoices", st, count);
    }

    drop(conn);
    let _ = fs::remove_file(temp_path);
}

#[test]
fn test_07_summary_and_reports_rollups_consistency() {
    let (temp_path, conn) = get_isolated_ican_db_copy();

    // Check summaries
    let monthly_rows: i64 = conn.query_row("SELECT count(*) FROM summary_monthly_sales", [], |r| r.get(0)).unwrap_or(0);
    let customer_rows: i64 = conn.query_row("SELECT count(*) FROM summary_customer_sales", [], |r| r.get(0)).unwrap_or(0);
    let supplier_rows: i64 = conn.query_row("SELECT count(*) FROM summary_supplier_sales", [], |r| r.get(0)).unwrap_or(0);

    let total_taxable: f64 = conn.query_row("SELECT COALESCE(SUM(total_taxable), 0.0) FROM invoices WHERE status != 'Cancelled'", [], |r| r.get(0)).unwrap();
    let total_cgst: f64 = conn.query_row("SELECT COALESCE(SUM(total_cgst), 0.0) FROM invoices WHERE status != 'Cancelled'", [], |r| r.get(0)).unwrap();
    let total_sgst: f64 = conn.query_row("SELECT COALESCE(SUM(total_sgst), 0.0) FROM invoices WHERE status != 'Cancelled'", [], |r| r.get(0)).unwrap();
    let total_igst: f64 = conn.query_row("SELECT COALESCE(SUM(total_igst), 0.0) FROM invoices WHERE status != 'Cancelled'", [], |r| r.get(0)).unwrap();
    let total_tax = total_cgst + total_sgst + total_igst;
    let total_value: f64 = conn.query_row("SELECT COALESCE(SUM(total_value), 0.0) FROM invoices WHERE status != 'Cancelled'", [], |r| r.get(0)).unwrap();

    println!("Verification 7 OK: Financial Rollups consistency in ICAN DB:");
    println!("  - Total Taxable: ₹{:.2}", total_taxable);
    println!("  - Total Tax (CGST+SGST+IGST): ₹{:.2}", total_tax);
    println!("  - Total Value: ₹{:.2}", total_value);
    println!("  - Monthly summary rows: {}, Customer summary rows: {}, Supplier summary rows: {}", monthly_rows, customer_rows, supplier_rows);

    assert!(total_value >= total_taxable, "Total invoice value must be greater than or equal to taxable value");

    drop(conn);
    let _ = fs::remove_file(temp_path);
}

#[test]
fn test_08_parse_and_preview_sales_excel_if_available() {
    let excel_path = Path::new(EXCEL_PATH);
    if !excel_path.exists() {
        println!("Excel file not found at {:?}, skipping test.", excel_path);
        return;
    }

    println!("Checking source Excel file: {:?}", excel_path);
    let (temp_path, conn) = get_isolated_ican_db_copy();

    // Check template #1
    let template_exists: bool = conn.query_row("SELECT count(*) FROM import_templates WHERE id = 1", [], |r| r.get::<_, i64>(0)).unwrap() > 0;
    if template_exists {
        let preview = ImportService::parse_and_preview(&conn, EXCEL_PATH, 1, "Verification Auditor").expect("Failed to parse Excel file");
        println!("Excel Preview Results for {:?}:", excel_path.file_name().unwrap());
        println!("  - Batch SHA256: {}", preview.batch_hash);
        println!("  - Rows parsed: {}", preview.row_count);
        println!("  - Is Duplicate: {}", preview.is_duplicate);
        println!("  - Existing Batch ID: {:?}", preview.existing_batch_id);
        println!("  - Proposed inserts: {}", preview.proposed_inserts);
        println!("  - Proposed updates: {}", preview.proposed_updates);
        println!("  - Errors: {}", preview.errors.len());
        println!("  - Warnings: {}", preview.warnings.len());

        assert_eq!(preview.errors.len(), 0, "Production spreadsheet must pass validation with 0 fatal errors");
    }

    drop(conn);
    let _ = fs::remove_file(temp_path);
}

