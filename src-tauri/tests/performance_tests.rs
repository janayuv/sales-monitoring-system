mod test_utils;

use rusqlite::Connection;
use std::time::Instant;
use tauri_app_lib::services::credit_note_service::CreditNoteService;
use tauri_app_lib::repositories::CreditNoteRepository;

#[test]
fn test_performance_scale_benchmarks() {
    // 1. Setup path to a temporary database file to measure file size
    let db_path = "temp_bench.db";
    let _ = std::fs::remove_file(db_path);

    let mut conn = Connection::open(db_path).unwrap();
    tauri_app_lib::database::migrate::run_migrations(&mut conn).unwrap();

    // Seed master data using shared seed utility
    test_utils::seed_db(&conn);

    println!("Seeding high-volume dataset: 10,000 Invoices, 2,000 Credit Notes, 50,000 items...");
    
    // Seed within a single transaction for speed
    let tx = conn.transaction().unwrap();
    
    for i in 1..=10000 {
        let inv_no = format!("INV-{:05}", i);
        let status = if i % 5 == 0 { "Cancelled" } else { "Posted" };
        
        tx.execute(
            "INSERT INTO invoices (invoice_number, customer_id, invoice_date, status, place_of_supply, financial_year_id, total_taxable, total_cgst, total_sgst, total_igst, total_value)
             VALUES (?, 101, '2026-07-29', ?, '29', 2, 1000.0, 90.0, 90.0, 0.0, 1180.0)",
            rusqlite::params![inv_no, status],
        ).unwrap();

        // 5 items per invoice = 50,000 line items total
        for j in 1..=5 {
            tx.execute(
                "INSERT INTO invoice_items (invoice_number, part_code, quantity, rate_pre_unit, assessable_value, cgst_rate, cgst_amount, sgst_rate, sgst_amount, igst_rate, igst_amount, total_value)
                 VALUES (?, 'PART-A', 1.0, 200.0, 200.0, 9.0, 18.0, 9.0, 18.0, 0.0, 0.0, 236.0)",
                rusqlite::params![inv_no],
            ).unwrap();
        }
    }

    // Seed 2,000 Credit Notes
    for i in 1..=2000 {
        // Only cancelling invoices (index divisble by 5) can have credit notes
        let inv_idx = i * 5;
        let inv_no = format!("INV-{:05}", inv_idx);
        let cn_no = format!("CN-{:05}", i);

        tx.execute(
            "INSERT INTO credit_notes (credit_note_number, invoice_number, customer_id, credit_note_date, status, remarks, reason, revision_no, updated_at, created_at, is_deleted)
             VALUES (?, ?, 101, '2026-07-29', 'Draft', 'Remarks', 'Reason', 1, '2026-07-29 12:00:00', '2026-07-29 12:00:00', 0)",
            rusqlite::params![cn_no, inv_no],
        ).unwrap();

        // Seed credit note items
        tx.execute(
            "INSERT INTO credit_note_items (credit_note_number, invoice_item_id, part_code, quantity, rate_pre_unit, assessable_value, cgst_rate, cgst_amount, sgst_rate, sgst_amount, igst_rate, igst_amount, total_value, original_quantity, original_rate_pre_unit)
             VALUES (?, 1, 'PART-A', 1.0, 20000, 20000, 9.0, 1800, 9.0, 1800, 0.0, 0, 23600, 1.0, 20000)",
            rusqlite::params![cn_no],
        ).unwrap();
    }

    tx.commit().unwrap();
    println!("Database seeding completed!");

    // Measure listing query
    let start_list = Instant::now();
    let list = CreditNoteService::get_credit_note_details(&conn, "CN-00001").unwrap().unwrap();
    let duration_detail = start_list.elapsed();

    // Verify detail loaded
    assert_eq!(list.header.credit_note_number, "CN-00001");

    // Measure listing query under scale
    let start_all = Instant::now();
    // Fetch count of all credit notes in repository
    let repo = tauri_app_lib::repositories::credit_note_repository::SqliteCreditNoteRepository;
    let all_notes = repo.list_credit_notes(&conn, false).unwrap();
    let duration_list = start_all.elapsed();

    assert_eq!(all_notes.len(), 2000);

    let db_size = std::fs::metadata(db_path).map(|m| m.len()).unwrap_or(0);
    
    // Save results to benchmark JSON log
    let build_profile = if cfg!(debug_assertions) { "debug" } else { "release" };
    let json_output = serde_json::json!({
        "metadata": {
            "build_profile": build_profile,
            "invoices_count": 10000,
            "credit_notes_count": 2000,
            "line_items_count": 50000,
            "db_size_bytes": db_size,
        },
        "timings": {
            "load_single_detail_ms": duration_detail.as_millis(),
            "list_all_notes_ms": duration_list.as_millis(),
        }
    });

    let _ = std::fs::create_dir_all("target");
    std::fs::write("target/benchmarks.json", serde_json::to_string_pretty(&json_output).unwrap()).unwrap();

    println!("--------------------------------------------------");
    println!("SCALE PERFORMANCE BENCHMARKS RESULTS:");
    println!("- DB Size: {:.2} MB", db_size as f64 / 1024.0 / 1024.0);
    println!("- Load Single CN Detail: {} ms", duration_detail.as_millis());
    println!("- List All 2,000 CNs: {} ms", duration_list.as_millis());
    println!("- Results logged to target/benchmarks.json");
    println!("--------------------------------------------------");

    // Cleanup temp db
    let _ = std::fs::remove_file(db_path);
}
