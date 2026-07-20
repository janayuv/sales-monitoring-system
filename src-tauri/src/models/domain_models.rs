use serde::{Deserialize, Serialize};
use ts_rs::TS;

#[derive(Debug, Serialize, Deserialize, Clone, TS)]
#[ts(export, export_to = "../../src/types/bindings/TallyExportRow.ts")]
pub struct TallyExportRow {
    pub cust_code: String,
    pub cust_name: String,
    pub inv_date: String,
    pub re_type: String,
    pub inv_no: String,
    pub part_code: String,
    pub part_name: String,
    pub tariff: String,
    pub qty: f64,
    pub bas_price: f64,
    pub ass_val: f64,
    pub cgst: f64,
    pub sgst: f64,
    pub igst: f64,
    pub amot: f64,
    pub inv_val: f64,
    pub igst_yes_no: String,
    pub percentage: f64,
}

#[derive(Debug, Serialize, Deserialize, Clone, TS)]
#[ts(export, export_to = "../../src/types/bindings/SupplierRecovery.ts")]
pub struct SupplierRecovery {
    pub supplier_id: i64,
    pub supplier_name: String,
    pub part_code: String,
    pub old_price: f64,
    pub new_price: f64,
    pub effective_date: String,
    pub affected_invoice_count: u32,
    pub total_quantity: f64,
    pub assessable_difference: f64,
    pub tax_difference: f64,
    pub net_recovery_amount: f64,
}

#[derive(Debug, Serialize, Deserialize, Clone, TS)]
#[ts(export, export_to = "../../src/types/bindings/ValidationErrorDetail.ts")]
pub struct ValidationErrorDetail {
    pub row_no: i32,
    pub invoice_no: Option<String>,
    pub field_name: String,
    pub error_type: String,
    pub actual_value: String,
    pub expected_value: String,
}

#[derive(Debug, Serialize, Deserialize, Clone, TS)]
#[ts(export, export_to = "../../src/types/bindings/ValidationWarningDetail.ts")]
pub struct ValidationWarningDetail {
    pub row_no: i32,
    pub invoice_no: Option<String>,
    pub field_name: String,
    pub warning_type: String,
    pub actual_value: String,
    pub expected_value: String,
}

#[derive(Debug, Serialize, Deserialize, Clone, TS)]
#[ts(export, export_to = "../../src/types/bindings/ImportPreview.ts")]
pub struct ImportPreview {
    pub batch_hash: String,
    pub file_name: String,
    pub row_count: u32,
    pub mapped_template_name: String,
    pub errors: Vec<ValidationErrorDetail>,
    pub warnings: Vec<ValidationWarningDetail>,
    pub proposed_inserts: u32,
    pub proposed_updates: u32,
}

#[derive(Debug, Serialize, Deserialize, Clone, TS)]
#[ts(export, export_to = "../../src/types/bindings/GstSummaryBreakdown.ts")]
pub struct GstSummaryBreakdown {
    pub total_taxable: f64,
    pub total_cgst: f64,
    pub total_sgst: f64,
    pub total_igst: f64,
    pub total_gross: f64,
}

#[derive(Debug, Serialize, Deserialize, Clone, TS)]
#[ts(export, export_to = "../../src/types/bindings/DashboardMetrics.ts")]
pub struct DashboardMetrics {
    pub today_sales: f64,
    pub mtd_sales: f64,
    pub ytd_sales: f64,
    pub comparative_growth_percent: f64,
    pub pending_credit_notes_count: u32,
    pub pending_debit_notes_count: u32,
    pub cancelled_invoices_count: u32,
    pub top_10_customers: Vec<(String, f64)>,
    pub top_10_suppliers: Vec<(String, f64)>,
    pub top_20_parts: Vec<(String, f64)>,
    pub gst_payable_summary: GstSummaryBreakdown,
    pub import_errors_count: u32,
    pub recent_activity: Vec<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone, TS)]
#[ts(export, export_to = "../../src/types/bindings/InvoiceSummary.ts")]
pub struct InvoiceSummary {
    pub invoice_number: String,
    pub invoice_date: String,
    pub customer_code: String,
    pub customer_name: String,
    pub total_taxable: f64,
    pub total_tax: f64,
    pub total_value: f64,
    pub status: String,
}
