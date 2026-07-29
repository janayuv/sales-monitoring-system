use crate::error::AppError;
use crate::models::database_models::{CreditNoteHeader, CreditNoteItemRow, CreditNoteStatus};
use crate::repositories::CreditNoteRepository;
use rusqlite::{params, Connection, OptionalExtension};

pub struct SqliteCreditNoteRepository;

impl CreditNoteRepository for SqliteCreditNoteRepository {
    fn save_header(&self, conn: &Connection, header: &CreditNoteHeader) -> Result<(), AppError> {
        let is_deleted_int = if header.is_deleted { 1 } else { 0 };
        
        conn.execute(
            "INSERT OR REPLACE INTO credit_notes (
                credit_note_number, invoice_number, customer_id, credit_note_date,
                status, remarks, reason, revision_no, updated_at, created_at,
                is_deleted, deleted_by, deleted_at, snapshot_version,
                frozen_company_name, frozen_company_gstin, frozen_company_address,
                frozen_company_state, frozen_company_state_code, frozen_company_pan, frozen_company_bank_details,
                frozen_customer_name, frozen_customer_gstin, frozen_customer_address,
                frozen_customer_state, frozen_customer_pincode, frozen_customer_pan,
                frozen_place_of_supply, frozen_currency, approved_by, approved_at,
                exported_by, exported_at, print_count, last_printed_at, last_printed_by
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            params![
                header.credit_note_number,
                header.invoice_number,
                header.customer_id,
                header.credit_note_date,
                header.status.to_str(),
                header.remarks,
                header.reason,
                header.revision_no,
                header.updated_at,
                header.created_at,
                is_deleted_int,
                header.deleted_by,
                header.deleted_at,
                header.snapshot_version,
                header.frozen_company_name,
                header.frozen_company_gstin,
                header.frozen_company_address,
                header.frozen_company_state,
                header.frozen_company_state_code,
                header.frozen_company_pan,
                header.frozen_company_bank_details,
                header.frozen_customer_name,
                header.frozen_customer_gstin,
                header.frozen_customer_address,
                header.frozen_customer_state,
                header.frozen_customer_pincode,
                header.frozen_customer_pan,
                header.frozen_place_of_supply,
                header.frozen_currency,
                header.approved_by,
                header.approved_at,
                header.exported_by,
                header.exported_at,
                header.print_count,
                header.last_printed_at,
                header.last_printed_by
            ],
        )
        .map_err(|e| AppError::Db {
            code: "ERR_DB_003".to_string(),
            message: format!("Failed to save credit note header: {}", e),
        })?;
        Ok(())
    }

    fn save_items(&self, conn: &Connection, items: &[CreditNoteItemRow]) -> Result<(), AppError> {
        if items.is_empty() {
            return Ok(());
        }
        let cn_number = &items[0].credit_note_number;
        
        conn.execute(
            "DELETE FROM credit_note_items WHERE credit_note_number = ?",
            [cn_number],
        )
        .map_err(|e| AppError::Db {
            code: "ERR_DB_003".to_string(),
            message: format!("Failed to clear old credit note items: {}", e),
        })?;

        let mut stmt = conn.prepare(
            "INSERT INTO credit_note_items (
                credit_note_number, invoice_item_id, part_code, quantity,
                rate_pre_unit, assessable_value, cgst_rate, cgst_amount,
                sgst_rate, sgst_amount, igst_rate, igst_amount, total_value,
                original_quantity, original_rate_pre_unit, frozen_unit_of_measure
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
        )
        .map_err(|e| AppError::Db {
            code: "ERR_DB_003".to_string(),
            message: format!("Failed to prepare save items query: {}", e),
        })?;

        for item in items {
            stmt.execute(params![
                item.credit_note_number,
                item.invoice_item_id,
                item.part_code,
                item.quantity,
                (item.rate_pre_unit * 100.0).round() as i64,
                (item.assessable_value * 100.0).round() as i64,
                item.cgst_rate,
                (item.cgst_amount * 100.0).round() as i64,
                item.sgst_rate,
                (item.sgst_amount * 100.0).round() as i64,
                item.igst_rate,
                (item.igst_amount * 100.0).round() as i64,
                (item.total_value * 100.0).round() as i64,
                item.original_quantity,
                (item.original_rate_pre_unit * 100.0).round() as i64,
                item.frozen_unit_of_measure
            ])
            .map_err(|e| AppError::Db {
                code: "ERR_DB_003".to_string(),
                message: format!("Failed to insert credit note item: {}", e),
            })?;
        }
        Ok(())
    }

    fn load_header(&self, conn: &Connection, credit_note_number: &str) -> Result<Option<CreditNoteHeader>, AppError> {
        conn.query_row(
            "SELECT 
                credit_note_number, invoice_number, customer_id, credit_note_date,
                status, remarks, reason, revision_no, updated_at, created_at,
                is_deleted, deleted_by, deleted_at, snapshot_version,
                frozen_company_name, frozen_company_gstin, frozen_company_address,
                frozen_company_state, frozen_company_state_code, frozen_company_pan, frozen_company_bank_details,
                frozen_customer_name, frozen_customer_gstin, frozen_customer_address,
                frozen_customer_state, frozen_customer_pincode, frozen_customer_pan,
                frozen_place_of_supply, frozen_currency, approved_by, approved_at,
                exported_by, exported_at, print_count, last_printed_at, last_printed_by,
                COALESCE((SELECT SUM(assessable_value) FROM credit_note_items WHERE credit_note_number = credit_notes.credit_note_number), 0) as total_taxable_paise,
                COALESCE((SELECT SUM(total_value) FROM credit_note_items WHERE credit_note_number = credit_notes.credit_note_number), 0) as total_value_paise
             FROM credit_notes WHERE credit_note_number = ?",
            [credit_note_number],
            |row| {
                let status_str: String = row.get(4)?;
                let status = CreditNoteStatus::from_str(&status_str)
                    .map_err(|e| rusqlite::Error::ToSqlConversionFailure(Box::new(std::io::Error::new(std::io::ErrorKind::Other, e))))?;
                let is_deleted_int: i32 = row.get(10)?;
                let total_taxable_paise: i64 = row.get(36)?;
                let total_value_paise: i64 = row.get(37)?;
                
                Ok(CreditNoteHeader {
                    credit_note_number: row.get(0)?,
                    invoice_number: row.get(1)?,
                    customer_id: row.get(2)?,
                    credit_note_date: row.get(3)?,
                    status,
                    remarks: row.get(5)?,
                    reason: row.get(6)?,
                    revision_no: row.get(7)?,
                    updated_at: row.get(8)?,
                    created_at: row.get(9)?,
                    is_deleted: is_deleted_int == 1,
                    deleted_by: row.get(11)?,
                    deleted_at: row.get(12)?,
                    snapshot_version: row.get(13)?,
                    frozen_company_name: row.get(14)?,
                    frozen_company_gstin: row.get(15)?,
                    frozen_company_address: row.get(16)?,
                    frozen_company_state: row.get(17)?,
                    frozen_company_state_code: row.get(18)?,
                    frozen_company_pan: row.get(19)?,
                    frozen_company_bank_details: row.get(20)?,
                    frozen_customer_name: row.get(21)?,
                    frozen_customer_gstin: row.get(22)?,
                    frozen_customer_address: row.get(23)?,
                    frozen_customer_state: row.get(24)?,
                    frozen_customer_pincode: row.get(25)?,
                    frozen_customer_pan: row.get(26)?,
                    frozen_place_of_supply: row.get(27)?,
                    frozen_currency: row.get(28)?,
                    approved_by: row.get(29)?,
                    approved_at: row.get(30)?,
                    exported_by: row.get(31)?,
                    exported_at: row.get(32)?,
                    print_count: row.get(33)?,
                    last_printed_at: row.get(34)?,
                    last_printed_by: row.get(35)?,
                    total_taxable: total_taxable_paise as f64 / 100.0,
                    total_value: total_value_paise as f64 / 100.0,
                })
            },
        )
        .optional()
        .map_err(|e| AppError::Db {
            code: "ERR_DB_003".to_string(),
            message: format!("Failed to query credit note header: {}", e),
        })
    }

    fn load_items(&self, conn: &Connection, credit_note_number: &str) -> Result<Vec<CreditNoteItemRow>, AppError> {
        let mut stmt = conn.prepare(
            "SELECT 
                id, credit_note_number, invoice_item_id, part_code, quantity,
                rate_pre_unit, assessable_value, cgst_rate, cgst_amount,
                sgst_rate, sgst_amount, igst_rate, igst_amount, total_value,
                original_quantity, original_rate_pre_unit, frozen_unit_of_measure
             FROM credit_note_items WHERE credit_note_number = ? ORDER BY id ASC"
        )
        .map_err(|e| AppError::Db {
            code: "ERR_DB_003".to_string(),
            message: format!("Failed to prepare load items query: {}", e),
        })?;

        let rows = stmt.query_map([credit_note_number], |row| {
            let rate_paise: i64 = row.get(5)?;
            let assessable_paise: i64 = row.get(6)?;
            let cgst_paise: i64 = row.get(8)?;
            let sgst_paise: i64 = row.get(10)?;
            let igst_paise: i64 = row.get(12)?;
            let total_paise: i64 = row.get(13)?;
            let orig_rate_paise: i64 = row.get(15)?;

            Ok(CreditNoteItemRow {
                id: Some(row.get(0)?),
                credit_note_number: row.get(1)?,
                invoice_item_id: row.get(2)?,
                part_code: row.get(3)?,
                quantity: row.get(4)?,
                rate_pre_unit: rate_paise as f64 / 100.0,
                assessable_value: assessable_paise as f64 / 100.0,
                cgst_rate: row.get(7)?,
                cgst_amount: cgst_paise as f64 / 100.0,
                sgst_rate: row.get(9)?,
                sgst_amount: sgst_paise as f64 / 100.0,
                igst_rate: row.get(11)?,
                igst_amount: igst_paise as f64 / 100.0,
                total_value: total_paise as f64 / 100.0,
                original_quantity: row.get(14)?,
                original_rate_pre_unit: orig_rate_paise as f64 / 100.0,
                frozen_unit_of_measure: row.get(16)?,
            })
        })
        .map_err(|e| AppError::Db {
            code: "ERR_DB_003".to_string(),
            message: format!("Failed to query credit note items: {}", e),
        })?;

        let mut list = Vec::new();
        for r in rows {
            list.push(r.map_err(|e| AppError::Db {
                code: "ERR_DB_003".to_string(),
                message: format!("Failed to parse credit note item: {}", e),
            })?);
        }
        Ok(list)
    }

    fn mark_deleted(&self, conn: &Connection, credit_note_number: &str, user: &str) -> Result<(), AppError> {
        conn.execute(
            "UPDATE credit_notes 
             SET is_deleted = 1, deleted_by = ?, deleted_at = datetime('now'), updated_at = datetime('now') 
             WHERE credit_note_number = ?",
            params![user, credit_note_number],
        )
        .map_err(|e| AppError::Db {
            code: "ERR_DB_003".to_string(),
            message: format!("Failed to soft delete credit note: {}", e),
        })?;
        Ok(())
    }

    fn restore_deleted(&self, conn: &Connection, credit_note_number: &str, user: &str) -> Result<(), AppError> {
        conn.execute(
            "UPDATE credit_notes 
             SET is_deleted = 0, deleted_by = NULL, deleted_at = NULL, status = 'Draft',
                 revision_no = revision_no + 1, updated_at = datetime('now'), remarks = ? || ' (Restored)'
             WHERE credit_note_number = ?",
            params![format!("Restored by {}", user), credit_note_number],
        )
        .map_err(|e| AppError::Db {
            code: "ERR_DB_003".to_string(),
            message: format!("Failed to restore soft deleted credit note: {}", e),
        })?;
        Ok(())
    }

    fn increment_print_count(&self, conn: &Connection, credit_note_number: &str, user: &str, action_type: &str) -> Result<(), AppError> {
        conn.execute(
            "UPDATE credit_notes 
             SET print_count = print_count + 1, 
                 last_printed_at = datetime('now'), 
                 last_printed_by = ? || ' (' || ? || ')'
             WHERE credit_note_number = ?",
            params![user, action_type, credit_note_number],
        )
        .map_err(|e| AppError::Db {
            code: "ERR_DB_003".to_string(),
            message: format!("Failed to increment print count: {}", e),
        })?;
        Ok(())
    }

    fn list_credit_notes(&self, conn: &Connection, include_deleted: bool) -> Result<Vec<CreditNoteHeader>, AppError> {
        let filter = if include_deleted { "" } else { "WHERE is_deleted = 0" };
        let query = format!(
            "SELECT 
                credit_note_number, invoice_number, customer_id, credit_note_date,
                status, remarks, reason, revision_no, updated_at, created_at,
                is_deleted, deleted_by, deleted_at, snapshot_version,
                frozen_company_name, frozen_company_gstin, frozen_company_address,
                frozen_company_state, frozen_company_state_code, frozen_company_pan, frozen_company_bank_details,
                frozen_customer_name, frozen_customer_gstin, frozen_customer_address,
                frozen_customer_state, frozen_customer_pincode, frozen_customer_pan,
                frozen_place_of_supply, frozen_currency, approved_by, approved_at,
                exported_by, exported_at, print_count, last_printed_at, last_printed_by,
                COALESCE((SELECT SUM(assessable_value) FROM credit_note_items WHERE credit_note_number = credit_notes.credit_note_number), 0) as total_taxable_paise,
                COALESCE((SELECT SUM(total_value) FROM credit_note_items WHERE credit_note_number = credit_notes.credit_note_number), 0) as total_value_paise
             FROM credit_notes 
             {} 
             ORDER BY created_at DESC",
            filter
        );

        let mut stmt = conn.prepare(&query)
            .map_err(|e| AppError::Db {
                code: "ERR_DB_003".to_string(),
                message: format!("Failed to prepare list credit notes query: {}", e),
            })?;

        let rows = stmt.query_map([], |row| {
            let status_str: String = row.get(4)?;
            let status = CreditNoteStatus::from_str(&status_str)
                .map_err(|e| rusqlite::Error::ToSqlConversionFailure(Box::new(std::io::Error::new(std::io::ErrorKind::Other, e))))?;
            let is_deleted_int: i32 = row.get(10)?;
            let total_taxable_paise: i64 = row.get(36)?;
            let total_value_paise: i64 = row.get(37)?;

            Ok(CreditNoteHeader {
                credit_note_number: row.get(0)?,
                invoice_number: row.get(1)?,
                customer_id: row.get(2)?,
                credit_note_date: row.get(3)?,
                status,
                remarks: row.get(5)?,
                reason: row.get(6)?,
                revision_no: row.get(7)?,
                updated_at: row.get(8)?,
                created_at: row.get(9)?,
                is_deleted: is_deleted_int == 1,
                deleted_by: row.get(11)?,
                deleted_at: row.get(12)?,
                snapshot_version: row.get(13)?,
                frozen_company_name: row.get(14)?,
                frozen_company_gstin: row.get(15)?,
                frozen_company_address: row.get(16)?,
                frozen_company_state: row.get(17)?,
                frozen_company_state_code: row.get(18)?,
                frozen_company_pan: row.get(19)?,
                frozen_company_bank_details: row.get(20)?,
                frozen_customer_name: row.get(21)?,
                frozen_customer_gstin: row.get(22)?,
                frozen_customer_address: row.get(23)?,
                frozen_customer_state: row.get(24)?,
                frozen_customer_pincode: row.get(25)?,
                frozen_customer_pan: row.get(26)?,
                frozen_place_of_supply: row.get(27)?,
                frozen_currency: row.get(28)?,
                approved_by: row.get(29)?,
                approved_at: row.get(30)?,
                exported_by: row.get(31)?,
                exported_at: row.get(32)?,
                print_count: row.get(33)?,
                last_printed_at: row.get(34)?,
                last_printed_by: row.get(35)?,
                total_taxable: total_taxable_paise as f64 / 100.0,
                total_value: total_value_paise as f64 / 100.0,
            })
        })
        .map_err(|e| AppError::Db {
            code: "ERR_DB_003".to_string(),
            message: format!("Failed to query credit notes list: {}", e),
        })?;

        let mut list = Vec::new();
        for r in rows {
            list.push(r.map_err(|e| AppError::Db {
                code: "ERR_DB_003".to_string(),
                message: format!("Failed to parse credit note row: {}", e),
            })?);
        }
        Ok(list)
    }
}
