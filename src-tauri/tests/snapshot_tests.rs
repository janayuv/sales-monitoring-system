mod test_utils;

use tauri_app_lib::models::database_models::CreditNoteStatus;
use tauri_app_lib::services::credit_note_service::CreditNoteService;
use test_utils::{setup_test_db, InvoiceBuilder};

#[test]
fn test_snapshot_immutability() {
    let conn = setup_test_db();
    
    InvoiceBuilder::new("INV-SNAP")
        .with_status("Cancelled")
        .with_item("PART-A", 10.0, 100.0, 18.0)
        .build(&conn);

    let cn_no = CreditNoteService::generate_credit_note(
        &conn,
        "INV-SNAP",
        "2026-07-29",
        None,
        Some("Rebate".to_string()),
        "System User",
    ).unwrap();

    let details = CreditNoteService::get_credit_note_details(&conn, &cn_no).unwrap().unwrap();
    
    // Assert initial snapshot matches seeder
    assert_eq!(details.header.frozen_company_name, Some("Test Company Ltd".to_string()));
    assert_eq!(details.header.frozen_customer_name, Some("Acme Customer".to_string()));
    assert_eq!(details.header.frozen_customer_gstin, Some("29AABCU1234A1Z2".to_string()));

    // Submit and Approve to lock it
    CreditNoteService::submit_for_review(&conn, &cn_no, "System User").unwrap();
    CreditNoteService::approve_credit_note(&conn, &cn_no, "System User").unwrap();

    // Now, update Company Profile and Customer Master in active tables
    conn.execute(
        "UPDATE company_profile SET company_name = 'Completely New Company Name', gstin = '33NEWGST1234A1Z' WHERE id = 1",
        [],
    ).unwrap();

    conn.execute(
        "UPDATE customers SET report_name = 'Different Customer Legal Name', gstin = '33DEFCUST1234' WHERE id = 101",
        [],
    ).unwrap();

    // Re-load credit note details and verify the snapshots are unchanged
    let details_after = CreditNoteService::get_credit_note_details(&conn, &cn_no).unwrap().unwrap();
    assert_eq!(details_after.header.status, CreditNoteStatus::Approved);
    assert_eq!(details_after.header.frozen_company_name, Some("Test Company Ltd".to_string()));
    assert_eq!(details_after.header.frozen_customer_name, Some("Acme Customer".to_string()));
    assert_eq!(details_after.header.frozen_customer_gstin, Some("29AABCU1234A1Z2".to_string()));
}
