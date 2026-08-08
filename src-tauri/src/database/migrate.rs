use crate::error::AppError;
use rusqlite::{params, Connection};

pub struct Migration {
    pub version: i32,
    pub description: &'static str,
    pub sql: &'static str,
    /// When true, the migration is a full table rebuild: it runs with
    /// foreign_keys disabled and a foreign_key_check before commit, because
    /// SQLite cannot ALTER away a foreign key or CHECK constraint in place.
    pub rebuild: bool,
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
    ];

    // 4. Apply migrations sequentially
    for migration in migrations {
        if migration.version > current_version {
            log::info!(
                "Applying migration v{}: {}",
                migration.version,
                migration.description
            );
            if migration.rebuild {
                apply_rebuild_migration(conn, &migration)?;
            } else {
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
    }

    Ok(())
}

/// Applies a table-rebuild migration. `PRAGMA foreign_keys` is a no-op inside a
/// transaction, so it is toggled OFF outside, then a foreign_key_check runs
/// before commit; any violation rolls the whole rebuild back.
fn apply_rebuild_migration(conn: &mut Connection, migration: &Migration) -> Result<(), AppError> {
    conn.pragma_update(None, "foreign_keys", "OFF")
        .map_err(|e| AppError::Db {
            code: "ERR_DB_003".to_string(),
            message: format!("Failed to disable foreign_keys for rebuild: {}", e),
        })?;

    let result = (|| {
        let tx = conn.transaction().map_err(|e| AppError::Db {
            code: "ERR_DB_003".to_string(),
            message: format!("Failed to begin rebuild transaction: {}", e),
        })?;
        tx.execute_batch(migration.sql).map_err(|e| AppError::Db {
            code: "ERR_DB_003".to_string(),
            message: format!("Failed to execute rebuild script: {}", e),
        })?;
        tx.execute(
            "INSERT INTO schema_migrations (version, description) VALUES (?, ?)",
            params![migration.version, migration.description],
        )
        .map_err(|e| AppError::Db {
            code: "ERR_DB_003".to_string(),
            message: format!("Failed to log rebuild migration: {}", e),
        })?;
        let violations: i64 = tx
            .query_row("SELECT COUNT(*) FROM pragma_foreign_key_check", [], |r| {
                r.get(0)
            })
            .map_err(|e| AppError::Db {
                code: "ERR_DB_003".to_string(),
                message: format!("foreign_key_check read failed: {e}"),
            })?;
        if violations > 0 {
            return Err(AppError::Db {
                code: "ERR_DB_003".to_string(),
                message: format!(
                    "Rebuild v{} failed foreign_key_check ({violations} violations)",
                    migration.version
                ),
            });
        }
        tx.commit().map_err(|e| AppError::Db {
            code: "ERR_DB_003".to_string(),
            message: format!("Failed to commit rebuild transaction: {}", e),
        })?;
        Ok(())
    })();

    // Restore enforcement regardless of outcome.
    conn.pragma_update(None, "foreign_keys", "ON").ok();
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

        let result = apply_rebuild_migration(&mut conn, &bogus_migration);
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
}
