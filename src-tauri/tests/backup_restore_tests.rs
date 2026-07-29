mod test_utils;

use rusqlite::Connection;
use tauri_app_lib::models::database_models::CreditNoteStatus;
use tauri_app_lib::services::credit_note_service::CreditNoteService;
use test_utils::{setup_test_db, InvoiceBuilder};

#[test]
fn test_backup_and_restore_cycle() {
    let mut conn = setup_test_db();
    
    // Seed data
    InvoiceBuilder::new("INV-BACKUP")
        .with_status("Cancelled")
        .with_item("PART-A", 10.0, 100.0, 18.0)
        .build(&conn);

    let cn_no = CreditNoteService::generate_credit_note(
        &conn,
        "INV-BACKUP",
        "2026-07-29",
        Some("Backup remarks".to_string()),
        Some("Reconciliation".to_string()),
        "System User",
    ).unwrap();

    // Verify initial state
    let details_orig = CreditNoteService::get_credit_note_details(&conn, &cn_no).unwrap().unwrap();
    assert_eq!(details_orig.header.status, CreditNoteStatus::Draft);
    assert_eq!(details_orig.items.len(), 1);
    assert_eq!(details_orig.header.remarks, Some("Backup remarks".to_string()));

    // 1. Perform SQLite Online Backup
    let mut backup_db = Connection::open_in_memory().unwrap();
    {
        let backup = rusqlite::backup::Backup::new(&conn, &mut backup_db).unwrap();
        backup.run_to_completion(5, std::time::Duration::from_millis(10), None).unwrap();
    }

    // 2. Corrupt / Mutate active DB (simulating damage or wrong edits)
    conn.execute("DELETE FROM credit_note_items WHERE credit_note_number = ?", [&cn_no]).unwrap();
    conn.execute("UPDATE credit_notes SET status = 'Exported', remarks = 'Corrupted' WHERE credit_note_number = ?", [&cn_no]).unwrap();

    let details_corrupted = CreditNoteService::get_credit_note_details(&conn, &cn_no).unwrap().unwrap();
    assert_eq!(details_corrupted.header.status, CreditNoteStatus::Exported);
    assert_eq!(details_corrupted.items.len(), 0);

    // 3. Restore active DB from Backup DB
    {
        // Re-open/clear active DB connection to ensure lock release, or just run backup restore in reverse
        let backup_restore = rusqlite::backup::Backup::new(&backup_db, &mut conn).unwrap();
        backup_restore.run_to_completion(5, std::time::Duration::from_millis(10), None).unwrap();
    }

    // 4. Assert restored state matches original exactly
    let details_restored = CreditNoteService::get_credit_note_details(&conn, &cn_no).unwrap().unwrap();
    assert_eq!(details_restored.header.status, CreditNoteStatus::Draft);
    assert_eq!(details_restored.items.len(), 1);
    assert_eq!(details_restored.items[0].quantity, 10.0);
    assert_eq!(details_restored.header.remarks, Some("Backup remarks".to_string()));
    assert_eq!(details_restored.header.frozen_customer_name, Some("Acme Customer".to_string()));
}
