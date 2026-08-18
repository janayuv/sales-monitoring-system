use serde::{Deserialize, Serialize};
use ts_rs::TS;
use crate::reports::common::ReportFilterCommon;

#[derive(Debug, Clone, Serialize, Deserialize, Default, TS)]
#[ts(export, export_to = "../../src/types/bindings/HsnReportFilter.ts")]
pub struct HsnReportFilter {
    #[serde(flatten)]
    pub common: ReportFilterCommon,
    pub hsn_codes: Option<Vec<String>>,
    pub show_empty_hsn: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../src/types/bindings/HsnSalesRow.ts")]
pub struct HsnSalesRow {
    pub hsn_code: String,
    pub description: Option<String>,
    pub uom_code: Option<String>,
    pub gst_rate: f64,
    pub total_quantity: f64,
    pub item_count: i64,
    pub customer_count: i64,
    pub invoice_count: i64,
    pub total_taxable: f64,
    pub total_cgst: f64,
    pub total_sgst: f64,
    pub total_igst: f64,
    pub total_tax: f64,
    pub total_value: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../src/types/bindings/HsnItemBreakdownRow.ts")]
pub struct HsnItemBreakdownRow {
    pub hsn_code: String,
    pub part_code: String,
    pub part_name: String,
    pub uom_code: String,
    pub default_gst_rate: f64,
    pub total_quantity: f64,
    pub avg_rate: f64,
    pub customer_count: i64,
    pub invoice_count: i64,
    pub total_taxable: f64,
    pub total_cgst: f64,
    pub total_sgst: f64,
    pub total_igst: f64,
    pub total_tax: f64,
    pub total_value: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../src/types/bindings/HsnInvoiceBreakdownRow.ts")]
pub struct HsnInvoiceBreakdownRow {
    pub invoice_number: String,
    pub invoice_date: String,
    pub customer_code: String,
    pub customer_name: String,
    pub part_code: String,
    pub part_name: String,
    pub quantity: f64,
    pub uom_code: String,
    pub rate_pre_unit: f64,
    pub assessable_value: f64,
    pub cgst_rate: f64,
    pub cgst_amount: f64,
    pub sgst_rate: f64,
    pub sgst_amount: f64,
    pub igst_rate: f64,
    pub igst_amount: f64,
    pub total_value: f64,
    pub status: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default, TS)]
#[ts(export, export_to = "../../src/types/bindings/HsnGrandTotals.ts")]
pub struct HsnGrandTotals {
    pub total_hsn_codes: u32,
    pub total_items: i64,
    pub total_customers: i64,
    pub total_invoices: i64,
    pub total_quantity: f64,
    pub total_taxable: f64,
    pub total_cgst: f64,
    pub total_sgst: f64,
    pub total_igst: f64,
    pub total_tax: f64,
    pub grand_total_value: f64,
    pub top_hsn_code: String,
    pub top_hsn_description: String,
    pub top_hsn_share: f64,
}
