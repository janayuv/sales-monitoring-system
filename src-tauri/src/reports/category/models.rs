use serde::{Deserialize, Serialize};
use ts_rs::TS;
use crate::reports::common::ReportFilterCommon;

#[derive(Debug, Clone, Serialize, Deserialize, Default, TS)]
#[ts(export, export_to = "../../src/types/bindings/CategoryReportFilter.ts")]
pub struct CategoryReportFilter {
    #[serde(flatten)]
    pub common: ReportFilterCommon,
    pub category_ids: Option<Vec<i64>>,
    pub show_empty_categories: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../src/types/bindings/CategorySalesRow.ts")]
pub struct CategorySalesRow {
    pub category_id: Option<i64>,
    pub category_name: String,
    pub customer_count: i64,
    pub invoice_count: i64,
    pub total_taxable: f64,
    pub total_cgst: f64,
    pub total_sgst: f64,
    pub total_igst: f64,
    pub total_value: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../src/types/bindings/CategoryCustomerBreakdownRow.ts")]
pub struct CategoryCustomerBreakdownRow {
    pub customer_id: Option<i64>,
    pub customer_code: String,
    pub report_name: String,
    pub invoice_count: i64,
    pub last_invoice_date: Option<String>,
    pub total_taxable: f64,
    pub total_gst: f64,
    pub total_value: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default, TS)]
#[ts(export, export_to = "../../src/types/bindings/CategoryGrandTotals.ts")]
pub struct CategoryGrandTotals {
    pub total_categories: u32,
    pub total_customers: i64,
    pub total_invoices: i64,
    pub total_taxable: f64,
    pub total_cgst: f64,
    pub total_sgst: f64,
    pub total_igst: f64,
    pub grand_total_value: f64,
    pub largest_category_name: String,
    pub largest_category_share: f64,
}
