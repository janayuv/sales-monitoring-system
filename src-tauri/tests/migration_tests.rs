use rusqlite::Connection;
use std::collections::{BTreeMap, BTreeSet};
use tauri_app_lib::database::migrate::{apply_migrations_atomic, get_migrations, run_migrations, Migration};
use tauri_app_lib::models::database_models::CreditNoteStatus;
use tauri_app_lib::repositories::credit_note_repository::SqliteCreditNoteRepository;
use tauri_app_lib::repositories::CreditNoteRepository;

/// Represents a semantically normalized SQLite column definition
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ColumnSchema {
    pub name: String,
    pub declared_type: String,
    pub not_null: bool,
    pub default_value: Option<String>,
    pub pk_index: i32,
}

/// Represents a foreign key constraint
#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord)]
pub struct ForeignKeySchema {
    pub from_col: String,
    pub to_table: String,
    pub to_col: String,
    pub on_update: String,
    pub on_delete: String,
}

/// Represents an index definition
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct IndexSchema {
    pub name: String,
    pub is_unique: bool,
    pub columns: Vec<String>,
}

/// Represents a full table schema
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TableSchema {
    pub name: String,
    pub columns: BTreeMap<String, ColumnSchema>,
    pub foreign_keys: BTreeSet<ForeignKeySchema>,
    pub indexes: BTreeMap<String, IndexSchema>,
}

/// Complete semantic snapshot of a database schema
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SchemaSnapshot {
    pub tables: BTreeMap<String, TableSchema>,
    pub views: BTreeSet<String>,
    pub triggers: BTreeSet<String>,
}

impl SchemaSnapshot {
    pub fn capture(conn: &Connection) -> Self {
        let mut tables = BTreeMap::new();

        // 1. Fetch user tables (ignoring sqlite internals and temporary backups)
        let mut stmt = conn
            .prepare(
                "SELECT name FROM sqlite_master 
                 WHERE type = 'table' 
                   AND name NOT LIKE 'sqlite_%' 
                   AND name NOT IN ('schema_migrations', 'credit_notes_backup', '_rebuild_probe')
                 ORDER BY name;",
            )
            .unwrap();

        let table_names: Vec<String> = stmt
            .query_map([], |r| r.get(0))
            .unwrap()
            .filter_map(|r| r.ok())
            .collect();

        for tbl in table_names {
            // Columns
            let mut col_stmt = conn.prepare(&format!("PRAGMA table_info('{}');", tbl)).unwrap();
            let columns = col_stmt
                .query_map([], |r| {
                    let name: String = r.get(1)?;
                    let raw_type: String = r.get(2)?;
                    let not_null: bool = r.get::<_, i32>(3)? != 0;
                    let default_val: Option<String> = r.get(4)?;
                    let pk_index: i32 = r.get(5)?;
                    Ok((
                        name.clone(),
                        ColumnSchema {
                            name,
                            declared_type: raw_type.trim().to_uppercase(),
                            not_null,
                            default_value: default_val,
                            pk_index,
                        },
                    ))
                })
                .unwrap()
                .filter_map(|r| r.ok())
                .collect::<BTreeMap<String, ColumnSchema>>();

            // Foreign Keys
            let mut fk_stmt = conn
                .prepare(&format!("PRAGMA foreign_key_list('{}');", tbl))
                .unwrap();
            let foreign_keys = fk_stmt
                .query_map([], |r| {
                    Ok(ForeignKeySchema {
                        to_table: r.get::<_, String>(2)?.to_lowercase(),
                        from_col: r.get::<_, String>(3)?.to_lowercase(),
                        to_col: r.get::<_, Option<String>>(4)?.unwrap_or_default().to_lowercase(),
                        on_update: r.get::<_, String>(5)?.to_uppercase(),
                        on_delete: r.get::<_, String>(6)?.to_uppercase(),
                    })
                })
                .unwrap()
                .filter_map(|r| r.ok())
                .collect::<BTreeSet<ForeignKeySchema>>();

            // Indexes
            let mut idx_stmt = conn
                .prepare(&format!("PRAGMA index_list('{}');", tbl))
                .unwrap();
            let mut indexes = BTreeMap::new();
            let index_headers: Vec<(String, bool)> = idx_stmt
                .query_map([], |r| {
                    let idx_name: String = r.get(1)?;
                    let unique: bool = r.get::<_, i32>(2)? != 0;
                    Ok((idx_name, unique))
                })
                .unwrap()
                .filter_map(|r| r.ok())
                .collect();

            for (idx_name, is_unique) in index_headers {
                if idx_name.starts_with("sqlite_autoindex") {
                    continue;
                }
                let mut info_stmt = conn
                    .prepare(&format!("PRAGMA index_info('{}');", idx_name))
                    .unwrap();
                let cols: Vec<String> = info_stmt
                    .query_map([], |r| r.get::<_, String>(2))
                    .unwrap()
                    .filter_map(|r| r.ok())
                    .collect();

                indexes.insert(
                    idx_name.clone(),
                    IndexSchema {
                        name: idx_name,
                        is_unique,
                        columns: cols,
                    },
                );
            }

            tables.insert(
                tbl.clone(),
                TableSchema {
                    name: tbl,
                    columns,
                    foreign_keys,
                    indexes,
                },
            );
        }

        // Views
        let mut view_stmt = conn
            .prepare("SELECT name FROM sqlite_master WHERE type = 'view' ORDER BY name;")
            .unwrap();
        let views = view_stmt
            .query_map([], |r| r.get(0))
            .unwrap()
            .filter_map(|r| r.ok())
            .collect();

        // Triggers
        let mut trg_stmt = conn
            .prepare("SELECT name FROM sqlite_master WHERE type = 'trigger' ORDER BY name;")
            .unwrap();
        let triggers = trg_stmt
            .query_map([], |r| r.get(0))
            .unwrap()
            .filter_map(|r| r.ok())
            .collect();

        SchemaSnapshot {
            tables,
            views,
            triggers,
        }
    }
}

#[test]
fn test_schema_parity_fresh_vs_sequential_upgrade_with_historical_data() {
    let all_migrations = get_migrations();
    let target_version = all_migrations.iter().map(|m| m.version).max().unwrap_or(0);
    assert!(target_version >= 14, "Target migration version should be at least 14");

    // -------------------------------------------------------------
    // Path A: Fresh Database Migration (v1..current in one shot)
    // -------------------------------------------------------------
    let mut conn_fresh = Connection::open_in_memory().unwrap();
    run_migrations(&mut conn_fresh).unwrap();
    let fresh_schema = SchemaSnapshot::capture(&conn_fresh);

    // -------------------------------------------------------------
    // Path B: Sequential Migration with Seeded Historical Data at Each Version
    // -------------------------------------------------------------
    let mut conn_seq = Connection::open_in_memory().unwrap();

    for v in 1..=target_version {
        let single_migration: Vec<Migration> = all_migrations
            .iter()
            .filter(|m| m.version == v)
            .cloned()
            .collect();

        apply_migrations_atomic(&mut conn_seq, &single_migration, v - 1).unwrap();

        // Seed representative historical dummy data at specific migration milestones
        match v {
            1 => {
                // v1 Base Seed
                conn_seq.execute(
                    "INSERT OR IGNORE INTO states (state_code, state_name, gst_state_id) VALUES ('33', 'Tamil Nadu', '33')",
                    [],
                ).unwrap();
                conn_seq.execute(
                    "INSERT OR IGNORE INTO currencies (currency_code, currency_name, symbol) VALUES ('INR', 'Indian Rupee', '₹')",
                    [],
                ).unwrap();
                conn_seq.execute(
                    "INSERT OR IGNORE INTO financial_years (id, label, start_date, end_date, is_active) VALUES (1, '2026-2027', '2026-04-01', '2027-03-31', 1)",
                    [],
                ).unwrap();
                conn_seq.execute(
                    "INSERT OR IGNORE INTO gst_rates (rate, description) VALUES (18.0, '18% GST')",
                    [],
                ).unwrap();
                conn_seq.execute(
                    "INSERT OR IGNORE INTO hsn_master (hsn_code, description, gst_rate) VALUES ('8708.99.00', 'Motor Parts', 18.0)",
                    [],
                ).unwrap();
                conn_seq.execute(
                    "INSERT OR IGNORE INTO uoms (uom_code, uom_name) VALUES ('NOS', 'Numbers')",
                    [],
                ).unwrap();
                conn_seq.execute(
                    "INSERT INTO suppliers (id, supplier_code, supplier_name) VALUES (1, 'SUP-01', 'Primary Supplier')",
                    [],
                ).unwrap();
                conn_seq.execute(
                    "INSERT INTO customers (id, customer_code, customer_name, gstin, address) VALUES (1, 'CUST-01', 'Alpha Corp', '33AAACA1234A1Z5', '123 Main St')",
                    [],
                ).unwrap();
                conn_seq.execute(
                    "INSERT INTO items (part_code, part_name, hsn_code, uom_code, default_gst_rate, supplier_id) VALUES ('PART-A', 'Engine Valve', '8708.99.00', 'NOS', 18.0, 1)",
                    [],
                ).unwrap();
                conn_seq.execute(
                    "INSERT INTO invoices (invoice_number, invoice_date, customer_id, financial_year_id, total_taxable, total_cgst, total_sgst, total_value, status)
                     VALUES ('INV-101', '2026-07-15', 1, 1, 10000.0, 900.0, 900.0, 11800.0, 'Imported')",
                    [],
                ).unwrap();
                conn_seq.execute(
                    "INSERT INTO invoice_items (invoice_number, part_code, quantity, rate_pre_unit, assessable_value, cgst_rate, cgst_amount, sgst_rate, sgst_amount, total_value)
                     VALUES ('INV-101', 'PART-A', 10.0, 1000.0, 10000.0, 9.0, 900.0, 9.0, 900.0, 11800.0)",
                    [],
                ).unwrap();
            }
            2 => {
                // v2 tally_customer_name populated
                conn_seq.execute(
                    "UPDATE customers SET tally_customer_name = 'Alpha Corp Tally' WHERE id = 1",
                    [],
                ).unwrap();
            }
            3 => {
                // v3 customer_categories and category_name
                conn_seq.execute(
                    "INSERT INTO customer_categories (id, name, description) VALUES (1, 'OEM Tier 1', 'Direct Automotive Customers')",
                    [],
                ).unwrap();
                conn_seq.execute(
                    "UPDATE customers SET category_name = 'OEM Tier 1' WHERE id = 1",
                    [],
                ).unwrap();
            }
            6 => {
                // v6 company_profile
                conn_seq.execute(
                    "INSERT INTO company_profile (id, company_name, gstin, state_code) VALUES (1, 'Apex Manufacturing Ltd', '33ABCDE1234F1Z5', '33')",
                    [],
                ).unwrap();
            }
            9 => {
                // v9 credit_notes
                conn_seq.execute(
                    "INSERT INTO credit_notes (credit_note_number, invoice_number, customer_id, credit_note_date, status, remarks)
                     VALUES ('CN-201', 'INV-101', 1, '2026-07-20', 'Approved', 'Price adjustment')",
                    [],
                ).unwrap();
                conn_seq.execute(
                    "INSERT INTO credit_note_items (credit_note_number, invoice_item_id, part_code, quantity, rate_pre_unit, assessable_value, total_value, original_quantity, original_rate_pre_unit)
                     VALUES ('CN-201', 1, 'PART-A', 2.0, 100.0, 200.0, 236, 2.0, 100.0)",
                    [],
                ).unwrap();
            }
            _ => {}
        }
    }

    let seq_schema = SchemaSnapshot::capture(&conn_seq);

    // -------------------------------------------------------------
    // Assertion 1: Semantic Schema Parity (Tables, Columns, Types, Nullability, PK, FK, Indexes)
    // -------------------------------------------------------------
    assert_eq!(
        fresh_schema.tables.keys().collect::<Vec<_>>(),
        seq_schema.tables.keys().collect::<Vec<_>>(),
        "Table sets must be identical between fresh and sequential migration"
    );

    for (table_name, fresh_table) in &fresh_schema.tables {
        let seq_table = seq_schema
            .tables
            .get(table_name)
            .expect(&format!("Table {} missing in sequential schema", table_name));

        // Compare columns
        assert_eq!(
            fresh_table.columns, seq_table.columns,
            "Column definitions mismatch on table: {}",
            table_name
        );

        // Compare foreign keys
        assert_eq!(
            fresh_table.foreign_keys, seq_table.foreign_keys,
            "Foreign key constraints mismatch on table: {}",
            table_name
        );

        // Compare indexes
        assert_eq!(
            fresh_table.indexes, seq_table.indexes,
            "Index definitions mismatch on table: {}",
            table_name
        );
    }

    // Compare views and triggers
    assert_eq!(fresh_schema.views, seq_schema.views);
    assert_eq!(fresh_schema.triggers, seq_schema.triggers);

    // -------------------------------------------------------------
    // Assertion 2: Historical Data Preservation Verification
    // -------------------------------------------------------------
    let cust_name: String = conn_seq
        .query_row("SELECT report_name FROM customers WHERE id = 1", [], |r| r.get(0))
        .unwrap();
    assert_eq!(cust_name, "Alpha Corp");

    let cust_tally: Option<String> = conn_seq
        .query_row("SELECT tally_customer_name FROM customers WHERE id = 1", [], |r| r.get(0))
        .unwrap();
    assert_eq!(cust_tally, Some("Alpha Corp Tally".to_string()));

    let cust_cat_id: Option<i64> = conn_seq
        .query_row("SELECT category_id FROM customers WHERE id = 1", [], |r| r.get(0))
        .unwrap();
    assert_eq!(cust_cat_id, Some(1), "v12 category_id backfill must link to category 1");

    let invoice_val: f64 = conn_seq
        .query_row("SELECT total_value FROM invoices WHERE invoice_number = 'INV-101'", [], |r| r.get(0))
        .unwrap();
    assert_eq!(invoice_val, 11800.0);

    let cn_val: i64 = conn_seq
        .query_row("SELECT total_value FROM credit_note_items WHERE credit_note_number = 'CN-201'", [], |r| r.get(0))
        .unwrap();
    assert_eq!(cn_val, 200, "v13 total_value recalculation must equal assessable_value + taxes (200 + 0)");

    // -------------------------------------------------------------
    // Assertion 3: Migration Audit Metadata Completeness
    // -------------------------------------------------------------
    let fresh_migration_count: i64 = conn_fresh
        .query_row("SELECT COUNT(*) FROM schema_migrations", [], |r| r.get(0))
        .unwrap();
    let seq_migration_count: i64 = conn_seq
        .query_row("SELECT COUNT(*) FROM schema_migrations", [], |r| r.get(0))
        .unwrap();

    assert_eq!(fresh_migration_count, target_version as i64);
    assert_eq!(seq_migration_count, target_version as i64);

    let invalid_checksums: i64 = conn_seq
        .query_row(
            "SELECT COUNT(*) FROM schema_migrations WHERE checksum_sha256 IS NULL OR TRIM(checksum_sha256) = ''",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(invalid_checksums, 0, "Every migration audit entry must have a valid SHA256 checksum");
}

#[test]
fn test_v14_hsn_migration_preserves_legacy_invoices_and_indexes() {
    let mut conn = Connection::open_in_memory().unwrap();
    let all_migrations = get_migrations();

    // 1. Build database up to v13 (prior to transaction HSN migration)
    let v1_to_v13: Vec<Migration> = all_migrations.iter().filter(|m| m.version <= 13).cloned().collect();
    apply_migrations_atomic(&mut conn, &v1_to_v13, 0).unwrap();

    // Seed master data and legacy invoice
    conn.execute(
        "INSERT INTO customers (id, customer_code, report_name, status) VALUES (1, 'C1', 'Customer 1', 'Approved')",
        [],
    ).unwrap();
    conn.execute(
        "INSERT INTO items (part_code, part_name, hsn_code, uom_code, default_gst_rate, status)
         VALUES ('PART-X', 'Widget X', '8708.99.00', 'PCS', 18.0, 'Approved')",
        [],
    ).unwrap();
    conn.execute(
        "INSERT INTO invoices (invoice_number, invoice_date, customer_id, financial_year_id, total_taxable, total_value, status)
         VALUES ('INV-LEGACY-1', '2026-07-01', 1, 1, 5000.0, 5900.0, 'Imported')",
        [],
    ).unwrap();
    conn.execute(
        "INSERT INTO invoice_items (invoice_number, part_code, quantity, rate_pre_unit, assessable_value,
                                    cgst_rate, cgst_amount, sgst_rate, sgst_amount, igst_rate, igst_amount, total_value)
         VALUES ('INV-LEGACY-1', 'PART-X', 10.0, 500.0, 5000.0, 9.0, 450.0, 9.0, 450.0, 0.0, 0.0, 5900.0)",
        [],
    ).unwrap();

    // 2. Execute migration v14
    let v14_only: Vec<Migration> = all_migrations.iter().filter(|m| m.version == 14).cloned().collect();
    apply_migrations_atomic(&mut conn, &v14_only, 13).unwrap();

    // 3. Verify legacy row has NULL hsn_code and remains intact
    let legacy_hsn: Option<String> = conn
        .query_row(
            "SELECT hsn_code FROM invoice_items WHERE invoice_number = 'INV-LEGACY-1'",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(legacy_hsn, None, "Legacy invoice items must have NULL hsn_code");

    // 4. Insert new invoice item with explicit transaction-level HSN
    conn.execute(
        "INSERT INTO invoice_items (invoice_number, part_code, quantity, rate_pre_unit, assessable_value,
                                    cgst_rate, cgst_amount, sgst_rate, sgst_amount, igst_rate, igst_amount, total_value, hsn_code)
         VALUES ('INV-LEGACY-1', 'PART-X', 2.0, 500.0, 1000.0, 9.0, 90.0, 9.0, 90.0, 0.0, 0.0, 1180.0, '8409.91.99')",
        [],
    ).unwrap();

    // 5. Query using the new HSN index
    let new_row_hsn: Option<String> = conn
        .query_row(
            "SELECT hsn_code FROM invoice_items WHERE assessable_value = 1000.0",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(new_row_hsn, Some("8409.91.99".to_string()));

    // Verify index idx_invoice_items_hsn exists
    let index_exists: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM sqlite_master WHERE type = 'index' AND name = 'idx_invoice_items_hsn'",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(index_exists, 1, "Index idx_invoice_items_hsn must be present after v14 migration");
}

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
