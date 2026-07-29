use rusqlite::Connection;
use crate::error::AppError;
use crate::models::database_models::{CreditNoteItemRow, CreditNoteStatus, CreditNoteUpdatePayload};
use crate::services::financial_period_service::FinancialPeriodService;

pub struct CreditNoteValidator;

impl CreditNoteValidator {
    pub fn validate_input(payload: &CreditNoteUpdatePayload) -> Result<(), AppError> {
        // Validate credit note date format (YYYY-MM-DD)
        if payload.credit_note_date.len() != 10 {
            return Err(AppError::Validation {
                code: "ERR_VAL_001".to_string(),
                message: "Credit note date must be in YYYY-MM-DD format".to_string(),
            });
        }

        // Validate remarks length
        if let Some(ref r) = payload.remarks {
            if r.len() > 1000 {
                return Err(AppError::Validation {
                    code: "ERR_VAL_001".to_string(),
                    message: "Remarks must be 1000 characters or less".to_string(),
                });
            }
        }

        // Validate reason length
        if let Some(ref r) = payload.reason {
            if r.is_empty() {
                return Err(AppError::Validation {
                    code: "ERR_VAL_001".to_string(),
                    message: "Reason cannot be empty".to_string(),
                });
            }
            if r.len() > 500 {
                return Err(AppError::Validation {
                    code: "ERR_VAL_001".to_string(),
                    message: "Reason must be 500 characters or less".to_string(),
                });
            }
        } else {
            return Err(AppError::Validation {
                code: "ERR_VAL_001".to_string(),
                message: "Reason is required for editing a credit note".to_string(),
            });
        }

        // Validate items non-negative
        for item in &payload.items {
            if item.quantity < 0.0 {
                return Err(AppError::Validation {
                    code: "ERR_VAL_001".to_string(),
                    message: "Quantity cannot be negative".to_string(),
                });
            }
            if item.rate_pre_unit < 0.0 {
                return Err(AppError::Validation {
                    code: "ERR_VAL_001".to_string(),
                    message: "Rate pre unit cannot be negative".to_string(),
                });
            }
        }

        Ok(())
    }

    pub fn validate_transition(
        current_status: CreditNoteStatus,
        target_status: CreditNoteStatus,
    ) -> Result<(), AppError> {
        match (current_status, target_status) {
            (CreditNoteStatus::Draft, CreditNoteStatus::Review) => Ok(()),
            (CreditNoteStatus::Review, CreditNoteStatus::Draft) => Ok(()),
            (CreditNoteStatus::Review, CreditNoteStatus::Approved) => Ok(()),
            (CreditNoteStatus::Approved, CreditNoteStatus::Exported) => Ok(()),
            // Self transitions are allowed for idempotency
            (s1, s2) if s1 == s2 => Ok(()),
            _ => Err(AppError::Validation {
                code: "ERR_VAL_002".to_string(),
                message: format!(
                    "Invalid state transition from {:?} to {:?}",
                    current_status, target_status
                ),
            }),
        }
    }

    pub fn validate_controlled_edit(
        payload: &CreditNoteUpdatePayload,
        existing_items: &[CreditNoteItemRow],
    ) -> Result<(), AppError> {
        for item_payload in &payload.items {
            // Find corresponding item in existing items
            let existing_item = existing_items
                .iter()
                .find(|i| i.invoice_item_id == item_payload.invoice_item_id)
                .ok_or_else(|| AppError::Validation {
                    code: "ERR_VAL_003".to_string(),
                    message: format!(
                        "Invoice item ID {} does not exist in this credit note",
                        item_payload.invoice_item_id
                    ),
                })?;

            // 1. Quantity constraint: 0 <= quantity <= original_quantity
            if item_payload.quantity > existing_item.original_quantity {
                return Err(AppError::Validation {
                    code: "ERR_VAL_003".to_string(),
                    message: format!(
                        "Credited quantity ({}) cannot exceed original invoice quantity ({})",
                        item_payload.quantity, existing_item.original_quantity
                    ),
                });
            }

            // 2. Credited Value constraint: line total must not exceed original invoice line total
            // We calculate assessable value first
            let assessable_value = item_payload.quantity * item_payload.rate_pre_unit;
            
            // Calculate tax amounts
            let cgst_amount = (assessable_value * existing_item.cgst_rate / 100.0).round();
            let sgst_amount = (assessable_value * existing_item.sgst_rate / 100.0).round();
            let igst_amount = (assessable_value * existing_item.igst_rate / 100.0).round();
            let total_line_value = assessable_value + cgst_amount + sgst_amount + igst_amount;

            // Compute original invoice line total value:
            // The original total value can be derived or stored. Here it is stored in existing_item.
            // Wait, existing_item.original_quantity * existing_item.original_rate_pre_unit + taxes
            let orig_assessable = existing_item.original_quantity * existing_item.original_rate_pre_unit;
            let orig_cgst = (orig_assessable * existing_item.cgst_rate / 100.0).round();
            let orig_sgst = (orig_assessable * existing_item.sgst_rate / 100.0).round();
            let orig_igst = (orig_assessable * existing_item.igst_rate / 100.0).round();
            let orig_total_line_value = orig_assessable + orig_cgst + orig_sgst + orig_igst;

            if total_line_value > orig_total_line_value {
                return Err(AppError::Validation {
                    code: "ERR_VAL_003".to_string(),
                    message: format!(
                        "Credited total value ({:.2}) cannot exceed original invoice line total value ({:.2})",
                        total_line_value, orig_total_line_value
                    ),
                });
            }
        }

        Ok(())
    }

    pub fn validate_period_lock(conn: &Connection, date_str: &str) -> Result<(), AppError> {
        let is_locked = FinancialPeriodService::is_period_locked(conn, date_str)?;
        if is_locked {
            return Err(AppError::Validation {
                code: "ERR_VAL_004".to_string(),
                message: format!(
                    "The financial period covering date {} is locked",
                    date_str
                ),
            });
        }
        Ok(())
    }
}
