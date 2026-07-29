mod test_utils;

use tauri_app_lib::services::credit_note_service::CreditNoteService;
use test_utils::{setup_test_db, InvoiceBuilder};

#[test]
fn test_audit_integrity_and_idempotency() {
    let conn = setup_test_db();
    
    InvoiceBuilder::new("INV-AUDIT")
        .with_status("Cancelled")
        .with_item("PART-A", 1.0, 100.0, 18.0)
        .build(&conn);

    // 1. Generate: assert audit count is 1
    let cn_no = CreditNoteService::generate_credit_note(
        &conn,
        "INV-AUDIT",
        "2026-07-29",
        None,
        Some("Audit check".to_string()),
        "System User",
    ).unwrap();

    let count: i64 = conn.query_row(
        "SELECT COUNT(*) FROM audit_log WHERE record_id = ? AND user_action LIKE 'Credit Note generated%'",
        [&cn_no],
        |r| r.get(0),
    ).unwrap();
    assert_eq!(count, 1);

    // 2. Submit: assert submit audit exists
    CreditNoteService::submit_for_review(&conn, &cn_no, "System User").unwrap();
    let count: i64 = conn.query_row(
        "SELECT COUNT(*) FROM audit_log WHERE record_id = ? AND user_action LIKE 'Submitted for Review%'",
        [&cn_no],
        |r| r.get(0),
    ).unwrap();
    assert_eq!(count, 1);

    // Idempotent Submit: call again
    CreditNoteService::submit_for_review(&conn, &cn_no, "System User").unwrap();
    let count_after: i64 = conn.query_row(
        "SELECT COUNT(*) FROM audit_log WHERE record_id = ? AND user_action LIKE 'Submitted for Review%'",
        [&cn_no],
        |r| r.get(0),
    ).unwrap();
    assert_eq!(count_after, 1); // Remains 1, no duplicate written!

    // 3. Approve: assert approve audit exists
    CreditNoteService::approve_credit_note(&conn, &cn_no, "System User").unwrap();
    let count: i64 = conn.query_row(
        "SELECT COUNT(*) FROM audit_log WHERE record_id = ? AND user_action LIKE 'Approved by%'",
        [&cn_no],
        |r| r.get(0),
    ).unwrap();
    assert_eq!(count, 1);

    // Idempotent Approve
    CreditNoteService::approve_credit_note(&conn, &cn_no, "System User").unwrap();
    let count_after: i64 = conn.query_row(
        "SELECT COUNT(*) FROM audit_log WHERE record_id = ? AND user_action LIKE 'Approved by%'",
        [&cn_no],
        |r| r.get(0),
    ).unwrap();
    assert_eq!(count_after, 1); // Remains 1, no duplicate written!
}
