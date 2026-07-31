use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FilterCriteriaDTO {
    pub search_query: Option<String>,
    pub status_filter: Option<String>,
    pub customer_code: Option<String>,
    pub date_from: Option<String>,
    pub date_to: Option<String>,
    pub min_value: Option<f64>,
    pub max_value: Option<f64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", content = "payload")]
pub enum SelectionModeDTO {
    Direct {
        invoice_numbers: Vec<String>,
    },
    ServerResolved {
        filter: FilterCriteriaDTO,
    },
    ServerResolvedExcept {
        filter: FilterCriteriaDTO,
        excluded_invoice_numbers: Vec<String>,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BulkVerifyRequestDTO {
    pub selection: SelectionModeDTO,
}
