use rusqlite::Connection;
use crate::reports::common::{ReportContext, ReportFilterCommon};
use crate::reports::category::models::CategoryReportFilter;
use crate::reports::category::service::CategoryReportService;

fn setup_test_db() -> Connection {
    let conn = Connection::open_in_memory().unwrap();
    conn.execute_batch("
        CREATE TABLE customer_categories (id INTEGER PRIMARY KEY, name TEXT UNIQUE);
        CREATE TABLE customers (id INTEGER PRIMARY KEY, customer_code TEXT, report_name TEXT, category_id INTEGER, category_name TEXT);
        CREATE TABLE invoices (invoice_number TEXT PRIMARY KEY, invoice_date TEXT, customer_id INTEGER, financial_year_id INTEGER, total_taxable REAL, total_cgst REAL, total_sgst REAL, total_igst REAL, total_value REAL, status TEXT);
        
        INSERT INTO customer_categories (id, name) VALUES (1, 'OEM'), (2, 'Retail');
        INSERT INTO customers (id, customer_code, report_name, category_id, category_name) VALUES (10, 'C001', 'Acme Motors', 1, 'OEM'), (20, 'C002', 'Beta Retail', 2, 'Retail'), (30, 'C003', 'Gamma Uncat', NULL, NULL);
        
        INSERT INTO invoices (invoice_number, invoice_date, customer_id, financial_year_id, total_taxable, total_cgst, total_sgst, total_igst, total_value, status)
        VALUES 
            ('INV-001', '2026-04-10', 10, 1, 1000.0, 90.0, 90.0, 0.0, 1180.0, 'Posted'),
            ('INV-002', '2026-04-15', 20, 1, 500.0, 45.0, 45.0, 0.0, 590.0, 'Posted'),
            ('INV-003', '2026-04-20', 30, 1, 200.0, 18.0, 18.0, 0.0, 236.0, 'Posted'),
            ('INV-004', '2026-04-25', 10, 1, 100.0, 9.0, 9.0, 0.0, 118.0, 'Cancelled');
    ").unwrap();
    conn
}

#[test]
fn test_category_report_service_basic() {
    let conn = setup_test_db();
    let ctx = ReportContext {
        conn: &conn,
        generated_at: "2026-08-06T12:00:00Z".to_string(),
        user_name: Some("TestUser".to_string()),
    };

    let filter = CategoryReportFilter {
        common: ReportFilterCommon {
            date_from: Some("2026-04-01".to_string()),
            date_to: Some("2026-04-30".to_string()),
            ..Default::default()
        },
        ..Default::default()
    };

    let res = CategoryReportService::generate_report(&ctx, filter).unwrap();
    assert_eq!(res.rows.len(), 3); // OEM, Retail, Uncategorized
    assert_eq!(res.grand_totals.total_invoices, 3); // Cancelled INV-004 excluded
    assert_eq!(res.grand_totals.grand_total_value, 2006.0); // 1180 + 590 + 236
    assert_eq!(res.grand_totals.largest_category_name, "OEM");
}

#[test]
fn test_category_report_service_include_cancelled() {
    let conn = setup_test_db();
    let ctx = ReportContext {
        conn: &conn,
        generated_at: "2026-08-06T12:00:00Z".to_string(),
        user_name: Some("TestUser".to_string()),
    };

    let filter = CategoryReportFilter {
        common: ReportFilterCommon {
            date_from: Some("2026-04-01".to_string()),
            date_to: Some("2026-04-30".to_string()),
            include_cancelled: Some(true),
            ..Default::default()
        },
        ..Default::default()
    };

    let res = CategoryReportService::generate_report(&ctx, filter).unwrap();
    assert_eq!(res.grand_totals.total_invoices, 4); // Included INV-004
}
