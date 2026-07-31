use crate::error::AppError;
use crate::models::database_models::{InvoiceItemRow, InvoiceRow};
use crate::models::domain_models::InvoiceSummary;
use crate::repositories::InvoiceRepository;
use rusqlite::{params, Connection, OptionalExtension};

pub struct SqliteInvoiceRepository;

impl InvoiceRepository for SqliteInvoiceRepository {
    // Invoices
    fn insert_invoice(&self, conn: &mut Connection, row: &InvoiceRow) -> Result<(), AppError> {
        conn.execute(
            "INSERT INTO invoices (invoice_number, invoice_no_long, invoice_date, customer_id, financial_year_id,
                                  total_taxable, total_cgst, total_sgst, total_igst, total_cess, total_value,
                                  irn, irn_date, place_of_supply, reverse_charge, invoice_type, status, cancellation_date, import_batch_id)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            params![
                row.invoice_number,
                row.invoice_no_long,
                row.invoice_date,
                row.customer_id,
                row.financial_year_id,
                row.total_taxable,
                row.total_cgst,
                row.total_sgst,
                row.total_igst,
                row.total_cess,
                row.total_value,
                row.irn,
                row.irn_date,
                row.place_of_supply,
                row.reverse_charge,
                row.invoice_type,
                row.status,
                row.cancellation_date,
                row.import_batch_id
            ],
        )
        .map_err(|e| AppError::Db {
            code: "ERR_DB_003".to_string(),
            message: format!("Failed to insert invoice: {}", e),
        })?;
        Ok(())
    }

    fn update_invoice_status(
        &self,
        conn: &mut Connection,
        number: &str,
        status: &str,
    ) -> Result<(), AppError> {
        let cancel_date = if status == "Cancelled" {
            "datetime('now')"
        } else {
            "NULL"
        };

        let query = format!(
            "UPDATE invoices SET status = ?, cancellation_date = {}, updated_at = datetime('now') WHERE invoice_number = ?",
            cancel_date
        );

        conn.execute(&query, params![status, number])
            .map_err(|e| AppError::Db {
                code: "ERR_DB_003".to_string(),
                message: format!("Failed to update invoice status: {}", e),
            })?;
        Ok(())
    }

    fn delete_invoice(&self, conn: &mut Connection, number: &str) -> Result<(), AppError> {
        conn.execute("DELETE FROM invoices WHERE invoice_number = ?", [number])
            .map_err(|e| AppError::Db {
                code: "ERR_DB_003".to_string(),
                message: format!("Failed to delete invoice: {}", e),
            })?;
        Ok(())
    }

    fn find_invoice(
        &self,
        conn: &Connection,
        number: &str,
    ) -> Result<Option<InvoiceRow>, AppError> {
        conn.query_row(
            "SELECT invoice_number, invoice_no_long, invoice_date, customer_id, financial_year_id,
                    total_taxable, total_cgst, total_sgst, total_igst, total_cess, total_value,
                    irn, irn_date, place_of_supply, reverse_charge, invoice_type, status, cancellation_date, import_batch_id, created_at, updated_at,
                    COALESCE(version, 1)
             FROM invoices WHERE invoice_number = ?",
            [number],
            |row| {
                Ok(InvoiceRow {
                    invoice_number: row.get(0)?,
                    invoice_no_long: row.get(1)?,
                    invoice_date: row.get(2)?,
                    customer_id: row.get(3)?,
                    financial_year_id: row.get(4)?,
                    total_taxable: row.get(5)?,
                    total_cgst: row.get(6)?,
                    total_sgst: row.get(7)?,
                    total_igst: row.get(8)?,
                    total_cess: row.get(9)?,
                    total_value: row.get(10)?,
                    irn: row.get(11)?,
                    irn_date: row.get(12)?,
                    place_of_supply: row.get(13)?,
                    reverse_charge: row.get(14)?,
                    invoice_type: row.get(15)?,
                    status: row.get(16)?,
                    cancellation_date: row.get(17)?,
                    import_batch_id: row.get(18)?,
                    created_at: row.get(19)?,
                    updated_at: row.get(20)?,
                    version: row.get(21)?,
                })
            },
        )
        .optional()
        .map_err(|e| AppError::Db {
            code: "ERR_DB_003".to_string(),
            message: format!("Failed to find invoice: {}", e),
        })
    }

    fn list_invoices_paginated(
        &self,
        conn: &Connection,
        cursor_date: Option<&str>,
        cursor_no: Option<&str>,
        limit: u32,
    ) -> Result<Vec<InvoiceSummary>, AppError> {
        let mut query = "
            SELECT i.invoice_number, i.invoice_date, c.customer_code, c.report_name AS customer_name,
                   i.total_taxable, (i.total_cgst + i.total_sgst + i.total_igst) as total_tax,
                   i.total_value, i.status
            FROM invoices i
            JOIN customers c ON i.customer_id = c.id
        "
        .to_string();

        let mut params_vec: Vec<String> = Vec::new();

        if let (Some(c_date), Some(c_no)) = (cursor_date, cursor_no) {
            query.push_str(
                " WHERE (i.invoice_date < ? OR (i.invoice_date = ? AND i.invoice_number < ?))",
            );
            params_vec.push(c_date.to_string());
            params_vec.push(c_date.to_string());
            params_vec.push(c_no.to_string());
        }

        query.push_str(" ORDER BY i.invoice_date DESC, i.invoice_number DESC LIMIT ?");

        let mut stmt = conn.prepare(&query).map_err(|e| AppError::Db {
            code: "ERR_DB_003".to_string(),
            message: format!("Failed to prepare paginated invoices query: {}", e),
        })?;

        let map_row = |row: &rusqlite::Row| -> rusqlite::Result<InvoiceSummary> {
            Ok(InvoiceSummary {
                invoice_number: row.get(0)?,
                invoice_date: row.get(1)?,
                customer_code: row.get(2)?,
                customer_name: row.get(3)?,
                total_taxable: row.get(4)?,
                total_tax: row.get(5)?,
                total_value: row.get(6)?,
                status: row.get(7)?,
            })
        };

        // Setup parameters binding safely
        let rows = if params_vec.is_empty() {
            stmt.query_map([limit], map_row)
        } else {
            stmt.query_map(
                params![params_vec[0], params_vec[1], params_vec[2], limit],
                map_row,
            )
        }
        .map_err(|e| AppError::Db {
            code: "ERR_DB_003".to_string(),
            message: format!("Failed to query paginated invoices: {}", e),
        })?;

        let mut list = Vec::new();
        for r in rows {
            list.push(r.map_err(|e| AppError::Db {
                code: "ERR_DB_003".to_string(),
                message: format!("Failed to parse invoice summary: {}", e),
            })?);
        }
        Ok(list)
    }

    // Invoice Items
    fn insert_invoice_items(
        &self,
        conn: &mut Connection,
        items: &[InvoiceItemRow],
    ) -> Result<(), AppError> {
        let mut stmt = conn.prepare(
            "INSERT INTO invoice_items (invoice_number, part_code, quantity, rate_pre_unit, assessable_value,
                                        cgst_rate, cgst_amount, sgst_rate, sgst_amount, igst_rate, igst_amount, total_value)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .map_err(|e| AppError::Db {
            code: "ERR_DB_003".to_string(),
            message: format!("Failed to prepare insert invoice item query: {}", e),
        })?;

        for item in items {
            stmt.execute(params![
                item.invoice_number,
                item.part_code,
                item.quantity,
                item.rate_pre_unit,
                item.assessable_value,
                item.cgst_rate,
                item.cgst_amount,
                item.sgst_rate,
                item.sgst_amount,
                item.igst_rate,
                item.igst_amount,
                item.total_value
            ])
            .map_err(|e| AppError::Db {
                code: "ERR_DB_003".to_string(),
                message: format!("Failed to insert invoice item line: {}", e),
            })?;
        }
        Ok(())
    }

    fn get_invoice_items(
        &self,
        conn: &Connection,
        invoice_number: &str,
    ) -> Result<Vec<InvoiceItemRow>, AppError> {
        let mut stmt = conn.prepare(
            "SELECT ii.id, ii.invoice_number, ii.part_code, ii.quantity, ii.rate_pre_unit, ii.assessable_value,
                    ii.cgst_rate, ii.cgst_amount, ii.sgst_rate, ii.sgst_amount, ii.igst_rate, ii.igst_amount, ii.total_value,
                    it.part_name AS description
             FROM invoice_items ii
             LEFT JOIN items it ON ii.part_code = it.part_code
             WHERE ii.invoice_number = ?",
        )
        .map_err(|e| AppError::Db {
            code: "ERR_DB_003".to_string(),
            message: format!("Failed to prepare get invoice items query: {}", e),
        })?;

        let rows = stmt
            .query_map([invoice_number], |row| {
                Ok(InvoiceItemRow {
                    id: Some(row.get(0)?),
                    invoice_number: row.get(1)?,
                    part_code: row.get(2)?,
                    description: row.get(13).ok(),
                    quantity: row.get(3)?,
                    rate_pre_unit: row.get(4)?,
                    assessable_value: row.get(5)?,
                    cgst_rate: row.get(6)?,
                    cgst_amount: row.get(7)?,
                    sgst_rate: row.get(8)?,
                    sgst_amount: row.get(9)?,
                    igst_rate: row.get(10)?,
                    igst_amount: row.get(11)?,
                    total_value: row.get(12)?,
                })
            })
            .map_err(|e| AppError::Db {
                code: "ERR_DB_003".to_string(),
                message: format!("Failed to query invoice items: {}", e),
            })?;

        let mut list = Vec::new();
        for r in rows {
            list.push(r.map_err(|e| AppError::Db {
                code: "ERR_DB_003".to_string(),
                message: format!("Failed to parse invoice item line: {}", e),
            })?);
        }
        Ok(list)
    }
}
