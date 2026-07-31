use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum InvoiceStatus {
    Draft,
    Imported,
    Verified,
    Cancelled,
    CreditNoteGenerated,
}

impl InvoiceStatus {
    pub fn as_db_value(&self) -> &'static str {
        match self {
            InvoiceStatus::Draft => "Draft",
            InvoiceStatus::Imported => "Imported",
            InvoiceStatus::Verified => "Verified",
            InvoiceStatus::Cancelled => "Cancelled",
            InvoiceStatus::CreditNoteGenerated => "Credit Note Generated",
        }
    }

    pub fn from_db_value(s: &str) -> Option<Self> {
        match s {
            "Draft" => Some(InvoiceStatus::Draft),
            "Imported" => Some(InvoiceStatus::Imported),
            "Verified" => Some(InvoiceStatus::Verified),
            "Cancelled" => Some(InvoiceStatus::Cancelled),
            "Credit Note Generated" => Some(InvoiceStatus::CreditNoteGenerated),
            _ => None,
        }
    }

    pub fn can_transition_to_verified(&self) -> bool {
        matches!(self, InvoiceStatus::Imported | InvoiceStatus::Draft)
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum SkipReason {
    AlreadyVerified,
    InvalidTransition,
    ProtectedStatus,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum FailReason {
    FinancialYearLocked,
    PermissionDenied,
    DatabaseLocked,
    ValidationFailed,
    UnexpectedError,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SkippedInvoiceInfo {
    pub invoice_number: String,
    pub reason: SkipReason,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FailedInvoiceInfo {
    pub invoice_number: String,
    pub reason: FailReason,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BulkActionResult {
    pub batch_id: String,
    pub updated: usize,
    pub skipped: usize,
    pub failed: usize,
    pub skipped_invoices: Vec<SkippedInvoiceInfo>,
    pub failed_invoices: Vec<FailedInvoiceInfo>,
    pub execution_time_ms: u128,
    pub db_time_ms: u128,
    pub audit_time_ms: u128,
    pub cache_time_ms: u128,
}
