use crate::error::AppError;
use crate::models::database_models::{CreditNoteRow, DebitNoteRow};
use crate::repositories::NoteRepository;
use rusqlite::{params, Connection, OptionalExtension};

pub struct SqliteNoteRepository;

impl NoteRepository for SqliteNoteRepository {
    // Debit Notes
    fn insert_debit_note(&self, conn: &mut Connection, row: &DebitNoteRow) -> Result<(), AppError> {
        conn.execute(
            "INSERT INTO debit_notes (debit_note_number, supplier_id, revision_id, debit_note_date,
                                     total_taxable, total_cgst, total_sgst, total_igst, total_value, status, remarks, approved_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            params![
                row.debit_note_number,
                row.supplier_id,
                row.revision_id,
                row.debit_note_date,
                row.total_taxable,
                row.total_cgst,
                row.total_sgst,
                row.total_igst,
                row.total_value,
                row.status,
                row.remarks,
                row.approved_at
            ],
        )
        .map_err(|e| AppError::Db {
            code: "ERR_DB_003".to_string(),
            message: format!("Failed to insert debit note: {}", e),
        })?;
        Ok(())
    }

    fn update_debit_note_status(
        &self,
        conn: &mut Connection,
        number: &str,
        status: &str,
    ) -> Result<(), AppError> {
        let approved_date = if status == "Approved" {
            "datetime('now')"
        } else {
            "NULL"
        };

        let query = format!(
            "UPDATE debit_notes SET status = ?, approved_at = {} WHERE debit_note_number = ?",
            approved_date
        );

        conn.execute(&query, params![status, number])
            .map_err(|e| AppError::Db {
                code: "ERR_DB_003".to_string(),
                message: format!("Failed to update debit note status: {}", e),
            })?;
        Ok(())
    }

    fn find_debit_note(
        &self,
        conn: &Connection,
        number: &str,
    ) -> Result<Option<DebitNoteRow>, AppError> {
        conn.query_row(
            "SELECT debit_note_number, supplier_id, revision_id, debit_note_date,
                    total_taxable, total_cgst, total_sgst, total_igst, total_value, status, remarks, approved_at, created_at
             FROM debit_notes WHERE debit_note_number = ?",
            [number],
            |row| {
                Ok(DebitNoteRow {
                    debit_note_number: row.get(0)?,
                    supplier_id: row.get(1)?,
                    revision_id: row.get(2)?,
                    debit_note_date: row.get(3)?,
                    total_taxable: row.get(4)?,
                    total_cgst: row.get(5)?,
                    total_sgst: row.get(6)?,
                    total_igst: row.get(7)?,
                    total_value: row.get(8)?,
                    status: row.get(9)?,
                    remarks: row.get(10)?,
                    approved_at: row.get(11)?,
                    created_at: row.get(12)?,
                })
            },
        )
        .optional()
        .map_err(|e| AppError::Db {
            code: "ERR_DB_003".to_string(),
            message: format!("Failed to find debit note: {}", e),
        })
    }

    // Credit Notes
    fn insert_credit_note(
        &self,
        conn: &mut Connection,
        row: &CreditNoteRow,
    ) -> Result<(), AppError> {
        conn.execute(
            "INSERT INTO credit_notes (credit_note_number, invoice_number, customer_id, credit_note_date,
                                      total_taxable, total_cgst, total_sgst, total_igst, total_value, status, remarks, approved_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            params![
                row.credit_note_number,
                row.invoice_number,
                row.customer_id,
                row.credit_note_date,
                row.total_taxable,
                row.total_cgst,
                row.total_sgst,
                row.total_igst,
                row.total_value,
                row.status,
                row.remarks,
                row.approved_at
            ],
        )
        .map_err(|e| AppError::Db {
            code: "ERR_DB_003".to_string(),
            message: format!("Failed to insert credit note: {}", e),
        })?;
        Ok(())
    }

    fn update_credit_note_status(
        &self,
        conn: &mut Connection,
        number: &str,
        status: &str,
    ) -> Result<(), AppError> {
        let approved_date = if status == "Approved" {
            "datetime('now')"
        } else {
            "NULL"
        };

        let query = format!(
            "UPDATE credit_notes SET status = ?, approved_at = {} WHERE credit_note_number = ?",
            approved_date
        );

        conn.execute(&query, params![status, number])
            .map_err(|e| AppError::Db {
                code: "ERR_DB_003".to_string(),
                message: format!("Failed to update credit note status: {}", e),
            })?;
        Ok(())
    }

    fn find_credit_note(
        &self,
        conn: &Connection,
        number: &str,
    ) -> Result<Option<CreditNoteRow>, AppError> {
        conn.query_row(
            "SELECT credit_note_number, invoice_number, customer_id, credit_note_date,
                    total_taxable, total_cgst, total_sgst, total_igst, total_value, status, remarks, approved_at, created_at
             FROM credit_notes WHERE credit_note_number = ?",
            [number],
            |row| {
                Ok(CreditNoteRow {
                    credit_note_number: row.get(0)?,
                    invoice_number: row.get(1)?,
                    customer_id: row.get(2)?,
                    credit_note_date: row.get(3)?,
                    total_taxable: row.get(4)?,
                    total_cgst: row.get(5)?,
                    total_sgst: row.get(6)?,
                    total_igst: row.get(7)?,
                    total_value: row.get(8)?,
                    status: row.get(9)?,
                    remarks: row.get(10)?,
                    approved_at: row.get(11)?,
                    created_at: row.get(12)?,
                })
            },
        )
        .optional()
        .map_err(|e| AppError::Db {
            code: "ERR_DB_003".to_string(),
            message: format!("Failed to find credit note: {}", e),
        })
    }
}
