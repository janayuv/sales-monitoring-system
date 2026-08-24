use crate::error::AppError;
use rusqlite::{params, Connection};
use sha2::{Digest, Sha256};
use std::time::Instant;

#[derive(Clone, Debug)]
pub struct Migration {
    pub version: i32,
    pub description: &'static str,
    pub sql: &'static str,
    /// When true, the migration is a full table rebuild: it runs with
    /// foreign_keys disabled and a foreign_key_check before commit, because
    /// SQLite cannot ALTER away a foreign key or CHECK constraint in place.
    pub rebuild: bool,
}

/// Computes the normalized SHA256 checksum of migration SQL (converting CRLF to LF for cross-platform determinism)
pub fn compute_sql_checksum(sql: &str) -> String {
    let normalized = sql.replace("\r\n", "\n");
    let mut hasher = Sha256::new();
    hasher.update(normalized.trim().as_bytes());
    format!("{:x}", hasher.finalize())
}

/// Upgrades the schema_migrations table structure to support checksums, app versions, and execution times
fn ensure_and_upgrade_schema_migrations(
    conn: &mut Connection,
    migrations: &[Migration],
) -> Result<(), AppError> {
    // 1. Create base tracking table if not present
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

    // 2. Check existing columns in schema_migrations
    let mut stmt = conn
        .prepare("PRAGMA table_info(schema_migrations);")
        .map_err(|e| AppError::Db {
            code: "ERR_DB_003".to_string(),
            message: format!("Failed to inspect schema_migrations table: {}", e),
        })?;

    let existing_columns: Vec<String> = stmt
        .query_map([], |r| r.get::<_, String>(1))
        .map_err(|e| AppError::Db {
            code: "ERR_DB_003".to_string(),
            message: format!("Failed to read schema_migrations columns: {}", e),
        })?
        .filter_map(|res| res.ok())
        .collect();

    // 3. Add new audit columns if missing (backward compatibility with legacy databases)
    if !existing_columns.contains(&"checksum_sha256".to_string()) {
        conn.execute(
            "ALTER TABLE schema_migrations ADD COLUMN checksum_sha256 TEXT;",
            [],
        )
        .map_err(|e| AppError::Db {
            code: "ERR_DB_003".to_string(),
            message: format!("Failed to add checksum_sha256 column: {}", e),
        })?;
    }

    if !existing_columns.contains(&"app_version".to_string()) {
        conn.execute(
            "ALTER TABLE schema_migrations ADD COLUMN app_version TEXT;",
            [],
        )
        .map_err(|e| AppError::Db {
            code: "ERR_DB_003".to_string(),
            message: format!("Failed to add app_version column: {}", e),
        })?;
    }

    if !existing_columns.contains(&"execution_time_ms".to_string()) {
        conn.execute(
            "ALTER TABLE schema_migrations ADD COLUMN execution_time_ms INTEGER NOT NULL DEFAULT 0;",
            [],
        )
        .map_err(|e| AppError::Db {
            code: "ERR_DB_003".to_string(),
            message: format!("Failed to add execution_time_ms column: {}", e),
        })?;
    }

    // 4. Backfill checksum_sha256 and app_version for legacy applied rows that have NULL checksums
    let current_app_ver = env!("CARGO_PKG_VERSION");
    for m in migrations {
        let expected_checksum = compute_sql_checksum(m.sql);
        conn.execute(
            "UPDATE schema_migrations 
             SET checksum_sha256 = ?, app_version = COALESCE(app_version, ?)
             WHERE version = ? AND checksum_sha256 IS NULL",
            params![expected_checksum, current_app_ver, m.version],
        )
        .map_err(|e| AppError::Db {
            code: "ERR_DB_003".to_string(),
            message: format!("Failed to backfill migration v{} metadata: {}", m.version, e),
        })?;
    }

    Ok(())
}

pub fn get_migrations() -> Vec<Migration> {
    vec![
        Migration {
            version: 1,
            description: "Initial schema migrations containing all master and transactional tables",
            sql: include_str!("../migrations/0001_init.sql"),
            rebuild: false,
        },
        Migration {
            version: 2,
            description: "Add tally_customer_name column to customers table",
            sql: "ALTER TABLE customers ADD COLUMN tally_customer_name TEXT;",
            rebuild: false,
        },
        Migration {
            version: 3,
            description: "Add customer_categories table and category_name column to customers table",
            sql: "CREATE TABLE IF NOT EXISTS customer_categories (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL UNIQUE,
                description TEXT,
                created_at TEXT NOT NULL DEFAULT (datetime('now'))
            );
            ALTER TABLE customers ADD COLUMN category_name TEXT;",
            rebuild: false,
        },
        Migration {
            version: 4,
            description: "Rebuild customers into full customer master (rename customer_name->report_name, add master columns, drop state_code FK)",
            rebuild: true,
            sql: "
                CREATE TABLE customers_new (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    customer_code TEXT NOT NULL UNIQUE,
                    report_name TEXT NOT NULL,
                    tally_customer_name TEXT,
                    legal_name TEXT,
                    gstin TEXT,
                    address1 TEXT,
                    address2 TEXT,
                    location TEXT,
                    pincode TEXT,
                    state_code TEXT,
                    place_of_supply TEXT,
                    phone TEXT,
                    email TEXT,
                    category_name TEXT,
                    remarks TEXT,
                    status TEXT NOT NULL DEFAULT 'Approved' CHECK(status IN ('Approved', 'Pending_Review'))
                );
                INSERT INTO customers_new
                    (id, customer_code, report_name, tally_customer_name, legal_name, gstin,
                     address1, address2, location, pincode, state_code, place_of_supply,
                     phone, email, category_name, remarks, status)
                SELECT id, customer_code, customer_name, tally_customer_name, NULL, gstin,
                       address, NULL, NULL, NULL, state_code, NULL,
                       NULL, NULL, category_name, NULL, status
                FROM customers;
                DROP TABLE customers;
                ALTER TABLE customers_new RENAME TO customers;
                CREATE INDEX IF NOT EXISTS idx_customers_code ON customers(customer_code);
            ",
        },
        Migration {
            version: 5,
            description: "Rebuild import_batches to allow source_type 'customer_master'",
            rebuild: true,
            sql: "
                CREATE TABLE import_batches_new (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    imported_at TEXT NOT NULL DEFAULT (datetime('now')),
                    source_type TEXT NOT NULL CHECK(source_type IN ('erp_sales_report', 'gstr1_report', 'customer_master')),
                    file_name TEXT NOT NULL,
                    file_size_bytes INTEGER NOT NULL,
                    excel_version TEXT,
                    template_version_id INTEGER,
                    file_hash TEXT NOT NULL UNIQUE,
                    row_count INTEGER NOT NULL,
                    success_count INTEGER NOT NULL DEFAULT 0,
                    warning_count INTEGER NOT NULL DEFAULT 0,
                    error_count INTEGER NOT NULL DEFAULT 0,
                    duration_ms INTEGER NOT NULL DEFAULT 0,
                    imported_by TEXT NOT NULL,
                    user_remarks TEXT,
                    rollback_reason TEXT,
                    status TEXT NOT NULL DEFAULT 'staged' CHECK(status IN ('staged', 'completed', 'failed'))
                );
                INSERT INTO import_batches_new SELECT * FROM import_batches;
                DROP TABLE import_batches;
                ALTER TABLE import_batches_new RENAME TO import_batches;
            ",
        },
        Migration {
            version: 6,
            description: "Add company_profile single-row table (company GST master)",
            rebuild: false,
            sql: "
                CREATE TABLE IF NOT EXISTS company_profile (
                    id INTEGER PRIMARY KEY CHECK (id = 1),
                    company_name TEXT,
                    legal_name   TEXT,
                    gstin        TEXT,
                    pan          TEXT,
                    address1     TEXT,
                    address2     TEXT,
                    location     TEXT,
                    pincode      TEXT,
                    state_code   TEXT,
                    phone        TEXT,
                    email        TEXT,
                    logo         TEXT,
                    updated_at   TEXT NOT NULL DEFAULT (datetime('now'))
                );
            ",
        },
        Migration {
            version: 7,
            description: "Add Customer Price Revision and Customer Debit Notes module tables",
            rebuild: false,
            sql: "
                CREATE TABLE IF NOT EXISTS customer_price_master (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    company_id INTEGER NOT NULL DEFAULT 1,
                    customer_id INTEGER NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
                    part_number TEXT NOT NULL REFERENCES items(part_code) ON DELETE RESTRICT,
                    current_price REAL NOT NULL CHECK(current_price >= 0),
                    effective_date TEXT NOT NULL,
                    effective_to TEXT CHECK(effective_to IS NULL OR effective_to >= effective_date),
                    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
                    is_deleted INTEGER NOT NULL DEFAULT 0 CHECK(is_deleted IN (0, 1))
                );
                CREATE INDEX IF NOT EXISTS idx_cust_pm_cust_part ON customer_price_master(customer_id, part_number);

                CREATE TABLE IF NOT EXISTS customer_price_history (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    price_master_id INTEGER REFERENCES customer_price_master(id) ON DELETE SET NULL,
                    company_id INTEGER NOT NULL DEFAULT 1,
                    customer_id INTEGER NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
                    part_number TEXT NOT NULL REFERENCES items(part_code) ON DELETE RESTRICT,
                    old_price REAL NOT NULL CHECK(old_price >= 0),
                    new_price REAL NOT NULL CHECK(new_price >= 0),
                    effective_date TEXT NOT NULL,
                    effective_to TEXT,
                    revision_no TEXT,
                    changed_by TEXT NOT NULL,
                    changed_at TEXT NOT NULL DEFAULT (datetime('now'))
                );

                CREATE TABLE IF NOT EXISTS customer_price_revisions (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    company_id INTEGER NOT NULL DEFAULT 1,
                    customer_id INTEGER NOT NULL REFERENCES customers(id) ON DELETE RESTRICT,
                    revision_no TEXT NOT NULL UNIQUE,
                    effective_from TEXT NOT NULL,
                    customer_ref_date TEXT,
                    customer_po_ref TEXT,
                    status TEXT NOT NULL DEFAULT 'Draft' CHECK(status IN ('Draft', 'Verified', 'Approved', 'Rejected', 'Superseded')),
                    remarks TEXT,
                    parent_revision_id INTEGER REFERENCES customer_price_revisions(id) ON DELETE SET NULL,
                    created_by TEXT NOT NULL,
                    created_at TEXT NOT NULL DEFAULT (datetime('now')),
                    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
                    is_deleted INTEGER NOT NULL DEFAULT 0 CHECK(is_deleted IN (0, 1))
                );

                CREATE TABLE IF NOT EXISTS customer_price_revision_items (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    revision_id INTEGER NOT NULL REFERENCES customer_price_revisions(id) ON DELETE CASCADE,
                    part_number TEXT NOT NULL REFERENCES items(part_code) ON DELETE RESTRICT,
                    old_price REAL NOT NULL CHECK(old_price >= 0),
                    new_price REAL NOT NULL CHECK(new_price >= 0),
                    difference REAL NOT NULL,
                    price_source TEXT NOT NULL DEFAULT 'Manual Entry',
                    remarks TEXT
                );

                CREATE TABLE IF NOT EXISTS customer_revision_documents (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    revision_id INTEGER NOT NULL REFERENCES customer_price_revisions(id) ON DELETE CASCADE,
                    file_name TEXT NOT NULL,
                    file_path TEXT NOT NULL,
                    file_hash TEXT NOT NULL,
                    uploaded_by TEXT NOT NULL,
                    uploaded_at TEXT NOT NULL DEFAULT (datetime('now'))
                );

                CREATE TABLE IF NOT EXISTS customer_recovery_cases (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    uuid TEXT NOT NULL UNIQUE,
                    company_id INTEGER NOT NULL DEFAULT 1,
                    case_no TEXT NOT NULL UNIQUE,
                    customer_id INTEGER NOT NULL REFERENCES customers(id) ON DELETE RESTRICT,
                    revision_id INTEGER NOT NULL REFERENCES customer_price_revisions(id) ON DELETE RESTRICT,
                    financial_year_id INTEGER NOT NULL REFERENCES financial_years(id) ON DELETE RESTRICT,
                    period_from TEXT NOT NULL,
                    period_to TEXT NOT NULL CHECK(period_to >= period_from),
                    total_invoices INTEGER NOT NULL DEFAULT 0 CHECK(total_invoices >= 0),
                    total_quantity REAL NOT NULL DEFAULT 0.0 CHECK(total_quantity >= 0),
                    total_recoverable_amount INTEGER NOT NULL DEFAULT 0 CHECK(total_recoverable_amount >= 0),
                    recovered_amount INTEGER NOT NULL DEFAULT 0 CHECK(recovered_amount >= 0),
                    balance_amount INTEGER NOT NULL DEFAULT 0 CHECK(balance_amount >= 0),
                    status TEXT NOT NULL DEFAULT 'Open' CHECK(status IN ('Open', 'Partial_Recovered', 'Fully_Recovered', 'Closed', 'Cancelled')),
                    remarks TEXT,
                    created_by TEXT NOT NULL,
                    created_at TEXT NOT NULL DEFAULT (datetime('now')),
                    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
                );

                CREATE TABLE IF NOT EXISTS customer_debit_notes (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    uuid TEXT NOT NULL UNIQUE,
                    company_id INTEGER NOT NULL DEFAULT 1,
                    case_id INTEGER NOT NULL REFERENCES customer_recovery_cases(id) ON DELETE RESTRICT,
                    financial_year_id INTEGER NOT NULL REFERENCES financial_years(id) ON DELETE RESTRICT,
                    debit_note_no TEXT NOT NULL UNIQUE,
                    annexure_no TEXT NOT NULL UNIQUE,
                    customer_id INTEGER NOT NULL REFERENCES customers(id) ON DELETE RESTRICT,
                    debit_note_date TEXT NOT NULL,
                    reference TEXT,
                    total_taxable INTEGER NOT NULL DEFAULT 0 CHECK(total_taxable >= 0),
                    total_cgst INTEGER NOT NULL DEFAULT 0 CHECK(total_cgst >= 0),
                    total_sgst INTEGER NOT NULL DEFAULT 0 CHECK(total_sgst >= 0),
                    total_igst INTEGER NOT NULL DEFAULT 0 CHECK(total_igst >= 0),
                    total_cess INTEGER NOT NULL DEFAULT 0 CHECK(total_cess >= 0),
                    total_value INTEGER NOT NULL DEFAULT 0 CHECK(total_value >= 0),
                    round_off INTEGER NOT NULL DEFAULT 0,
                    currency TEXT NOT NULL DEFAULT 'INR',
                    exchange_rate REAL NOT NULL DEFAULT 1.0 CHECK(exchange_rate > 0),
                    exchange_rate_source TEXT NOT NULL DEFAULT 'Manual',
                    foreign_total_value INTEGER NOT NULL DEFAULT 0 CHECK(foreign_total_value >= 0),
                    outstanding_amount INTEGER NOT NULL DEFAULT 0 CHECK(outstanding_amount >= 0),
                    status TEXT NOT NULL DEFAULT 'Created' CHECK(status IN ('Created', 'Verified', 'Approved', 'Posted', 'Locked', 'Cancelled', 'Reopen Requested')),
                    financial_status TEXT NOT NULL DEFAULT 'Pending' CHECK(financial_status IN ('Pending', 'Exported to ERP', 'Posted to Ledger', 'Paid', 'Partial Paid')),
                    template_version TEXT NOT NULL DEFAULT '1.0',
                    version INTEGER NOT NULL DEFAULT 1,
                    idempotency_key TEXT UNIQUE,
                    sent_date TEXT,
                    payment_date TEXT,
                    remarks TEXT,
                    created_by TEXT NOT NULL,
                    created_at TEXT NOT NULL DEFAULT (datetime('now')),
                    approved_by TEXT,
                    approved_at TEXT,
                    cancelled_by TEXT,
                    cancelled_date TEXT,
                    cancel_reason TEXT,
                    is_deleted INTEGER NOT NULL DEFAULT 0 CHECK(is_deleted IN (0, 1)),
                    deleted_by TEXT,
                    deleted_at TEXT,
                    frozen_customer_name TEXT NOT NULL,
                    frozen_customer_gstin TEXT,
                    frozen_customer_address TEXT,
                    frozen_customer_state TEXT,
                    frozen_customer_country TEXT
                );
                CREATE INDEX IF NOT EXISTS idx_cust_dn_lookup ON customer_debit_notes(company_id, case_id, status, is_deleted);
                CREATE INDEX IF NOT EXISTS idx_dn_cust_date ON customer_debit_notes(customer_id, debit_note_date);
                CREATE INDEX IF NOT EXISTS idx_dn_fy_date ON customer_debit_notes(financial_year_id, debit_note_date);

                CREATE TABLE IF NOT EXISTS customer_debit_note_invoice_map (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    debit_note_id INTEGER NOT NULL REFERENCES customer_debit_notes(id) ON DELETE CASCADE,
                    invoice_id INTEGER NOT NULL,
                    invoice_number TEXT NOT NULL,
                    invoice_item_id INTEGER NOT NULL,
                    part_code TEXT NOT NULL,
                    quantity REAL NOT NULL CHECK(quantity > 0),
                    recovered_qty REAL NOT NULL CHECK(recovered_qty >= 0),
                    balance_qty REAL NOT NULL CHECK(balance_qty >= 0),
                    recovery_percentage REAL NOT NULL DEFAULT 0.0 CHECK(recovery_percentage >= 0),
                    recovered_value_percentage REAL NOT NULL DEFAULT 0.0 CHECK(recovered_value_percentage >= 0),
                    rate_pre_unit REAL NOT NULL CHECK(rate_pre_unit >= 0),
                    new_price REAL NOT NULL CHECK(new_price >= 0),
                    difference REAL NOT NULL CHECK(difference >= 0),
                    assessable_difference INTEGER NOT NULL CHECK(assessable_difference >= 0),
                    cgst_rate REAL NOT NULL DEFAULT 0.0,
                    cgst_amount INTEGER NOT NULL DEFAULT 0 CHECK(cgst_amount >= 0),
                    sgst_rate REAL NOT NULL DEFAULT 0.0,
                    sgst_amount INTEGER NOT NULL DEFAULT 0 CHECK(sgst_amount >= 0),
                    igst_rate REAL NOT NULL DEFAULT 0.0,
                    igst_amount INTEGER NOT NULL DEFAULT 0 CHECK(igst_amount >= 0),
                    cess_amount INTEGER NOT NULL DEFAULT 0 CHECK(cess_amount >= 0),
                    hsn_code TEXT NOT NULL,
                    gst_type TEXT NOT NULL,
                    total_difference INTEGER NOT NULL DEFAULT 0 CHECK(total_difference >= 0),
                    currency TEXT NOT NULL DEFAULT 'INR',
                    exchange_rate REAL NOT NULL DEFAULT 1.0 CHECK(exchange_rate > 0),
                    foreign_total_difference INTEGER NOT NULL DEFAULT 0 CHECK(foreign_total_difference >= 0),
                    status TEXT NOT NULL DEFAULT 'Draft' CHECK(status IN ('Draft', 'Generated', 'Cancelled')),
                    frozen_part_number TEXT NOT NULL,
                    frozen_part_description TEXT,
                    frozen_part_uom TEXT,
                    frozen_part_hsn TEXT,
                    frozen_part_drawing_revision TEXT,
                    invoice_date TEXT
                );
                CREATE INDEX IF NOT EXISTS idx_cdn_inv_map_dn ON customer_debit_note_invoice_map(debit_note_id);
                CREATE INDEX IF NOT EXISTS idx_cdn_inv_map_inv ON customer_debit_note_invoice_map(invoice_number);

                CREATE TABLE IF NOT EXISTS customer_debit_note_events (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    debit_note_id INTEGER REFERENCES customer_debit_notes(id) ON DELETE CASCADE,
                    case_id INTEGER REFERENCES customer_recovery_cases(id) ON DELETE CASCADE,
                    revision_id INTEGER REFERENCES customer_price_revisions(id) ON DELETE CASCADE,
                    event_severity TEXT NOT NULL DEFAULT 'INFO' CHECK(event_severity IN ('INFO', 'WARNING', 'ERROR')),
                    event_type TEXT NOT NULL,
                    event_details TEXT NOT NULL,
                    event_json TEXT,
                    correlation_id TEXT,
                    request_id TEXT,
                    session_id TEXT,
                    performed_by TEXT NOT NULL,
                    timestamp TEXT NOT NULL DEFAULT (datetime('now'))
                );

                CREATE TABLE IF NOT EXISTS background_jobs (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    job_uuid TEXT NOT NULL UNIQUE,
                    job_type TEXT NOT NULL,
                    module_name TEXT NOT NULL DEFAULT 'CustomerDebitNotes',
                    parameters_json TEXT,
                    status TEXT NOT NULL DEFAULT 'Queued' CHECK(status IN ('Queued', 'Processing', 'Completed', 'Failed', 'Cancelled')),
                    progress_percent INTEGER NOT NULL DEFAULT 0 CHECK(progress_percent BETWEEN 0 AND 100),
                    current_step TEXT,
                    records_processed INTEGER NOT NULL DEFAULT 0,
                    total_records INTEGER NOT NULL DEFAULT 0,
                    result_json TEXT,
                    error_message TEXT,
                    retry_count INTEGER NOT NULL DEFAULT 0,
                    max_retries INTEGER NOT NULL DEFAULT 3,
                    heartbeat_at TEXT,
                    created_by TEXT NOT NULL,
                    created_at TEXT NOT NULL DEFAULT (datetime('now')),
                    started_at TEXT,
                    completed_at TEXT
                );

                CREATE TABLE IF NOT EXISTS customer_debit_note_journal_entries (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    debit_note_id INTEGER NOT NULL REFERENCES customer_debit_notes(id) ON DELETE CASCADE,
                    journal_number TEXT NOT NULL UNIQUE,
                    voucher_date TEXT NOT NULL,
                    financial_year_id INTEGER NOT NULL REFERENCES financial_years(id) ON DELETE RESTRICT,
                    currency TEXT NOT NULL DEFAULT 'INR',
                    exchange_rate REAL NOT NULL DEFAULT 1.0 CHECK(exchange_rate > 0),
                    account_code TEXT NOT NULL,
                    account_name TEXT NOT NULL,
                    entry_type TEXT NOT NULL CHECK(entry_type IN ('DEBIT', 'CREDIT')),
                    amount INTEGER NOT NULL CHECK(amount >= 0),
                    posting_status TEXT NOT NULL DEFAULT 'Pending' CHECK(posting_status IN ('Pending', 'Exported', 'Posted', 'Cancelled', 'Reversed')),
                    external_sys_name TEXT,
                    external_sys_ref TEXT,
                    posted_by TEXT NOT NULL,
                    posted_at TEXT NOT NULL DEFAULT (datetime('now')),
                    posting_reference TEXT
                );

                CREATE TABLE IF NOT EXISTS customer_debit_note_approvals (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    debit_note_id INTEGER NOT NULL REFERENCES customer_debit_notes(id) ON DELETE CASCADE,
                    step_order INTEGER NOT NULL,
                    step_name TEXT NOT NULL,
                    user_id TEXT NOT NULL,
                    user_name TEXT NOT NULL,
                    action TEXT NOT NULL CHECK(action IN ('Submitted', 'Verified', 'Approved', 'Rejected', 'Reopened')),
                    remarks TEXT,
                    created_at TEXT NOT NULL DEFAULT (datetime('now'))
                );

                CREATE INDEX IF NOT EXISTS idx_dn_search_composite ON customer_debit_notes(company_id, customer_id, status, is_deleted);
                CREATE INDEX IF NOT EXISTS idx_revision_search_composite ON customer_price_revisions(company_id, customer_id, status, is_deleted);
            ",
        },
        Migration {
            version: 8,
            description: "Recreate customer_debit_note_invoice_map without foreign keys on invoices",
            rebuild: false,
            sql: "
                DROP TABLE IF EXISTS customer_debit_note_invoice_map;

                CREATE TABLE IF NOT EXISTS customer_debit_note_invoice_map (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    debit_note_id INTEGER NOT NULL REFERENCES customer_debit_notes(id) ON DELETE CASCADE,
                    invoice_id INTEGER NOT NULL,
                    invoice_number TEXT NOT NULL,
                    invoice_item_id INTEGER NOT NULL,
                    part_code TEXT NOT NULL,
                    quantity REAL NOT NULL CHECK(quantity > 0),
                    recovered_qty REAL NOT NULL CHECK(recovered_qty >= 0),
                    balance_qty REAL NOT NULL CHECK(balance_qty >= 0),
                    recovery_percentage REAL NOT NULL DEFAULT 0.0 CHECK(recovery_percentage >= 0),
                    recovered_value_percentage REAL NOT NULL DEFAULT 0.0 CHECK(recovered_value_percentage >= 0),
                    rate_pre_unit REAL NOT NULL CHECK(rate_pre_unit >= 0),
                    new_price REAL NOT NULL CHECK(new_price >= 0),
                    difference REAL NOT NULL CHECK(difference >= 0),
                    assessable_difference INTEGER NOT NULL CHECK(assessable_difference >= 0),
                    cgst_rate REAL NOT NULL DEFAULT 0.0,
                    cgst_amount INTEGER NOT NULL DEFAULT 0 CHECK(cgst_amount >= 0),
                    sgst_rate REAL NOT NULL DEFAULT 0.0,
                    sgst_amount INTEGER NOT NULL DEFAULT 0 CHECK(sgst_amount >= 0),
                    igst_rate REAL NOT NULL DEFAULT 0.0,
                    igst_amount INTEGER NOT NULL DEFAULT 0 CHECK(igst_amount >= 0),
                    cess_amount INTEGER NOT NULL DEFAULT 0 CHECK(cess_amount >= 0),
                    hsn_code TEXT NOT NULL,
                    gst_type TEXT NOT NULL,
                    total_difference INTEGER NOT NULL DEFAULT 0 CHECK(total_difference >= 0),
                    currency TEXT NOT NULL DEFAULT 'INR',
                    exchange_rate REAL NOT NULL DEFAULT 1.0 CHECK(exchange_rate > 0),
                    foreign_total_difference INTEGER NOT NULL DEFAULT 0 CHECK(foreign_total_difference >= 0),
                    status TEXT NOT NULL DEFAULT 'Draft' CHECK(status IN ('Draft', 'Generated', 'Cancelled')),
                    frozen_part_number TEXT NOT NULL,
                    frozen_part_description TEXT,
                    frozen_part_uom TEXT,
                    frozen_part_hsn TEXT,
                    frozen_part_drawing_revision TEXT,
                    invoice_date TEXT
                );
                CREATE INDEX IF NOT EXISTS idx_cdn_inv_map_dn ON customer_debit_note_invoice_map(debit_note_id);
                CREATE INDEX IF NOT EXISTS idx_cdn_inv_map_inv ON customer_debit_note_invoice_map(invoice_number);
            ",
        },
        Migration {
            version: 9,
            description: "Rebuild credit_notes with snapshots and create credit_note_items",
            rebuild: false,
            sql: "
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

                CREATE INDEX IF NOT EXISTS idx_cn_items_num ON credit_note_items(credit_note_number);
                CREATE INDEX IF NOT EXISTS idx_cn_invoice_num ON credit_notes(invoice_number);
                CREATE INDEX IF NOT EXISTS idx_cn_status_deleted ON credit_notes(status, is_deleted);
                CREATE INDEX IF NOT EXISTS idx_cn_date ON credit_notes(credit_note_date);
            ",
        },
        Migration {
            version: 10,
            description: "Add version column to invoices for optimistic concurrency control",
            rebuild: false,
            sql: "ALTER TABLE invoices ADD COLUMN version INTEGER NOT NULL DEFAULT 1;",
        },
        Migration {
            version: 11,
            description: "Recalculate and fix invoice and line item total values",
            rebuild: false,
            sql: "
                UPDATE invoice_items
                SET total_value = ROUND(assessable_value + cgst_amount + sgst_amount + igst_amount, 2);

                UPDATE invoices
                SET total_taxable = ROUND((SELECT COALESCE(SUM(assessable_value), invoices.total_taxable) FROM invoice_items WHERE invoice_items.invoice_number = invoices.invoice_number), 2),
                    total_cgst = ROUND((SELECT COALESCE(SUM(cgst_amount), invoices.total_cgst) FROM invoice_items WHERE invoice_items.invoice_number = invoices.invoice_number), 2),
                    total_sgst = ROUND((SELECT COALESCE(SUM(sgst_amount), invoices.total_sgst) FROM invoice_items WHERE invoice_items.invoice_number = invoices.invoice_number), 2),
                    total_igst = ROUND((SELECT COALESCE(SUM(igst_amount), invoices.total_igst) FROM invoice_items WHERE invoice_items.invoice_number = invoices.invoice_number), 2)
                WHERE EXISTS (
                    SELECT 1 FROM invoice_items WHERE invoice_items.invoice_number = invoices.invoice_number
                );

                UPDATE invoices
                SET total_value = ROUND(total_taxable + total_cgst + total_sgst + total_igst + total_cess, 2);

                DELETE FROM summary_monthly_sales;
                INSERT INTO summary_monthly_sales
                    (financial_year_id, month_no, total_taxable, total_cgst, total_sgst, total_igst, total_value, invoice_count, active_count, cancelled_count)
                 SELECT
                    financial_year_id,
                    strftime('%Y-%m', invoice_date),
                    COALESCE(SUM(CASE WHEN status NOT IN ('Cancelled', 'Draft') THEN total_taxable ELSE 0.0 END), 0.0),
                    COALESCE(SUM(CASE WHEN status NOT IN ('Cancelled', 'Draft') THEN total_cgst ELSE 0.0 END), 0.0),
                    COALESCE(SUM(CASE WHEN status NOT IN ('Cancelled', 'Draft') THEN total_sgst ELSE 0.0 END), 0.0),
                    COALESCE(SUM(CASE WHEN status NOT IN ('Cancelled', 'Draft') THEN total_igst ELSE 0.0 END), 0.0),
                    COALESCE(SUM(CASE WHEN status NOT IN ('Cancelled', 'Draft') THEN total_value ELSE 0.0 END), 0.0),
                    COUNT(*),
                    SUM(CASE WHEN status NOT IN ('Cancelled', 'Draft') THEN 1 ELSE 0 END),
                    SUM(CASE WHEN status = 'Cancelled' THEN 1 ELSE 0 END)
                 FROM invoices
                 GROUP BY financial_year_id, strftime('%Y-%m', invoice_date);

                DELETE FROM summary_customer_sales;
                INSERT INTO summary_customer_sales
                    (financial_year_id, customer_id, total_taxable, total_cgst, total_sgst, total_igst, total_value)
                 SELECT
                    i.financial_year_id,
                    i.customer_id,
                    COALESCE(SUM(i.total_taxable), 0.0),
                    COALESCE(SUM(i.total_cgst), 0.0),
                    COALESCE(SUM(i.total_sgst), 0.0),
                    COALESCE(SUM(i.total_igst), 0.0),
                    COALESCE(SUM(i.total_value), 0.0)
                 FROM invoices i
                 WHERE i.status NOT IN ('Cancelled', 'Draft')
                 GROUP BY i.financial_year_id, i.customer_id;

                DELETE FROM summary_supplier_sales;
                INSERT INTO summary_supplier_sales
                    (financial_year_id, supplier_id, part_code, total_qty, total_taxable, total_cgst, total_sgst, total_igst, total_value, avg_selling_price)
                 SELECT
                    i.financial_year_id,
                    it.supplier_id,
                    ii.part_code,
                    COALESCE(SUM(ii.quantity), 0.0),
                    COALESCE(SUM(ii.assessable_value), 0.0),
                    COALESCE(SUM(ii.cgst_amount), 0.0),
                    COALESCE(SUM(ii.sgst_amount), 0.0),
                    COALESCE(SUM(ii.igst_amount), 0.0),
                    COALESCE(SUM(ii.total_value), 0.0),
                    CASE WHEN SUM(ii.quantity) > 0 THEN SUM(ii.total_value) / SUM(ii.quantity) ELSE 0.0 END
                 FROM invoice_items ii
                 JOIN invoices i ON ii.invoice_number = i.invoice_number
                 JOIN items it ON ii.part_code = it.part_code
                 WHERE i.status NOT IN ('Cancelled', 'Draft') AND it.supplier_id IS NOT NULL
                 GROUP BY i.financial_year_id, it.supplier_id, ii.part_code;
            ",
        },
        Migration {
            version: 12,
            description: "Add category_id FK column to customers table, backfill from category_name, and create performance indexes",
            rebuild: false,
            sql: "
                ALTER TABLE customers ADD COLUMN category_id INTEGER REFERENCES customer_categories(id) ON DELETE SET NULL;

                UPDATE customers
                SET category_id = (
                    SELECT id FROM customer_categories WHERE customer_categories.name = customers.category_name
                )
                WHERE category_id IS NULL AND category_name IS NOT NULL;

                CREATE INDEX IF NOT EXISTS idx_customers_category_id ON customers(category_id);
                CREATE INDEX IF NOT EXISTS idx_customers_category_name ON customers(category_name);
                CREATE INDEX IF NOT EXISTS idx_invoices_cust_date ON invoices(customer_id, invoice_date);
            ",
        },
        Migration {
            version: 13,
            description: "Recalculate and fix credit_note_items line item total values",
            rebuild: false,
            sql: "
                UPDATE credit_note_items
                SET total_value = assessable_value + cgst_amount + sgst_amount + igst_amount;
            ",
        },
        Migration {
            version: 14,
            description: "Add nullable hsn_code column and index to invoice_items table for transaction-level HSN tracking",
            rebuild: false,
            sql: "
                ALTER TABLE invoice_items ADD COLUMN hsn_code TEXT;
                CREATE INDEX IF NOT EXISTS idx_invoice_items_hsn ON invoice_items(hsn_code);
            ",
        },
    ]
}

pub fn run_migrations(conn: &mut Connection) -> Result<(), AppError> {
    let migrations = get_migrations();

    // 1. Upgrade schema_migrations tracking table if needed
    ensure_and_upgrade_schema_migrations(conn, &migrations)?;

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

    let target_version = migrations.iter().map(|m| m.version).max().unwrap_or(0);

    // 3. Strict Downgrade Protection: if DB version > application target version, abort
    if current_version > target_version {
        return Err(AppError::Db {
            code: "ERR_DB_DOWNGRADE".to_string(),
            message: format!(
                "Database schema version (v{}) is newer than the supported application version (v{}). Downgrading is blocked to protect data integrity.",
                current_version, target_version
            ),
        });
    }

    // 4. Verify historical migration checksums to detect script tampering or drift
    for m in &migrations {
        if m.version <= current_version {
            let expected_checksum = compute_sql_checksum(m.sql);
            let stored_checksum: Option<String> = conn
                .query_row(
                    "SELECT checksum_sha256 FROM schema_migrations WHERE version = ?",
                    [m.version],
                    |r| r.get(0),
                )
                .ok()
                .flatten();

            if let Some(ref stored) = stored_checksum {
                if stored != &expected_checksum {
                    return Err(AppError::Db {
                        code: "ERR_DB_CHECKSUM_MISMATCH".to_string(),
                        message: format!(
                            "Migration checksum mismatch for v{}: database contains '{}', expected '{}'. Historical migration drift detected.",
                            m.version, stored, expected_checksum
                        ),
                    });
                }
            }
        }
    }

    // 5. Apply all pending migrations in one atomic upgrade transaction
    apply_migrations_atomic(conn, &migrations, current_version)
}

/// Executes all pending migrations from `current_version + 1` to `target_version` within a single
/// atomic transaction. If any migration fails, the entire upgrade rolls back completely.
pub fn apply_migrations_atomic(
    conn: &mut Connection,
    migrations: &[Migration],
    current_version: i32,
) -> Result<(), AppError> {
    ensure_and_upgrade_schema_migrations(conn, migrations)?;

    let pending_migrations: Vec<&Migration> = migrations
        .iter()
        .filter(|m| m.version > current_version)
        .collect();

    if pending_migrations.is_empty() {
        return Ok(());
    }

    let has_rebuild = pending_migrations.iter().any(|m| m.rebuild);
    let app_version = env!("CARGO_PKG_VERSION");

    // Rebuild migrations require foreign keys to be disabled outside the transaction
    if has_rebuild {
        conn.pragma_update(None, "foreign_keys", "OFF")
            .map_err(|e| AppError::Db {
                code: "ERR_DB_003".to_string(),
                message: format!("Failed to disable foreign_keys for rebuild: {}", e),
            })?;
    }

    let result = (|| -> Result<(), AppError> {
        let tx = conn.transaction().map_err(|e| AppError::Db {
            code: "ERR_DB_003".to_string(),
            message: format!("Failed to begin atomic migration transaction: {}", e),
        })?;

        for migration in &pending_migrations {
            log::info!(
                "Applying migration v{}: {}",
                migration.version,
                migration.description
            );

            let start_time = Instant::now();
            let checksum = compute_sql_checksum(migration.sql);

            tx.execute_batch(migration.sql).map_err(|e| AppError::Db {
                code: "ERR_DB_003".to_string(),
                message: format!(
                    "Failed to execute migration v{} script: {}",
                    migration.version, e
                ),
            })?;

            if migration.rebuild {
                let violations: i64 = tx
                    .query_row("SELECT COUNT(*) FROM pragma_foreign_key_check", [], |r| {
                        r.get(0)
                    })
                    .map_err(|e| AppError::Db {
                        code: "ERR_DB_003".to_string(),
                        message: format!("foreign_key_check read failed for v{}: {}", migration.version, e),
                    })?;

                if violations > 0 {
                    return Err(AppError::Db {
                        code: "ERR_DB_003".to_string(),
                        message: format!(
                            "Rebuild v{} failed foreign_key_check ({} violations)",
                            migration.version, violations
                        ),
                    });
                }
            }

            let elapsed_ms = start_time.elapsed().as_millis() as i64;
            tx.execute(
                "INSERT INTO schema_migrations (version, description, checksum_sha256, app_version, execution_time_ms) VALUES (?, ?, ?, ?, ?)",
                params![migration.version, migration.description, checksum, app_version, elapsed_ms],
            )
            .map_err(|e| AppError::Db {
                code: "ERR_DB_003".to_string(),
                message: format!("Failed to log migration status for v{}: {}", migration.version, e),
            })?;
        }

        tx.commit().map_err(|e| AppError::Db {
            code: "ERR_DB_003".to_string(),
            message: format!("Failed to commit atomic migration transaction: {}", e),
        })?;

        Ok(())
    })();

    // Restore foreign key enforcement regardless of outcome
    if has_rebuild {
        conn.pragma_update(None, "foreign_keys", "ON").ok();
    }

    result
}

#[cfg(test)]
mod tests {
    use super::*;
    use rusqlite::Connection;

    fn columns(conn: &Connection, table: &str) -> Vec<String> {
        let mut stmt = conn
            .prepare(&format!("PRAGMA table_info({})", table))
            .unwrap();
        let cols = stmt
            .query_map([], |row| row.get::<_, String>(1))
            .unwrap()
            .map(|r| r.unwrap())
            .collect();
        cols
    }

    #[test]
    fn v4_customers_has_master_columns_and_free_text_state() {
        let mut conn = Connection::open_in_memory().unwrap();
        run_migrations(&mut conn).unwrap();

        let cols = columns(&conn, "customers");
        for expected in [
            "report_name",
            "legal_name",
            "address1",
            "address2",
            "location",
            "pincode",
            "place_of_supply",
            "phone",
            "email",
            "remarks",
        ] {
            assert!(
                cols.contains(&expected.to_string()),
                "missing column {expected}"
            );
        }
        assert!(
            !cols.contains(&"customer_name".to_string()),
            "customer_name must be renamed"
        );

        // Free-text GST state code accepted (no FK to states).
        conn.execute(
            "INSERT INTO customers (customer_code, report_name, state_code, place_of_supply, status)
             VALUES ('C1', 'Report Co', '33', '33', 'Approved')",
            [],
        )
        .unwrap();
        let state: String = conn
            .query_row(
                "SELECT state_code FROM customers WHERE customer_code='C1'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(state, "33");
    }

    #[test]
    fn v4_preserves_invoice_customer_fk_roundtrip() {
        let mut conn = Connection::open_in_memory().unwrap();
        run_migrations(&mut conn).unwrap();

        conn.execute(
            "INSERT INTO customers (id, customer_code, report_name, status) VALUES (7, 'C7', 'Seven', 'Approved')",
            [],
        )
        .unwrap();
        // financial_years id=1 is seeded by 0001. Invoice FK to customers(7) must resolve.
        conn.execute(
            "INSERT INTO invoices (invoice_number, invoice_date, customer_id, financial_year_id, total_taxable, total_value, status)
             VALUES ('INV7', '2025-05-01', 7, 1, 100.0, 118.0, 'Imported')",
            [],
        )
        .unwrap();
        let cnt: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM invoices WHERE customer_id = 7",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(cnt, 1);
    }

    #[test]
    fn rebuild_migration_rolls_back_and_restores_fk_enforcement_on_violation() {
        let mut conn = Connection::open_in_memory().unwrap();
        run_migrations(&mut conn).unwrap();

        // Set up a parent/child pair with a dangling FK reference. foreign_keys
        // enforcement is switched OFF first so the bad insert is allowed to land
        // (mirrors how a real rebuild leaves stray rows behind before the check
        // runs); pragma_foreign_key_check reports violations regardless of the
        // enforcement pragma's runtime state.
        conn.pragma_update(None, "foreign_keys", "OFF").unwrap();
        conn.execute_batch(
            "CREATE TABLE p (id INTEGER PRIMARY KEY);
             CREATE TABLE c (pid INTEGER REFERENCES p(id));
             INSERT INTO c (pid) VALUES (999);",
        )
        .unwrap();

        let bogus_migration = Migration {
            version: 9999,
            description: "test-only rebuild probe (no-op, unrelated to the FK violation)",
            sql: "CREATE TABLE IF NOT EXISTS _rebuild_probe (x INTEGER);",
            rebuild: true,
        };

        let result = apply_migrations_atomic(&mut conn, &[bogus_migration], 0);
        assert!(
            result.is_err(),
            "pre-existing dangling FK should abort the rebuild via foreign_key_check"
        );

        // Rolled back: the rebuild's own DDL must not have survived the abort.
        let probe_exists: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='_rebuild_probe'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(
            probe_exists, 0,
            "_rebuild_probe must not exist after rollback"
        );

        // schema_migrations must not record the failed rebuild either.
        let logged: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM schema_migrations WHERE version = 9999",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(logged, 0, "failed rebuild must not be logged as applied");

        // foreign_keys enforcement must be restored to ON afterward, regardless
        // of the failure.
        let fk_on: i64 = conn
            .query_row("PRAGMA foreign_keys", [], |r| r.get(0))
            .unwrap();
        assert_eq!(
            fk_on, 1,
            "foreign_keys must be restored to ON after a failed rebuild"
        );
    }

    #[test]
    fn v5_import_batches_accepts_customer_master_source() {
        let mut conn = Connection::open_in_memory().unwrap();
        run_migrations(&mut conn).unwrap();

        conn.execute(
            "INSERT INTO import_batches
                (source_type, file_name, file_size_bytes, file_hash, row_count, imported_by, status)
             VALUES ('customer_master', 'cm.xlsx', 10, 'hash-cm-1', 3, 'tester', 'completed')",
            [],
        )
        .expect("customer_master source_type must be allowed after v5");

        let cnt: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM import_batches WHERE source_type='customer_master'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(cnt, 1);
    }

    #[test]
    fn v6_company_profile_table_is_single_row() {
        let mut conn = Connection::open_in_memory().unwrap();
        run_migrations(&mut conn).unwrap();

        // Columns exist.
        let cols = columns(&conn, "company_profile");
        for expected in [
            "company_name",
            "legal_name",
            "gstin",
            "pan",
            "address1",
            "address2",
            "location",
            "pincode",
            "state_code",
            "phone",
            "email",
            "logo",
        ] {
            assert!(
                cols.contains(&expected.to_string()),
                "missing column {expected}"
            );
        }

        // Row 1 inserts fine.
        conn.execute(
            "INSERT INTO company_profile (id, company_name) VALUES (1, 'Acme')",
            [],
        )
        .expect("id=1 row should insert");

        // A second row (id != 1) is rejected by the CHECK constraint.
        let second = conn.execute(
            "INSERT INTO company_profile (id, company_name) VALUES (2, 'Other')",
            [],
        );
        assert!(second.is_err(), "CHECK(id=1) must reject a second row");
    }

    #[test]
    fn v14_invoice_items_has_hsn_code_column_and_preserves_existing_rows() {
        let mut conn = Connection::open_in_memory().unwrap();
        run_migrations(&mut conn).unwrap();

        // 1. Verify hsn_code column exists in invoice_items
        let cols = columns(&conn, "invoice_items");
        assert!(
            cols.contains(&"hsn_code".to_string()),
            "missing hsn_code column in invoice_items after v14 migration"
        );

        // 2. Verify schema version is at least 14
        let current_version: i32 = conn
            .query_row(
                "SELECT COALESCE(MAX(version), 0) FROM schema_migrations",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert!(current_version >= 14, "schema version should be >= 14");

        // 3. Verify that existing invoice rows without hsn_code remain valid (nullable)
        conn.execute(
            "INSERT INTO customers (id, customer_code, report_name, status) VALUES (1, 'C1', 'Customer 1', 'Approved')",
            [],
        ).unwrap();
        conn.execute(
            "INSERT INTO items (part_code, part_name, hsn_code, uom_code, default_gst_rate, status)
             VALUES ('P1', 'Part 1', '8708.99.00', 'PCS', 18.0, 'Approved')",
            [],
        ).unwrap();
        conn.execute(
            "INSERT INTO invoices (invoice_number, invoice_date, customer_id, financial_year_id, total_taxable, total_value, status)
             VALUES ('INV-TEST-1', '2026-07-01', 1, 1, 1000.0, 1180.0, 'Imported')",
            [],
        ).unwrap();

        // Insert legacy row with NULL hsn_code
        conn.execute(
            "INSERT INTO invoice_items (invoice_number, part_code, quantity, rate_pre_unit, assessable_value,
                                        cgst_rate, cgst_amount, sgst_rate, sgst_amount, igst_rate, igst_amount, total_value, hsn_code)
             VALUES ('INV-TEST-1', 'P1', 10.0, 100.0, 1000.0, 9.0, 90.0, 9.0, 90.0, 0.0, 0.0, 1180.0, NULL)",
            [],
        ).unwrap();

        // Insert new row with explicit transaction-level hsn_code
        conn.execute(
            "INSERT INTO invoice_items (invoice_number, part_code, quantity, rate_pre_unit, assessable_value,
                                        cgst_rate, cgst_amount, sgst_rate, sgst_amount, igst_rate, igst_amount, total_value, hsn_code)
             VALUES ('INV-TEST-1', 'P1', 5.0, 100.0, 500.0, 9.0, 45.0, 9.0, 45.0, 0.0, 0.0, 590.0, '8409.91.99')",
            [],
        ).unwrap();

        let count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM invoice_items WHERE invoice_number = 'INV-TEST-1'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(count, 2);

        let explicit_hsn: Option<String> = conn
            .query_row(
                "SELECT hsn_code FROM invoice_items WHERE assessable_value = 500.0",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(explicit_hsn, Some("8409.91.99".to_string()));
    }

    #[test]
    fn test_downgrade_detection_blocks_newer_db_version() {
        let mut conn = Connection::open_in_memory().unwrap();
        // Simulate a database from future app version 99
        conn.execute(
            "CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT, description TEXT)",
            [],
        ).unwrap();
        conn.execute(
            "INSERT INTO schema_migrations (version, applied_at, description) VALUES (99, '2027-01-01', 'Future Migration')",
            [],
        ).unwrap();

        let res = run_migrations(&mut conn);
        assert!(res.is_err(), "Expected error on newer database version");
        match res.unwrap_err() {
            AppError::Db { code, message } => {
                assert_eq!(code, "ERR_DB_DOWNGRADE");
                assert!(message.contains("newer than the supported application version"));
            }
            other => panic!("Expected ERR_DB_DOWNGRADE, got {:?}", other),
        }
    }

    #[test]
    fn test_legacy_schema_migrations_upgrade_and_backfill() {
        let mut conn = Connection::open_in_memory().unwrap();
        // Create legacy 3-column table (as existed in v1.0 - v1.5.1)
        conn.execute(
            "CREATE TABLE schema_migrations (
                version INTEGER PRIMARY KEY,
                applied_at TEXT NOT NULL DEFAULT (datetime('now')),
                description TEXT
             )",
            [],
        ).unwrap();

        // Simulate legacy migration v1 and v2 DDL already executed in DB
        let v1_sql = include_str!("../migrations/0001_init.sql");
        conn.execute_batch(v1_sql).unwrap();
        conn.execute("ALTER TABLE customers ADD COLUMN tally_customer_name TEXT;", []).unwrap();

        conn.execute("INSERT INTO schema_migrations (version, description) VALUES (1, 'Initial schema')", []).unwrap();
        conn.execute("INSERT INTO schema_migrations (version, description) VALUES (2, 'Add tally_customer_name')", []).unwrap();

        // Run migrations
        run_migrations(&mut conn).unwrap();

        // Assert schema_migrations was upgraded with 3 new columns
        let cols = columns(&conn, "schema_migrations");
        assert!(cols.contains(&"checksum_sha256".to_string()), "missing checksum_sha256");
        assert!(cols.contains(&"app_version".to_string()), "missing app_version");
        assert!(cols.contains(&"execution_time_ms".to_string()), "missing execution_time_ms");

        // Assert v1 and v2 checksums were properly backfilled
        let v1_checksum: Option<String> = conn.query_row("SELECT checksum_sha256 FROM schema_migrations WHERE version = 1", [], |r| r.get(0)).unwrap();
        assert!(v1_checksum.is_some(), "v1 checksum should be backfilled");
        assert!(!v1_checksum.unwrap().is_empty());

        let v14_checksum: Option<String> = conn.query_row("SELECT checksum_sha256 FROM schema_migrations WHERE version = 14", [], |r| r.get(0)).unwrap();
        assert!(v14_checksum.is_some(), "v14 checksum should be present");
    }

    #[test]
    fn test_checksum_validation_and_drift_detection() {
        let mut conn = Connection::open_in_memory().unwrap();
        run_migrations(&mut conn).unwrap();

        // Intentionally tamper with a recorded checksum in schema_migrations
        conn.execute(
            "UPDATE schema_migrations SET checksum_sha256 = 'tampered_invalid_hash_value' WHERE version = 1",
            [],
        ).unwrap();

        // Next connection attempt / run_migrations must detect tampering
        let res = run_migrations(&mut conn);
        assert!(res.is_err(), "Expected checksum mismatch error");
        match res.unwrap_err() {
            AppError::Db { code, message } => {
                assert_eq!(code, "ERR_DB_CHECKSUM_MISMATCH");
                assert!(message.contains("Historical migration drift detected"));
            }
            other => panic!("Expected ERR_DB_CHECKSUM_MISMATCH, got {:?}", other),
        }
    }

    #[test]
    fn test_multi_version_migration_atomicity_and_logging() {
        let mut conn = Connection::open_in_memory().unwrap();
        run_migrations(&mut conn).unwrap();

        let count: i64 = conn.query_row("SELECT COUNT(*) FROM schema_migrations", [], |r| r.get(0)).unwrap();
        assert_eq!(count, 14, "All 14 migrations should be logged in schema_migrations");

        let null_checksums: i64 = conn.query_row("SELECT COUNT(*) FROM schema_migrations WHERE checksum_sha256 IS NULL OR TRIM(checksum_sha256) = ''", [], |r| r.get(0)).unwrap();
        assert_eq!(null_checksums, 0, "No migration should have null/empty checksum");
    }

    #[test]
    fn test_multi_version_atomic_upgrade_rollback_v10_to_v14_on_failure() {
        let mut conn = Connection::open_in_memory().unwrap();
        let all_migrations = get_migrations();

        // 1. Initialize database up to version 10
        let v1_to_v10: Vec<Migration> = all_migrations.iter().filter(|m| m.version <= 10).cloned().collect();
        ensure_and_upgrade_schema_migrations(&mut conn, &v1_to_v10).unwrap();
        apply_migrations_atomic(&mut conn, &v1_to_v10, 0).unwrap();

        let initial_ver: i32 = conn.query_row("SELECT MAX(version) FROM schema_migrations", [], |r| r.get(0)).unwrap();
        assert_eq!(initial_ver, 10, "Database should be at version 10 initially");

        // 2. Prepare an upgrade to v14 where v14 contains an invalid SQL statement that triggers a fatal error
        let mut upgrade_migrations = all_migrations.clone();
        if let Some(m14) = upgrade_migrations.iter_mut().find(|m| m.version == 14) {
            m14.sql = "ALTER TABLE invoice_items ADD COLUMN hsn_code TEXT; SELECT * FROM non_existent_table_that_fails_fatally;";
        }

        // 3. Attempt multi-version upgrade from v10 to v14
        let result = apply_migrations_atomic(&mut conn, &upgrade_migrations, 10);
        assert!(result.is_err(), "Upgrade must fail when v14 contains invalid statement");

        // 4. Verify database state: MUST REMAIN AT v10 with ZERO partial migration records
        let current_ver: i32 = conn.query_row("SELECT MAX(version) FROM schema_migrations", [], |r| r.get(0)).unwrap();
        assert_eq!(current_ver, 10, "Schema version must remain exactly at 10 after rollback");

        let partial_records: i64 = conn.query_row(
            "SELECT COUNT(*) FROM schema_migrations WHERE version > 10",
            [],
            |r| r.get(0),
        ).unwrap();
        assert_eq!(partial_records, 0, "There must be NO partial migration records for v11, v12, v13");

        // 5. Verify intermediate DDL changes from v12 (category_id in customers) and v14 (hsn_code in invoice_items) were completely rolled back
        let customer_cols = columns(&conn, "customers");
        assert!(!customer_cols.contains(&"category_id".to_string()), "v12 category_id column must be rolled back");

        let invoice_item_cols = columns(&conn, "invoice_items");
        assert!(!invoice_item_cols.contains(&"hsn_code".to_string()), "v14 hsn_code column must be rolled back");
    }
}

