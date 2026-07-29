mod test_utils;

use std::sync::Mutex;
use tauri::State;
use tauri_app_lib::state::DbState;
use tauri_app_lib::commands::credit_note_commands::{
    generate_credit_note_record, get_credit_note_details, update_credit_note_record,
};
use tauri_app_lib::models::database_models::{CreditNoteUpdatePayload, CreditNoteItemUpdatePayload};
use test_utils::{setup_test_db, InvoiceBuilder};

#[test]
fn test_command_endpoints_integration() {
    let conn = setup_test_db();
    
    // Seed cancelled invoice
    InvoiceBuilder::new("INV-CMD")
        .with_status("Cancelled")
        .with_item("PART-A", 5.0, 200.0, 18.0)
        .build(&conn);

    let db_state = DbState {
        conn: Mutex::new(Some(conn)),
        dashboard_cache: Mutex::new(None),
    };

    // Use unsafe transmute to bypass Tauri's private State constructor.
    // This allows testing Tauri command handlers directly as pure Rust functions
    // without requiring WebView2 loader DLLs at runtime.
    let state_ref: &DbState = &db_state;
    let state: State<'_, DbState> = unsafe { std::mem::transmute(state_ref) };

    // 1. Generate Credit Note command
    let cn_no = generate_credit_note_record(
        state.clone(),
        "INV-CMD".to_string(),
        "2026-07-29".to_string(),
        Some("Command remark".to_string()),
        Some("Settlement".to_string()),
        "System User".to_string(),
    ).unwrap();

    assert_eq!(cn_no, "CN-INV-CMD");

    // 2. Get Details command
    let details = get_credit_note_details(
        state.clone(),
        cn_no.clone(),
    ).unwrap().expect("Should return details");

    assert_eq!(details.header.status.to_str(), "Draft");
    assert_eq!(details.items.len(), 1);

    // 3. Update command
    let payload = CreditNoteUpdatePayload {
        credit_note_number: cn_no.clone(),
        credit_note_date: "2026-07-29".to_string(),
        remarks: Some("Command update".to_string()),
        reason: Some("Settlement updated".to_string()),
        items: vec![
            CreditNoteItemUpdatePayload {
                invoice_item_id: details.items[0].invoice_item_id,
                quantity: 3.0,
                rate_pre_unit: 200.0,
            }
        ],
        expected_revision_no: 1,
    };

    update_credit_note_record(
        state.clone(),
        payload,
        "System User".to_string(),
    ).unwrap();

    // Verify update
    let updated_details = get_credit_note_details(
        state.clone(),
        cn_no.clone(),
    ).unwrap().expect("Should return details");

    assert_eq!(updated_details.header.revision_no, 2);
    assert_eq!(updated_details.header.remarks, Some("Command update".to_string()));
}
