use serde::{Deserialize, Serialize};
use ts_rs::TS;
use rusqlite::Connection;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, TS)]
#[ts(export, export_to = "../../src/types/bindings/InvoiceStatus.ts")]
pub enum InvoiceStatus {
    Draft,
    Imported,
    Verified,
    Posted,
    Cancelled,
    CreditNoteGenerated,
    DebitNoteGenerated,
    Closed,
}

#[derive(Debug, thiserror::Error)]
pub enum ReportError {
    #[error("Database error: {0}")]
    Db(String),
    #[error("Validation error: {0}")]
    Validation(String),
    #[error("Internal error: {0}")]
    Internal(String),
}

impl From<rusqlite::Error> for ReportError {
    fn from(err: rusqlite::Error) -> Self {
        ReportError::Db(err.to_string())
    }
}

pub struct ReportContext<'a> {
    pub conn: &'a Connection,
    pub generated_at: String,
    pub user_name: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../src/types/bindings/ReportCapabilities.ts")]
pub struct ReportCapabilities {
    pub export_excel: bool,
    pub export_csv: bool,
    pub print: bool,
    pub clipboard: bool,
    pub charts: bool,
    pub drilldown: bool,
}

impl Default for ReportCapabilities {
    fn default() -> Self {
        Self {
            export_excel: true,
            export_csv: true,
            print: true,
            clipboard: true,
            charts: true,
            drilldown: true,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../src/types/bindings/ReportDefinition.ts")]
pub struct ReportDefinition {
    pub id: String,
    pub name: String,
    pub version: u32,
    pub default_page_size: u32,
    pub capabilities: ReportCapabilities,
    pub default_sort: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default, TS)]
#[ts(export, export_to = "../../src/types/bindings/ReportFilterCommon.ts")]
pub struct ReportFilterCommon {
    pub date_from: Option<String>,
    pub date_to: Option<String>,
    pub financial_year_id: Option<i64>,
    pub invoice_statuses: Option<Vec<String>>,
    pub include_cancelled: Option<bool>,
    pub search_term: Option<String>,
    pub page: Option<u32>,
    pub page_size: Option<u32>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../src/types/bindings/ReportMetadata.ts")]
pub struct ReportMetadata {
    pub report_name: String,
    pub report_version: u32,
    pub generated_at: String,
    pub execution_time_ms: u64,
    pub filter_hash: String,
    pub total_records: u32,
    pub total_pages: u32,
    pub page: u32,
    pub page_size: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../src/types/bindings/ReportResult.ts")]
pub struct ReportResult<R, G, F> {
    pub metadata: ReportMetadata,
    pub filter: F,
    pub grand_totals: G,
    pub rows: Vec<R>,
}
