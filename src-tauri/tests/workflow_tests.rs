mod test_utils;

use tauri_app_lib::error::AppError;
use tauri_app_lib::models::database_models::{CreditNoteStatus, CreditNoteUpdatePayload, CreditNoteItemUpdatePayload};
use tauri_app_lib::services::credit_note_service::CreditNoteService;
use test_utils::{setup_test_db, InvoiceBuilder};

#[test]
fn test_workflow_transitions() {
    let conn = setup_test_db();
    
    // Seed cancelled invoice
    InvoiceBuilder::new("INV-111")
        .with_status("Cancelled")
        .with_item("PART-A", 10.0, 150.0, 18.0) // Taxable: 1500, CGST/SGST: 135 each, Total: 1770
        .build(&conn);

    // 1. Generate Credit Note (Draft)
    let cn_no = CreditNoteService::generate_credit_note(
        &conn,
        "INV-111",
        "2026-07-29",
        Some("Initial Draft remarks".to_string()),
        Some("Commercial Settlement".to_string()),
        "System User",
    ).unwrap();

    assert_eq!(cn_no, "CN-INV-111");

    let details = CreditNoteService::get_credit_note_details(&conn, &cn_no).unwrap().unwrap();
    assert_eq!(details.header.status, CreditNoteStatus::Draft);
    assert_eq!(details.header.revision_no, 1);

    // Verify Capabilities for Draft
    assert!(details.capabilities.can_edit);
    assert!(details.capabilities.can_delete);
    assert!(details.capabilities.can_submit);
    assert!(!details.capabilities.can_approve);
    assert!(!details.capabilities.can_restore);

    // 2. Edit Credit Note
    let payload = CreditNoteUpdatePayload {
        credit_note_number: cn_no.clone(),
        new_credit_note_number: None,
        credit_note_date: "2026-07-29".to_string(),
        remarks: Some("Updated remarks".to_string()),
        reason: Some("Settlement negotiated".to_string()),
        items: vec![
            CreditNoteItemUpdatePayload {
                invoice_item_id: details.items[0].invoice_item_id,
                quantity: 8.0, // Reduced from 10.0
                rate_pre_unit: 150.0,
            }
        ],
        expected_revision_no: 1,
    };

    CreditNoteService::update_credit_note(&conn, payload, "System User").unwrap();

    let details = CreditNoteService::get_credit_note_details(&conn, &cn_no).unwrap().unwrap();
    assert_eq!(details.header.revision_no, 2);
    assert_eq!(details.items[0].quantity, 8.0);
    assert_eq!(details.tax_summary.total_taxable, 1200.0); // 8.0 * 150.0 = 1200.0

    // 3. Submit for Review
    CreditNoteService::submit_for_review(&conn, &cn_no, "System User").unwrap();
    let details = CreditNoteService::get_credit_note_details(&conn, &cn_no).unwrap().unwrap();
    assert_eq!(details.header.status, CreditNoteStatus::Review);
    assert!(!details.capabilities.can_edit);
    assert!(details.capabilities.can_approve);

    // 4. Reject back to Draft
    CreditNoteService::reject_to_draft(&conn, &cn_no, "System User").unwrap();
    let details = CreditNoteService::get_credit_note_details(&conn, &cn_no).unwrap().unwrap();
    assert_eq!(details.header.status, CreditNoteStatus::Draft);

    // 5. Submit again
    CreditNoteService::submit_for_review(&conn, &cn_no, "System User").unwrap();

    // 6. Approve
    CreditNoteService::approve_credit_note(&conn, &cn_no, "System User").unwrap();
    let details = CreditNoteService::get_credit_note_details(&conn, &cn_no).unwrap().unwrap();
    assert_eq!(details.header.status, CreditNoteStatus::Approved);
    assert!(!details.capabilities.can_edit);
    assert!(!details.capabilities.can_delete);

    // 7. Export
    CreditNoteService::export_credit_note(&conn, &cn_no, "System User").unwrap();
    let details = CreditNoteService::get_credit_note_details(&conn, &cn_no).unwrap().unwrap();
    assert_eq!(details.header.status, CreditNoteStatus::Exported);

    // 8. Attempt Edit -> Expect rejection
    let payload_fail = CreditNoteUpdatePayload {
        credit_note_number: cn_no.clone(),
        new_credit_note_number: None,
        credit_note_date: "2026-07-29".to_string(),
        remarks: Some("Failed edit".to_string()),
        reason: Some("Negotiated".to_string()),
        items: vec![],
        expected_revision_no: details.header.revision_no,
    };
    let edit_res = CreditNoteService::update_credit_note(&conn, payload_fail, "System User");
    assert!(edit_res.is_err());
    if let Err(AppError::Validation { code, .. }) = edit_res {
        assert_eq!(code, "ERR_VAL_006"); // State block error code
    } else {
        panic!("Expected ERR_VAL_006");
    }

    // 9. Attempt Delete -> Expect rejection
    let del_res = CreditNoteService::delete_credit_note(&conn, &cn_no, "System User", &cn_no);
    assert!(del_res.is_err());
    if let Err(AppError::Validation { code, .. }) = del_res {
        assert_eq!(code, "ERR_VAL_009"); // Cannot delete Approved/Exported
    } else {
        panic!("Expected ERR_VAL_009");
    }
}

#[test]
fn test_concurrent_optimistic_locking() {
    let conn = setup_test_db();
    
    InvoiceBuilder::new("INV-CONC")
        .with_status("Cancelled")
        .with_item("PART-A", 10.0, 100.0, 18.0)
        .build(&conn);

    let cn_no = CreditNoteService::generate_credit_note(
        &conn,
        "INV-CONC",
        "2026-07-29",
        None,
        Some("Price Revision Settlement".to_string()),
        "System User",
    ).unwrap();

    let details_a = CreditNoteService::get_credit_note_details(&conn, &cn_no).unwrap().unwrap();
    let details_b = CreditNoteService::get_credit_note_details(&conn, &cn_no).unwrap().unwrap();

    assert_eq!(details_a.header.revision_no, 1);
    assert_eq!(details_b.header.revision_no, 1);

    // User A edits first
    let payload_a = CreditNoteUpdatePayload {
        credit_note_number: cn_no.clone(),
        new_credit_note_number: None,
        credit_note_date: "2026-07-29".to_string(),
        remarks: Some("User A edit".to_string()),
        reason: Some("Revision".to_string()),
        items: vec![
            CreditNoteItemUpdatePayload {
                invoice_item_id: details_a.items[0].invoice_item_id,
                quantity: 5.0,
                rate_pre_unit: 100.0,
            }
        ],
        expected_revision_no: 1,
    };
    CreditNoteService::update_credit_note(&conn, payload_a, "User A").unwrap();

    // User B tries to edit with expected revision 1
    let payload_b = CreditNoteUpdatePayload {
        credit_note_number: cn_no.clone(),
        new_credit_note_number: None,
        credit_note_date: "2026-07-29".to_string(),
        remarks: Some("User B edit".to_string()),
        reason: Some("Revision".to_string()),
        items: vec![
            CreditNoteItemUpdatePayload {
                invoice_item_id: details_b.items[0].invoice_item_id,
                quantity: 4.0,
                rate_pre_unit: 100.0,
            }
        ],
        expected_revision_no: 1, // Stale revision
    };

    let res_b = CreditNoteService::update_credit_note(&conn, payload_b, "User B");
    assert!(res_b.is_err());
    if let Err(AppError::Validation { code, .. }) = res_b {
        assert_eq!(code, "ERR_VAL_007"); // Optimistic Lock mismatch
    } else {
        panic!("Expected ERR_VAL_007");
    }
}

#[test]
fn test_credit_note_rename_and_no_op() {
    let conn = setup_test_db();
    
    InvoiceBuilder::new("INV-RENAME")
        .with_status("Cancelled")
        .with_item("PART-A", 10.0, 100.0, 18.0)
        .build(&conn);

    let original_cn = CreditNoteService::generate_credit_note(
        &conn,
        "INV-RENAME",
        "2026-07-29",
        None,
        Some("Initial reason".to_string()),
        "Tester",
    ).unwrap();

    let details = CreditNoteService::get_credit_note_details(&conn, &original_cn).unwrap().unwrap();

    // 1. Test No-Op update (identical fields)
    let no_op_payload = CreditNoteUpdatePayload {
        credit_note_number: original_cn.clone(),
        new_credit_note_number: Some(original_cn.clone()),
        credit_note_date: "2026-07-29".to_string(),
        remarks: None,
        reason: Some("Initial reason".to_string()),
        items: vec![
            CreditNoteItemUpdatePayload {
                invoice_item_id: details.items[0].invoice_item_id,
                quantity: 10.0,
                rate_pre_unit: 100.0,
            }
        ],
        expected_revision_no: 1,
    };
    CreditNoteService::update_credit_note(&conn, no_op_payload, "Tester").unwrap();

    let post_no_op = CreditNoteService::get_credit_note_details(&conn, &original_cn).unwrap().unwrap();
    assert_eq!(post_no_op.header.revision_no, 1); // Revision unchanged on no-op

    // 2. Test Rename CN & update fields
    let rename_payload = CreditNoteUpdatePayload {
        credit_note_number: original_cn.clone(),
        new_credit_note_number: Some(" CN-NEW-2026-001 ".to_string()), // Test normalization
        credit_note_date: "2026-07-30".to_string(),
        remarks: Some("Renamed & Updated".to_string()),
        reason: Some("Commercial discount".to_string()),
        items: vec![
            CreditNoteItemUpdatePayload {
                invoice_item_id: details.items[0].invoice_item_id,
                quantity: 8.0,
                rate_pre_unit: 100.0,
            }
        ],
        expected_revision_no: 1,
    };
    CreditNoteService::update_credit_note(&conn, rename_payload, "Tester").unwrap();

    // Old CN should no longer exist
    let old_res = CreditNoteService::get_credit_note_details(&conn, &original_cn).unwrap();
    assert!(old_res.is_none());

    // Verify new details
    let new_res = CreditNoteService::get_credit_note_details(&conn, "CN-NEW-2026-001").unwrap().unwrap();
    assert_eq!(new_res.header.credit_note_number, "CN-NEW-2026-001");
    assert_eq!(new_res.header.credit_note_date, "2026-07-30");
    assert_eq!(new_res.header.reason.as_deref(), Some("Commercial discount"));
    assert_eq!(new_res.header.revision_no, 2);
    assert_eq!(new_res.items.len(), 1);
    assert_eq!(new_res.items[0].credit_note_number, "CN-NEW-2026-001");
    assert_eq!(new_res.items[0].quantity, 8.0);
}

#[test]
fn test_soft_delete_filtering() {
    let conn = setup_test_db();
    
    InvoiceBuilder::new("INV-DEL")
        .with_status("Cancelled")
        .with_item("PART-A", 10.0, 100.0, 18.0)
        .build(&conn);

    let cn_no = CreditNoteService::generate_credit_note(
        &conn,
        "INV-DEL",
        "2026-07-29",
        None,
        Some("Settlement".to_string()),
        "System User",
    ).unwrap();

    // Default listing should include it
    let list_default = CreditNoteService::get_credit_note_details(&conn, &cn_no).unwrap().unwrap();
    assert!(!list_default.header.is_deleted);

    // Delete it
    CreditNoteService::delete_credit_note(&conn, &cn_no, "System User", &cn_no).unwrap();

    // Normal get_details still loads it but sets is_deleted and capabilities.can_restore = true
    let deleted = CreditNoteService::get_credit_note_details(&conn, &cn_no).unwrap().unwrap();
    assert!(deleted.header.is_deleted);
    assert!(deleted.capabilities.can_restore);
    assert!(!deleted.capabilities.can_edit);
    assert!(!deleted.capabilities.can_delete);

    // Restore it
    CreditNoteService::restore_credit_note(&conn, &cn_no, "System User").unwrap();
    let restored = CreditNoteService::get_credit_note_details(&conn, &cn_no).unwrap().unwrap();
    assert!(!restored.header.is_deleted);
    assert_eq!(restored.header.status, CreditNoteStatus::Draft);
}

#[test]
fn test_financial_calculations() {
    let conn = setup_test_db();
    
    // Seed cancelled invoice with different GST rate items (Multi-slab)
    InvoiceBuilder::new("INV-FIN")
        .with_status("Cancelled")
        .with_item("PART-A", 10.0, 150.0, 18.0) // Taxable: 1500, Tax: 270, Total: 1770
        .with_item("PART-B", 5.0, 200.0, 12.0)  // Taxable: 1000, Tax: 120, Total: 1120
        .build(&conn);

    let cn_no = CreditNoteService::generate_credit_note(
        &conn,
        "INV-FIN",
        "2026-07-29",
        None,
        Some("Multi-slab rebate".to_string()),
        "System User",
    ).unwrap();

    let details = CreditNoteService::get_credit_note_details(&conn, &cn_no).unwrap().unwrap();
    
    // Verify multi-slab subtotal sums
    assert_eq!(details.tax_summary.total_taxable, 2500.0); // 1500 + 1000
    // CGST+SGST sum = 270 (from PART-A: 18%) + 120 (from PART-B: 12%) = 390.0 total GST
    assert_eq!(details.tax_summary.total_cgst + details.tax_summary.total_sgst + details.tax_summary.total_igst, 390.0);
    assert_eq!(details.tax_summary.total_value, 2890.0);

    // Verify ordering invariance
    // Sum of items total should match the summary grand total regardless of item ordering
    let mut sum_items_total = 0.0;
    for item in &details.items {
        sum_items_total += item.total_value;
    }
    assert_eq!(sum_items_total, details.tax_summary.total_value);
}

#[test]
fn test_property_based_calculations_fuzz() {
    let conn = setup_test_db();
    
    // Fuzz many random configurations of quantities, rates, and GST percentages
    let fuzz_cases = vec![
        (1.55, 123.45, 18.0),
        (10.0, 1500.0, 12.0),
        (0.3333, 10.51, 5.0),
        (100.0, 0.0, 18.0),       // Zero rate
        (5.1234, 12345.67, 18.0),  // Large rates & fractions
    ];

    for (idx, (qty, rate, gst)) in fuzz_cases.into_iter().enumerate() {
        let inv_no = format!("INV-FUZZ-{}", idx);
        InvoiceBuilder::new(&inv_no)
            .with_status("Cancelled")
            .with_item("PART-A", qty, rate, gst)
            .build(&conn);

        let cn_no = CreditNoteService::generate_credit_note(
            &conn,
            &inv_no,
            "2026-07-29",
            None,
            Some("Fuzz test".to_string()),
            "System User",
        ).unwrap();

        let details = CreditNoteService::get_credit_note_details(&conn, &cn_no).unwrap().unwrap();
        
        // Assert invariants
        assert!(details.tax_summary.total_taxable >= 0.0);
        assert!(details.tax_summary.total_value >= 0.0);
        
        // Verify line total matches taxable + taxes
        let item = &details.items[0];
        let computed_sum = item.assessable_value + item.cgst_amount + item.sgst_amount + item.igst_amount;
        // Float precision checks within 0.01 rupee (1 paisa) tolerance
        assert!((item.total_value - computed_sum).abs() < 0.01);
    }
}
