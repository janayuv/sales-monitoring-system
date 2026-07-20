use rusqlite::Connection;
use crate::error::AppError;
use crate::models::database_models::{
    CustomerRow, SupplierRow, ItemRow, FinancialYearRow, InvoiceRow, InvoiceItemRow,
    DebitNoteRow, CreditNoteRow, AppSettingRow, ValidationExceptionRow, AuditLogRow
};
use crate::models::domain_models::InvoiceSummary;

pub mod master_repo;
pub mod invoice_repo;
pub mod note_repo;
pub mod report_repo;

pub trait MasterRepository: Send + Sync {
    // Customers
    fn insert_customer(&self, conn: &mut Connection, row: &CustomerRow) -> Result<(), AppError>;
    fn update_customer(&self, conn: &mut Connection, row: &CustomerRow) -> Result<(), AppError>;
    fn find_customer(&self, conn: &Connection, code: &str) -> Result<Option<CustomerRow>, AppError>;
    fn list_customers(&self, conn: &Connection, status: Option<&str>) -> Result<Vec<CustomerRow>, AppError>;

    // Suppliers
    fn insert_supplier(&self, conn: &mut Connection, row: &SupplierRow) -> Result<(), AppError>;
    fn update_supplier(&self, conn: &mut Connection, row: &SupplierRow) -> Result<(), AppError>;
    fn find_supplier(&self, conn: &Connection, code: &str) -> Result<Option<SupplierRow>, AppError>;
    fn list_suppliers(&self, conn: &Connection, status: Option<&str>) -> Result<Vec<SupplierRow>, AppError>;

    // Items
    fn insert_item(&self, conn: &mut Connection, row: &ItemRow) -> Result<(), AppError>;
    fn update_item(&self, conn: &mut Connection, row: &ItemRow) -> Result<(), AppError>;
    fn find_item(&self, conn: &Connection, code: &str) -> Result<Option<ItemRow>, AppError>;
    fn list_items(&self, conn: &Connection, status: Option<&str>) -> Result<Vec<ItemRow>, AppError>;

    // Financial Years
    fn insert_fy(&self, conn: &mut Connection, row: &FinancialYearRow) -> Result<i64, AppError>;
    fn lock_fy(&self, conn: &mut Connection, id: i64) -> Result<(), AppError>;
    fn get_active_fy(&self, conn: &Connection) -> Result<Option<FinancialYearRow>, AppError>;
}

pub trait InvoiceRepository: Send + Sync {
    // Invoices
    fn insert_invoice(&self, conn: &mut Connection, row: &InvoiceRow) -> Result<(), AppError>;
    fn update_invoice_status(&self, conn: &mut Connection, number: &str, status: &str) -> Result<(), AppError>;
    fn delete_invoice(&self, conn: &mut Connection, number: &str) -> Result<(), AppError>;
    fn find_invoice(&self, conn: &Connection, number: &str) -> Result<Option<InvoiceRow>, AppError>;
    fn list_invoices_paginated(
        &self, 
        conn: &Connection, 
        cursor_date: Option<&str>, 
        cursor_no: Option<&str>, 
        limit: u32
    ) -> Result<Vec<InvoiceSummary>, AppError>;

    // Invoice Items
    fn insert_invoice_items(&self, conn: &mut Connection, items: &[InvoiceItemRow]) -> Result<(), AppError>;
    fn get_invoice_items(&self, conn: &Connection, invoice_number: &str) -> Result<Vec<InvoiceItemRow>, AppError>;
}

pub trait NoteRepository: Send + Sync {
    // Debit Notes
    fn insert_debit_note(&self, conn: &mut Connection, row: &DebitNoteRow) -> Result<(), AppError>;
    fn update_debit_note_status(&self, conn: &mut Connection, number: &str, status: &str) -> Result<(), AppError>;
    fn find_debit_note(&self, conn: &Connection, number: &str) -> Result<Option<DebitNoteRow>, AppError>;

    // Credit Notes
    fn insert_credit_note(&self, conn: &mut Connection, row: &CreditNoteRow) -> Result<(), AppError>;
    fn update_credit_note_status(&self, conn: &mut Connection, number: &str, status: &str) -> Result<(), AppError>;
    fn find_credit_note(&self, conn: &Connection, number: &str) -> Result<Option<CreditNoteRow>, AppError>;
}

pub trait ReportRepository: Send + Sync {
    /// Recomputes summary_monthly_sales for one financial year from `invoices`.
    fn refresh_monthly_summary(&self, conn: &Connection, financial_year_id: i64) -> Result<(), AppError>;
    /// Recomputes summary_customer_sales for one financial year from `invoices`.
    fn refresh_customer_summary(&self, conn: &Connection, financial_year_id: i64) -> Result<(), AppError>;
    /// Recomputes summary_supplier_sales for one financial year from `invoice_items`.
    fn refresh_supplier_summary(&self, conn: &Connection, financial_year_id: i64) -> Result<(), AppError>;
}
