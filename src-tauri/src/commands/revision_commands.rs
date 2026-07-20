use crate::error::AppError;
use crate::models::database_models::{
    CreditNoteRow, DebitNoteItemRow, DebitNoteRow, SupplierPriceRevisionRow,
};
use crate::repositories::report_repo::SqliteReportRepository;
use crate::repositories::ReportRepository;
use crate::state::DbState;
use rusqlite::params;
use tauri::State;

#[tauri::command]
pub fn create_price_revision(
    state: State<'_, DbState>,
    supplier_id: i64,
    part_code: String,
    old_price: f64,
    new_price: f64,
    effective_date: String,
    remarks: Option<String>,
) -> Result<i64, AppError> {
    log::info!(
        "Creating price revision for supplier_id: {}, part: {}",
        supplier_id,
        part_code
    );

    let mut conn_guard = state
        .conn
        .lock()
        .map_err(|e| AppError::Internal(format!("Failed to acquire connection lock: {}", e)))?;
    let conn = conn_guard.as_mut().ok_or_else(|| AppError::Db {
        code: "ERR_DB_002".to_string(),
        message: "No active database connection profile".to_string(),
    })?;

    let tx = conn.transaction().map_err(|e| AppError::Db {
        code: "ERR_DB_003".to_string(),
        message: format!("Failed to begin transaction: {}", e),
    })?;

    // Inserts price revision
    let difference = old_price - new_price;
    tx.execute(
        "INSERT INTO supplier_price_revisions (supplier_id, part_code, old_price, new_price, difference, effective_date, remarks, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'Draft')",
        params![supplier_id, part_code, old_price, new_price, difference, effective_date, remarks],
    )
    .map_err(|e| AppError::Db {
        code: "ERR_DB_003".to_string(),
        message: format!("Failed to create price revision: {}", e),
    })?;

    let revision_id = tx.last_insert_rowid();

    // Log in general item_price_history table
    tx.execute(
        "INSERT INTO item_price_history (part_code, effective_date, old_price, new_price, supplier_id, reason, updated_by)
         VALUES (?, ?, ?, ?, ?, ?, 'System')",
        params![part_code, effective_date, old_price, new_price, supplier_id, remarks],
    )
    .map_err(|e| AppError::Db {
        code: "ERR_DB_003".to_string(),
        message: format!("Failed to write item price history: {}", e),
    })?;

    tx.commit().map_err(|e| AppError::Db {
        code: "ERR_DB_003".to_string(),
        message: format!("Failed to commit price revision: {}", e),
    })?;

    Ok(revision_id)
}

#[tauri::command]
pub fn get_price_revisions(
    state: State<'_, DbState>,
) -> Result<Vec<SupplierPriceRevisionRow>, AppError> {
    let conn_guard = state
        .conn
        .lock()
        .map_err(|e| AppError::Internal(format!("Failed to acquire connection lock: {}", e)))?;
    let conn = conn_guard.as_ref().ok_or_else(|| AppError::Db {
        code: "ERR_DB_002".to_string(),
        message: "No active database connection profile".to_string(),
    })?;

    let mut stmt = conn
        .prepare(
            "SELECT id, supplier_id, part_code, old_price, new_price, difference, effective_date, remarks, status, approved_at, created_at 
             FROM supplier_price_revisions 
             ORDER BY created_at DESC",
        )
        .map_err(|e| AppError::Db {
            code: "ERR_DB_003".to_string(),
            message: format!("Failed to prepare query: {}", e),
        })?;

    let rows = stmt
        .query_map([], |row| {
            Ok(SupplierPriceRevisionRow {
                id: Some(row.get(0)?),
                supplier_id: row.get(1)?,
                part_code: row.get(2)?,
                old_price: row.get(3)?,
                new_price: row.get(4)?,
                difference: row.get(5)?,
                effective_date: row.get(6)?,
                remarks: row.get(7)?,
                status: row.get(8)?,
                approved_at: row.get(9)?,
                created_at: row.get(10)?,
            })
        })
        .map_err(|e| AppError::Db {
            code: "ERR_DB_003".to_string(),
            message: format!("Failed to fetch revisions: {}", e),
        })?;

    let mut list = Vec::new();
    for r in rows {
        list.push(r.map_err(|e| AppError::Db {
            code: "ERR_DB_003".to_string(),
            message: format!("Failed to read revision row: {}", e),
        })?);
    }
    Ok(list)
}

#[tauri::command]
pub fn preview_revision_recovery(
    state: State<'_, DbState>,
    revision_id: i64,
) -> Result<Vec<DebitNoteItemRow>, AppError> {
    let conn_guard = state
        .conn
        .lock()
        .map_err(|e| AppError::Internal(format!("Failed to acquire connection lock: {}", e)))?;
    let conn = conn_guard.as_ref().ok_or_else(|| AppError::Db {
        code: "ERR_DB_002".to_string(),
        message: "No active database connection profile".to_string(),
    })?;

    // Load price revision details
    let rev: SupplierPriceRevisionRow = conn
        .query_row(
            "SELECT id, supplier_id, part_code, old_price, new_price, difference, effective_date, remarks, status, approved_at, created_at
             FROM supplier_price_revisions WHERE id = ?",
            [revision_id],
            |row| {
                Ok(SupplierPriceRevisionRow {
                    id: Some(row.get(0)?),
                    supplier_id: row.get(1)?,
                    part_code: row.get(2)?,
                    old_price: row.get(3)?,
                    new_price: row.get(4)?,
                    difference: row.get(5)?,
                    effective_date: row.get(6)?,
                    remarks: row.get(7)?,
                    status: row.get(8)?,
                    approved_at: row.get(9)?,
                    created_at: row.get(10)?,
                })
            },
        )
        .map_err(|e| AppError::Db {
            code: "ERR_DB_003".to_string(),
            message: format!("Failed to retrieve revision details: {}", e),
        })?;

    // Join invoices and invoice_items to find matching rows for recovery analysis
    let mut stmt = conn
        .prepare(
            "SELECT ii.invoice_number, ii.part_code, ii.quantity, ii.rate_pre_unit, ii.cgst_rate, ii.sgst_rate, ii.igst_rate
             FROM invoice_items ii
             JOIN invoices i ON ii.invoice_number = i.invoice_number
             WHERE ii.part_code = ? 
               AND i.invoice_date >= ?
               AND i.status != 'Cancelled'
               AND ii.rate_pre_unit > ?",
        )
        .map_err(|e| AppError::Db {
            code: "ERR_DB_003".to_string(),
            message: format!("Failed to prepare recovery preview query: {}", e),
        })?;

    let rows = stmt
        .query_map(
            params![rev.part_code, rev.effective_date, rev.new_price],
            |row| {
                let invoice_number: String = row.get(0)?;
                let part_code: String = row.get(1)?;
                let quantity: f64 = row.get(2)?;
                let rate_pre_unit: f64 = row.get(3)?;
                let cgst_rate: f64 = row.get(4)?;
                let sgst_rate: f64 = row.get(5)?;
                let igst_rate: f64 = row.get(6)?;

                let rate_diff = rate_pre_unit - rev.new_price;
                let assessable_diff = quantity * rate_diff;
                let cgst_amount = assessable_diff * (cgst_rate / 100.0);
                let sgst_amount = assessable_diff * (sgst_rate / 100.0);
                let igst_amount = assessable_diff * (igst_rate / 100.0);
                let total_diff = assessable_diff + cgst_amount + sgst_amount + igst_amount;

                Ok(DebitNoteItemRow {
                    id: None,
                    debit_note_number: "".to_string(),
                    invoice_number,
                    part_code,
                    quantity,
                    rate_difference: rate_diff,
                    assessable_difference: assessable_diff,
                    cgst_amount,
                    sgst_amount,
                    igst_amount,
                    total_difference: total_diff,
                })
            },
        )
        .map_err(|e| AppError::Db {
            code: "ERR_DB_003".to_string(),
            message: format!("Failed to run recovery preview: {}", e),
        })?;

    let mut preview = Vec::new();
    for r in rows {
        preview.push(r.map_err(|e| AppError::Db {
            code: "ERR_DB_003".to_string(),
            message: format!("Failed to read recovery row: {}", e),
        })?);
    }
    Ok(preview)
}

#[tauri::command]
pub fn generate_debit_note(
    state: State<'_, DbState>,
    revision_id: i64,
    debit_note_number: String,
    remarks: Option<String>,
) -> Result<(), AppError> {
    log::info!(
        "Generating debit note: {} from revision ID: {}",
        debit_note_number,
        revision_id
    );

    let mut conn_guard = state
        .conn
        .lock()
        .map_err(|e| AppError::Internal(format!("Failed to acquire connection lock: {}", e)))?;
    let conn = conn_guard.as_mut().ok_or_else(|| AppError::Db {
        code: "ERR_DB_002".to_string(),
        message: "No active database connection profile".to_string(),
    })?;

    let tx = conn.transaction().map_err(|e| AppError::Db {
        code: "ERR_DB_003".to_string(),
        message: format!("Failed to start transaction: {}", e),
    })?;

    // Load price revision details
    let rev: SupplierPriceRevisionRow = tx
        .query_row(
            "SELECT id, supplier_id, part_code, old_price, new_price, difference, effective_date, remarks, status, approved_at, created_at
             FROM supplier_price_revisions WHERE id = ?",
            [revision_id],
            |row| {
                Ok(SupplierPriceRevisionRow {
                    id: Some(row.get(0)?),
                    supplier_id: row.get(1)?,
                    part_code: row.get(2)?,
                    old_price: row.get(3)?,
                    new_price: row.get(4)?,
                    difference: row.get(5)?,
                    effective_date: row.get(6)?,
                    remarks: row.get(7)?,
                    status: row.get(8)?,
                    approved_at: row.get(9)?,
                    created_at: row.get(10)?,
                })
            },
        )
        .map_err(|e| AppError::Db {
            code: "ERR_DB_003".to_string(),
            message: format!("Failed to retrieve revision details: {}", e),
        })?;

    // Recalculate items to write to debit_note_items
    let mut stmt = tx
        .prepare(
            "SELECT ii.invoice_number, ii.part_code, ii.quantity, ii.rate_pre_unit, ii.cgst_rate, ii.sgst_rate, ii.igst_rate
             FROM invoice_items ii
             JOIN invoices i ON ii.invoice_number = i.invoice_number
             WHERE ii.part_code = ? 
               AND i.invoice_date >= ?
               AND i.status != 'Cancelled'
               AND ii.rate_pre_unit > ?",
        )
        .map_err(|e| AppError::Db {
            code: "ERR_DB_003".to_string(),
            message: format!("Failed to prepare recovery items: {}", e),
        })?;

    let rows = stmt
        .query_map(
            params![rev.part_code, rev.effective_date, rev.new_price],
            |row| {
                let invoice_number: String = row.get(0)?;
                let part_code: String = row.get(1)?;
                let quantity: f64 = row.get(2)?;
                let rate_pre_unit: f64 = row.get(3)?;
                let cgst_rate: f64 = row.get(4)?;
                let sgst_rate: f64 = row.get(5)?;
                let igst_rate: f64 = row.get(6)?;

                let rate_diff = rate_pre_unit - rev.new_price;
                let assessable_diff = quantity * rate_diff;
                let cgst_amount = assessable_diff * (cgst_rate / 100.0);
                let sgst_amount = assessable_diff * (sgst_rate / 100.0);
                let igst_amount = assessable_diff * (igst_rate / 100.0);
                let total_diff = assessable_diff + cgst_amount + sgst_amount + igst_amount;

                Ok(DebitNoteItemRow {
                    id: None,
                    debit_note_number: debit_note_number.clone(),
                    invoice_number,
                    part_code,
                    quantity,
                    rate_difference: rate_diff,
                    assessable_difference: assessable_diff,
                    cgst_amount,
                    sgst_amount,
                    igst_amount,
                    total_difference: total_diff,
                })
            },
        )
        .map_err(|e| AppError::Db {
            code: "ERR_DB_003".to_string(),
            message: format!("Failed to run recovery calculations: {}", e),
        })?;

    let mut items = Vec::new();
    let mut total_taxable = 0.0;
    let mut total_cgst = 0.0;
    let mut total_sgst = 0.0;
    let mut total_igst = 0.0;
    let mut total_value = 0.0;

    for r in rows {
        let it = r.map_err(|e| AppError::Db {
            code: "ERR_DB_003".to_string(),
            message: format!("Failed to parse note item: {}", e),
        })?;
        total_taxable += it.assessable_difference;
        total_cgst += it.cgst_amount;
        total_sgst += it.sgst_amount;
        total_igst += it.igst_amount;
        total_value += it.total_difference;
        items.push(it);
    }

    drop(stmt);

    if items.is_empty() {
        return Err(AppError::Validation {
            code: "ERR_NOTE_001".to_string(),
            message: "No invoices match the price revision parameters for recovery".to_string(),
        });
    }

    // Insert debit note header
    tx.execute(
        "INSERT INTO debit_notes (debit_note_number, supplier_id, revision_id, debit_note_date, total_taxable, total_cgst, total_sgst, total_igst, total_value, status, remarks)
         VALUES (?, ?, ?, date('now'), ?, ?, ?, ?, ?, 'Draft', ?)",
        params![debit_note_number, rev.supplier_id, revision_id, total_taxable, total_cgst, total_sgst, total_igst, total_value, remarks],
    )
    .map_err(|e| AppError::Db {
        code: "ERR_DB_003".to_string(),
        message: format!("Failed to write debit note header: {}", e),
    })?;

    // Insert debit note items
    for it in items {
        tx.execute(
            "INSERT INTO debit_note_items (debit_note_number, invoice_number, part_code, quantity, rate_difference, assessable_difference, cgst_amount, sgst_amount, igst_amount, total_difference)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            params![debit_note_number, it.invoice_number, it.part_code, it.quantity, it.rate_difference, it.assessable_difference, it.cgst_amount, it.sgst_amount, it.igst_amount, it.total_difference],
        )
        .map_err(|e| AppError::Db {
            code: "ERR_DB_003".to_string(),
            message: format!("Failed to write debit note line items: {}", e),
        })?;
    }

    // Update price revision status
    tx.execute(
        "UPDATE supplier_price_revisions SET status = 'Approved', approved_at = datetime('now') WHERE id = ?",
        [revision_id],
    )
    .map_err(|e| AppError::Db {
        code: "ERR_DB_003".to_string(),
        message: format!("Failed to update revision status: {}", e),
    })?;

    tx.commit().map_err(|e| AppError::Db {
        code: "ERR_DB_003".to_string(),
        message: format!("Failed to commit debit note generation: {}", e),
    })?;

    if let Ok(mut cache) = state.dashboard_cache.lock() {
        *cache = None;
    }

    Ok(())
}

#[tauri::command]
pub fn list_debit_notes(state: State<'_, DbState>) -> Result<Vec<DebitNoteRow>, AppError> {
    let conn_guard = state
        .conn
        .lock()
        .map_err(|e| AppError::Internal(format!("Failed to acquire connection lock: {}", e)))?;
    let conn = conn_guard.as_ref().ok_or_else(|| AppError::Db {
        code: "ERR_DB_002".to_string(),
        message: "No active database connection profile".to_string(),
    })?;

    let mut stmt = conn
        .prepare(
            "SELECT debit_note_number, supplier_id, revision_id, debit_note_date, total_taxable, total_cgst, total_sgst, total_igst, total_value, status, remarks, approved_at, created_at 
             FROM debit_notes 
             ORDER BY created_at DESC",
        )
        .map_err(|e| AppError::Db {
            code: "ERR_DB_003".to_string(),
            message: format!("Failed to prepare debit notes query: {}", e),
        })?;

    let rows = stmt
        .query_map([], |row| {
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
        })
        .map_err(|e| AppError::Db {
            code: "ERR_DB_003".to_string(),
            message: format!("Failed to execute query: {}", e),
        })?;

    let mut list = Vec::new();
    for r in rows {
        list.push(r.map_err(|e| AppError::Db {
            code: "ERR_DB_003".to_string(),
            message: format!("Failed to parse debit note row: {}", e),
        })?);
    }
    Ok(list)
}

#[tauri::command]
pub fn approve_debit_note(
    state: State<'_, DbState>,
    debit_note_number: String,
    user_name: String,
) -> Result<(), AppError> {
    let mut conn_guard = state
        .conn
        .lock()
        .map_err(|e| AppError::Internal(format!("Failed to acquire connection lock: {}", e)))?;
    let conn = conn_guard.as_mut().ok_or_else(|| AppError::Db {
        code: "ERR_DB_002".to_string(),
        message: "No active database connection profile".to_string(),
    })?;

    let tx = conn.transaction().map_err(|e| AppError::Db {
        code: "ERR_DB_003".to_string(),
        message: format!("Failed to start transaction: {}", e),
    })?;

    // Update status to Approved
    tx.execute(
        "UPDATE debit_notes SET status = 'Approved', approved_at = datetime('now') WHERE debit_note_number = ?",
        [&debit_note_number],
    )
    .map_err(|e| AppError::Db {
        code: "ERR_DB_003".to_string(),
        message: format!("Failed to approve debit note: {}", e),
    })?;

    // Log audit log trace
    tx.execute(
        "INSERT INTO audit_log (user_action, table_name, record_id, old_value, new_value)
         VALUES (?, 'debit_notes', ?, 'Draft', 'Approved')",
        params![
            format!("Debit Note approved by {}", user_name),
            debit_note_number
        ],
    )
    .map_err(|e| AppError::Db {
        code: "ERR_DB_003".to_string(),
        message: format!("Failed to log audit details: {}", e),
    })?;

    tx.commit().map_err(|e| AppError::Db {
        code: "ERR_DB_003".to_string(),
        message: format!("Failed to commit approval: {}", e),
    })?;

    if let Ok(mut cache) = state.dashboard_cache.lock() {
        *cache = None;
    }

    Ok(())
}

#[tauri::command]
pub fn auto_generate_credit_note(
    state: State<'_, DbState>,
    invoice_number: String,
    remarks: Option<String>,
) -> Result<String, AppError> {
    log::info!(
        "Auto-generating credit note for cancelled invoice: {}",
        invoice_number
    );

    let mut conn_guard = state
        .conn
        .lock()
        .map_err(|e| AppError::Internal(format!("Failed to acquire connection lock: {}", e)))?;
    let conn = conn_guard.as_mut().ok_or_else(|| AppError::Db {
        code: "ERR_DB_002".to_string(),
        message: "No active database connection profile".to_string(),
    })?;

    let tx = conn.transaction().map_err(|e| AppError::Db {
        code: "ERR_DB_003".to_string(),
        message: format!("Failed to start transaction: {}", e),
    })?;

    // Find invoice details
    let (customer_id, total_taxable, total_cgst, total_sgst, total_igst, total_value, status, financial_year_id) = tx.query_row(
        "SELECT customer_id, total_taxable, total_cgst, total_sgst, total_igst, total_value, status, financial_year_id
         FROM invoices WHERE invoice_number = ?",
        [&invoice_number],
        |row| {
            Ok((
                row.get::<_, i64>(0)?,
                row.get::<_, f64>(1)?,
                row.get::<_, f64>(2)?,
                row.get::<_, f64>(3)?,
                row.get::<_, f64>(4)?,
                row.get::<_, f64>(5)?,
                row.get::<_, String>(6)?,
                row.get::<_, i64>(7)?,
            ))
        },
    )
    .map_err(|e| AppError::Db {
        code: "ERR_DB_003".to_string(),
        message: format!("Invoice not found: {}", e),
    })?;

    if status != "Cancelled" {
        return Err(AppError::Validation {
            code: "ERR_NOTE_002".to_string(),
            message: "Credit notes can only be auto-generated for Cancelled invoices".to_string(),
        });
    }

    let credit_note_number = format!("CN-{}", invoice_number);

    // Insert Credit Note
    tx.execute(
        "INSERT INTO credit_notes (credit_note_number, invoice_number, customer_id, credit_note_date, total_taxable, total_cgst, total_sgst, total_igst, total_value, status, remarks)
         VALUES (?, ?, ?, date('now'), ?, ?, ?, ?, ?, 'Draft', ?)",
        params![
            credit_note_number,
            invoice_number,
            customer_id,
            total_taxable,
            total_cgst,
            total_sgst,
            total_igst,
            total_value,
            remarks
        ],
    )
    .map_err(|e| AppError::Db {
        code: "ERR_DB_003".to_string(),
        message: format!("Failed to create credit note record: {}", e),
    })?;

    // Update invoice status
    tx.execute(
        "UPDATE invoices SET status = 'Credit Note Generated' WHERE invoice_number = ?",
        [&invoice_number],
    )
    .map_err(|e| AppError::Db {
        code: "ERR_DB_003".to_string(),
        message: format!("Failed to update invoice status flag: {}", e),
    })?;

    let report_repo = SqliteReportRepository;
    report_repo.refresh_monthly_summary(&tx, financial_year_id)?;
    report_repo.refresh_customer_summary(&tx, financial_year_id)?;
    report_repo.refresh_supplier_summary(&tx, financial_year_id)?;

    tx.commit().map_err(|e| AppError::Db {
        code: "ERR_DB_003".to_string(),
        message: format!("Failed to commit credit note transaction: {}", e),
    })?;

    if let Ok(mut cache) = state.dashboard_cache.lock() {
        *cache = None;
    }

    Ok(credit_note_number)
}

#[tauri::command]
pub fn list_credit_notes(state: State<'_, DbState>) -> Result<Vec<CreditNoteRow>, AppError> {
    let conn_guard = state
        .conn
        .lock()
        .map_err(|e| AppError::Internal(format!("Failed to acquire connection lock: {}", e)))?;
    let conn = conn_guard.as_ref().ok_or_else(|| AppError::Db {
        code: "ERR_DB_002".to_string(),
        message: "No active database connection profile".to_string(),
    })?;

    let mut stmt = conn
        .prepare(
            "SELECT credit_note_number, invoice_number, customer_id, credit_note_date, total_taxable, total_cgst, total_sgst, total_igst, total_value, status, remarks, approved_at, created_at 
             FROM credit_notes 
             ORDER BY created_at DESC",
        )
        .map_err(|e| AppError::Db {
            code: "ERR_DB_003".to_string(),
            message: format!("Failed to prepare credit notes query: {}", e),
        })?;

    let rows = stmt
        .query_map([], |row| {
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
        })
        .map_err(|e| AppError::Db {
            code: "ERR_DB_003".to_string(),
            message: format!("Failed to execute credit notes query: {}", e),
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
