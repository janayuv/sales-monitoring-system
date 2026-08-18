use rusqlite::Connection;
use crate::reports::common::{ReportContext, ReportFilterCommon};
use crate::reports::hsn::models::HsnReportFilter;
use crate::reports::hsn::service::HsnReportService;

fn setup_test_db() -> Connection {
    let conn = Connection::open_in_memory().unwrap();
    conn.execute_batch("
        CREATE TABLE hsn_master (
            hsn_code TEXT PRIMARY KEY,
            description TEXT,
            gst_rate REAL NOT NULL
        );
        CREATE TABLE items (
            part_code TEXT PRIMARY KEY,
            part_name TEXT NOT NULL,
            hsn_code TEXT REFERENCES hsn_master(hsn_code),
            uom_code TEXT,
            default_gst_rate REAL
        );
        CREATE TABLE customers (
            id INTEGER PRIMARY KEY,
            customer_code TEXT NOT NULL,
            report_name TEXT NOT NULL
        );
        CREATE TABLE invoices (
            invoice_number TEXT PRIMARY KEY,
            invoice_date TEXT NOT NULL,
            customer_id INTEGER NOT NULL,
            financial_year_id INTEGER DEFAULT 1,
            total_taxable REAL,
            total_cgst REAL,
            total_sgst REAL,
            total_igst REAL,
            total_value REAL,
            status TEXT NOT NULL
        );
        CREATE TABLE invoice_items (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            invoice_number TEXT NOT NULL REFERENCES invoices(invoice_number),
            part_code TEXT NOT NULL REFERENCES items(part_code),
            quantity REAL NOT NULL,
            rate_pre_unit REAL NOT NULL,
            assessable_value REAL NOT NULL,
            cgst_rate REAL DEFAULT 0.0,
            cgst_amount REAL DEFAULT 0.0,
            sgst_rate REAL DEFAULT 0.0,
            sgst_amount REAL DEFAULT 0.0,
            igst_rate REAL DEFAULT 0.0,
            igst_amount REAL DEFAULT 0.0,
            total_value REAL NOT NULL,
            hsn_code TEXT
        );
        CREATE TABLE audit_log (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            event_type TEXT,
            table_name TEXT,
            record_id TEXT,
            changed_by TEXT,
            old_values TEXT,
            new_values TEXT,
            created_at TEXT DEFAULT (datetime('now'))
        );

        -- Seed HSN master
        INSERT INTO hsn_master (hsn_code, description, gst_rate) VALUES
            ('8708', 'Parts & Accessories of Motor Vehicles', 18.0),
            ('8409', 'Parts for Internal Combustion Engines', 28.0),
            ('9983', 'Consulting & Engineering Services', 18.0);

        -- Seed items (including one with no hsn_master match to test UNASSIGNED fallback)
        INSERT INTO items (part_code, part_name, hsn_code, uom_code, default_gst_rate) VALUES
            ('PART-001', 'Brake Rotor', '8708', 'NOS', 18.0),
            ('PART-002', 'Brake Pad', '8708', 'SET', 18.0),
            ('PART-003', 'Piston Ring', '8409', 'NOS', 28.0),
            ('PART-004', 'Custom Prototype Part', NULL, 'PCS', 18.0);

        -- Seed customers
        INSERT INTO customers (id, customer_code, report_name) VALUES
            (1, 'CUST-001', 'Alpha Motors'),
            (2, 'CUST-002', 'Beta Engineering');

        -- Seed invoices (with both intra-state CGST+SGST and inter-state IGST)
        INSERT INTO invoices (invoice_number, invoice_date, customer_id, financial_year_id, total_taxable, total_cgst, total_sgst, total_igst, total_value, status) VALUES
            ('INV-101', '2026-04-10', 1, 1, 10000.0, 900.0, 900.0, 0.0, 11800.0, 'Posted'),
            ('INV-102', '2026-04-15', 2, 1, 5000.0, 0.0, 0.0, 1400.0, 6400.0, 'Posted'),
            ('INV-103', '2026-04-20', 1, 1, 2000.0, 180.0, 180.0, 0.0, 2360.0, 'Posted'),
            ('INV-104', '2026-04-25', 2, 1, 1000.0, 90.0, 90.0, 0.0, 1180.0, 'Cancelled');

        -- Seed invoice items
        -- INV-101 (PART-001 under 8708: qty 10, rate 1000)
        INSERT INTO invoice_items (invoice_number, part_code, quantity, rate_pre_unit, assessable_value, cgst_rate, cgst_amount, sgst_rate, sgst_amount, igst_rate, igst_amount, total_value) VALUES
            ('INV-101', 'PART-001', 10.0, 1000.0, 10000.0, 9.0, 900.0, 9.0, 900.0, 0.0, 0.0, 11800.0);

        -- INV-102 (PART-003 under 8409: qty 5, rate 1000, IGST 28%)
        INSERT INTO invoice_items (invoice_number, part_code, quantity, rate_pre_unit, assessable_value, cgst_rate, cgst_amount, sgst_rate, sgst_amount, igst_rate, igst_amount, total_value) VALUES
            ('INV-102', 'PART-003', 5.0, 1000.0, 5000.0, 0.0, 0.0, 0.0, 0.0, 28.0, 1400.0, 6400.0);

        -- INV-103 (PART-002 under 8708 + PART-004 under UNASSIGNED)
        INSERT INTO invoice_items (invoice_number, part_code, quantity, rate_pre_unit, assessable_value, cgst_rate, cgst_amount, sgst_rate, sgst_amount, igst_rate, igst_amount, total_value) VALUES
            ('INV-103', 'PART-002', 2.0, 500.0, 1000.0, 9.0, 90.0, 9.0, 90.0, 0.0, 0.0, 1180.0),
            ('INV-103', 'PART-004', 1.0, 1000.0, 1000.0, 9.0, 90.0, 9.0, 90.0, 0.0, 0.0, 1180.0);

        -- INV-104 (Cancelled - PART-001 under 8708)
        INSERT INTO invoice_items (invoice_number, part_code, quantity, rate_pre_unit, assessable_value, cgst_rate, cgst_amount, sgst_rate, sgst_amount, igst_rate, igst_amount, total_value) VALUES
            ('INV-104', 'PART-001', 1.0, 1000.0, 1000.0, 9.0, 90.0, 9.0, 90.0, 0.0, 0.0, 1180.0);
    ").unwrap();
    conn
}

#[test]
fn test_hsn_report_basic_and_tax_totals() {
    let conn = setup_test_db();
    let ctx = ReportContext {
        conn: &conn,
        generated_at: "2026-08-18T10:00:00Z".to_string(),
        user_name: Some("Tester".to_string()),
    };

    let filter = HsnReportFilter {
        common: ReportFilterCommon {
            date_from: Some("2026-04-01".to_string()),
            date_to: Some("2026-04-30".to_string()),
            ..Default::default()
        },
        ..Default::default()
    };

    let res = HsnReportService::generate_report(&ctx, filter).unwrap();

    // Active rows: 8708, 8409, UNASSIGNED (INV-104 cancelled is excluded)
    assert_eq!(res.rows.len(), 3);
    assert_eq!(res.grand_totals.total_invoices, 3);
    assert_eq!(res.grand_totals.total_taxable, 17000.0); // 11000 (8708) + 5000 (8409) + 1000 (UNASSIGNED)
    assert_eq!(res.grand_totals.total_cgst, 1080.0);      // 900 + 0 + 90 + 90
    assert_eq!(res.grand_totals.total_sgst, 1080.0);      // 900 + 0 + 90 + 90
    assert_eq!(res.grand_totals.total_igst, 1400.0);      // 0 + 1400 + 0
    assert_eq!(res.grand_totals.total_tax, 3560.0);
    assert_eq!(res.grand_totals.grand_total_value, 20560.0);
    assert_eq!(res.grand_totals.total_quantity, 18.0);    // 12 (8708) + 5 (8409) + 1 (UNASSIGNED)
    assert_eq!(res.grand_totals.top_hsn_code, "8708");

    // 8708 total_value = 11800 + 1180 = 12980.0
    // share = (12980 / 20380) * 100 = 63.689892%
    let top_hsn_row = res.rows.iter().find(|r| r.hsn_code == "8708").unwrap();
    assert_eq!(top_hsn_row.total_quantity, 12.0);
    assert_eq!(top_hsn_row.item_count, 2); // PART-001 and PART-002
    assert_eq!(top_hsn_row.invoice_count, 2);
    assert_eq!(top_hsn_row.total_taxable, 11000.0);
}

#[test]
fn test_hsn_report_cancelled_invoice_inclusion() {
    let conn = setup_test_db();
    let ctx = ReportContext {
        conn: &conn,
        generated_at: "2026-08-18T10:00:00Z".to_string(),
        user_name: Some("Tester".to_string()),
    };

    let filter = HsnReportFilter {
        common: ReportFilterCommon {
            date_from: Some("2026-04-01".to_string()),
            date_to: Some("2026-04-30".to_string()),
            include_cancelled: Some(true),
            ..Default::default()
        },
        ..Default::default()
    };

    let res = HsnReportService::generate_report(&ctx, filter).unwrap();
    // With cancelled INV-104: total_taxable = 17000 + 1000 = 18000
    assert_eq!(res.grand_totals.total_invoices, 4);
    assert_eq!(res.grand_totals.total_taxable, 18000.0);
}

#[test]
fn test_hsn_report_show_empty_hsn() {
    let conn = setup_test_db();
    let ctx = ReportContext {
        conn: &conn,
        generated_at: "2026-08-18T10:00:00Z".to_string(),
        user_name: Some("Tester".to_string()),
    };

    let filter = HsnReportFilter {
        common: ReportFilterCommon {
            date_from: Some("2026-04-01".to_string()),
            date_to: Some("2026-04-30".to_string()),
            ..Default::default()
        },
        show_empty_hsn: Some(true),
        ..Default::default()
    };

    let res = HsnReportService::generate_report(&ctx, filter).unwrap();
    // Should include 9983 which has 0 sales
    assert!(res.rows.iter().any(|r| r.hsn_code == "9983" && r.total_value == 0.0));
}

#[test]
fn test_hsn_report_item_breakdown_level2() {
    let conn = setup_test_db();
    let ctx = ReportContext {
        conn: &conn,
        generated_at: "2026-08-18T10:00:00Z".to_string(),
        user_name: Some("Tester".to_string()),
    };

    let filter = HsnReportFilter {
        common: ReportFilterCommon {
            date_from: Some("2026-04-01".to_string()),
            date_to: Some("2026-04-30".to_string()),
            ..Default::default()
        },
        ..Default::default()
    };

    let items = HsnReportService::get_item_breakdown(&ctx, filter, "8708").unwrap();
    assert_eq!(items.len(), 2);
    let p1 = items.iter().find(|i| i.part_code == "PART-001").unwrap();
    assert_eq!(p1.total_quantity, 10.0);
    assert_eq!(p1.avg_rate, 1000.0);
    assert_eq!(p1.total_taxable, 10000.0);
    assert_eq!(p1.total_tax, 1800.0);
}

#[test]
fn test_hsn_report_invoice_breakdown_level3() {
    let conn = setup_test_db();
    let ctx = ReportContext {
        conn: &conn,
        generated_at: "2026-08-18T10:00:00Z".to_string(),
        user_name: Some("Tester".to_string()),
    };

    let filter = HsnReportFilter {
        common: ReportFilterCommon {
            date_from: Some("2026-04-01".to_string()),
            date_to: Some("2026-04-30".to_string()),
            ..Default::default()
        },
        ..Default::default()
    };

    let invoices = HsnReportService::get_invoice_breakdown(&ctx, filter, "8708", Some("PART-001")).unwrap();
    assert_eq!(invoices.len(), 1);
    assert_eq!(invoices[0].invoice_number, "INV-101");
    assert_eq!(invoices[0].customer_code, "CUST-001");
    assert_eq!(invoices[0].quantity, 10.0);
    assert_eq!(invoices[0].assessable_value, 10000.0);
}

#[test]
fn test_hsn_report_search_filtering() {
    let conn = setup_test_db();
    let ctx = ReportContext {
        conn: &conn,
        generated_at: "2026-08-18T10:00:00Z".to_string(),
        user_name: Some("Tester".to_string()),
    };

    let filter = HsnReportFilter {
        common: ReportFilterCommon {
            date_from: Some("2026-04-01".to_string()),
            date_to: Some("2026-04-30".to_string()),
            search_term: Some("Internal Combustion".to_string()),
            ..Default::default()
        },
        ..Default::default()
    };

    let res = HsnReportService::generate_report(&ctx, filter).unwrap();
    assert_eq!(res.rows.len(), 1);
    assert_eq!(res.rows[0].hsn_code, "8409");
}

#[test]
fn test_hsn_report_unassigned_level2_and_level3() {
    let conn = setup_test_db();
    let ctx = ReportContext {
        conn: &conn,
        generated_at: "2026-08-18T10:00:00Z".to_string(),
        user_name: Some("Tester".to_string()),
    };

    let filter = HsnReportFilter {
        common: ReportFilterCommon {
            date_from: Some("2026-04-01".to_string()),
            date_to: Some("2026-04-30".to_string()),
            ..Default::default()
        },
        ..Default::default()
    };

    // Level 2 drilldown on UNASSIGNED
    let items = HsnReportService::get_item_breakdown(&ctx, filter.clone(), "UNASSIGNED").unwrap();
    assert_eq!(items.len(), 1);
    assert_eq!(items[0].part_code, "PART-004");
    assert_eq!(items[0].hsn_code, "UNASSIGNED");
    assert_eq!(items[0].total_quantity, 1.0);
    assert_eq!(items[0].total_taxable, 1000.0);

    // Level 3 drilldown on UNASSIGNED
    let invoices = HsnReportService::get_invoice_breakdown(&ctx, filter, "UNASSIGNED", Some("PART-004")).unwrap();
    assert_eq!(invoices.len(), 1);
    assert_eq!(invoices[0].invoice_number, "INV-103");
    assert_eq!(invoices[0].part_code, "PART-004");
    assert_eq!(invoices[0].assessable_value, 1000.0);
}

#[test]
fn test_hsn_report_specific_hsn_filter() {
    let conn = setup_test_db();
    let ctx = ReportContext {
        conn: &conn,
        generated_at: "2026-08-18T10:00:00Z".to_string(),
        user_name: Some("Tester".to_string()),
    };

    let filter = HsnReportFilter {
        common: ReportFilterCommon {
            date_from: Some("2026-04-01".to_string()),
            date_to: Some("2026-04-30".to_string()),
            ..Default::default()
        },
        hsn_codes: Some(vec!["8409".to_string()]),
        ..Default::default()
    };

    let res = HsnReportService::generate_report(&ctx, filter).unwrap();
    assert_eq!(res.rows.len(), 1);
    assert_eq!(res.rows[0].hsn_code, "8409");
    assert_eq!(res.grand_totals.total_hsn_codes, 1);
    assert_eq!(res.grand_totals.total_invoices, 1);
    assert_eq!(res.grand_totals.total_taxable, 5000.0);
    assert_eq!(res.grand_totals.top_hsn_code, "8409");
}

#[test]
fn test_same_part_code_under_multiple_hsns_separated_across_all_levels() {
    let conn = setup_test_db();
    let ctx = ReportContext {
        conn: &conn,
        generated_at: "2026-08-18T10:00:00Z".to_string(),
        user_name: Some("Tester".to_string()),
    };

    // 1. Create a multi-HSN part 'PART-MULTI' whose default item HSN is '8708'
    conn.execute(
        "INSERT INTO items (part_code, part_name, hsn_code, uom_code, default_gst_rate)
         VALUES ('PART-MULTI', 'Dual Classification Filter', '8708', 'PCS', 18.0)",
        [],
    ).unwrap();

    // 2. Create Invoice INV-M1 where PART-MULTI is sold under transaction HSN '8409' (qty 10, taxable 10000)
    conn.execute(
        "INSERT INTO invoices (invoice_number, invoice_date, customer_id, financial_year_id, total_taxable, total_cgst, total_sgst, total_igst, total_value, status)
         VALUES ('INV-M1', '2026-04-12', 1, 1, 10000.0, 900.0, 900.0, 0.0, 11800.0, 'Posted')",
        [],
    ).unwrap();
    conn.execute(
        "INSERT INTO invoice_items (invoice_number, part_code, quantity, rate_pre_unit, assessable_value, cgst_rate, cgst_amount, sgst_rate, sgst_amount, igst_rate, igst_amount, total_value, hsn_code)
         VALUES ('INV-M1', 'PART-MULTI', 10.0, 1000.0, 10000.0, 9.0, 900.0, 9.0, 900.0, 0.0, 0.0, 11800.0, '8409')",
        [],
    ).unwrap();

    // 3. Create Invoice INV-M2 where SAME PART-MULTI is sold under transaction HSN '8708' (qty 20, taxable 20000)
    conn.execute(
        "INSERT INTO invoices (invoice_number, invoice_date, customer_id, financial_year_id, total_taxable, total_cgst, total_sgst, total_igst, total_value, status)
         VALUES ('INV-M2', '2026-04-18', 2, 1, 20000.0, 1800.0, 1800.0, 0.0, 23600.0, 'Posted')",
        [],
    ).unwrap();
    conn.execute(
        "INSERT INTO invoice_items (invoice_number, part_code, quantity, rate_pre_unit, assessable_value, cgst_rate, cgst_amount, sgst_rate, sgst_amount, igst_rate, igst_amount, total_value, hsn_code)
         VALUES ('INV-M2', 'PART-MULTI', 20.0, 1000.0, 20000.0, 9.0, 1800.0, 9.0, 1800.0, 0.0, 0.0, 23600.0, '8708')",
        [],
    ).unwrap();

    let filter = HsnReportFilter {
        common: ReportFilterCommon {
            date_from: Some("2026-04-01".to_string()),
            date_to: Some("2026-04-30".to_string()),
            ..Default::default()
        },
        ..Default::default()
    };

    // --- LEVEL 1: Verify both HSN 8409 and 8708 aggregated rows reflect separate line assignments ---
    let report = HsnReportService::generate_report(&ctx, filter.clone()).unwrap();
    
    let hsn_8409 = report.rows.iter().find(|r| r.hsn_code == "8409").unwrap();
    // 8409 base had PART-003 (qty 5, taxable 5000) + now PART-MULTI from INV-M1 (qty 10, taxable 10000) = qty 15, taxable 15000
    assert_eq!(hsn_8409.total_quantity, 15.0);
    assert_eq!(hsn_8409.total_taxable, 15000.0);

    let hsn_8708 = report.rows.iter().find(|r| r.hsn_code == "8708").unwrap();
    // 8708 base had PART-001 (qty 10, taxable 10000) + PART-002 (qty 2, taxable 1000) + now PART-MULTI from INV-M2 (qty 20, taxable 20000) = qty 32, taxable 31000
    assert_eq!(hsn_8708.total_quantity, 32.0);
    assert_eq!(hsn_8708.total_taxable, 31000.0);

    // --- LEVEL 2: Verify item drilldown for 8409 and 8708 separately includes PART-MULTI with exact quantities ---
    let items_8409 = HsnReportService::get_item_breakdown(&ctx, filter.clone(), "8409").unwrap();
    let part_multi_in_8409 = items_8409.iter().find(|i| i.part_code == "PART-MULTI").unwrap();
    assert_eq!(part_multi_in_8409.hsn_code, "8409");
    assert_eq!(part_multi_in_8409.total_quantity, 10.0);
    assert_eq!(part_multi_in_8409.total_taxable, 10000.0);
    assert_eq!(part_multi_in_8409.invoice_count, 1);

    let items_8708 = HsnReportService::get_item_breakdown(&ctx, filter.clone(), "8708").unwrap();
    let part_multi_in_8708 = items_8708.iter().find(|i| i.part_code == "PART-MULTI").unwrap();
    assert_eq!(part_multi_in_8708.hsn_code, "8708");
    assert_eq!(part_multi_in_8708.total_quantity, 20.0);
    assert_eq!(part_multi_in_8708.total_taxable, 20000.0);
    assert_eq!(part_multi_in_8708.invoice_count, 1);

    // --- LEVEL 3: Verify invoice drilldown for PART-MULTI filters strictly by transaction HSN ---
    let invs_8409_part = HsnReportService::get_invoice_breakdown(&ctx, filter.clone(), "8409", Some("PART-MULTI")).unwrap();
    assert_eq!(invs_8409_part.len(), 1);
    assert_eq!(invs_8409_part[0].invoice_number, "INV-M1");
    assert_eq!(invs_8409_part[0].assessable_value, 10000.0);

    let invs_8708_part = HsnReportService::get_invoice_breakdown(&ctx, filter, "8708", Some("PART-MULTI")).unwrap();
    assert_eq!(invs_8708_part.len(), 1);
    assert_eq!(invs_8708_part[0].invoice_number, "INV-M2");
    assert_eq!(invs_8708_part[0].assessable_value, 20000.0);
}


