use crate::error::AppError;
use crate::models::bulk_action::{
    BulkActionResult, FailReason, FailedInvoiceInfo, InvoiceStatus, SkipReason,
    SkippedInvoiceInfo,
};
use crate::models::bulk_action_dto::{FilterCriteriaDTO, SelectionModeDTO};
use crate::repositories::report_repo::SqliteReportRepository;
use crate::repositories::ReportRepository;
use rusqlite::{params, Connection};
use std::time::Instant;
use uuid::Uuid;

pub struct BulkActionService;

impl BulkActionService {
    /// Executes bulk verification of invoices inside an atomic SQLite transaction.
    /// Emits performance metrics, correlation batch ID, parent/child audit logs, and handles post-commit cache refresh.
    pub fn execute_bulk_verify(
        conn: &mut Connection,
        selection: &SelectionModeDTO,
        user_name: &str,
    ) -> Result<BulkActionResult, AppError> {
        let total_start = Instant::now();
        let batch_id = Uuid::new_v4().to_string();

        // 1. Resolve Target Invoices from selection mode
        let target_invoice_numbers = Self::resolve_selection(conn, selection)?;
        let total_requested = target_invoice_numbers.len();

        let db_start = Instant::now();

        // 2. Begin SQLite Transaction
        let tx = conn.transaction().map_err(|e| AppError::Db {
            code: "ERR_DB_003".to_string(),
            message: format!("Failed to begin bulk verify transaction: {}", e),
        })?;

        let mut updated_count = 0;
        let mut skipped_invoices: Vec<SkippedInvoiceInfo> = Vec::new();
        let mut failed_invoices: Vec<FailedInvoiceInfo> = Vec::new();
        let mut fy_cache = std::collections::HashMap::<i64, bool>::new();
        let mut affected_fy_ids = std::collections::HashSet::<i64>::new();

        for inv_no in target_invoice_numbers {
            // Read invoice header info
            let row_res = tx.query_row(
                "SELECT status, financial_year_id FROM invoices WHERE invoice_number = ?",
                [&inv_no],
                |row| {
                    let st: String = row.get(0)?;
                    let fy_id: i64 = row.get(1)?;
                    Ok((st, fy_id))
                },
            );

            let (current_status_str, fy_id) = match row_res {
                Ok(data) => data,
                Err(rusqlite::Error::QueryReturnedNoRows) => {
                    failed_invoices.push(FailedInvoiceInfo {
                        invoice_number: inv_no,
                        reason: FailReason::ValidationFailed,
                        message: "Invoice record not found".to_string(),
                    });
                    continue;
                }
                Err(e) => {
                    failed_invoices.push(FailedInvoiceInfo {
                        invoice_number: inv_no,
                        reason: FailReason::UnexpectedError,
                        message: format!("Database read error: {}", e),
                    });
                    continue;
                }
            };

            // Check Financial Year Lock status
            let is_locked = if let Some(&locked) = fy_cache.get(&fy_id) {
                locked
            } else {
                let locked: i32 = tx
                    .query_row(
                        "SELECT is_locked FROM financial_years WHERE id = ?",
                        [fy_id],
                        |r| r.get(0),
                    )
                    .unwrap_or(0);
                let lock_bool = locked == 1;
                fy_cache.insert(fy_id, lock_bool);
                lock_bool
            };

            if is_locked {
                failed_invoices.push(FailedInvoiceInfo {
                    invoice_number: inv_no,
                    reason: FailReason::FinancialYearLocked,
                    message: format!("Financial year ID {} is locked", fy_id),
                });
                continue;
            }

            // Check status transitions
            let parsed_status = InvoiceStatus::from_db_value(&current_status_str);
            match parsed_status {
                Some(InvoiceStatus::Verified) => {
                    skipped_invoices.push(SkippedInvoiceInfo {
                        invoice_number: inv_no,
                        reason: SkipReason::AlreadyVerified,
                    });
                    continue;
                }
                Some(InvoiceStatus::Cancelled) | Some(InvoiceStatus::CreditNoteGenerated) => {
                    skipped_invoices.push(SkippedInvoiceInfo {
                        invoice_number: inv_no,
                        reason: SkipReason::InvalidTransition,
                    });
                    continue;
                }
                Some(InvoiceStatus::Imported) | Some(InvoiceStatus::Draft) => {
                    // Allowed transition -> execute update
                }
                None => {
                    skipped_invoices.push(SkippedInvoiceInfo {
                        invoice_number: inv_no,
                        reason: SkipReason::InvalidTransition,
                    });
                    continue;
                }
            }

            // Optimistic concurrency update
            let rows_affected = tx
                .execute(
                    "UPDATE invoices SET status = ?, updated_at = datetime('now') WHERE invoice_number = ? AND status IN ('Imported', 'Draft')",
                    params![InvoiceStatus::Verified.as_db_value(), inv_no],
                )
                .map_err(|e| AppError::Db {
                    code: "ERR_DB_003".to_string(),
                    message: format!("Failed to update invoice {}: {}", inv_no, e),
                })?;

            if rows_affected > 0 {
                updated_count += 1;
                affected_fy_ids.insert(fy_id);

                // Insert Child Record Audit Entry
                let user_action = format!(
                    "Bulk Verify (Batch: {}) status updated from '{}' to '{}' by {}",
                    batch_id,
                    current_status_str,
                    InvoiceStatus::Verified.as_db_value(),
                    user_name
                );

                tx.execute(
                    "INSERT INTO audit_log (user_action, table_name, record_id, old_value, new_value)
                     VALUES (?, 'invoices', ?, ?, ?)",
                    params![
                        user_action,
                        inv_no,
                        format!("{{\"status\":\"{}\"}}", current_status_str),
                        format!("{{\"status\":\"{}\",\"batch_id\":\"{}\"}}", InvoiceStatus::Verified.as_db_value(), batch_id)
                    ],
                )
                .map_err(|e| AppError::Db {
                    code: "ERR_DB_003".to_string(),
                    message: format!("Failed to write child audit log for {}: {}", inv_no, e),
                })?;
            } else {
                skipped_invoices.push(SkippedInvoiceInfo {
                    invoice_number: inv_no,
                    reason: SkipReason::AlreadyVerified,
                });
            }
        }

        let db_time_ms = db_start.elapsed().as_millis();
        let audit_start = Instant::now();

        // 3. Write Parent Batch Audit Entry
        let parent_telemetry = serde_json::json!({
            "event": "bulk_verify_completed",
            "version": 1,
            "batch_id": batch_id,
            "user_name": user_name,
            "requested_count": total_requested,
            "updated_count": updated_count,
            "skipped_count": skipped_invoices.len(),
            "failed_count": failed_invoices.len(),
            "db_time_ms": db_time_ms,
        });

        tx.execute(
            "INSERT INTO audit_log (user_action, table_name, record_id, old_value, new_value)
             VALUES (?, 'bulk_actions', ?, NULL, ?)",
            params![
                format!("Executed Bulk Verify batch {} by {}", batch_id, user_name),
                batch_id,
                parent_telemetry.to_string()
            ],
        )
        .map_err(|e| AppError::Db {
            code: "ERR_DB_003".to_string(),
            message: format!("Failed to write parent batch audit log: {}", e),
        })?;

        // 4. Commit SQLite Transaction
        tx.commit().map_err(|e| AppError::Db {
            code: "ERR_DB_003".to_string(),
            message: format!("Failed to commit bulk verify transaction: {}", e),
        })?;

        let audit_time_ms = audit_start.elapsed().as_millis();
        let cache_start = Instant::now();

        // 5. Post-Commit Cache Refresh (only if updated_count > 0)
        if updated_count > 0 {
            let report_repo = SqliteReportRepository;
            for fy_id in affected_fy_ids {
                let _ = report_repo.refresh_monthly_summary(conn, fy_id);
                let _ = report_repo.refresh_customer_summary(conn, fy_id);
                let _ = report_repo.refresh_supplier_summary(conn, fy_id);
            }
        }

        let cache_time_ms = cache_start.elapsed().as_millis();
        let execution_time_ms = total_start.elapsed().as_millis();

        log::info!(
            "Bulk verify completed [Batch ID: {}]. Updated: {}, Skipped: {}, Failed: {} in {}ms",
            batch_id,
            updated_count,
            skipped_invoices.len(),
            failed_invoices.len(),
            execution_time_ms
        );

        Ok(BulkActionResult {
            batch_id,
            updated: updated_count,
            skipped: skipped_invoices.len(),
            failed: failed_invoices.len(),
            skipped_invoices,
            failed_invoices,
            execution_time_ms,
            db_time_ms,
            audit_time_ms,
            cache_time_ms,
        })
    }

    /// Resolves selection mode into list of matching invoice numbers using SQLite query engine
    fn resolve_selection(
        conn: &Connection,
        selection: &SelectionModeDTO,
    ) -> Result<Vec<String>, AppError> {
        match selection {
            SelectionModeDTO::Direct { invoice_numbers } => Ok(invoice_numbers.clone()),
            SelectionModeDTO::ServerResolved { filter } => {
                Self::query_invoices_by_filter(conn, filter, &[])
            }
            SelectionModeDTO::ServerResolvedExcept {
                filter,
                excluded_invoice_numbers,
            } => Self::query_invoices_by_filter(conn, filter, excluded_invoice_numbers),
        }
    }

    fn query_invoices_by_filter(
        conn: &Connection,
        filter: &FilterCriteriaDTO,
        excluded: &[String],
    ) -> Result<Vec<String>, AppError> {
        let mut query = String::from("SELECT invoice_number FROM invoices WHERE 1=1 ");
        let mut params_vec: Vec<Box<dyn rusqlite::ToSql>> = Vec::new();

        if let Some(ref q) = filter.search_query {
            if !q.trim().is_empty() {
                query.push_str(" AND (invoice_number LIKE ? OR customer_name LIKE ? OR customer_code LIKE ?) ");
                let pattern = format!("%{}%", q.trim());
                params_vec.push(Box::new(pattern.clone()));
                params_vec.push(Box::new(pattern.clone()));
                params_vec.push(Box::new(pattern));
            }
        }

        if let Some(ref st) = filter.status_filter {
            if !st.trim().is_empty() && st != "ALL" {
                query.push_str(" AND status = ? ");
                params_vec.push(Box::new(st.clone()));
            } else {
                query.push_str(" AND status IN ('Imported', 'Draft') ");
            }
        } else {
            query.push_str(" AND status IN ('Imported', 'Draft') ");
        }

        if let Some(ref cust) = filter.customer_code {
            if !cust.trim().is_empty() && cust != "ALL" {
                query.push_str(" AND customer_code = ? ");
                params_vec.push(Box::new(cust.clone()));
            }
        }

        if let Some(ref df) = filter.date_from {
            if !df.trim().is_empty() {
                query.push_str(" AND invoice_date >= ? ");
                params_vec.push(Box::new(df.clone()));
            }
        }

        if let Some(ref dt) = filter.date_to {
            if !dt.trim().is_empty() {
                query.push_str(" AND invoice_date <= ? ");
                params_vec.push(Box::new(dt.clone()));
            }
        }

        if let Some(min_v) = filter.min_value {
            query.push_str(" AND total_value >= ? ");
            params_vec.push(Box::new(min_v));
        }

        if let Some(max_v) = filter.max_value {
            query.push_str(" AND total_value <= ? ");
            params_vec.push(Box::new(max_v));
        }

        query.push_str(" ORDER BY invoice_date DESC, invoice_number DESC");

        let mut stmt = conn.prepare(&query).map_err(|e| AppError::Db {
            code: "ERR_DB_003".to_string(),
            message: format!("Failed to prepare selection query: {}", e),
        })?;

        let params_refs: Vec<&dyn rusqlite::ToSql> = params_vec.iter().map(|b| b.as_ref()).collect();

        let rows = stmt
            .query_map(params_refs.as_slice(), |row| row.get::<_, String>(0))
            .map_err(|e| AppError::Db {
                code: "ERR_DB_003".to_string(),
                message: format!("Failed to execute selection query: {}", e),
            })?;

        let excluded_set: std::collections::HashSet<&str> =
            excluded.iter().map(|s| s.as_str()).collect();

        let mut result = Vec::new();
        for r in rows {
            let inv_no = r.map_err(|e| AppError::Db {
                code: "ERR_DB_003".to_string(),
                message: format!("Error reading invoice row: {}", e),
            })?;

            if !excluded_set.contains(inv_no.as_str()) {
                result.push(inv_no);
            }
        }

        Ok(result)
    }
}
