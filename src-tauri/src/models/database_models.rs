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
    pub customer_name: String,
    pub gstin: Option<String>,
    pub state_code: Option<String>,
    pub address: Option<String>,
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
#[ts(export, export_to = "../../src/types/bindings/SupplierPriceRevisionRow.ts")]
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
#[ts(export, export_to = "../../src/types/bindings/ImportTemplateMappingRow.ts")]
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
#[ts(export, export_to = "../../src/types/bindings/ValidationExceptionRow.ts")]
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
