use rusqlite::Connection;
use tauri_app_lib::models::database_models::CreditNoteStatus;
use tauri_app_lib::repositories::credit_note_repository::SqliteCreditNoteRepository;
use tauri_app_lib::repositories::CreditNoteRepository;

#[test]
fn test_migration_v9_sequence() {
    let conn = Connection::open_in_memory().unwrap();

    // 1. Create dependencies
    conn.execute(
        "CREATE TABLE customers (id INTEGER PRIMARY KEY, customer_code TEXT)",
        [],
    ).unwrap();
    conn.execute(
        "INSERT INTO customers VALUES (1, 'C1')",
        [],
    ).unwrap();

    conn.execute(
        "CREATE TABLE invoices (invoice_number TEXT PRIMARY KEY, customer_id INTEGER)",
        [],
    ).unwrap();
    conn.execute(
        "INSERT INTO invoices VALUES ('INV-100', 1)",
        [],
    ).unwrap();

    // 2. Create old v8 credit_notes table
    conn.execute(
        "CREATE TABLE credit_notes (
            credit_note_number TEXT PRIMARY KEY,
            invoice_number TEXT,
            customer_id INTEGER,
            credit_note_date TEXT,
            status TEXT,
            remarks TEXT,
            approved_at TEXT,
            created_at TEXT
         )",
        [],
    ).unwrap();

    // Seed historical v8 credit note record
    conn.execute(
        "INSERT INTO credit_notes (credit_note_number, invoice_number, customer_id, credit_note_date, status, remarks, approved_at, created_at)
         VALUES ('CN-100', 'INV-100', 1, '2026-07-29', 'Approved', 'Old remark', '2026-07-29 12:00:00', '2026-07-29 11:00:00')",
        [],
    ).unwrap();

    // 3. Execute version 9 sql statements directly
    conn.execute_batch("
        CREATE TABLE credit_notes_new (
            credit_note_number TEXT PRIMARY KEY,
            invoice_number TEXT NOT NULL UNIQUE REFERENCES invoices(invoice_number) ON DELETE RESTRICT,
            customer_id INTEGER NOT NULL REFERENCES customers(id),
            credit_note_date TEXT NOT NULL,
            status TEXT NOT NULL DEFAULT 'Draft' CHECK(status IN ('Draft', 'Review', 'Approved', 'Exported')),
            remarks TEXT,
            reason TEXT,
            revision_no INTEGER NOT NULL DEFAULT 1 CHECK(revision_no >= 1),
            updated_at TEXT NOT NULL DEFAULT (datetime('now')),
            created_at TEXT NOT NULL DEFAULT (datetime('now')),
            is_deleted INTEGER NOT NULL DEFAULT 0 CHECK(is_deleted IN (0, 1)),
            deleted_by TEXT,
            deleted_at TEXT,
            snapshot_version INTEGER NOT NULL DEFAULT 1,
            frozen_company_name TEXT,
            frozen_company_gstin TEXT,
            frozen_company_address TEXT,
            frozen_company_state TEXT,
            frozen_company_state_code TEXT,
            frozen_company_pan TEXT,
            frozen_company_bank_details TEXT,
            frozen_customer_name TEXT,
            frozen_customer_gstin TEXT,
            frozen_customer_address TEXT,
            frozen_customer_state TEXT,
            frozen_customer_pincode TEXT,
            frozen_customer_pan TEXT,
            frozen_place_of_supply TEXT,
            frozen_currency TEXT DEFAULT 'INR',
            approved_by TEXT,
            approved_at TEXT,
            exported_by TEXT,
            exported_at TEXT,
            print_count INTEGER NOT NULL DEFAULT 0 CHECK(print_count >= 0),
            last_printed_at TEXT,
            last_printed_by TEXT
        );

        INSERT INTO credit_notes_new (
            credit_note_number, invoice_number, customer_id, credit_note_date,
            status, remarks, approved_at, created_at
        )
        SELECT 
            credit_note_number, invoice_number, customer_id, credit_note_date,
            status, remarks, approved_at, created_at
        FROM credit_notes;

        ALTER TABLE credit_notes RENAME TO credit_notes_backup;
        ALTER TABLE credit_notes_new RENAME TO credit_notes;

        CREATE TABLE IF NOT EXISTS credit_note_items (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            credit_note_number TEXT NOT NULL REFERENCES credit_notes(credit_note_number) ON DELETE CASCADE,
            invoice_item_id INTEGER NOT NULL,
            part_code TEXT NOT NULL,
            quantity REAL NOT NULL CHECK(quantity >= 0),
            rate_pre_unit INTEGER NOT NULL CHECK(rate_pre_unit >= 0),
            assessable_value INTEGER NOT NULL CHECK(assessable_value >= 0),
            cgst_rate REAL NOT NULL DEFAULT 0.0,
            cgst_amount INTEGER NOT NULL DEFAULT 0 CHECK(cgst_amount >= 0),
            sgst_rate REAL NOT NULL DEFAULT 0.0,
            sgst_amount INTEGER NOT NULL DEFAULT 0 CHECK(sgst_amount >= 0),
            igst_rate REAL NOT NULL DEFAULT 0.0,
            igst_amount INTEGER NOT NULL DEFAULT 0 CHECK(igst_amount >= 0),
            total_value INTEGER NOT NULL CHECK(total_value >= 0),
            original_quantity REAL NOT NULL CHECK(original_quantity >= 0),
            original_rate_pre_unit INTEGER NOT NULL CHECK(original_rate_pre_unit >= 0),
            frozen_unit_of_measure TEXT
        );
    ").unwrap();

    // 4. Validate migrated results
    let repo = SqliteCreditNoteRepository;
    let header = repo.load_header(&conn, "CN-100").unwrap().expect("Should load migrated header");

    assert_eq!(header.credit_note_number, "CN-100");
    assert_eq!(header.invoice_number, "INV-100");
    assert_eq!(header.customer_id, 1);
    assert_eq!(header.status, CreditNoteStatus::Approved);
    assert_eq!(header.remarks, Some("Old remark".to_string()));
    assert_eq!(header.approved_at, Some("2026-07-29 12:00:00".to_string()));
    assert_eq!(header.revision_no, 1);
    assert_eq!(header.is_deleted, false);

    // Verify backup table exists and contains identical rows
    let backup_count: i64 = conn.query_row(
        "SELECT COUNT(*) FROM credit_notes_backup",
        [],
        |r| r.get(0),
    ).unwrap();
    assert_eq!(backup_count, 1);

    // Foreign key check passes
    let fk_violations_count: i32 = conn.query_row(
        "PRAGMA foreign_key_check",
        [],
        |_r| Ok(1),
    ).unwrap_or(0);
    assert_eq!(fk_violations_count, 0);
}
