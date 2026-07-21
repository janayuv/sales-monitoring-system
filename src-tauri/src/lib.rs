// lib.rs
// Core entry point for the Tauri backend application

pub mod commands;
pub mod config;
pub mod database;
pub mod error;
pub mod models;
pub mod repositories;
pub mod services;
pub mod state;
pub mod utils;

use state::DbState;

#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_log::Builder::default().build())
        .plugin(tauri_plugin_store::Builder::new().build())
        .manage(DbState::new())
        .invoke_handler(tauri::generate_handler![
            greet,
            commands::profile_commands::switch_company_profile,
            commands::profile_commands::close_active_profile,
            commands::import_commands::get_import_templates,
            commands::import_commands::preview_import_file,
            commands::import_commands::commit_import_batch,
            commands::invoice_commands::list_invoices_paginated,
            commands::invoice_commands::get_invoice_details,
            commands::invoice_commands::update_invoice_status,
            commands::invoice_commands::delete_invoice_record,
            commands::invoice_commands::get_record_audit_logs,
            commands::invoice_commands::get_suppliers_list,
            commands::invoice_commands::get_customers_list,
            commands::revision_commands::create_price_revision,
            commands::revision_commands::get_price_revisions,
            commands::revision_commands::preview_revision_recovery,
            commands::revision_commands::generate_debit_note,
            commands::revision_commands::list_debit_notes,
            commands::revision_commands::approve_debit_note,
            commands::revision_commands::auto_generate_credit_note,
            commands::revision_commands::list_credit_notes,
            // Phase 5: Exporters & Report Center
            commands::export_commands::query_tally_export_rows,
            commands::export_commands::export_tally_excel,
            commands::export_commands::export_standard_excel,
            commands::export_commands::export_csv,
            commands::export_commands::export_pdf,
            commands::export_commands::get_monthly_sales_summary,
            commands::export_commands::get_gst_rate_summary,
            commands::export_commands::get_top_customers,
            commands::export_commands::get_top_items,
            commands::export_commands::get_dashboard_metrics,
            // Customer Master & Category Module
            commands::customer_commands::get_customer_master,
            commands::customer_commands::get_customer_categories,
            commands::customer_commands::create_customer_category,
            commands::customer_commands::delete_customer_category,
            commands::customer_commands::create_customer_master,
            commands::customer_commands::update_customer_master,
            commands::customer_commands::bulk_update_customer_mappings,
            // Phase 6: Maintenance & Backup
            commands::maintenance_commands::check_db_integrity,
            commands::maintenance_commands::vacuum_database,
            commands::maintenance_commands::create_db_backup,
            commands::maintenance_commands::get_backup_status,
            commands::maintenance_commands::get_app_setting,
            commands::maintenance_commands::set_app_setting,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
