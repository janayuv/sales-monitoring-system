use serde::{Deserialize, Serialize};
use ts_rs::TS;

#[derive(Debug, Serialize, Deserialize, Clone, TS)]
#[ts(export, export_to = "../../src/types/bindings/StateRow.ts")]
pub struct StateRow {
    pub state_code: String,
    pub state_name: String,
    pub gst_state_id: String,
}

#[derive(Debug, Serialize, Deserialize, Clone, TS)]
#[ts(export, export_to = "../../src/types/bindings/CurrencyRow.ts")]
pub struct CurrencyRow {
    pub currency_code: String,
    pub currency_name: String,
    pub symbol: String,
}

#[derive(Debug, Serialize, Deserialize, Clone, TS)]
#[ts(export, export_to = "../../src/types/bindings/FinancialYearRow.ts")]
pub struct FinancialYearRow {
    pub id: Option<i64>,
    pub label: String,
    pub start_date: String,
    pub end_date: String,
    pub is_active: i32,
    pub is_locked: i32,
    pub closed_at: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone, TS)]
#[ts(export, export_to = "../../src/types/bindings/HsnMasterRow.ts")]
pub struct HsnMasterRow {
    pub hsn_code: String,
    pub description: Option<String>,
    pub gst_rate: f64,
}

#[derive(Debug, Serialize, Deserialize, Clone, TS)]
#[ts(export, export_to = "../../src/types/bindings/UomRow.ts")]
pub struct UomRow {
    pub uom_code: String,
    pub uom_name: String,
}

#[derive(Debug, Serialize, Deserialize, Clone, TS)]
#[ts(export, export_to = "../../src/types/bindings/BankRow.ts")]
pub struct BankRow {
    pub id: Option<i64>,
    pub bank_name: String,
    pub account_no: String,
    pub ifsc_code: String,
    pub branch: String,
}

#[derive(Debug, Serialize, Deserialize, Clone, TS)]
#[ts(export, export_to = "../../src/types/bindings/VoucherSeriesRow.ts")]
pub struct VoucherSeriesRow {
    pub id: Option<i64>,
    pub voucher_type: String,
    pub financial_year_id: i64,
    pub prefix: Option<String>,
    pub suffix: Option<String>,
    pub current_number: i32,
    pub padding_length: i32,
}

#[derive(Debug, Serialize, Deserialize, Clone, TS)]
#[ts(export, export_to = "../../src/types/bindings/SupplierRow.ts")]
pub struct SupplierRow {
    pub id: Option<i64>,
    pub supplier_code: String,
    pub supplier_name: String,
    pub gstin: Option<String>,
    pub state_code: Option<String>,
    pub address: Option<String>,
    pub status: String,
}

#[derive(Debug, Serialize, Deserialize, Clone, TS)]
#[ts(export, export_to = "../../src/types/bindings/CustomerRow.ts")]
pub struct CustomerRow {
    pub id: Option<i64>,
    pub customer_code: String,
    pub report_name: String,
    pub tally_customer_name: Option<String>,
    pub gstin: Option<String>,
    pub state_code: Option<String>,
    pub address1: Option<String>,
    pub status: String,
}

#[derive(Debug, Serialize, Deserialize, Clone, TS)]
#[ts(export, export_to = "../../src/types/bindings/ItemRow.ts")]
pub struct ItemRow {
    pub part_code: String,
    pub part_name: String,
    pub hsn_code: String,
    pub uom_code: String,
    pub default_gst_rate: f64,
    pub supplier_id: Option<i64>,
    pub status: String,
}

#[derive(Debug, Serialize, Deserialize, Clone, TS)]
#[ts(export, export_to = "../../src/types/bindings/ItemPriceHistoryRow.ts")]
pub struct ItemPriceHistoryRow {
    pub id: Option<i64>,
    pub part_code: String,
    pub effective_date: String,
    pub old_price: f64,
    pub new_price: f64,
    pub supplier_id: Option<i64>,
    pub reason: Option<String>,
    pub updated_by: String,
}

#[derive(Debug, Serialize, Deserialize, Clone, TS)]
#[ts(export, export_to = "../../src/types/bindings/ImportBatchRow.ts")]
pub struct ImportBatchRow {
    pub id: Option<i64>,
    pub imported_at: String,
    pub source_type: String,
    pub file_name: String,
    pub file_size_bytes: i64,
    pub excel_version: Option<String>,
    pub template_version_id: Option<i64>,
    pub file_hash: String,
    pub row_count: i32,
    pub success_count: i32,
    pub warning_count: i32,
    pub error_count: i32,
    pub duration_ms: i32,
    pub imported_by: String,
    pub user_remarks: Option<String>,
    pub rollback_reason: Option<String>,
    pub status: String,
}

#[derive(Debug, Serialize, Deserialize, Clone, TS)]
#[ts(export, export_to = "../../src/types/bindings/InvoiceRow.ts")]
pub struct InvoiceRow {
    pub invoice_number: String,
    pub invoice_no_long: Option<String>,
    pub invoice_date: String,
    pub customer_id: i64,
    pub financial_year_id: i64,
    pub total_taxable: f64,
    pub total_cgst: f64,
    pub total_sgst: f64,
    pub total_igst: f64,
    pub total_cess: f64,
    pub total_value: f64,
    pub irn: Option<String>,
    pub irn_date: Option<String>,
    pub place_of_supply: Option<String>,
    pub reverse_charge: Option<String>,
    pub invoice_type: Option<String>,
    pub status: String,
    pub cancellation_date: Option<String>,
    pub import_batch_id: Option<i64>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Serialize, Deserialize, Clone, TS)]
#[ts(export, export_to = "../../src/types/bindings/InvoiceItemRow.ts")]
pub struct InvoiceItemRow {
    pub id: Option<i64>,
    pub invoice_number: String,
    pub part_code: String,
    pub quantity: f64,
    pub rate_pre_unit: f64,
    pub assessable_value: f64,
    pub cgst_rate: f64,
    pub cgst_amount: f64,
    pub sgst_rate: f64,
    pub sgst_amount: f64,
    pub igst_rate: f64,
    pub igst_amount: f64,
    pub total_value: f64,
}

#[derive(Debug, Serialize, Deserialize, Clone, TS)]
#[ts(
    export,
    export_to = "../../src/types/bindings/SupplierPriceRevisionRow.ts"
)]
pub struct SupplierPriceRevisionRow {
    pub id: Option<i64>,
    pub supplier_id: i64,
    pub part_code: String,
    pub old_price: f64,
    pub new_price: f64,
    pub difference: f64,
    pub effective_date: String,
    pub remarks: Option<String>,
    pub status: String,
    pub approved_at: Option<String>,
    pub created_at: String,
}

#[derive(Debug, Serialize, Deserialize, Clone, TS)]
#[ts(export, export_to = "../../src/types/bindings/DebitNoteRow.ts")]
pub struct DebitNoteRow {
    pub debit_note_number: String,
    pub supplier_id: i64,
    pub revision_id: Option<i64>,
    pub debit_note_date: String,
    pub total_taxable: f64,
    pub total_cgst: f64,
    pub total_sgst: f64,
    pub total_igst: f64,
    pub total_value: f64,
    pub status: String,
    pub remarks: Option<String>,
    pub approved_at: Option<String>,
    pub created_at: String,
}

#[derive(Debug, Serialize, Deserialize, Clone, TS)]
#[ts(export, export_to = "../../src/types/bindings/DebitNoteItemRow.ts")]
pub struct DebitNoteItemRow {
    pub id: Option<i64>,
    pub debit_note_number: String,
    pub invoice_number: String,
    pub part_code: String,
    pub quantity: f64,
    pub rate_difference: f64,
    pub assessable_difference: f64,
    pub cgst_amount: f64,
    pub sgst_amount: f64,
    pub igst_amount: f64,
    pub total_difference: f64,
}

#[derive(Debug, Serialize, Deserialize, Clone, TS)]
#[ts(export, export_to = "../../src/types/bindings/CreditNoteRow.ts")]
pub struct CreditNoteRow {
    pub credit_note_number: String,
    pub invoice_number: String,
    pub customer_id: i64,
    pub credit_note_date: String,
    pub total_taxable: f64,
    pub total_cgst: f64,
    pub total_sgst: f64,
    pub total_igst: f64,
    pub total_value: f64,
    pub status: String,
    pub remarks: Option<String>,
    pub approved_at: Option<String>,
    pub created_at: String,
}

#[derive(Debug, Serialize, Deserialize, Clone, TS)]
#[ts(export, export_to = "../../src/types/bindings/ImportTemplateRow.ts")]
pub struct ImportTemplateRow {
    pub id: Option<i64>,
    pub template_name: String,
    pub source_type: String,
    pub is_active: i32,
}

#[derive(Debug, Serialize, Deserialize, Clone, TS)]
#[ts(
    export,
    export_to = "../../src/types/bindings/ImportTemplateMappingRow.ts"
)]
pub struct ImportTemplateMappingRow {
    pub id: Option<i64>,
    pub template_id: i64,
    pub excel_column_header: String,
    pub target_field_key: String,
}

#[derive(Debug, Serialize, Deserialize, Clone, TS)]
#[ts(export, export_to = "../../src/types/bindings/AttachmentRow.ts")]
pub struct AttachmentRow {
    pub id: Option<i64>,
    pub record_type: String,
    pub record_id: String,
    pub file_name: String,
    pub file_path: String,
    pub mime_type: String,
    pub file_size: i64,
    pub uploaded_at: String,
}

#[derive(Debug, Serialize, Deserialize, Clone, TS)]
#[ts(export, export_to = "../../src/types/bindings/SavedFilterRow.ts")]
pub struct SavedFilterRow {
    pub id: Option<i64>,
    pub filter_name: String,
    pub target_screen: String,
    pub filter_json: String,
}

#[derive(Debug, Serialize, Deserialize, Clone, TS)]
#[ts(
    export,
    export_to = "../../src/types/bindings/ValidationExceptionRow.ts"
)]
pub struct ValidationExceptionRow {
    pub id: Option<i64>,
    pub level: String,
    pub batch_id: Option<i64>,
    pub row_no: Option<i32>,
    pub invoice_no: Option<String>,
    pub severity: String,
    pub exception_type: String,
    pub field_name: Option<String>,
    pub expected_value: Option<String>,
    pub actual_value: Option<String>,
    pub resolved: i32,
    pub resolved_comment: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone, TS)]
#[ts(export, export_to = "../../src/types/bindings/AuditLogRow.ts")]
pub struct AuditLogRow {
    pub id: Option<i64>,
    pub timestamp: String,
    pub user_action: String,
    pub table_name: String,
    pub record_id: String,
    pub old_value: Option<String>,
    pub new_value: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone, TS)]
#[ts(export, export_to = "../../src/types/bindings/ApplicationLogRow.ts")]
pub struct ApplicationLogRow {
    pub id: Option<i64>,
    pub timestamp: String,
    pub level: String,
    pub module: String,
    pub message: String,
    pub stack_trace: Option<String>,
    pub user_name: String,
}

#[derive(Debug, Serialize, Deserialize, Clone, TS)]
#[ts(export, export_to = "../../src/types/bindings/AppSettingRow.ts")]
pub struct AppSettingRow {
    pub key: String,
    pub value: String,
}

// --- Customer Price Revision & Debit Notes Module Structs ---

#[derive(Debug, Serialize, Deserialize, Clone, TS)]
#[ts(export, export_to = "../../src/types/bindings/CustomerPriceMasterRow.ts")]
pub struct CustomerPriceMasterRow {
    pub id: Option<i64>,
    pub company_id: i64,
    pub customer_id: i64,
    pub customer_name: Option<String>,
    pub part_number: String,
    pub part_description: Option<String>,
    pub current_price: f64,
    pub effective_date: String,
    pub effective_to: Option<String>,
    pub updated_at: String,
}

#[derive(Debug, Serialize, Deserialize, Clone, TS)]
#[ts(export, export_to = "../../src/types/bindings/CustomerPriceHistoryRow.ts")]
pub struct CustomerPriceHistoryRow {
    pub id: Option<i64>,
    pub company_id: i64,
    pub customer_id: i64,
    pub part_number: String,
    pub old_price: f64,
    pub new_price: f64,
    pub difference: f64,
    pub effective_date: String,
    pub revision_no: Option<String>,
    pub changed_by: String,
    pub changed_at: String,
}

#[derive(Debug, Serialize, Deserialize, Clone, TS)]
#[ts(export, export_to = "../../src/types/bindings/CustomerPriceRevisionRow.ts")]
pub struct CustomerPriceRevisionRow {
    pub id: Option<i64>,
    pub uuid: String,
    pub company_id: i64,
    pub customer_id: i64,
    pub customer_name: Option<String>,
    pub customer_code: Option<String>,
    pub parent_revision_id: Option<i64>,
    pub revision_no: String,
    pub effective_from: String,
    pub customer_reference: Option<String>,
    pub customer_reference_date: Option<String>,
    pub customer_po: Option<String>,
    pub remarks: Option<String>,
    pub status: String,
    pub version: i32,
    pub workflow_version: String,
    pub created_by: String,
    pub created_date: String,
    pub updated_at: String,
}

#[derive(Debug, Serialize, Deserialize, Clone, TS)]
#[ts(export, export_to = "../../src/types/bindings/CustomerPriceRevisionItemRow.ts")]
pub struct CustomerPriceRevisionItemRow {
    pub id: Option<i64>,
    pub revision_id: i64,
    pub part_number: String,
    pub part_description: Option<String>,
    pub old_price: f64,
    pub new_price: f64,
    pub difference: f64,
    pub price_source: String,
    pub remarks: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone, TS)]
#[ts(export, export_to = "../../src/types/bindings/CustomerRevisionDocumentRow.ts")]
pub struct CustomerRevisionDocumentRow {
    pub id: Option<i64>,
    pub revision_id: i64,
    pub document_type: String,
    pub filename: String,
    pub storage_path: String,
    pub document_version: String,
    pub upload_source: String,
    pub file_size: Option<i64>,
    pub mime_type: Option<String>,
    pub sha256_hash: Option<String>,
    pub uploaded_by: String,
    pub uploaded_at: String,
}

#[derive(Debug, Serialize, Deserialize, Clone, TS)]
#[ts(export, export_to = "../../src/types/bindings/CustomerRecoveryCaseRow.ts")]
pub struct CustomerRecoveryCaseRow {
    pub id: Option<i64>,
    pub uuid: String,
    pub company_id: i64,
    pub case_no: String,
    pub customer_id: i64,
    pub customer_name: Option<String>,
    pub revision_id: Option<i64>,
    pub financial_year_id: Option<i64>,
    pub period_from: String,
    pub period_to: String,
    pub plant: Option<String>,
    pub status: String,
    pub version: i32,
    pub created_by: String,
    pub created_at: String,
    pub total_invoices: i64,
    pub total_quantity: f64,
    pub total_parts: i64,
    pub total_customers: i64,
    pub total_recoverable_amount: f64,
    pub recovered_amount: f64,
    pub balance_amount: f64,
}

#[derive(Debug, Serialize, Deserialize, Clone, TS)]
#[ts(export, export_to = "../../src/types/bindings/CustomerDebitNoteRow.ts")]
pub struct CustomerDebitNoteRow {
    pub id: Option<i64>,
    pub uuid: String,
    pub company_id: i64,
    pub case_id: i64,
    pub financial_year_id: i64,
    pub debit_note_no: String,
    pub annexure_no: String,
    pub customer_id: i64,
    pub customer_name: Option<String>,
    pub customer_code: Option<String>,
    pub debit_note_date: String,
    pub reference: Option<String>,
    pub total_taxable: f64,
    pub total_cgst: f64,
    pub total_sgst: f64,
    pub total_igst: f64,
    pub total_cess: f64,
    pub total_value: f64,
    pub round_off: f64,
    pub currency: String,
    pub exchange_rate: f64,
    pub exchange_rate_source: String,
    pub foreign_total_value: f64,
    pub outstanding_amount: f64,
    pub status: String,
    pub financial_status: String,
    pub template_version: String,
    pub version: i32,
    pub idempotency_key: Option<String>,
    pub sent_date: Option<String>,
    pub payment_date: Option<String>,
    pub remarks: Option<String>,
    pub created_by: String,
    pub created_at: String,
    pub approved_by: Option<String>,
    pub approved_at: Option<String>,
    pub cancelled_by: Option<String>,
    pub cancelled_date: Option<String>,
    pub cancel_reason: Option<String>,
    pub frozen_customer_name: String,
    pub frozen_customer_gstin: Option<String>,
    pub frozen_customer_address: Option<String>,
    pub frozen_customer_state: Option<String>,
    pub frozen_customer_country: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone, TS)]
#[ts(export, export_to = "../../src/types/bindings/CustomerDebitNoteInvoiceMapRow.ts")]
pub struct CustomerDebitNoteInvoiceMapRow {
    pub id: Option<i64>,
    pub debit_note_id: i64,
    pub invoice_id: i64,
    pub invoice_number: String,
    pub invoice_date: String,
    pub invoice_item_id: i64,
    pub part_code: String,
    pub quantity: f64,
    pub recovered_qty: f64,
    pub balance_qty: f64,
    pub recovery_percentage: f64,
    pub recovered_value_percentage: f64,
    pub rate_pre_unit: f64,
    pub new_price: f64,
    pub difference: f64,
    pub assessable_difference: f64,
    pub cgst_rate: f64,
    pub cgst_amount: f64,
    pub sgst_rate: f64,
    pub sgst_amount: f64,
    pub igst_rate: f64,
    pub igst_amount: f64,
    pub cess_amount: f64,
    pub hsn_code: String,
    pub gst_type: String,
    pub total_difference: f64,
    pub currency: String,
    pub exchange_rate: f64,
    pub foreign_total_difference: f64,
    pub status: String,
    pub frozen_part_number: String,
    pub frozen_part_description: String,
    pub frozen_part_uom: String,
    pub frozen_part_hsn: String,
    pub frozen_part_drawing_revision: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone, TS)]
#[ts(export, export_to = "../../src/types/bindings/CustomerDebitNoteEventRow.ts")]
pub struct CustomerDebitNoteEventRow {
    pub id: Option<i64>,
    pub debit_note_id: Option<i64>,
    pub case_id: Option<i64>,
    pub revision_id: Option<i64>,
    pub event_severity: String,
    pub event_type: String,
    pub event_details: Option<String>,
    pub event_json: Option<String>,
    pub correlation_id: Option<String>,
    pub request_id: Option<String>,
    pub session_id: Option<String>,
    pub performed_by: String,
    pub timestamp: String,
}

#[derive(Debug, Serialize, Deserialize, Clone, TS)]
#[ts(export, export_to = "../../src/types/bindings/CustomerDebitNoteSimulation.ts")]
pub struct CustomerDebitNoteSimulation {
    pub total_customers: usize,
    pub total_invoices: usize,
    pub total_parts: usize,
    pub total_quantity: f64,
    pub total_taxable: f64,
    pub total_cgst: f64,
    pub total_sgst: f64,
    pub total_igst: f64,
    pub total_cess: f64,
    pub grand_total: f64,
    pub currency: String,
    pub warnings: Vec<String>,
    pub items: Vec<CustomerDebitNoteInvoiceMapRow>,
}

#[derive(Debug, Serialize, Deserialize, Clone, TS)]
#[ts(export, export_to = "../../src/types/bindings/RevisionExcelParseResult.ts")]
pub struct RevisionExcelParseResult {
    pub rows_read: usize,
    pub valid_count: usize,
    pub warning_count: usize,
    pub error_count: usize,
    pub items: Vec<CustomerPriceRevisionItemRow>,
    pub validation_errors: Vec<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone, Copy, PartialEq, Eq, TS)]
#[ts(export, export_to = "../../src/types/bindings/CreditNoteStatus.ts")]
pub enum CreditNoteStatus {
    Draft,
    Review,
    Approved,
    Exported,
}

impl CreditNoteStatus {
    pub fn to_str(&self) -> &'static str {
        match self {
            CreditNoteStatus::Draft => "Draft",
            CreditNoteStatus::Review => "Review",
            CreditNoteStatus::Approved => "Approved",
            CreditNoteStatus::Exported => "Exported",
        }
    }

    pub fn from_str(s: &str) -> Result<Self, String> {
        match s {
            "Draft" => Ok(CreditNoteStatus::Draft),
            "Review" => Ok(CreditNoteStatus::Review),
            "Approved" => Ok(CreditNoteStatus::Approved),
            "Exported" => Ok(CreditNoteStatus::Exported),
            _ => Err(format!("Invalid credit note status: {}", s)),
        }
    }
}

#[derive(Debug, Serialize, Deserialize, Clone, TS)]
#[ts(export, export_to = "../../src/types/bindings/CreditNoteHeader.ts")]
pub struct CreditNoteHeader {
    pub credit_note_number: String,
    pub invoice_number: String,
    pub customer_id: i64,
    pub credit_note_date: String,
    pub status: CreditNoteStatus,
    pub remarks: Option<String>,
    pub reason: Option<String>,
    pub revision_no: i32,
    pub updated_at: String,
    pub created_at: String,
    pub is_deleted: bool,
    pub deleted_by: Option<String>,
    pub deleted_at: Option<String>,
    pub snapshot_version: i32,
    pub frozen_company_name: Option<String>,
    pub frozen_company_gstin: Option<String>,
    pub frozen_company_address: Option<String>,
    pub frozen_company_state: Option<String>,
    pub frozen_company_state_code: Option<String>,
    pub frozen_company_pan: Option<String>,
    pub frozen_company_bank_details: Option<String>,
    pub frozen_customer_name: Option<String>,
    pub frozen_customer_gstin: Option<String>,
    pub frozen_customer_address: Option<String>,
    pub frozen_customer_state: Option<String>,
    pub frozen_customer_pincode: Option<String>,
    pub frozen_customer_pan: Option<String>,
    pub frozen_place_of_supply: Option<String>,
    pub frozen_currency: String,
    pub approved_by: Option<String>,
    pub approved_at: Option<String>,
    pub exported_by: Option<String>,
    pub exported_at: Option<String>,
    pub print_count: i32,
    pub last_printed_at: Option<String>,
    pub last_printed_by: Option<String>,
    pub total_taxable: f64,
    pub total_value: f64,
}

#[derive(Debug, Serialize, Deserialize, Clone, TS)]
#[ts(export, export_to = "../../src/types/bindings/CreditNoteItemRow.ts")]
pub struct CreditNoteItemRow {
    pub id: Option<i64>,
    pub credit_note_number: String,
    pub invoice_item_id: i64,
    pub part_code: String,
    pub quantity: f64,
    pub rate_pre_unit: f64,
    pub assessable_value: f64,
    pub cgst_rate: f64,
    pub cgst_amount: f64,
    pub sgst_rate: f64,
    pub sgst_amount: f64,
    pub igst_rate: f64,
    pub igst_amount: f64,
    pub total_value: f64,
    pub original_quantity: f64,
    pub original_rate_pre_unit: f64,
    pub frozen_unit_of_measure: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone, TS)]
#[ts(export, export_to = "../../src/types/bindings/CreditNoteTaxSummary.ts")]
pub struct CreditNoteTaxSummary {
    pub total_taxable: f64,
    pub total_cgst: f64,
    pub total_sgst: f64,
    pub total_igst: f64,
    pub total_value: f64,
}

#[derive(Debug, Serialize, Deserialize, Clone, TS)]
#[ts(export, export_to = "../../src/types/bindings/CreditNoteCapabilities.ts")]
pub struct CreditNoteCapabilities {
    pub can_edit: bool,
    pub reason_edit_disabled: Option<String>,
    pub can_delete: bool,
    pub reason_delete_disabled: Option<String>,
    pub can_restore: bool,
    pub reason_restore_disabled: Option<String>,
    pub can_submit: bool,
    pub can_approve: bool,
    pub can_print: bool,
}

#[derive(Debug, Serialize, Deserialize, Clone, TS)]
#[ts(export, export_to = "../../src/types/bindings/CreditNoteDetails.ts")]
pub struct CreditNoteDetails {
    pub header: CreditNoteHeader,
    pub tax_summary: CreditNoteTaxSummary,
    pub items: Vec<CreditNoteItemRow>,
    pub audit_timeline: Vec<AuditLogRow>,
    pub capabilities: CreditNoteCapabilities,
}

#[derive(Debug, Serialize, Deserialize, Clone, TS)]
#[ts(export, export_to = "../../src/types/bindings/CreditNoteItemUpdatePayload.ts")]
pub struct CreditNoteItemUpdatePayload {
    pub invoice_item_id: i64,
    pub quantity: f64,
    pub rate_pre_unit: f64,
}

#[derive(Debug, Serialize, Deserialize, Clone, TS)]
#[ts(export, export_to = "../../src/types/bindings/CreditNoteUpdatePayload.ts")]
pub struct CreditNoteUpdatePayload {
    pub credit_note_number: String,
    pub credit_note_date: String,
    pub remarks: Option<String>,
    pub reason: Option<String>,
    pub items: Vec<CreditNoteItemUpdatePayload>,
    pub expected_revision_no: i32,
}

