mod test_utils;

use std::sync::Mutex;
use tauri::State;
use tauri_app_lib::commands::customer_revision_commands::update_customer_debit_note_lines;
use tauri_app_lib::error::AppError;
use tauri_app_lib::state::DbState;
use rusqlite::params;
use test_utils::setup_test_db;

fn setup_debit_note_test_db() -> (DbState, i64, Vec<i64>) {
    let conn = setup_test_db();

    // 1. Seed 3 Invoices with items
    // Invoice 1: 100 PCS of PART-A @ 100.0 (Taxable: 10000.0, CGST: 900.0, SGST: 900.0)
    conn.execute(
        "INSERT INTO invoices (invoice_number, invoice_date, customer_id, financial_year_id, total_taxable, total_cgst, total_sgst, total_igst, total_value, status)
         VALUES ('INV-001', '2026-05-01', 101, 2, 10000.0, 900.0, 900.0, 0.0, 11800.0, 'Imported')",
        [],
    )
    .unwrap();
    conn.execute(
        "INSERT INTO invoice_items (id, invoice_number, part_code, quantity, rate_pre_unit, assessable_value, cgst_rate, cgst_amount, sgst_rate, sgst_amount, igst_rate, igst_amount, total_value)
         VALUES (1, 'INV-001', 'PART-A', 100.0, 100.0, 10000.0, 9.0, 900.0, 9.0, 900.0, 0.0, 0.0, 11800.0)",
        [],
    )
    .unwrap();

    // Invoice 2: 50 PCS of PART-B @ 200.0 (Taxable: 10000.0, CGST: 900.0, SGST: 900.0)
    conn.execute(
        "INSERT INTO invoices (invoice_number, invoice_date, customer_id, financial_year_id, total_taxable, total_cgst, total_sgst, total_igst, total_value, status)
         VALUES ('INV-002', '2026-05-02', 101, 2, 10000.0, 900.0, 900.0, 0.0, 11800.0, 'Imported')",
        [],
    )
    .unwrap();
    conn.execute(
        "INSERT INTO invoice_items (id, invoice_number, part_code, quantity, rate_pre_unit, assessable_value, cgst_rate, cgst_amount, sgst_rate, sgst_amount, igst_rate, igst_amount, total_value)
         VALUES (2, 'INV-002', 'PART-B', 50.0, 200.0, 10000.0, 9.0, 900.0, 9.0, 900.0, 0.0, 0.0, 11800.0)",
        [],
    )
    .unwrap();

    // Invoice 3: 200 PCS of PART-A @ 50.0 (Taxable: 10000.0, CGST: 900.0, SGST: 900.0)
    conn.execute(
        "INSERT INTO invoices (invoice_number, invoice_date, customer_id, financial_year_id, total_taxable, total_cgst, total_sgst, total_igst, total_value, status)
         VALUES ('INV-003', '2026-05-03', 101, 2, 10000.0, 900.0, 900.0, 0.0, 11800.0, 'Imported')",
        [],
    )
    .unwrap();
    conn.execute(
        "INSERT INTO invoice_items (id, invoice_number, part_code, quantity, rate_pre_unit, assessable_value, cgst_rate, cgst_amount, sgst_rate, sgst_amount, igst_rate, igst_amount, total_value)
         VALUES (3, 'INV-003', 'PART-A', 200.0, 50.0, 10000.0, 9.0, 900.0, 9.0, 900.0, 0.0, 0.0, 11800.0)",
        [],
    )
    .unwrap();

    // 2. Create sample Customer Price Revision, Recovery Case & Debit Note with 3 lines
    conn.execute(
        "INSERT INTO customer_price_revisions (id, customer_id, revision_no, effective_from, created_by)
         VALUES (1, 101, 'REV-001', '2026-04-01', 'Tester')",
        [],
    )
    .unwrap();

    // Line 1: 100 * 10 = 1000.0 (CGST: 90, SGST: 90, Tot: 1180) -> assessable: 100000 paise, cgst: 9000, sgst: 9000, tot: 118000
    // Line 2: 50 * 20 = 1000.0 (CGST: 90, SGST: 90, Tot: 1180) -> assessable: 100000 paise, cgst: 9000, sgst: 9000, tot: 118000
    // Line 3: 200 * 5 = 1000.0 (CGST: 90, SGST: 90, Tot: 1180) -> assessable: 100000 paise, cgst: 9000, sgst: 9000, tot: 118000
    // Initial Grand Total: Taxable = 3000.0 (300000 paise), CGST = 270.0 (27000 paise), SGST = 270.0 (27000 paise), Total = 3540.0 (354000 paise)
    conn.execute(
        "INSERT INTO customer_recovery_cases (id, uuid, case_no, customer_id, revision_id, financial_year_id, period_from, period_to, total_invoices, total_quantity, total_recoverable_amount, recovered_amount, balance_amount, created_by)
         VALUES (1, 'case-1', 'RC-001', 101, 1, 2, '2026-04-01', '2026-05-31', 3, 300000, 354000, 354000, 0, 'Tester')",
        [],
    )
    .unwrap();

    conn.execute(
        "INSERT INTO customer_debit_notes (id, uuid, case_id, financial_year_id, debit_note_no, annexure_no, customer_id, debit_note_date, total_taxable, total_cgst, total_sgst, total_igst, total_cess, total_value, currency, exchange_rate, foreign_total_value, outstanding_amount, status, financial_status, version, created_by, frozen_customer_name)
         VALUES (1, 'cdn-1', 1, 2, 'CDN00001', 'CDN00001-A', 101, '2026-05-10', 300000, 27000, 27000, 0, 0, 354000, 'INR', 1.0, 354000, 354000, 'Created', 'Pending', 1, 'Tester', 'Acme Customer')",
        [],
    )
    .unwrap();

    conn.execute(
        "INSERT INTO customer_debit_note_journal_entries (id, debit_note_id, journal_number, voucher_date, financial_year_id, currency, exchange_rate, account_code, account_name, entry_type, amount, posted_by, posting_status)
         VALUES (1, 1, 'JNL-001', '2026-05-10', 2, 'INR', 1.0, '1100-AR', 'Customer Accounts Receivable', 'DEBIT', 354000, 'Tester', 'Pending')",
        [],
    )
    .unwrap();

    conn.execute(
        "INSERT INTO customer_debit_note_invoice_map (id, debit_note_id, invoice_id, invoice_number, invoice_item_id, part_code, quantity, recovered_qty, balance_qty, rate_pre_unit, new_price, difference, assessable_difference, cgst_rate, cgst_amount, sgst_rate, sgst_amount, igst_rate, igst_amount, cess_amount, hsn_code, gst_type, total_difference, status, frozen_part_number, invoice_date)
         VALUES (1, 1, 1, 'INV-001', 1, 'PART-A', 100.0, 100.0, 0.0, 100.0, 110.0, 10.0, 100000, 9.0, 9000, 9.0, 9000, 0.0, 0, 0, '84099111', 'CGST+SGST', 118000, 'Draft', 'PART-A', '2026-05-01'),
                (2, 1, 2, 'INV-002', 2, 'PART-B', 50.0, 50.0, 0.0, 200.0, 220.0, 20.0, 100000, 9.0, 9000, 9.0, 9000, 0.0, 0, 0, '84099112', 'CGST+SGST', 118000, 'Draft', 'PART-B', '2026-05-02'),
                (3, 1, 3, 'INV-003', 3, 'PART-A', 200.0, 200.0, 0.0, 50.0, 55.0, 5.0, 100000, 9.0, 9000, 9.0, 9000, 0.0, 0, 0, '84099111', 'CGST+SGST', 118000, 'Draft', 'PART-A', '2026-05-03')",
        [],
    )
    .unwrap();

    let db_state = DbState {
        conn: Mutex::new(Some(conn)),
        dashboard_cache: Mutex::new(None),
    };

    (db_state, 1, vec![1, 2, 3])
}

fn state_from_db(db_state: &DbState) -> State<'_, DbState> {
    let state_ref: &DbState = db_state;
    unsafe { std::mem::transmute(state_ref) }
}

#[test]
fn test_remove_single_invoice_mapping_and_totals() {
    let (db_state, debit_note_id, _) = setup_debit_note_test_db();
    let state = state_from_db(&db_state);

    // Remove mapping 2 (INV-002), retaining mappings 1 and 3
    let res = update_customer_debit_note_lines(
        state,
        debit_note_id,
        vec![1, 3],
        Some("Removed INV-002 line".to_string()),
        "Auditor".to_string(),
    );

    assert!(res.is_ok(), "update_customer_debit_note_lines should succeed");
    let dn = res.unwrap();

    // Line 1 (1000.0 tax, 90 cgst, 90 sgst, 1180 tot) + Line 3 (1000.0 tax, 90 cgst, 90 sgst, 1180 tot)
    // Revised Totals: Taxable = 2000.0, CGST = 180.0, SGST = 180.0, Total = 2360.0
    assert_eq!(dn.total_taxable, 2000.0);
    assert_eq!(dn.total_cgst, 180.0);
    assert_eq!(dn.total_sgst, 180.0);
    assert_eq!(dn.total_igst, 0.0);
    assert_eq!(dn.total_cess, 0.0);
    assert_eq!(dn.total_value, 2360.0);
    assert_eq!(dn.outstanding_amount, 2360.0);
    assert_eq!(dn.version, 2);
    assert_eq!(dn.remarks, Some("Removed INV-002 line".to_string()));
}

#[test]
fn test_remove_multiple_invoice_mappings() {
    let (db_state, debit_note_id, _) = setup_debit_note_test_db();
    let state = state_from_db(&db_state);

    // Retain only mapping 1, removing mappings 2 and 3
    let res = update_customer_debit_note_lines(
        state,
        debit_note_id,
        vec![1],
        Some("Retained only INV-001".to_string()),
        "Auditor".to_string(),
    );

    assert!(res.is_ok());
    let dn = res.unwrap();
    assert_eq!(dn.total_taxable, 1000.0);
    assert_eq!(dn.total_cgst, 90.0);
    assert_eq!(dn.total_sgst, 90.0);
    assert_eq!(dn.total_value, 1180.0);
}

#[test]
fn test_removed_mapping_status_cancelled_not_deleted() {
    let (db_state, debit_note_id, _) = setup_debit_note_test_db();
    let state = state_from_db(&db_state);

    update_customer_debit_note_lines(
        state.clone(),
        debit_note_id,
        vec![1, 3],
        None,
        "Auditor".to_string(),
    )
    .unwrap();

    let conn_guard = db_state.conn.lock().unwrap();
    let conn = conn_guard.as_ref().unwrap();

    // Row with id = 2 must still physically exist in the table
    let (status, balance_qty, qty): (String, f64, f64) = conn
        .query_row(
            "SELECT status, balance_qty, quantity FROM customer_debit_note_invoice_map WHERE id = 2",
            [],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
        )
        .unwrap();

    assert_eq!(status, "Cancelled");
    assert_eq!(balance_qty, 50.0);
    assert_eq!(qty, 50.0);
}

#[test]
fn test_released_quantity_excluded_from_future_allocation_query() {
    let (db_state, debit_note_id, _) = setup_debit_note_test_db();
    let state = state_from_db(&db_state);

    // Before update: invoice_item_id = 2 has 50.0 recovered
    {
        let conn_guard = db_state.conn.lock().unwrap();
        let conn = conn_guard.as_ref().unwrap();
        let rec_before: f64 = conn
            .query_row(
                "SELECT COALESCE(SUM(recovered_qty), 0.0) FROM customer_debit_note_invoice_map WHERE invoice_item_id = 2 AND status != 'Cancelled'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(rec_before, 50.0);
    }

    // Remove mapping 2
    update_customer_debit_note_lines(
        state.clone(),
        debit_note_id,
        vec![1, 3],
        None,
        "Auditor".to_string(),
    )
    .unwrap();

    // After update: invoice_item_id = 2 allocation query must return 0.0 (released)
    {
        let conn_guard = db_state.conn.lock().unwrap();
        let conn = conn_guard.as_ref().unwrap();
        let rec_after: f64 = conn
            .query_row(
                "SELECT COALESCE(SUM(recovered_qty), 0.0) FROM customer_debit_note_invoice_map WHERE invoice_item_id = 2 AND status != 'Cancelled'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(rec_after, 0.0, "Released quantity must be excluded from active allocation");
    }
}

#[test]
fn test_accounting_effects_journal_and_recovery_case_updated() {
    let (db_state, debit_note_id, _) = setup_debit_note_test_db();
    let state = state_from_db(&db_state);

    update_customer_debit_note_lines(
        state.clone(),
        debit_note_id,
        vec![1, 3],
        None,
        "Auditor".to_string(),
    )
    .unwrap();

    let conn_guard = db_state.conn.lock().unwrap();
    let conn = conn_guard.as_ref().unwrap();

    // 1. Check Journal Entry
    let journal_amt: i64 = conn
        .query_row(
            "SELECT amount FROM customer_debit_note_journal_entries WHERE debit_note_id = 1 AND entry_type = 'DEBIT'",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(journal_amt, 236000, "AR journal entry amount must match revised debit note total in paise");

    // 2. Check Recovery Case Rollup
    let (tot_inv, tot_rec_amt, rec_amt, bal_amt): (i64, i64, i64, i64) = conn
        .query_row(
            "SELECT total_invoices, total_recoverable_amount, recovered_amount, balance_amount FROM customer_recovery_cases WHERE id = 1",
            [],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)),
        )
        .unwrap();
    assert_eq!(tot_inv, 2, "Recovery case total_invoices must match retained count");
    assert_eq!(tot_rec_amt, 236000, "Recovery case recoverable amount must match revised total in paise");
    assert_eq!(rec_amt, 236000, "Recovery case recovered amount must match revised total in paise");
    assert_eq!(bal_amt, 0);
}

#[test]
fn test_audit_event_logged_with_invoice_numbers() {
    let (db_state, debit_note_id, _) = setup_debit_note_test_db();
    let state = state_from_db(&db_state);

    update_customer_debit_note_lines(
        state.clone(),
        debit_note_id,
        vec![1, 3],
        None,
        "Auditor".to_string(),
    )
    .unwrap();

    let conn_guard = db_state.conn.lock().unwrap();
    let conn = conn_guard.as_ref().unwrap();

    let (event_type, event_severity, event_details, performed_by): (String, String, String, String) = conn
        .query_row(
            "SELECT event_type, event_severity, event_details, performed_by FROM customer_debit_note_events WHERE debit_note_id = 1 ORDER BY id DESC LIMIT 1",
            [],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)),
        )
        .unwrap();

    assert_eq!(event_type, "Debit Note Lines Updated");
    assert_eq!(event_severity, "INFO");
    assert!(event_details.contains("Removed 1 invoice line(s)"));
    assert!(event_details.contains("INV-002"));
    assert_eq!(performed_by, "Auditor");
}

#[test]
fn test_reject_empty_remaining_lines() {
    let (db_state, debit_note_id, _) = setup_debit_note_test_db();
    let state = state_from_db(&db_state);

    let res = update_customer_debit_note_lines(
        state,
        debit_note_id,
        vec![],
        None,
        "Auditor".to_string(),
    );

    assert!(res.is_err());
    match res.err().unwrap() {
        AppError::Validation { code, message } => {
            assert_eq!(code, "ERR_DN_EDIT_001");
            assert!(message.contains("Cannot remove all invoice lines"));
        }
        other => panic!("Expected Validation error, got: {:?}", other),
    }
}

#[test]
fn test_reject_map_id_belonging_to_another_debit_note() {
    let (db_state, debit_note_id, _) = setup_debit_note_test_db();
    let state = state_from_db(&db_state);

    // Map ID 999 does not belong to debit note 1
    let res = update_customer_debit_note_lines(
        state,
        debit_note_id,
        vec![1, 999],
        None,
        "Auditor".to_string(),
    );

    assert!(res.is_err());
    match res.err().unwrap() {
        AppError::Validation { code, message } => {
            assert_eq!(code, "ERR_DN_EDIT_005");
            assert!(message.contains("Line ID 999 does not belong"));
        }
        other => panic!("Expected Validation error, got: {:?}", other),
    }
}

#[test]
fn test_lifecycle_status_rules_created_verified_approved() {
    for st in ["Created", "Verified", "Approved"] {
        let (db_state, debit_note_id, _) = setup_debit_note_test_db();
        let state = state_from_db(&db_state);

        {
            let conn_guard = db_state.conn.lock().unwrap();
            let conn = conn_guard.as_ref().unwrap();
            conn.execute(
                "UPDATE customer_debit_notes SET status = ? WHERE id = ?",
                params![st, debit_note_id],
            )
            .unwrap();
        }

        let res = update_customer_debit_note_lines(
            state,
            debit_note_id,
            vec![1, 3],
            None,
            "Auditor".to_string(),
        );
        assert!(res.is_ok(), "Status '{}' must allow editing", st);
    }
}

#[test]
fn test_reject_posted_locked_cancelled() {
    for (st, expected_code) in [
        ("Posted", "ERR_DN_EDIT_002"),
        ("Locked", "ERR_DN_EDIT_002"),
        ("Cancelled", "ERR_DN_EDIT_003"),
    ] {
        let (db_state, debit_note_id, _) = setup_debit_note_test_db();
        let state = state_from_db(&db_state);

        {
            let conn_guard = db_state.conn.lock().unwrap();
            let conn = conn_guard.as_ref().unwrap();
            conn.execute(
                "UPDATE customer_debit_notes SET status = ? WHERE id = ?",
                params![st, debit_note_id],
            )
            .unwrap();
        }

        let res = update_customer_debit_note_lines(
            state,
            debit_note_id,
            vec![1, 3],
            None,
            "Auditor".to_string(),
        );
        assert!(res.is_err(), "Status '{}' must be rejected", st);
        match res.err().unwrap() {
            AppError::Validation { code, .. } => {
                assert_eq!(code, expected_code);
            }
            other => panic!("Expected Validation error, got: {:?}", other),
        }
    }
}

#[test]
fn test_rollback_on_failure_preserves_database() {
    let (db_state, debit_note_id, _) = setup_debit_note_test_db();
    let state = state_from_db(&db_state);

    // Attempt invalid update with non-existent map ID 999
    let res = update_customer_debit_note_lines(
        state.clone(),
        debit_note_id,
        vec![1, 999],
        None,
        "Auditor".to_string(),
    );
    assert!(res.is_err());

    // Verify that database state was fully rolled back and unchanged
    let conn_guard = db_state.conn.lock().unwrap();
    let conn = conn_guard.as_ref().unwrap();

    let active_count: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM customer_debit_note_invoice_map WHERE debit_note_id = 1 AND status != 'Cancelled'",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(active_count, 3, "All 3 lines must remain active after rollback");

    let total_val: i64 = conn
        .query_row(
            "SELECT total_value FROM customer_debit_notes WHERE id = 1",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(total_val, 354000, "Header total must remain 354000 paise");

    let jnl_amt: i64 = conn
        .query_row(
            "SELECT amount FROM customer_debit_note_journal_entries WHERE debit_note_id = 1",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(jnl_amt, 354000, "Journal amount must remain 354000 paise");
}
