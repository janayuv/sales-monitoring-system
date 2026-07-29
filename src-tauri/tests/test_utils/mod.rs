use rusqlite::Connection;
use tauri_app_lib::database::migrate::run_migrations;

pub fn setup_test_db() -> Connection {
    let mut conn = Connection::open_in_memory().unwrap();
    run_migrations(&mut conn).unwrap();
    seed_db(&conn);
    conn
}

pub fn seed_db(conn: &Connection) {
    // 1. Seed Company Profile
    conn.execute(
        "INSERT INTO company_profile (id, company_name, gstin, address1, state_code, pan)
         VALUES (1, 'Test Company Ltd', '29AAACT1234A1Z1', '123 Main Street, Bangalore', '29', 'AAACT1234A')",
        [],
    ).unwrap();

    // 2. Seed Customer Category
    conn.execute(
        "INSERT INTO customer_categories (name) VALUES ('Regular')",
        [],
    ).unwrap();

    // 3. Seed Customers
    conn.execute(
        "INSERT INTO customers (id, customer_code, report_name, legal_name, gstin, address1, state_code, pincode, category_name, status)
         VALUES (101, 'CUST-101', 'Acme Customer', 'Acme India Pvt Ltd', '29AABCU1234A1Z2', '456 Business Road', '29', '560001', 'Regular', 'Approved')",
        [],
    ).unwrap();

    // Seed dependencies for items table foreign keys
    conn.execute("INSERT OR IGNORE INTO gst_rates (rate, description) VALUES (18.0, '18% GST')", []).unwrap();
    conn.execute("INSERT OR IGNORE INTO gst_rates (rate, description) VALUES (12.0, '12% GST')", []).unwrap();
    
    conn.execute("INSERT OR IGNORE INTO hsn_master (hsn_code, description, gst_rate) VALUES ('84099111', 'HSN A', 18.0)", []).unwrap();
    conn.execute("INSERT OR IGNORE INTO hsn_master (hsn_code, description, gst_rate) VALUES ('84099112', 'HSN B', 12.0)", []).unwrap();
    
    conn.execute("INSERT OR IGNORE INTO uoms (uom_code, uom_name) VALUES ('PCS', 'Pieces')", []).unwrap();

    // 4. Seed items
    conn.execute(
        "INSERT INTO items (part_code, part_name, uom_code, hsn_code, default_gst_rate, status)
         VALUES ('PART-A', 'Part Name A', 'PCS', '84099111', 18.0, 'Approved')",
        [],
    ).unwrap();
    conn.execute(
        "INSERT INTO items (part_code, part_name, uom_code, hsn_code, default_gst_rate, status)
         VALUES ('PART-B', 'Part Name B', 'PCS', '84099112', 12.0, 'Approved')",
        [],
    ).unwrap();

    // 5. Seed Financial Years
    conn.execute(
        "INSERT OR IGNORE INTO financial_years (id, label, start_date, end_date, is_active, is_locked)
         VALUES (2, 'FY 2026-27', '2026-04-01', '2027-03-31', 1, 0)",
        [],
    ).unwrap();
}

pub struct InvoiceBuilder {
    invoice_number: String,
    customer_id: i64,
    invoice_date: String,
    status: String,
    financial_year_id: i64,
    items: Vec<InvoiceItemBuilderRow>,
}

struct InvoiceItemBuilderRow {
    part_code: String,
    quantity: f64,
    rate: f64,
    gst_rate: f64,
}

impl InvoiceBuilder {
    pub fn new(invoice_number: &str) -> Self {
        Self {
            invoice_number: invoice_number.to_string(),
            customer_id: 101,
            invoice_date: "2026-07-29".to_string(),
            status: "Approved".to_string(),
            financial_year_id: 2,
            items: Vec::new(),
        }
    }

    pub fn with_customer(mut self, id: i64) -> Self {
        self.customer_id = id;
        self
    }

    pub fn with_date(mut self, date: &str) -> Self {
        self.invoice_date = date.to_string();
        self
    }

    pub fn with_status(mut self, status: &str) -> Self {
        self.status = status.to_string();
        self
    }

    pub fn with_item(mut self, part_code: &str, quantity: f64, rate: f64, gst_rate: f64) -> Self {
        self.items.push(InvoiceItemBuilderRow {
            part_code: part_code.to_string(),
            quantity,
            rate,
            gst_rate,
        });
        self
    }

    pub fn build(self, conn: &Connection) {
        let total_taxable = self.items.iter().map(|item| item.quantity * item.rate).sum::<f64>();
        let total_value = self.items.iter().map(|item| {
            let assess = item.quantity * item.rate;
            assess + (assess * item.gst_rate / 100.0)
        }).sum::<f64>();

        conn.execute(
            "INSERT INTO invoices (invoice_number, customer_id, invoice_date, status, place_of_supply, financial_year_id, total_taxable, total_cgst, total_sgst, total_igst, total_value)
             VALUES (?, ?, ?, ?, '29', ?, ?, 0, 0, 0, ?)",
            rusqlite::params![
                self.invoice_number,
                self.customer_id,
                self.invoice_date,
                self.status,
                self.financial_year_id,
                total_taxable,
                total_value,
            ],
        ).unwrap();

        for item in self.items {
            let assess = item.quantity * item.rate;
            let cgst_amount = if item.gst_rate > 0.0 { assess * item.gst_rate / 200.0 } else { 0.0 };
            let sgst_amount = if item.gst_rate > 0.0 { assess * item.gst_rate / 200.0 } else { 0.0 };
            
            conn.execute(
                "INSERT INTO invoice_items (invoice_number, part_code, quantity, rate_pre_unit, assessable_value, cgst_rate, cgst_amount, sgst_rate, sgst_amount, igst_rate, igst_amount, total_value)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0.0, 0, ?)",
                rusqlite::params![
                    self.invoice_number,
                    item.part_code,
                    item.quantity,
                    item.rate,
                    assess,
                    item.gst_rate / 2.0,
                    cgst_amount,
                    item.gst_rate / 2.0,
                    sgst_amount,
                    assess + cgst_amount + sgst_amount,
                ],
            ).unwrap();
        }
    }
}
