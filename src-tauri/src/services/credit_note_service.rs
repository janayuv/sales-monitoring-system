use rusqlite::{params, Connection, OptionalExtension};
use crate::error::AppError;
use crate::models::database_models::{
    CreditNoteHeader, CreditNoteItemRow, CreditNoteStatus, CreditNoteTaxSummary,
    CreditNoteDetails, CreditNoteCapabilities, CreditNoteUpdatePayload,
};
use crate::repositories::credit_note_repository::SqliteCreditNoteRepository;
use crate::repositories::CreditNoteRepository;
use crate::services::financial_period_service::FinancialPeriodService;
use crate::services::credit_note_validator::CreditNoteValidator;

pub struct CreditNoteService;

impl CreditNoteService {
    pub fn generate_credit_note(
        conn: &Connection,
        invoice_number: &str,
        date: &str,
        remarks: Option<String>,
        reason: Option<String>,
        user: &str,
    ) -> Result<String, AppError> {
        // 1. Period check
        CreditNoteValidator::validate_period_lock(conn, date)?;

        // 2. Load Invoice
        let invoice_row: (i64, Option<String>, i64, f64, String) = conn.query_row(
            "SELECT customer_id, place_of_supply, financial_year_id, total_value, status FROM invoices WHERE invoice_number = ?",
            [invoice_number],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?, row.get(4)?)),
        )
        .map_err(|e| AppError::Db {
            code: "ERR_DB_003".to_string(),
            message: format!("Invoice {} not found: {}", invoice_number, e),
        })?;

        let (customer_id, place_of_supply, _financial_year_id, _total_val, invoice_status) = invoice_row;

        // Verify status is Cancelled
        if invoice_status != "Cancelled" {
            return Err(AppError::Validation {
                code: "ERR_VAL_005".to_string(),
                message: format!(
                    "Credit Note can only be generated for Cancelled invoices (current status: {})",
                    invoice_status
                ),
            });
        }

        // Verify no existing credit note references this invoice
        let existing_cn_count: i64 = conn.query_row(
            "SELECT COUNT(*) FROM credit_notes WHERE invoice_number = ? AND is_deleted = 0",
            [invoice_number],
            |row| row.get(0),
        ).unwrap_or(0);

        if existing_cn_count > 0 {
            return Err(AppError::Validation {
                code: "ERR_VAL_005".to_string(),
                message: format!(
                    "A Credit Note already exists for Invoice {}",
                    invoice_number
                ),
            });
        }

        let credit_note_number = format!("CN-{}", invoice_number);

        // 3. Load Customer Details for snapshot
        let cust_row: (String, Option<String>, String, Option<String>, Option<String>) = conn.query_row(
            "SELECT report_name, gstin, COALESCE(address1, '') || ' ' || COALESCE(address2, '') || ' ' || COALESCE(location, ''), state_code, pincode FROM customers WHERE id = ?",
            [customer_id],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?, row.get(4)?)),
        ).unwrap_or_else(|_| ("Unknown".to_string(), None, "".to_string(), None, None));

        let (cust_name, cust_gstin, cust_addr, cust_state, cust_pin) = cust_row;
        let cust_pan = extract_pan(&cust_gstin);

        // 4. Load Company Profile details for snapshot
        let comp_row: (Option<String>, Option<String>, String, Option<String>, Option<String>, Option<String>) = conn.query_row(
            "SELECT company_name, gstin, COALESCE(address1, '') || ' ' || COALESCE(address2, '') || ' ' || COALESCE(location, ''), state_code, pan, email FROM company_profile WHERE id = 1",
            [],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?, row.get(4)?, row.get(5)?)),
        ).unwrap_or_else(|_| (None, None, "".to_string(), None, None, None));

        let (comp_name, comp_gstin, comp_addr, comp_state_code, comp_pan, comp_bank) = comp_row;

        // 5. Create Credit Note Header
        let header = CreditNoteHeader {
            credit_note_number: credit_note_number.clone(),
            invoice_number: invoice_number.to_string(),
            customer_id,
            credit_note_date: date.to_string(),
            status: CreditNoteStatus::Draft,
            remarks: remarks.clone(),
            reason: reason.clone(),
            revision_no: 1,
            updated_at: chrono::Local::now().format("%Y-%m-%d %H:%M:%S").to_string(),
            created_at: chrono::Local::now().format("%Y-%m-%d %H:%M:%S").to_string(),
            is_deleted: false,
            deleted_by: None,
            deleted_at: None,
            snapshot_version: 1,
            
            frozen_company_name: comp_name,
            frozen_company_gstin: comp_gstin,
            frozen_company_address: Some(comp_addr),
            frozen_company_state: None, // Will fill if lookup state is implemented, leaving Option
            frozen_company_state_code: comp_state_code,
            frozen_company_pan: comp_pan,
            frozen_company_bank_details: comp_bank,

            frozen_customer_name: Some(cust_name),
            frozen_customer_gstin: cust_gstin,
            frozen_customer_address: Some(cust_addr),
            frozen_customer_state: cust_state,
            frozen_customer_pincode: cust_pin,
            frozen_customer_pan: cust_pan,

            frozen_place_of_supply: place_of_supply,
            frozen_currency: "INR".to_string(),
            approved_by: None,
            approved_at: None,
            exported_by: None,
            exported_at: None,
            print_count: 0,
            last_printed_at: None,
            last_printed_by: None,
            total_taxable: 0.0,
            total_value: 0.0,
        };

        // 6. Copy Invoice Items
        let mut stmt = conn.prepare(
            "SELECT id, part_code, quantity, rate_pre_unit, assessable_value, cgst_rate, cgst_amount, sgst_rate, sgst_amount, igst_rate, igst_amount, total_value 
             FROM invoice_items WHERE invoice_number = ?"
        ).map_err(|e| AppError::Db {
            code: "ERR_DB_003".to_string(),
            message: format!("Failed to prepare select invoice items query: {}", e),
        })?;

        let item_rows = stmt.query_map([invoice_number], |row| {
            Ok((
                row.get::<_, i64>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, f64>(2)?,
                row.get::<_, f64>(3)?,
                row.get::<_, f64>(4)?,
                row.get::<_, f64>(5)?,
                row.get::<_, f64>(6)?,
                row.get::<_, f64>(7)?,
                row.get::<_, f64>(8)?,
                row.get::<_, f64>(9)?,
                row.get::<_, f64>(10)?,
                row.get::<_, f64>(11)?,
            ))
        }).map_err(|e| AppError::Db {
            code: "ERR_DB_003".to_string(),
            message: format!("Failed to query invoice items: {}", e),
        })?;

        let mut items = Vec::new();
        for r in item_rows {
            let (
                inv_item_id, part_code, qty, rate, assess_val, cgst_r, cgst_a, sgst_r, sgst_a, igst_r, igst_a, total_v
            ) = r.map_err(|e| AppError::Db {
                code: "ERR_DB_003".to_string(),
                message: format!("Failed to parse invoice item: {}", e),
            })?;

            // Retrieve UOM code from items
            let uom_code: Option<String> = conn.query_row(
                "SELECT uom_code FROM items WHERE part_code = ?",
                [&part_code],
                |row| row.get(0),
            ).optional().unwrap_or(None);

            items.push(CreditNoteItemRow {
                id: None,
                credit_note_number: credit_note_number.clone(),
                invoice_item_id: inv_item_id,
                part_code,
                quantity: qty,
                rate_pre_unit: rate,
                assessable_value: assess_val,
                cgst_rate: cgst_r,
                cgst_amount: cgst_a,
                sgst_rate: sgst_r,
                sgst_amount: sgst_a,
                igst_rate: igst_r,
                igst_amount: igst_a,
                total_value: assess_val + cgst_a + sgst_a + igst_a,
                original_quantity: qty,
                original_rate_pre_unit: rate,
                frozen_unit_of_measure: uom_code,
            });
        }

        // 7. Save Aggregate
        let repo = SqliteCreditNoteRepository;
        repo.save_header(conn, &header)?;
        repo.save_items(conn, &items)?;

        // 8. Update Invoice Status
        conn.execute(
            "UPDATE invoices SET status = 'Credit Note Generated', updated_at = datetime('now') WHERE invoice_number = ?",
            [invoice_number],
        ).map_err(|e| AppError::Db {
            code: "ERR_DB_003".to_string(),
            message: format!("Failed to update invoice status: {}", e),
        })?;

        // 9. Write Audit
        log_audit(
            conn,
            &format!("Credit Note generated in Draft mode by {}", user),
            &credit_note_number,
            None,
            Some(&serde_json::to_string(&header).unwrap_or_default()),
        )?;

        Ok(credit_note_number)
    }

    pub fn update_credit_note(
        conn: &Connection,
        payload: CreditNoteUpdatePayload,
        user: &str,
    ) -> Result<(), AppError> {
        if conn.is_autocommit() {
            let tx = conn.unchecked_transaction().map_err(|e| AppError::Db {
                code: "ERR_DB_003".to_string(),
                message: format!("Failed to start transaction: {}", e),
            })?;
            Self::update_credit_note_internal(&tx, payload, user)?;
            tx.commit().map_err(|e| AppError::Db {
                code: "ERR_DB_003".to_string(),
                message: format!("Failed to commit transaction: {}", e),
            })?;
            Ok(())
        } else {
            Self::update_credit_note_internal(conn, payload, user)
        }
    }

    fn update_credit_note_internal(
        conn: &Connection,
        payload: CreditNoteUpdatePayload,
        user: &str,
    ) -> Result<(), AppError> {
        // Defer foreign key checking until transaction commit for primary key updates
        conn.execute_batch("PRAGMA defer_foreign_keys = ON;").map_err(|e| AppError::Db {
            code: "ERR_DB_003".to_string(),
            message: format!("Failed to defer foreign key checks: {}", e),
        })?;

        // 1. Input validations
        CreditNoteValidator::validate_input(&payload)?;

        let old_cn_number = CreditNoteValidator::normalize_credit_note_number(&payload.credit_note_number);
        let target_cn_number = match payload.new_credit_note_number {
            Some(ref new_no) if !new_no.trim().is_empty() => CreditNoteValidator::normalize_credit_note_number(new_no),
            _ => old_cn_number.clone(),
        };

        // 2. Load existing Header and verify state
        let repo = SqliteCreditNoteRepository;
        let mut header = repo.load_header(conn, &old_cn_number)?
            .ok_or_else(|| AppError::Validation {
                code: "ERR_VAL_006".to_string(),
                message: format!("Credit Note {} does not exist", old_cn_number),
            })?;

        if header.is_deleted {
            return Err(AppError::Validation {
                code: "ERR_VAL_006".to_string(),
                message: "Cannot edit a deleted Credit Note".to_string(),
            });
        }

        if header.status != CreditNoteStatus::Draft {
            return Err(AppError::Validation {
                code: "ERR_VAL_006".to_string(),
                message: format!("Only Draft Credit Notes can be edited (current status: {:?})", header.status),
            });
        }

        // Period lock check for the new date
        CreditNoteValidator::validate_period_lock(conn, &payload.credit_note_date)?;

        // Optimistic Locking verification
        if header.revision_no != payload.expected_revision_no {
            return Err(AppError::Validation {
                code: "ERR_VAL_007".to_string(),
                message: "The record was updated by another user. Please refresh and try again.".to_string(),
            });
        }

        // 3. Load existing Items and check Controlled Edit bounds
        let mut items = repo.load_items(conn, &old_cn_number)?;
        CreditNoteValidator::validate_controlled_edit(&payload, &items)?;

        // 4. Duplicate Check if Credit Note Number is changing
        if target_cn_number != old_cn_number {
            let count: i64 = conn.query_row(
                "SELECT COUNT(*) FROM credit_notes WHERE UPPER(TRIM(credit_note_number)) = UPPER(?) AND credit_note_number != ?",
                rusqlite::params![target_cn_number, old_cn_number],
                |r| r.get(0),
            ).map_err(|e| AppError::Db {
                code: "ERR_DB_003".to_string(),
                message: format!("Failed to check for duplicate credit note number: {}", e),
            })?;

            if count > 0 {
                return Err(AppError::Validation {
                    code: "ERR_VAL_001".to_string(),
                    message: format!("Credit Note Number \"{}\" already exists. Please choose another number.", target_cn_number),
                });
            }
        }

        // 5. Check No-Op condition
        let mut items_changed = false;
        for item_payload in &payload.items {
            if let Some(item) = items.iter().find(|i| i.invoice_item_id == item_payload.invoice_item_id) {
                if (item.quantity - item_payload.quantity).abs() > 1e-6 || (item.rate_pre_unit - item_payload.rate_pre_unit).abs() > 1e-6 {
                    items_changed = true;
                    break;
                }
            }
        }

        let header_cn_no_changed = target_cn_number != old_cn_number;
        let date_changed = payload.credit_note_date != header.credit_note_date;
        let remarks_changed = payload.remarks.as_deref().unwrap_or("").trim() != header.remarks.as_deref().unwrap_or("").trim();
        let reason_changed = payload.reason.as_deref().unwrap_or("").trim() != header.reason.as_deref().unwrap_or("").trim();

        if !header_cn_no_changed && !date_changed && !remarks_changed && !reason_changed && !items_changed {
            // No-op: Early return without modifying revision_no, updated_at, or writing audit log
            return Ok(());
        }

        // Save old header representation for audit diff
        let old_header_json = serde_json::to_string(&header).unwrap_or_default();

        // 6. Update and calculate item details in paise
        for item_payload in &payload.items {
            if let Some(item) = items.iter_mut().find(|i| i.invoice_item_id == item_payload.invoice_item_id) {
                item.quantity = item_payload.quantity;
                item.rate_pre_unit = item_payload.rate_pre_unit;
                if header_cn_no_changed {
                    item.credit_note_number = target_cn_number.clone();
                }

                // Paise calculations
                let rate_paise = (item.rate_pre_unit * 100.0).round() as i64;
                let assessable_paise = (item.quantity * rate_paise as f64).round() as i64;
                
                let cgst_paise = (assessable_paise as f64 * item.cgst_rate / 100.0).round() as i64;
                let sgst_paise = (assessable_paise as f64 * item.sgst_rate / 100.0).round() as i64;
                let igst_paise = (assessable_paise as f64 * item.igst_rate / 100.0).round() as i64;
                let total_paise = assessable_paise + cgst_paise + sgst_paise + igst_paise;

                item.assessable_value = assessable_paise as f64 / 100.0;
                item.cgst_amount = cgst_paise as f64 / 100.0;
                item.sgst_amount = sgst_paise as f64 / 100.0;
                item.igst_amount = igst_paise as f64 / 100.0;
                item.total_value = total_paise as f64 / 100.0;
            }
        }

        // 7. Update Header Fields with Atomic Revision Check
        let new_revision_no = header.revision_no + 1;
        let now_str = chrono::Local::now().format("%Y-%m-%d %H:%M:%S").to_string();

        let rows_affected = conn.execute(
            "UPDATE credit_notes 
             SET credit_note_number = ?, credit_note_date = ?, reason = ?, remarks = ?, revision_no = ?, updated_at = ? 
             WHERE credit_note_number = ? AND revision_no = ?",
            rusqlite::params![
                target_cn_number,
                payload.credit_note_date,
                payload.reason,
                payload.remarks,
                new_revision_no,
                now_str,
                old_cn_number,
                header.revision_no
            ],
        ).map_err(|e| {
            if e.to_string().contains("UNIQUE constraint failed") {
                AppError::Validation {
                    code: "ERR_VAL_001".to_string(),
                    message: format!("Credit Note Number \"{}\" already exists. Please choose another number.", target_cn_number),
                }
            } else {
                AppError::Db {
                    code: "ERR_DB_003".to_string(),
                    message: format!("Failed to update credit note header: {}", e),
                }
            }
        })?;

        if rows_affected == 0 {
            return Err(AppError::Validation {
                code: "ERR_VAL_007".to_string(),
                message: "The record was updated by another user. Please refresh and try again.".to_string(),
            });
        }

        // 8. Cascading update for credit_note_items if Credit Note Number was renamed
        if header_cn_no_changed {
            conn.execute(
                "UPDATE credit_note_items SET credit_note_number = ? WHERE credit_note_number = ?",
                rusqlite::params![target_cn_number, old_cn_number],
            ).map_err(|e| AppError::Db {
                code: "ERR_DB_003".to_string(),
                message: format!("Failed to update credit note items foreign key: {}", e),
            })?;
        }

        // Update local header copy
        header.credit_note_number = target_cn_number.clone();
        header.credit_note_date = payload.credit_note_date;
        header.remarks = payload.remarks;
        header.reason = payload.reason;
        header.revision_no = new_revision_no;
        header.updated_at = now_str;

        // 9. Persist item rows
        repo.save_items(conn, &items)?;

        // 10. Write Audit Log (Failure is fatal and will trigger transaction rollback)
        let new_header_json = serde_json::to_string(&header).unwrap_or_default();
        log_audit(
            conn,
            &format!("Credit Note edited by {}", user),
            &header.credit_note_number,
            Some(&old_header_json),
            Some(&new_header_json),
        )?;

        Ok(())
    }

    pub fn submit_for_review(
        conn: &Connection,
        credit_note_number: &str,
        user: &str,
    ) -> Result<(), AppError> {
        let repo = SqliteCreditNoteRepository;
        let mut header = repo.load_header(conn, credit_note_number)?
            .ok_or_else(|| AppError::Validation {
                code: "ERR_VAL_006".to_string(),
                message: format!("Credit Note {} does not exist", credit_note_number),
            })?;

        if header.status == CreditNoteStatus::Review {
            return Ok(()); // Idempotency
        }

        CreditNoteValidator::validate_transition(header.status, CreditNoteStatus::Review)?;

        let old_header_json = serde_json::to_string(&header).unwrap_or_default();

        header.status = CreditNoteStatus::Review;
        header.revision_no += 1;
        header.updated_at = chrono::Local::now().format("%Y-%m-%d %H:%M:%S").to_string();

        repo.save_header(conn, &header)?;

        log_audit(
            conn,
            &format!("Submitted for Review by {}", user),
            credit_note_number,
            Some(&old_header_json),
            Some(&serde_json::to_string(&header).unwrap_or_default()),
        )?;

        Ok(())
    }

    pub fn reject_to_draft(
        conn: &Connection,
        credit_note_number: &str,
        user: &str,
    ) -> Result<(), AppError> {
        let repo = SqliteCreditNoteRepository;
        let mut header = repo.load_header(conn, credit_note_number)?
            .ok_or_else(|| AppError::Validation {
                code: "ERR_VAL_006".to_string(),
                message: format!("Credit Note {} does not exist", credit_note_number),
            })?;

        if header.status == CreditNoteStatus::Draft {
            return Ok(()); // Idempotency
        }

        CreditNoteValidator::validate_transition(header.status, CreditNoteStatus::Draft)?;

        let old_header_json = serde_json::to_string(&header).unwrap_or_default();

        header.status = CreditNoteStatus::Draft;
        header.revision_no += 1;
        header.updated_at = chrono::Local::now().format("%Y-%m-%d %H:%M:%S").to_string();

        repo.save_header(conn, &header)?;

        log_audit(
            conn,
            &format!("Returned to Draft by {}", user),
            credit_note_number,
            Some(&old_header_json),
            Some(&serde_json::to_string(&header).unwrap_or_default()),
        )?;

        Ok(())
    }

    pub fn approve_credit_note(
        conn: &Connection,
        credit_note_number: &str,
        user: &str,
    ) -> Result<(), AppError> {
        let repo = SqliteCreditNoteRepository;
        let mut header = repo.load_header(conn, credit_note_number)?
            .ok_or_else(|| AppError::Validation {
                code: "ERR_VAL_006".to_string(),
                message: format!("Credit Note {} does not exist", credit_note_number),
            })?;

        if header.status == CreditNoteStatus::Approved {
            return Ok(()); // Idempotency
        }

        CreditNoteValidator::validate_transition(header.status, CreditNoteStatus::Approved)?;
        CreditNoteValidator::validate_period_lock(conn, &header.credit_note_date)?;

        let old_header_json = serde_json::to_string(&header).unwrap_or_default();

        header.status = CreditNoteStatus::Approved;
        header.approved_by = Some(user.to_string());
        header.approved_at = Some(chrono::Local::now().format("%Y-%m-%d %H:%M:%S").to_string());
        header.revision_no += 1;
        header.updated_at = chrono::Local::now().format("%Y-%m-%d %H:%M:%S").to_string();

        repo.save_header(conn, &header)?;

        log_audit(
            conn,
            &format!("Approved by {}", user),
            credit_note_number,
            Some(&old_header_json),
            Some(&serde_json::to_string(&header).unwrap_or_default()),
        )?;

        Ok(())
    }

    pub fn export_credit_note(
        conn: &Connection,
        credit_note_number: &str,
        user: &str,
    ) -> Result<(), AppError> {
        let repo = SqliteCreditNoteRepository;
        let mut header = repo.load_header(conn, credit_note_number)?
            .ok_or_else(|| AppError::Validation {
                code: "ERR_VAL_006".to_string(),
                message: format!("Credit Note {} does not exist", credit_note_number),
            })?;

        if header.status == CreditNoteStatus::Exported {
            return Ok(()); // Idempotency
        }

        CreditNoteValidator::validate_transition(header.status, CreditNoteStatus::Exported)?;
        CreditNoteValidator::validate_period_lock(conn, &header.credit_note_date)?;

        let old_header_json = serde_json::to_string(&header).unwrap_or_default();

        header.status = CreditNoteStatus::Exported;
        header.exported_by = Some(user.to_string());
        header.exported_at = Some(chrono::Local::now().format("%Y-%m-%d %H:%M:%S").to_string());
        header.revision_no += 1;
        header.updated_at = chrono::Local::now().format("%Y-%m-%d %H:%M:%S").to_string();

        repo.save_header(conn, &header)?;

        log_audit(
            conn,
            &format!("Exported to ERP by {}", user),
            credit_note_number,
            Some(&old_header_json),
            Some(&serde_json::to_string(&header).unwrap_or_default()),
        )?;

        Ok(())
    }

    pub fn delete_credit_note(
        conn: &Connection,
        credit_note_number: &str,
        user: &str,
        confirmation_number: &str,
    ) -> Result<(), AppError> {
        // Enforce typed confirmation input matches exactly
        if credit_note_number != confirmation_number {
            return Err(AppError::Validation {
                code: "ERR_VAL_008".to_string(),
                message: format!("Confirmation number '{}' does not match Credit Note number '{}'", confirmation_number, credit_note_number),
            });
        }

        let repo = SqliteCreditNoteRepository;
        let header = repo.load_header(conn, credit_note_number)?
            .ok_or_else(|| AppError::Validation {
                code: "ERR_VAL_006".to_string(),
                message: format!("Credit Note {} does not exist", credit_note_number),
            })?;

        if header.is_deleted {
            return Ok(()); // Idempotency
        }

        // Approved and Exported cannot be deleted!
        if header.status == CreditNoteStatus::Approved || header.status == CreditNoteStatus::Exported {
            return Err(AppError::Validation {
                code: "ERR_VAL_009".to_string(),
                message: "Cannot delete an Approved or Exported Credit Note".to_string(),
            });
        }

        let old_header_json = serde_json::to_string(&header).unwrap_or_default();

        // 1. Soft Delete
        repo.mark_deleted(conn, credit_note_number, user)?;

        // 2. Revert Invoice Status back to Cancelled
        conn.execute(
            "UPDATE invoices SET status = 'Cancelled', updated_at = datetime('now') WHERE invoice_number = ?",
            [&header.invoice_number],
        ).map_err(|e| AppError::Db {
            code: "ERR_DB_003".to_string(),
            message: format!("Failed to reset invoice status: {}", e),
        })?;

        // 3. Log Audit
        log_audit(
            conn,
            &format!("Credit Note soft-deleted by {}", user),
            credit_note_number,
            Some(&old_header_json),
            None,
        )?;

        Ok(())
    }

    pub fn restore_credit_note(
        conn: &Connection,
        credit_note_number: &str,
        user: &str,
    ) -> Result<(), AppError> {
        let repo = SqliteCreditNoteRepository;
        let header = repo.load_header(conn, credit_note_number)?
            .ok_or_else(|| AppError::Validation {
                code: "ERR_VAL_006".to_string(),
                message: format!("Credit Note {} does not exist", credit_note_number),
            })?;

        if !header.is_deleted {
            return Ok(()); // Idempotency
        }

        // Validate Period Lock
        CreditNoteValidator::validate_period_lock(conn, &header.credit_note_date)?;

        // Verify original invoice exists and is Cancelled
        let inv_row: Option<(String, i64)> = conn.query_row(
            "SELECT status, customer_id FROM invoices WHERE invoice_number = ?",
            [&header.invoice_number],
            |row| Ok((row.get(0)?, row.get(1)?)),
        ).optional().map_err(|e| AppError::Db {
            code: "ERR_DB_003".to_string(),
            message: format!("Failed to query invoice status: {}", e),
        })?;

        let (inv_status, inv_customer_id) = inv_row.ok_or_else(|| AppError::Validation {
            code: "ERR_VAL_010".to_string(),
            message: format!("Original Invoice {} no longer exists", header.invoice_number),
        })?;

        if inv_status != "Cancelled" {
            return Err(AppError::Validation {
                code: "ERR_VAL_010".to_string(),
                message: format!("Invoice status must be 'Cancelled' to restore, but it is currently '{}'", inv_status),
            });
        }

        if inv_customer_id != header.customer_id {
            return Err(AppError::Validation {
                code: "ERR_VAL_010".to_string(),
                message: "Invoice customer mismatch".to_string(),
            });
        }

        // Verify no OTHER active credit note references this invoice
        let other_cn_count: i64 = conn.query_row(
            "SELECT COUNT(*) FROM credit_notes WHERE invoice_number = ? AND credit_note_number != ? AND is_deleted = 0",
            params![header.invoice_number, credit_note_number],
            |row| row.get(0),
        ).unwrap_or(0);

        if other_cn_count > 0 {
            return Err(AppError::Validation {
                code: "ERR_VAL_010".to_string(),
                message: format!("Another active Credit Note already references Invoice {}", header.invoice_number),
            });
        }

        let old_header_json = serde_json::to_string(&header).unwrap_or_default();

        // 1. Restore status
        repo.restore_deleted(conn, credit_note_number, user)?;

        // 2. Set invoice status back to 'Credit Note Generated'
        conn.execute(
            "UPDATE invoices SET status = 'Credit Note Generated', updated_at = datetime('now') WHERE invoice_number = ?",
            [&header.invoice_number],
        ).map_err(|e| AppError::Db {
            code: "ERR_DB_003".to_string(),
            message: format!("Failed to restore invoice link: {}", e),
        })?;

        // 3. Log Audit
        log_audit(
            conn,
            &format!("Credit Note restored by {}", user),
            credit_note_number,
            Some(&old_header_json),
            Some(&serde_json::to_string(&header).unwrap_or_default()), // simplistic
        )?;

        Ok(())
    }

    pub fn get_credit_note_details(
        conn: &Connection,
        credit_note_number: &str,
    ) -> Result<Option<CreditNoteDetails>, AppError> {
        let repo = SqliteCreditNoteRepository;
        let header_opt = repo.load_header(conn, credit_note_number)?;
        if header_opt.is_none() {
            return Ok(None);
        }
        let header = header_opt.unwrap();
        let items = repo.load_items(conn, credit_note_number)?;

        // Math in paise
        let mut total_taxable_paise = 0i64;
        let mut total_cgst_paise = 0i64;
        let mut total_sgst_paise = 0i64;
        let mut total_igst_paise = 0i64;
        let mut total_value_paise = 0i64;

        for item in &items {
            let rate_paise = (item.rate_pre_unit * 100.0).round() as i64;
            let assessable_paise = (item.quantity * rate_paise as f64).round() as i64;
            
            let cgst_paise = (assessable_paise as f64 * item.cgst_rate / 100.0).round() as i64;
            let sgst_paise = (assessable_paise as f64 * item.sgst_rate / 100.0).round() as i64;
            let igst_paise = (assessable_paise as f64 * item.igst_rate / 100.0).round() as i64;
            let total_paise = assessable_paise + cgst_paise + sgst_paise + igst_paise;

            total_taxable_paise += assessable_paise;
            total_cgst_paise += cgst_paise;
            total_sgst_paise += sgst_paise;
            total_igst_paise += igst_paise;
            total_value_paise += total_paise;
        }

        let tax_summary = CreditNoteTaxSummary {
            total_taxable: total_taxable_paise as f64 / 100.0,
            total_cgst: total_cgst_paise as f64 / 100.0,
            total_sgst: total_sgst_paise as f64 / 100.0,
            total_igst: total_igst_paise as f64 / 100.0,
            total_value: total_value_paise as f64 / 100.0,
        };

        // Load audit timeline
        let mut stmt = conn.prepare(
            "SELECT id, user_action, table_name, record_id, old_value, new_value, timestamp 
             FROM audit_log WHERE record_id = ? AND table_name = 'credit_notes' ORDER BY timestamp DESC"
        ).map_err(|e| AppError::Db {
            code: "ERR_DB_003".to_string(),
            message: format!("Failed to prepare select audit log query: {}", e),
        })?;

        let audit_rows = stmt.query_map([credit_note_number], |row| {
            Ok(crate::models::database_models::AuditLogRow {
                id: row.get(0)?,
                user_action: row.get(1)?,
                table_name: row.get(2)?,
                record_id: row.get(3)?,
                old_value: row.get(4)?,
                new_value: row.get(5)?,
                timestamp: row.get(6)?,
            })
        }).map_err(|e| AppError::Db {
            code: "ERR_DB_003".to_string(),
            message: format!("Failed to query audit logs: {}", e),
        })?;

        let mut audit_timeline = Vec::new();
        for r in audit_rows {
            audit_timeline.push(r.map_err(|e| AppError::Db {
                code: "ERR_DB_003".to_string(),
                message: format!("Failed to parse audit log: {}", e),
            })?);
        }

        // Capabilities calculation
        let is_locked = FinancialPeriodService::is_period_locked(conn, &header.credit_note_date)?;

        let (can_edit, reason_edit_disabled) = if header.is_deleted {
            (false, Some("Cannot edit a deleted Credit Note".to_string()))
        } else if is_locked {
            (false, Some("Financial period is locked".to_string()))
        } else if header.status != CreditNoteStatus::Draft {
            (false, Some(format!("Only Draft notes can be edited (current status: {:?})", header.status)))
        } else {
            (true, None)
        };

        let (can_delete, reason_delete_disabled) = if header.is_deleted {
            (false, Some("Already deleted".to_string()))
        } else if is_locked {
            (false, Some("Financial period is locked".to_string()))
        } else if header.status != CreditNoteStatus::Draft && header.status != CreditNoteStatus::Review {
            (false, Some("Only Draft or Review Credit Notes can be deleted".to_string()))
        } else {
            (true, None)
        };

        let (can_restore, reason_restore_disabled) = if !header.is_deleted {
            (false, Some("Not deleted".to_string()))
        } else if is_locked {
            (false, Some("Financial period is locked".to_string()))
        } else {
            (true, None)
        };

        let can_submit = header.status == CreditNoteStatus::Draft && !header.is_deleted && !is_locked;
        let can_approve = header.status == CreditNoteStatus::Review && !header.is_deleted && !is_locked;
        let can_print = true;

        let capabilities = CreditNoteCapabilities {
            can_edit,
            reason_edit_disabled,
            can_delete,
            reason_delete_disabled,
            can_restore,
            reason_restore_disabled,
            can_submit,
            can_approve,
            can_print,
        };

        Ok(Some(CreditNoteDetails {
            header,
            tax_summary,
            items,
            audit_timeline,
            capabilities,
        }))
    }
}

// Helpers
fn extract_pan(gstin: &Option<String>) -> Option<String> {
    if let Some(ref g) = gstin {
        if g.len() >= 12 {
            return Some(g[2..12].to_string());
        }
    }
    None
}

fn log_audit(
    conn: &Connection,
    action: &str,
    record_id: &str,
    old_val: Option<&str>,
    new_val: Option<&str>,
) -> Result<(), AppError> {
    conn.execute(
        "INSERT INTO audit_log (user_action, table_name, record_id, old_value, new_value)
         VALUES (?, 'credit_notes', ?, ?, ?)",
        params![action, record_id, old_val, new_val],
    )
    .map_err(|e| AppError::Db {
        code: "ERR_DB_003".to_string(),
        message: format!("Failed to write audit logs: {}", e),
    })?;
    Ok(())
}
