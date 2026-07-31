-- 0001_init.sql
-- SQLite Database Initial Schema for Sales Monitoring & Tally Reporting Application

-- 1. Geographic & Currency Masters
CREATE TABLE IF NOT EXISTS states (
    state_code TEXT PRIMARY KEY,
    state_name TEXT NOT NULL,
    gst_state_id TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS currencies (
    currency_code TEXT PRIMARY KEY,
    currency_name TEXT NOT NULL,
    symbol TEXT NOT NULL
);

-- 2. Period Limits & System Masters
CREATE TABLE IF NOT EXISTS financial_years (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    label TEXT NOT NULL,
    start_date TEXT NOT NULL,      -- YYYY-MM-DD
    end_date TEXT NOT NULL,        -- YYYY-MM-DD
    is_active INTEGER NOT NULL DEFAULT 0 CHECK(is_active IN (0, 1)),
    is_locked INTEGER NOT NULL DEFAULT 0 CHECK(is_locked IN (0, 1)),
    closed_at TEXT
);

CREATE TABLE IF NOT EXISTS gst_rates (
    rate REAL PRIMARY KEY,
    description TEXT
);

CREATE TABLE IF NOT EXISTS hsn_master (
    hsn_code TEXT PRIMARY KEY,
    description TEXT,
    gst_rate REAL NOT NULL REFERENCES gst_rates(rate)
);

CREATE TABLE IF NOT EXISTS uoms (
    uom_code TEXT PRIMARY KEY,
    uom_name TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS banks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    bank_name TEXT NOT NULL,
    account_no TEXT NOT NULL,
    ifsc_code TEXT NOT NULL,
    branch TEXT
);

-- 3. Voucher Numbering Series
CREATE TABLE IF NOT EXISTS voucher_series (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    voucher_type TEXT NOT NULL CHECK(voucher_type IN ('CREDIT_NOTE', 'DEBIT_NOTE')),
    financial_year_id INTEGER NOT NULL REFERENCES financial_years(id),
    prefix TEXT,
    suffix TEXT,
    current_number INTEGER NOT NULL DEFAULT 1,
    padding_length INTEGER NOT NULL DEFAULT 4,
    UNIQUE(voucher_type, financial_year_id)
);

-- 4. Supplier & Customer Registries (With Approval Queue)
CREATE TABLE IF NOT EXISTS suppliers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    supplier_code TEXT NOT NULL UNIQUE,
    supplier_name TEXT NOT NULL,
    gstin TEXT,
    state_code TEXT REFERENCES states(state_code),
    address TEXT,
    status TEXT NOT NULL DEFAULT 'Approved' CHECK(status IN ('Approved', 'Pending_Review'))
);
CREATE INDEX IF NOT EXISTS idx_suppliers_code ON suppliers(supplier_code);

CREATE TABLE IF NOT EXISTS customers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    customer_code TEXT NOT NULL UNIQUE,
    customer_name TEXT NOT NULL,
    gstin TEXT,
    state_code TEXT REFERENCES states(state_code),
    address TEXT,
    status TEXT NOT NULL DEFAULT 'Approved' CHECK(status IN ('Approved', 'Pending_Review'))
);
CREATE INDEX IF NOT EXISTS idx_customers_code ON customers(customer_code);

-- 5. Parts Master & Historical Price Audits
CREATE TABLE IF NOT EXISTS items (
    part_code TEXT PRIMARY KEY,
    part_name TEXT NOT NULL,
    hsn_code TEXT NOT NULL REFERENCES hsn_master(hsn_code),
    uom_code TEXT NOT NULL REFERENCES uoms(uom_code),
    default_gst_rate REAL NOT NULL REFERENCES gst_rates(rate),
    supplier_id INTEGER REFERENCES suppliers(id) ON DELETE SET NULL,
    status TEXT NOT NULL DEFAULT 'Approved' CHECK(status IN ('Approved', 'Pending_Review'))
);
CREATE INDEX IF NOT EXISTS idx_items_supplier ON items(supplier_id);

CREATE TABLE IF NOT EXISTS item_price_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    part_code TEXT NOT NULL REFERENCES items(part_code) ON DELETE CASCADE,
    effective_date TEXT NOT NULL, -- YYYY-MM-DD
    old_price REAL NOT NULL,
    new_price REAL NOT NULL,
    supplier_id INTEGER REFERENCES suppliers(id) ON DELETE SET NULL,
    reason TEXT,
    updated_by TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_price_history_part ON item_price_history(part_code, effective_date);

-- 6. Transaction Tracking & Batch Records
CREATE TABLE IF NOT EXISTS import_batches (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    imported_at TEXT NOT NULL DEFAULT (datetime('now')),
    source_type TEXT NOT NULL CHECK(source_type IN ('erp_sales_report', 'gstr1_report')),
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

CREATE TABLE IF NOT EXISTS invoices (
    invoice_number TEXT PRIMARY KEY, -- The short invoice number, e.g., '371805'
    invoice_no_long TEXT,
    invoice_date TEXT NOT NULL,      -- YYYY-MM-DD
    customer_id INTEGER NOT NULL REFERENCES customers(id),
    financial_year_id INTEGER NOT NULL REFERENCES financial_years(id),
    total_taxable REAL NOT NULL,
    total_cgst REAL NOT NULL DEFAULT 0.0,
    total_sgst REAL NOT NULL DEFAULT 0.0,
    total_igst REAL NOT NULL DEFAULT 0.0,
    total_cess REAL NOT NULL DEFAULT 0.0,
    total_value REAL NOT NULL,
    irn TEXT,
    irn_date TEXT,
    place_of_supply TEXT,
    reverse_charge TEXT DEFAULT 'N',
    invoice_type TEXT DEFAULT 'Regular B2B',
    status TEXT NOT NULL DEFAULT 'Imported' CHECK(status IN (
        'Draft', 'Imported', 'Verified', 'Posted', 'Cancelled', 
        'Credit Note Generated', 'Debit Note Generated', 'Closed'
    )),
    cancellation_date TEXT,
    import_batch_id INTEGER REFERENCES import_batches(id) ON DELETE SET NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_invoices_perf ON invoices(financial_year_id, invoice_date);
CREATE INDEX IF NOT EXISTS idx_invoices_status ON invoices(status);
CREATE INDEX IF NOT EXISTS idx_invoices_cust ON invoices(customer_code);


CREATE TABLE IF NOT EXISTS invoice_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    invoice_number TEXT NOT NULL REFERENCES invoices(invoice_number) ON DELETE CASCADE,
    part_code TEXT NOT NULL REFERENCES items(part_code),
    quantity REAL NOT NULL CHECK(quantity > 0),
    rate_pre_unit REAL NOT NULL CHECK(rate_pre_unit >= 0),
    assessable_value REAL NOT NULL,
    cgst_rate REAL NOT NULL DEFAULT 0.0,
    cgst_amount REAL NOT NULL DEFAULT 0.0,
    sgst_rate REAL NOT NULL DEFAULT 0.0,
    sgst_amount REAL NOT NULL DEFAULT 0.0,
    igst_rate REAL NOT NULL DEFAULT 0.0,
    igst_amount REAL NOT NULL DEFAULT 0.0,
    total_value REAL NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_invoice_items_inv ON invoice_items(invoice_number);

-- 7. Supplier Revisions & Recovery Notes
CREATE TABLE IF NOT EXISTS supplier_price_revisions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    supplier_id INTEGER NOT NULL REFERENCES suppliers(id) ON DELETE CASCADE,
    part_code TEXT NOT NULL REFERENCES items(part_code) ON DELETE CASCADE,
    old_price REAL NOT NULL,
    new_price REAL NOT NULL,
    difference REAL NOT NULL,
    effective_date TEXT NOT NULL,
    remarks TEXT,
    status TEXT NOT NULL DEFAULT 'Draft' CHECK(status IN ('Draft', 'Approved', 'Rejected')),
    approved_at TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS debit_notes (
    debit_note_number TEXT PRIMARY KEY,
    supplier_id INTEGER NOT NULL REFERENCES suppliers(id),
    revision_id INTEGER REFERENCES supplier_price_revisions(id) ON DELETE SET NULL,
    debit_note_date TEXT NOT NULL,
    total_taxable REAL NOT NULL,
    total_cgst REAL NOT NULL DEFAULT 0.0,
    total_sgst REAL NOT NULL DEFAULT 0.0,
    total_igst REAL NOT NULL DEFAULT 0.0,
    total_value REAL NOT NULL,
    status TEXT NOT NULL DEFAULT 'Draft' CHECK(status IN ('Draft', 'Review', 'Approved', 'Lock', 'Exported')),
    remarks TEXT,
    approved_at TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS debit_note_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    debit_note_number TEXT NOT NULL REFERENCES debit_notes(debit_note_number) ON DELETE CASCADE,
    invoice_number TEXT NOT NULL REFERENCES invoices(invoice_number),
    part_code TEXT NOT NULL REFERENCES items(part_code),
    quantity REAL NOT NULL,
    rate_difference REAL NOT NULL,
    assessable_difference REAL NOT NULL,
    cgst_amount REAL NOT NULL DEFAULT 0.0,
    sgst_amount REAL NOT NULL DEFAULT 0.0,
    igst_amount REAL NOT NULL DEFAULT 0.0,
    total_difference REAL NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_dn_items_dn ON debit_note_items(debit_note_number);

CREATE TABLE IF NOT EXISTS credit_notes (
    credit_note_number TEXT PRIMARY KEY,
    invoice_number TEXT NOT NULL UNIQUE REFERENCES invoices(invoice_number) ON DELETE RESTRICT,
    customer_id INTEGER NOT NULL REFERENCES customers(id),
    credit_note_date TEXT NOT NULL,
    total_taxable REAL NOT NULL,
    total_cgst REAL NOT NULL DEFAULT 0.0,
    total_sgst REAL NOT NULL DEFAULT 0.0,
    total_igst REAL NOT NULL DEFAULT 0.0,
    total_value REAL NOT NULL,
    status TEXT NOT NULL DEFAULT 'Draft' CHECK(status IN ('Draft', 'Review', 'Approved', 'Lock', 'Exported')),
    remarks TEXT,
    approved_at TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 8. Configuration, Templates, Saved Filters, & Attachments
CREATE TABLE IF NOT EXISTS import_templates (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    template_name TEXT NOT NULL,
    source_type TEXT NOT NULL CHECK(source_type IN ('erp_sales_report', 'gstr1_report')),
    is_active INTEGER NOT NULL DEFAULT 0 CHECK(is_active IN (0, 1))
);

CREATE TABLE IF NOT EXISTS import_template_mappings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    template_id INTEGER NOT NULL REFERENCES import_templates(id) ON DELETE CASCADE,
    excel_column_header TEXT NOT NULL,
    target_field_key TEXT NOT NULL,
    UNIQUE(template_id, excel_column_header)
);

CREATE TABLE IF NOT EXISTS attachments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    record_type TEXT NOT NULL CHECK(record_type IN ('INVOICE', 'DEBIT_NOTE', 'CREDIT_NOTE', 'SUPPLIER', 'IMPORT_BATCH')),
    record_id TEXT NOT NULL,
    file_name TEXT NOT NULL,
    file_path TEXT NOT NULL,
    mime_type TEXT NOT NULL,
    file_size INTEGER NOT NULL,
    uploaded_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_attachments_lookup ON attachments(record_type, record_id);

CREATE TABLE IF NOT EXISTS saved_filters (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    filter_name TEXT NOT NULL,
    target_screen TEXT NOT NULL,
    filter_json TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS validation_exceptions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    level TEXT NOT NULL CHECK(level IN ('file', 'row', 'invoice', 'gst', 'tally')),
    batch_id INTEGER REFERENCES import_batches(id) ON DELETE CASCADE,
    row_no INTEGER,
    invoice_no TEXT,
    severity TEXT NOT NULL CHECK(severity IN ('info', 'warning', 'error')),
    exception_type TEXT NOT NULL,
    field_name TEXT,
    expected_value TEXT,
    actual_value TEXT,
    resolved INTEGER NOT NULL DEFAULT 0,
    resolved_comment TEXT
);
CREATE INDEX IF NOT EXISTS idx_exceptions_batch ON validation_exceptions(batch_id);

CREATE TABLE IF NOT EXISTS audit_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp TEXT NOT NULL DEFAULT (datetime('now')),
    user_action TEXT NOT NULL,
    table_name TEXT NOT NULL,
    record_id TEXT NOT NULL,
    old_value TEXT,
    new_value TEXT
);

CREATE TABLE IF NOT EXISTS application_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp TEXT NOT NULL DEFAULT (datetime('now')),
    level TEXT NOT NULL CHECK(level IN ('INFO', 'WARN', 'ERROR', 'FATAL')),
    module TEXT NOT NULL,
    message TEXT NOT NULL,
    stack_trace TEXT,
    user_name TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_app_logs_time ON application_logs(timestamp);

CREATE TABLE IF NOT EXISTS app_settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
);

-- 9. Materialized Summary Tables for Pre-Aggregated Reports
CREATE TABLE IF NOT EXISTS summary_monthly_sales (
    financial_year_id INTEGER NOT NULL REFERENCES financial_years(id),
    month_no TEXT NOT NULL, -- '01' to '12'
    total_taxable REAL NOT NULL DEFAULT 0.0,
    total_cgst REAL NOT NULL DEFAULT 0.0,
    total_sgst REAL NOT NULL DEFAULT 0.0,
    total_igst REAL NOT NULL DEFAULT 0.0,
    total_value REAL NOT NULL DEFAULT 0.0,
    invoice_count INTEGER NOT NULL DEFAULT 0,
    active_count INTEGER NOT NULL DEFAULT 0,
    cancelled_count INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (financial_year_id, month_no)
);

CREATE TABLE IF NOT EXISTS summary_supplier_sales (
    financial_year_id INTEGER NOT NULL REFERENCES financial_years(id),
    supplier_id INTEGER NOT NULL REFERENCES suppliers(id),
    part_code TEXT NOT NULL REFERENCES items(part_code),
    total_qty REAL NOT NULL DEFAULT 0.0,
    total_taxable REAL NOT NULL DEFAULT 0.0,
    total_cgst REAL NOT NULL DEFAULT 0.0,
    total_sgst REAL NOT NULL DEFAULT 0.0,
    total_igst REAL NOT NULL DEFAULT 0.0,
    total_value REAL NOT NULL DEFAULT 0.0,
    avg_selling_price REAL NOT NULL DEFAULT 0.0,
    PRIMARY KEY (financial_year_id, supplier_id, part_code)
);

CREATE TABLE IF NOT EXISTS summary_customer_sales (
    financial_year_id INTEGER NOT NULL REFERENCES financial_years(id),
    customer_id INTEGER NOT NULL REFERENCES customers(id),
    total_taxable REAL NOT NULL DEFAULT 0.0,
    total_cgst REAL NOT NULL DEFAULT 0.0,
    total_sgst REAL NOT NULL DEFAULT 0.0,
    total_igst REAL NOT NULL DEFAULT 0.0,
    total_value REAL NOT NULL DEFAULT 0.0,
    PRIMARY KEY (financial_year_id, customer_id)
);

-- 10. Seed Initial System Reference Data
-- Seed standard Indian states & their GST codes
INSERT OR IGNORE INTO states (state_code, state_name, gst_state_id) VALUES
('MH', 'Maharashtra', '27'),
('TN', 'Tamil Nadu', '33'),
('KA', 'Karnataka', '29'),
('DL', 'Delhi', '07'),
('UP', 'Uttar Pradesh', '09'),
('GJ', 'Gujarat', '24'),
('HR', 'Haryana', '06'),
('TS', 'Telangana', '36'),
('AP', 'Andhra Pradesh', '37'),
('KL', 'Kerala', '32');

-- Seed base currencies
INSERT OR IGNORE INTO currencies (currency_code, currency_name, symbol) VALUES
('INR', 'Indian Rupee', '₹'),
('USD', 'United States Dollar', '$');

-- Seed standard tax brackets
INSERT OR IGNORE INTO gst_rates (rate, description) VALUES
(0.0, 'Exempt / Zero Rated'),
(5.0, '5% GST'),
(12.0, '12% GST'),
(18.0, '18% GST'),
(28.0, '28% GST');

-- Seed standard HSN items
INSERT OR IGNORE INTO hsn_master (hsn_code, description, gst_rate) VALUES
('8708.99.00', 'Motor vehicle parts and accessories', 18.0),
('8409.91.99', 'Internal combustion piston engines parts', 18.0),
('7318.15.00', 'Screws, bolts, nuts, washers', 18.0),
('8421.23.00', 'Oil or petrol-filters for internal combustion engines', 18.0),
('8421.31.00', 'Intake air filters for internal combustion engines', 18.0),
('4016.99.90', 'Other articles of vulcanized rubber', 18.0);

-- Seed standard Units of Measure (UOM)
INSERT OR IGNORE INTO uoms (uom_code, uom_name) VALUES
('PCS', 'Pieces'),
('NOS', 'Numbers'),
('KGS', 'Kilograms'),
('BOX', 'Boxes');

-- Seed default Financial Year (e.g. FY 2025-26)
INSERT OR IGNORE INTO financial_years (label, start_date, end_date, is_active, is_locked) VALUES
('FY 2025-26', '2025-04-01', '2026-03-31', 1, 0);

-- Seed default ERP import template
INSERT OR IGNORE INTO import_templates (id, template_name, source_type, is_active) VALUES
(1, 'ERP Standard Outward Sales', 'erp_sales_report', 1);

-- Seed mappings for ERP standard template
INSERT OR IGNORE INTO import_template_mappings (template_id, excel_column_header, target_field_key) VALUES
(1, 'Invno', 'invoice_number'),
(1, 'Inv Date', 'invoice_date'),
(1, 'Cust Code', 'customer_code'),
(1, 'Cust Name', 'customer_name'),
(1, 'Part Code', 'part_code'),
(1, 'Part Name', 'part_name'),
(1, 'io_qty', 'quantity'),
(1, 'rate_pre_unit', 'rate_pre_unit'),
(1, 'ASSESSABLE_VALUE', 'assessable_value'),
(1, 'cgst_amount', 'cgst_amount'),
(1, 'sgst_amount', 'sgst_amount'),
(1, 'igst_amount', 'igst_amount'),
(1, 'total_value', 'total_value');

