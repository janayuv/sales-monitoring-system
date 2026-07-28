use crate::error::AppError;
use crate::models::database_models::FinancialYearRow;
use crate::models::domain_models::{DashboardMetrics, GstSummaryBreakdown, TallyExportRow};
use crate::services::export_service::{
    CsvExporter, Exporter, PdfExporter, StandardExcelExporter, TallyExcelExporter,
};
use crate::state::DbState;
use rusqlite::params;
use tauri::State;

// ======================== Report Data Models ========================

use serde::{Deserialize, Serialize};
use ts_rs::TS;

/// Summary for the monthly sales report widget
#[derive(Debug, Serialize, Deserialize, Clone, TS)]
#[ts(export, export_to = "../../src/types/bindings/MonthlySalesRow.ts")]
pub struct MonthlySalesRow {
    pub month_label: String,
    pub total_taxable: f64,
    pub total_cgst: f64,
    pub total_sgst: f64,
    pub total_igst: f64,
    pub total_value: f64,
    pub invoice_count: i64,
}

/// GST summary breakdown by rate tier
#[derive(Debug, Serialize, Deserialize, Clone, TS)]
#[ts(export, export_to = "../../src/types/bindings/GstRateSummaryRow.ts")]
pub struct GstRateSummaryRow {
    pub gst_rate: f64,
    pub taxable_amount: f64,
    pub cgst_amount: f64,
    pub sgst_amount: f64,
    pub igst_amount: f64,
    pub total_tax: f64,
    pub invoice_count: i64,
}

/// Top customer/supplier/item ranking for widgets
#[derive(Debug, Serialize, Deserialize, Clone, TS)]
#[ts(export, export_to = "../../src/types/bindings/RankingRow.ts")]
pub struct RankingRow {
    pub rank: i32,
    pub code: String,
    pub name: String,
    pub total_value: f64,
    pub total_qty: f64,
    pub invoice_count: i64,
}

/// Export operation result returned to the frontend
#[derive(Debug, Serialize, Deserialize, Clone, TS)]
#[ts(export, export_to = "../../src/types/bindings/ExportResult.ts")]
pub struct ExportResult {
    pub format: String,
    pub output_path: String,
    pub row_count: u32,
    pub message: String,
}

// ======================== Data Query Commands ========================

/// Fetch the raw Tally export rows for a date range.
/// This is the core query that joins invoices → invoice_items → customers → items
/// and produces the flattened TallyExportRow domain model.
#[tauri::command]
pub fn query_tally_export_rows(
    state: State<'_, DbState>,
    date_from: String,
    date_to: String,
    status_filter: Option<String>,
) -> Result<Vec<TallyExportRow>, AppError> {
    let conn_guard = state
        .conn
        .lock()
        .map_err(|e| AppError::Internal(format!("Failed to acquire connection lock: {}", e)))?;
    let conn = conn_guard.as_ref().ok_or_else(|| AppError::Db {
        code: "ERR_DB_002".to_string(),
        message: "No active database connection profile".to_string(),
    })?;

    let tally_register_code: String = conn
        .query_row(
            "SELECT setting_value FROM app_settings WHERE setting_key = 'tally_register_code'",
            [],
            |row| row.get(0),
        )
        .unwrap_or_else(|_| "TF".to_string());

    let status_clause = match status_filter.as_deref() {
        Some("ALL") | None => String::new(),
        Some(s) => format!("AND i.status = '{}'", s.replace('\'', "''")),
    };

    let query = format!(
        "SELECT
            c.customer_code,
            COALESCE(c.tally_customer_name, c.report_name) AS customer_name,
            i.invoice_date,
            '{}' AS re_type,
            i.invoice_number,
            ii.part_code,
            it.part_name,
            COALESCE(h.hsn_code, ''),
            ii.quantity,
            ii.rate_pre_unit,
            ii.assessable_value,
            ii.cgst_amount,
            ii.sgst_amount,
            ii.igst_amount,
            ii.total_value,
            i.total_value,
            CASE WHEN ii.igst_amount > 0 THEN 'Y' ELSE 'N' END,
            CASE
                WHEN ii.igst_rate > 0 THEN ii.igst_rate
                WHEN ii.cgst_rate > 0 THEN ii.cgst_rate * 2
                ELSE 0.0
            END
        FROM invoice_items ii
        JOIN invoices i ON ii.invoice_number = i.invoice_number
        JOIN customers c ON i.customer_id = c.id
        JOIN items it ON ii.part_code = it.part_code
        LEFT JOIN hsn_master h ON it.hsn_code = h.hsn_code
        WHERE i.invoice_date >= ? AND i.invoice_date <= ?
          AND i.status NOT IN ('Cancelled', 'Draft')
          {}
        ORDER BY i.invoice_date ASC, i.invoice_number ASC, ii.part_code ASC",
        tally_register_code.replace('\'', "''"),
        status_clause
    );

    let mut stmt = conn.prepare(&query).map_err(|e| AppError::Db {
        code: "ERR_DB_003".to_string(),
        message: format!("Failed to prepare Tally export query: {}", e),
    })?;

    let rows = stmt
        .query_map(params![date_from, date_to], |row| {
            Ok(TallyExportRow {
                cust_code: row.get(0)?,
                cust_name: row.get(1)?,
                inv_date: row.get(2)?,
                re_type: row.get(3)?,
                inv_no: row.get(4)?,
                part_code: row.get(5)?,
                part_name: row.get(6)?,
                tariff: row.get(7)?,
                qty: row.get(8)?,
                bas_price: row.get(9)?,
                ass_val: row.get(10)?,
                cgst: row.get(11)?,
                sgst: row.get(12)?,
                igst: row.get(13)?,
                amot: row.get(14)?,
                inv_val: row.get(15)?,
                igst_yes_no: row.get(16)?,
                percentage: row.get(17)?,
            })
        })
        .map_err(|e| AppError::Db {
            code: "ERR_DB_003".to_string(),
            message: format!("Failed to execute Tally export query: {}", e),
        })?;

    let mut result = Vec::new();
    for r in rows {
        result.push(r.map_err(|e| AppError::Db {
            code: "ERR_DB_003".to_string(),
            message: format!("Failed to read Tally export row: {}", e),
        })?);
    }

    Ok(result)
}

// ======================== Export Commands ========================

/// Export invoices to Tally-format Excel (with multi-rate splitting)
#[tauri::command]
pub fn export_tally_excel(
    state: State<'_, DbState>,
    date_from: String,
    date_to: String,
    output_path: String,
) -> Result<ExportResult, AppError> {
    let rows = query_tally_export_rows(state.clone(), date_from.clone(), date_to.clone(), None)?;

    if rows.is_empty() {
        return Err(AppError::Export {
            code: "ERR_TALLY_001".to_string(),
            message: "No invoice data found for the selected date range".to_string(),
        });
    }

    // Check if any customer in the date range lacks a Tally Customer Name
    let conn_guard = state
        .conn
        .lock()
        .map_err(|e| AppError::Internal(format!("Failed to acquire connection lock: {}", e)))?;
    let conn = conn_guard.as_ref().ok_or_else(|| AppError::Db {
        code: "ERR_DB_002".to_string(),
        message: "No active database connection profile".to_string(),
    })?;

    let mut unmapped_stmt = conn
        .prepare(
            "SELECT DISTINCT c.customer_code, c.report_name
             FROM invoices i
             JOIN customers c ON i.customer_id = c.id
             WHERE i.invoice_date >= ? AND i.invoice_date <= ?
               AND i.status NOT IN ('Cancelled', 'Draft')
               AND (c.tally_customer_name IS NULL OR TRIM(c.tally_customer_name) = '')",
        )
        .map_err(|e| AppError::Db {
            code: "ERR_DB_003".to_string(),
            message: format!("Failed to check unmapped Tally customers: {}", e),
        })?;

    let unmapped_customers: Vec<String> = unmapped_stmt
        .query_map(params![date_from, date_to], |row| {
            let code: String = row.get(0)?;
            let name: String = row.get(1)?;
            Ok(format!("{} ({})", name, code))
        })
        .map_err(|e| AppError::Db {
            code: "ERR_DB_003".to_string(),
            message: format!("Failed to map unmapped customers: {}", e),
        })?
        .filter_map(Result::ok)
        .collect();

    if !unmapped_customers.is_empty() {
        return Err(AppError::Export {
            code: "ERR_TALLY_UNMAPPED_CUSTOMERS".to_string(),
            message: format!(
                "Tally export blocked! {} customer(s) in this date range still need a Tally customer name: {}. Please map them in Customer Matching first.",
                unmapped_customers.len(),
                unmapped_customers.join(", ")
            ),
        });
    }

    let exporter = TallyExcelExporter;
    let row_count = exporter.export(&rows, &output_path)?;

    log::info!(
        "Tally Excel export completed: {} rows → {}",
        row_count,
        output_path
    );

    Ok(ExportResult {
        format: exporter.format_name().to_string(),
        output_path,
        row_count,
        message: format!(
            "Successfully exported {} rows with multi-rate splitting applied",
            row_count
        ),
    })
}

/// Export invoices to standard flat Excel
#[tauri::command]
pub fn export_standard_excel(
    state: State<'_, DbState>,
    date_from: String,
    date_to: String,
    output_path: String,
) -> Result<ExportResult, AppError> {
    let rows = query_tally_export_rows(state, date_from, date_to, None)?;

    if rows.is_empty() {
        return Err(AppError::Export {
            code: "ERR_TALLY_001".to_string(),
            message: "No invoice data found for the selected date range".to_string(),
        });
    }

    let exporter = StandardExcelExporter;
    let row_count = exporter.export(&rows, &output_path)?;

    log::info!(
        "Standard Excel export completed: {} rows → {}",
        row_count,
        output_path
    );

    Ok(ExportResult {
        format: exporter.format_name().to_string(),
        output_path,
        row_count,
        message: format!("Successfully exported {} rows", row_count),
    })
}

/// Export invoices to CSV
#[tauri::command]
pub fn export_csv(
    state: State<'_, DbState>,
    date_from: String,
    date_to: String,
    output_path: String,
) -> Result<ExportResult, AppError> {
    let rows = query_tally_export_rows(state, date_from, date_to, None)?;

    if rows.is_empty() {
        return Err(AppError::Export {
            code: "ERR_TALLY_001".to_string(),
            message: "No invoice data found for the selected date range".to_string(),
        });
    }

    let exporter = CsvExporter;
    let row_count = exporter.export(&rows, &output_path)?;

    log::info!("CSV export completed: {} rows → {}", row_count, output_path);

    Ok(ExportResult {
        format: exporter.format_name().to_string(),
        output_path,
        row_count,
        message: format!("Successfully exported {} rows", row_count),
    })
}

/// Export invoices to a print-layout PDF report
#[tauri::command]
pub fn export_pdf(
    state: State<'_, DbState>,
    date_from: String,
    date_to: String,
    output_path: String,
) -> Result<ExportResult, AppError> {
    let rows = query_tally_export_rows(state, date_from, date_to, None)?;

    if rows.is_empty() {
        return Err(AppError::Export {
            code: "ERR_TALLY_001".to_string(),
            message: "No invoice data found for the selected date range".to_string(),
        });
    }

    let exporter = PdfExporter;
    let row_count = exporter.export(&rows, &output_path)?;

    log::info!("PDF export completed: {} rows → {}", row_count, output_path);

    Ok(ExportResult {
        format: exporter.format_name().to_string(),
        output_path,
        row_count,
        message: format!("Successfully exported {} rows to PDF", row_count),
    })
}

// ======================== Report Query Commands ========================

/// Get monthly sales summary for the Report Center chart, read from the
/// materialized rollup table instead of scanning `invoices` live.
#[tauri::command]
pub fn get_monthly_sales_summary(
    state: State<'_, DbState>,
    financial_year_id: Option<i64>,
) -> Result<Vec<MonthlySalesRow>, AppError> {
    let conn_guard = state
        .conn
        .lock()
        .map_err(|e| AppError::Internal(format!("Failed to acquire connection lock: {}", e)))?;
    let conn = conn_guard.as_ref().ok_or_else(|| AppError::Db {
        code: "ERR_DB_002".to_string(),
        message: "No active database connection profile".to_string(),
    })?;

    let fy_clause = match financial_year_id {
        Some(_) => "WHERE financial_year_id = ?",
        None => "",
    };

    let query = format!(
        "SELECT month_no, total_taxable, total_cgst, total_sgst, total_igst, total_value, active_count
         FROM summary_monthly_sales
         {}
         ORDER BY month_no ASC",
        fy_clause
    );

    let mut stmt = conn.prepare(&query).map_err(|e| AppError::Db {
        code: "ERR_DB_003".to_string(),
        message: format!("Failed to prepare monthly sales query: {}", e),
    })?;

    let map_row = |row: &rusqlite::Row| -> rusqlite::Result<MonthlySalesRow> {
        Ok(MonthlySalesRow {
            month_label: row.get(0)?,
            total_taxable: row.get(1)?,
            total_cgst: row.get(2)?,
            total_sgst: row.get(3)?,
            total_igst: row.get(4)?,
            total_value: row.get(5)?,
            invoice_count: row.get(6)?,
        })
    };

    let rows = if let Some(fy_id) = financial_year_id {
        stmt.query_map(params![fy_id], map_row)
    } else {
        stmt.query_map([], map_row)
    }
    .map_err(|e| AppError::Db {
        code: "ERR_DB_003".to_string(),
        message: format!("Failed to query monthly sales: {}", e),
    })?;

    let mut result = Vec::new();
    for r in rows {
        result.push(r.map_err(|e| AppError::Db {
            code: "ERR_DB_003".to_string(),
            message: format!("Failed to read monthly sales row: {}", e),
        })?);
    }

    Ok(result)
}

/// Get GST summary broken down by rate tier
#[tauri::command]
pub fn get_gst_rate_summary(
    state: State<'_, DbState>,
    date_from: String,
    date_to: String,
) -> Result<Vec<GstRateSummaryRow>, AppError> {
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
            "SELECT
            CASE
                WHEN ii.igst_rate > 0 THEN ii.igst_rate
                WHEN ii.cgst_rate > 0 THEN ii.cgst_rate * 2
                ELSE 0.0
            END AS gst_rate,
            COALESCE(SUM(ii.assessable_value), 0.0),
            COALESCE(SUM(ii.cgst_amount), 0.0),
            COALESCE(SUM(ii.sgst_amount), 0.0),
            COALESCE(SUM(ii.igst_amount), 0.0),
            COALESCE(SUM(ii.cgst_amount + ii.sgst_amount + ii.igst_amount), 0.0),
            COUNT(DISTINCT ii.invoice_number)
        FROM invoice_items ii
        JOIN invoices i ON ii.invoice_number = i.invoice_number
        WHERE i.invoice_date >= ? AND i.invoice_date <= ?
          AND i.status NOT IN ('Cancelled', 'Draft')
        GROUP BY gst_rate
        ORDER BY gst_rate ASC",
        )
        .map_err(|e| AppError::Db {
            code: "ERR_DB_003".to_string(),
            message: format!("Failed to prepare GST rate summary query: {}", e),
        })?;

    let rows = stmt
        .query_map(params![date_from, date_to], |row| {
            Ok(GstRateSummaryRow {
                gst_rate: row.get(0)?,
                taxable_amount: row.get(1)?,
                cgst_amount: row.get(2)?,
                sgst_amount: row.get(3)?,
                igst_amount: row.get(4)?,
                total_tax: row.get(5)?,
                invoice_count: row.get(6)?,
            })
        })
        .map_err(|e| AppError::Db {
            code: "ERR_DB_003".to_string(),
            message: format!("Failed to query GST rate summary: {}", e),
        })?;

    let mut result = Vec::new();
    for r in rows {
        result.push(r.map_err(|e| AppError::Db {
            code: "ERR_DB_003".to_string(),
            message: format!("Failed to read GST summary row: {}", e),
        })?);
    }

    Ok(result)
}

/// Get top-N customers by total invoice value for a date range
#[tauri::command]
pub fn get_top_customers(
    state: State<'_, DbState>,
    date_from: String,
    date_to: String,
    limit: u32,
) -> Result<Vec<RankingRow>, AppError> {
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
            "SELECT
            c.customer_code,
            c.report_name,
            COALESCE(SUM(i.total_value), 0.0),
            0.0,
            COUNT(DISTINCT i.invoice_number)
        FROM invoices i
        JOIN customers c ON i.customer_id = c.id
        WHERE i.invoice_date >= ? AND i.invoice_date <= ?
          AND i.status NOT IN ('Cancelled', 'Draft')
        GROUP BY c.id
        ORDER BY SUM(i.total_value) DESC
        LIMIT ?",
        )
        .map_err(|e| AppError::Db {
            code: "ERR_DB_003".to_string(),
            message: format!("Failed to prepare top customers query: {}", e),
        })?;

    let rows = stmt
        .query_map(params![date_from, date_to, limit], |row| {
            Ok(RankingRow {
                rank: 0, // will be assigned below
                code: row.get(0)?,
                name: row.get(1)?,
                total_value: row.get(2)?,
                total_qty: row.get(3)?,
                invoice_count: row.get(4)?,
            })
        })
        .map_err(|e| AppError::Db {
            code: "ERR_DB_003".to_string(),
            message: format!("Failed to query top customers: {}", e),
        })?;

    let mut result = Vec::new();
    for (i, r) in rows.enumerate() {
        let mut row = r.map_err(|e| AppError::Db {
            code: "ERR_DB_003".to_string(),
            message: format!("Failed to read customer ranking row: {}", e),
        })?;
        row.rank = (i + 1) as i32;
        result.push(row);
    }

    Ok(result)
}

/// Get top-N items by total sales value for a date range
#[tauri::command]
pub fn get_top_items(
    state: State<'_, DbState>,
    date_from: String,
    date_to: String,
    limit: u32,
) -> Result<Vec<RankingRow>, AppError> {
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
            "SELECT
            it.part_code,
            it.part_name,
            COALESCE(SUM(ii.total_value), 0.0),
            COALESCE(SUM(ii.quantity), 0.0),
            COUNT(DISTINCT ii.invoice_number)
        FROM invoice_items ii
        JOIN invoices i ON ii.invoice_number = i.invoice_number
        JOIN items it ON ii.part_code = it.part_code
        WHERE i.invoice_date >= ? AND i.invoice_date <= ?
          AND i.status NOT IN ('Cancelled', 'Draft')
        GROUP BY it.part_code
        ORDER BY SUM(ii.total_value) DESC
        LIMIT ?",
        )
        .map_err(|e| AppError::Db {
            code: "ERR_DB_003".to_string(),
            message: format!("Failed to prepare top items query: {}", e),
        })?;

    let rows = stmt
        .query_map(params![date_from, date_to, limit], |row| {
            Ok(RankingRow {
                rank: 0,
                code: row.get(0)?,
                name: row.get(1)?,
                total_value: row.get(2)?,
                total_qty: row.get(3)?,
                invoice_count: row.get(4)?,
            })
        })
        .map_err(|e| AppError::Db {
            code: "ERR_DB_003".to_string(),
            message: format!("Failed to query top items: {}", e),
        })?;

    let mut result = Vec::new();
    for (i, r) in rows.enumerate() {
        let mut row = r.map_err(|e| AppError::Db {
            code: "ERR_DB_003".to_string(),
            message: format!("Failed to read item ranking row: {}", e),
        })?;
        row.rank = (i + 1) as i32;
        result.push(row);
    }

    Ok(result)
}

// ======================== Dashboard Metrics Command ========================

/// Load aggregated dashboard metrics, serving from the in-memory cache when
/// warm and falling back to the materialized rollup tables (or, for
/// day/month-granular figures the rollup can't serve, a live query) when cold.
#[tauri::command]
pub fn get_dashboard_metrics(state: State<'_, DbState>) -> Result<DashboardMetrics, AppError> {
    if let Ok(cache) = state.dashboard_cache.lock() {
        if let Some(cached) = cache.as_ref() {
            return Ok(cached.clone());
        }
    }

    let conn_guard = state
        .conn
        .lock()
        .map_err(|e| AppError::Internal(format!("Failed to acquire connection lock: {}", e)))?;
    let conn = conn_guard.as_ref().ok_or_else(|| AppError::Db {
        code: "ERR_DB_002".to_string(),
        message: "No active database connection profile".to_string(),
    })?;

    let today = chrono::Local::now().format("%Y-%m-%d").to_string();
    let month_start = chrono::Local::now().format("%Y-%m-01").to_string();

    // Active FY id + start date
    let (active_fy_id, fy_start): (i64, String) = conn
        .query_row(
            "SELECT id, start_date FROM financial_years WHERE is_active = 1 LIMIT 1",
            [],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .unwrap_or((0, "2025-04-01".to_string()));

    // Today's sales (day granularity — live query, the rollup is month-level)
    let today_sales: f64 = conn.query_row(
        "SELECT COALESCE(SUM(total_value), 0.0) FROM invoices WHERE invoice_date = ? AND status NOT IN ('Cancelled', 'Draft')",
        [&today],
        |row| row.get(0),
    ).unwrap_or(0.0);

    // MTD sales (partial-month granularity — live query)
    let mtd_sales: f64 = conn.query_row(
        "SELECT COALESCE(SUM(total_value), 0.0) FROM invoices WHERE invoice_date >= ? AND invoice_date <= ? AND status NOT IN ('Cancelled', 'Draft')",
        [&month_start, &today],
        |row| row.get(0),
    ).unwrap_or(0.0);

    // YTD sales (partial-year, spans a variable number of whole+partial months — live query)
    let ytd_sales: f64 = conn.query_row(
        "SELECT COALESCE(SUM(total_value), 0.0) FROM invoices WHERE invoice_date >= ? AND invoice_date <= ? AND status NOT IN ('Cancelled', 'Draft')",
        [&fy_start, &today],
        |row| row.get(0),
    ).unwrap_or(0.0);

    let pending_cn: u32 = conn
        .query_row(
            "SELECT COUNT(*) FROM credit_notes WHERE status IN ('Draft', 'Review')",
            [],
            |row| row.get::<_, i64>(0),
        )
        .unwrap_or(0) as u32;

    let pending_dn: u32 = conn
        .query_row(
            "SELECT COUNT(*) FROM debit_notes WHERE status IN ('Draft', 'Review')",
            [],
            |row| row.get::<_, i64>(0),
        )
        .unwrap_or(0) as u32;

    let cancelled_count: u32 = conn
        .query_row(
            "SELECT COUNT(*) FROM invoices WHERE status = 'Cancelled' AND invoice_date >= ?",
            [&fy_start],
            |row| row.get::<_, i64>(0),
        )
        .unwrap_or(0) as u32;

    let import_errors: u32 = conn
        .query_row(
            "SELECT COUNT(*) FROM validation_exceptions WHERE resolved = 0 AND severity = 'error'",
            [],
            |row| row.get::<_, i64>(0),
        )
        .unwrap_or(0) as u32;

    // Active invoice count for the FY — from the monthly rollup
    let active_invoices_count: u32 = conn.query_row(
        "SELECT COALESCE(SUM(active_count), 0) FROM summary_monthly_sales WHERE financial_year_id = ?",
        [active_fy_id],
        |row| row.get::<_, i64>(0),
    ).unwrap_or(0) as u32;

    // GST payable summary — from the monthly rollup instead of a live scan
    let gst_summary = conn
        .query_row(
            "SELECT
            COALESCE(SUM(total_taxable), 0.0),
            COALESCE(SUM(total_cgst), 0.0),
            COALESCE(SUM(total_sgst), 0.0),
            COALESCE(SUM(total_igst), 0.0),
            COALESCE(SUM(total_value), 0.0)
        FROM summary_monthly_sales
        WHERE financial_year_id = ?",
            [active_fy_id],
            |row| {
                Ok(GstSummaryBreakdown {
                    total_taxable: row.get(0)?,
                    total_cgst: row.get(1)?,
                    total_sgst: row.get(2)?,
                    total_igst: row.get(3)?,
                    total_gross: row.get(4)?,
                })
            },
        )
        .unwrap_or_else(|_| GstSummaryBreakdown {
            total_taxable: 0.0,
            total_cgst: 0.0,
            total_sgst: 0.0,
            total_igst: 0.0,
            total_gross: 0.0,
        });

    // Top 10 customers — from the customer rollup
    let top_customers = {
        let mut stmt = conn
            .prepare(
                "SELECT c.report_name, scs.total_value
             FROM summary_customer_sales scs
             JOIN customers c ON scs.customer_id = c.id
             WHERE scs.financial_year_id = ?
             ORDER BY scs.total_value DESC LIMIT 10",
            )
            .unwrap();
        let rows = stmt
            .query_map([active_fy_id], |row| {
                Ok((row.get::<_, String>(0)?, row.get::<_, f64>(1)?))
            })
            .unwrap();
        rows.filter_map(|r| r.ok()).collect::<Vec<_>>()
    };

    // Top 10 suppliers — aggregated from the supplier/part rollup
    let top_suppliers = {
        let mut stmt = conn
            .prepare(
                "SELECT s.supplier_name, SUM(sss.total_value) AS supplier_total
             FROM summary_supplier_sales sss
             JOIN suppliers s ON sss.supplier_id = s.id
             WHERE sss.financial_year_id = ?
             GROUP BY s.id
             ORDER BY supplier_total DESC LIMIT 10",
            )
            .unwrap();
        let rows = stmt
            .query_map([active_fy_id], |row| {
                Ok((row.get::<_, String>(0)?, row.get::<_, f64>(1)?))
            })
            .unwrap();
        rows.filter_map(|r| r.ok()).collect::<Vec<_>>()
    };

    // Top 20 parts — from the supplier/part rollup
    let top_parts = {
        let mut stmt = conn
            .prepare(
                "SELECT it.part_name, SUM(sss.total_value) AS part_total
             FROM summary_supplier_sales sss
             JOIN items it ON sss.part_code = it.part_code
             WHERE sss.financial_year_id = ?
             GROUP BY sss.part_code
             ORDER BY part_total DESC LIMIT 20",
            )
            .unwrap();
        let rows = stmt
            .query_map([active_fy_id], |row| {
                Ok((row.get::<_, String>(0)?, row.get::<_, f64>(1)?))
            })
            .unwrap();
        rows.filter_map(|r| r.ok()).collect::<Vec<_>>()
    };

    // Recent activity from audit log
    let recent_activity = {
        let mut stmt = conn.prepare(
            "SELECT timestamp || ' — ' || user_action FROM audit_log ORDER BY timestamp DESC LIMIT 15"
        ).unwrap();
        let rows = stmt.query_map([], |row| row.get::<_, String>(0)).unwrap();
        rows.filter_map(|r| r.ok()).collect::<Vec<_>>()
    };

    // Comparative growth (YTD this year vs. the same period one year earlier)
    let growth_percent = {
        let last_fy_start =
            crate::utils::dates::shift_years(&fy_start, -1).unwrap_or_else(|| fy_start.clone());
        let last_today =
            crate::utils::dates::shift_years(&today, -1).unwrap_or_else(|| today.clone());
        let last_year_sales: f64 = conn.query_row(
            "SELECT COALESCE(SUM(total_value), 0.0) FROM invoices WHERE invoice_date >= ? AND invoice_date <= ? AND status NOT IN ('Cancelled', 'Draft')",
            [&last_fy_start, &last_today],
            |row| row.get(0),
        ).unwrap_or(0.0);

        if last_year_sales > 0.0 {
            ((ytd_sales - last_year_sales) / last_year_sales) * 100.0
        } else {
            0.0
        }
    };

    let metrics = DashboardMetrics {
        today_sales,
        mtd_sales,
        ytd_sales,
        comparative_growth_percent: growth_percent,
        pending_credit_notes_count: pending_cn,
        pending_debit_notes_count: pending_dn,
        cancelled_invoices_count: cancelled_count,
        active_invoices_count,
        top_10_customers: top_customers,
        top_10_suppliers: top_suppliers,
        top_20_parts: top_parts,
        gst_payable_summary: gst_summary,
        import_errors_count: import_errors,
        recent_activity,
    };

    if let Ok(mut cache) = state.dashboard_cache.lock() {
        *cache = Some(metrics.clone());
    }

    Ok(metrics)
}

/// Get financial years list for the report center dropdowns
#[tauri::command]
pub fn get_financial_years_list(
    state: State<'_, DbState>,
) -> Result<Vec<FinancialYearRow>, AppError> {
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
            "SELECT id, label, start_date, end_date, is_active, is_locked, closed_at
         FROM financial_years ORDER BY start_date DESC",
        )
        .map_err(|e| AppError::Db {
            code: "ERR_DB_003".to_string(),
            message: format!("Failed to prepare financial years query: {}", e),
        })?;

    let rows = stmt
        .query_map([], |row| {
            Ok(FinancialYearRow {
                id: Some(row.get(0)?),
                label: row.get(1)?,
                start_date: row.get(2)?,
                end_date: row.get(3)?,
                is_active: row.get(4)?,
                is_locked: row.get(5)?,
                closed_at: row.get(6)?,
            })
        })
        .map_err(|e| AppError::Db {
            code: "ERR_DB_003".to_string(),
            message: format!("Failed to query financial years: {}", e),
        })?;

    let mut result = Vec::new();
    for r in rows {
        result.push(r.map_err(|e| AppError::Db {
            code: "ERR_DB_003".to_string(),
            message: format!("Failed to read financial year row: {}", e),
        })?);
    }

    Ok(result)
}

// ======================== E-Invoice JSON Helper & Commands ========================

fn format_state_code(code: &str) -> String {
    let clean = code.trim();
    if clean.is_empty() {
        return "37".to_string(); // default fallback (e.g. AP)
    }
    if clean.len() == 1 {
        format!("0{}", clean)
    } else {
        clean.to_string()
    }
}

fn round_to_two(val: f64) -> f64 {
    (val * 100.0).round() / 100.0
}

fn format_date_to_einvoice(db_date: &str) -> String {
    // db_date format: YYYY-MM-DD
    let parts: Vec<&str> = db_date.split('-').collect();
    if parts.len() == 3 {
        format!("{}/{}/{}", parts[2], parts[1], parts[0])
    } else {
        db_date.to_string()
    }
}

fn parse_address(addr: &str) -> (String, Option<String>, String, u32) {
    let mut addr1 = addr.trim().to_string();
    let mut addr2 = None;
    let mut loc = "Unknown".to_string();
    let mut pin = 0;

    let chars: Vec<char> = addr.chars().collect();
    for i in 0..chars.len().saturating_sub(5) {
        if chars[i..i + 6].iter().all(|c| c.is_ascii_digit()) {
            if let Ok(p) = chars[i..i + 6].iter().collect::<String>().parse::<u32>() {
                pin = p;
                break;
            }
        }
    }

    let parts: Vec<&str> = addr.split(',').map(|s| s.trim()).collect();
    if parts.len() > 1 {
        let last_idx = parts.len() - 1;
        if pin != 0 && parts[last_idx].contains(&pin.to_string()) {
            if parts.len() > 2 {
                loc = parts[last_idx - 1].to_string();
                addr1 = parts[0..last_idx - 1].join(", ");
                addr2 = Some(parts[last_idx - 1..].join(", "));
            } else {
                loc = parts[0].to_string();
            }
        } else {
            loc = parts[last_idx].to_string();
            addr1 = parts[0..last_idx].join(", ");
        }
    }

    if addr1.len() > 100 {
        let extra = addr1[100..].to_string();
        addr1.truncate(100);
        addr2 = Some(match addr2 {
            Some(a2) => format!("{}, {}", extra, a2),
            None => extra,
        });
    }

    if let Some(ref mut a2) = addr2 {
        if a2.len() > 100 {
            a2.truncate(100);
        }
    }

    if loc.len() > 50 {
        loc.truncate(50);
    }
    if loc.is_empty() {
        loc = "Unknown".to_string();
    }

    (addr1, addr2, loc, pin)
}

#[tauri::command]
pub fn export_credit_notes_einvoice_json(
    state: State<'_, DbState>,
    date_from: String,
    date_to: String,
    output_path: String,
) -> Result<ExportResult, AppError> {
    log::info!(
        "Exporting Credit Notes E-Invoice JSON: {} to {} -> {}",
        date_from,
        date_to,
        output_path
    );

    let conn_guard = state
        .conn
        .lock()
        .map_err(|e| AppError::Internal(format!("Failed to acquire connection lock: {}", e)))?;
    let conn = conn_guard.as_ref().ok_or_else(|| AppError::Db {
        code: "ERR_DB_002".to_string(),
        message: "No active database connection profile".to_string(),
    })?;

    // 1. Fetch Seller / Company Profile Details
    let (
        comp_name,
        comp_legal_name,
        comp_gstin,
        comp_addr1,
        comp_addr2,
        comp_loc,
        comp_pin,
        comp_state,
        comp_phone,
        comp_email,
    ) = match conn.query_row(
        "SELECT company_name, legal_name, gstin, address1, address2, location, pincode, state_code, phone, email
         FROM company_profile WHERE id = 1",
        [],
        |row| {
            Ok((
                row.get::<_, Option<String>>(0)?,
                row.get::<_, Option<String>>(1)?,
                row.get::<_, Option<String>>(2)?,
                row.get::<_, Option<String>>(3)?,
                row.get::<_, Option<String>>(4)?,
                row.get::<_, Option<String>>(5)?,
                row.get::<_, Option<String>>(6)?,
                row.get::<_, Option<String>>(7)?,
                row.get::<_, Option<String>>(8)?,
                row.get::<_, Option<String>>(9)?,
            ))
        },
    ) {
        Ok(info) => info,
        Err(_) => {
            return Err(AppError::Export {
                code: "ERR_EINVOICE_001".to_string(),
                message: "Company profile details (legal name, GSTIN, address) must be configured in settings before exporting E-Invoices.".to_string(),
            });
        }
    };

    let seller_gstin = comp_gstin.ok_or_else(|| AppError::Export {
        code: "ERR_EINVOICE_002".to_string(),
        message: "Seller GSTIN is not set in Company Profile".to_string(),
    })?;

    let seller_lgl_nm = comp_legal_name.or(comp_name).ok_or_else(|| AppError::Export {
        code: "ERR_EINVOICE_003".to_string(),
        message: "Seller Legal Name is not set in Company Profile".to_string(),
    })?;

    let seller_addr1 = comp_addr1.ok_or_else(|| AppError::Export {
        code: "ERR_EINVOICE_004".to_string(),
        message: "Seller Address line 1 is not set in Company Profile".to_string(),
    })?;

    let seller_loc = comp_loc.ok_or_else(|| AppError::Export {
        code: "ERR_EINVOICE_005".to_string(),
        message: "Seller Location is not set in Company Profile".to_string(),
    })?;

    let seller_pin_str = comp_pin.ok_or_else(|| AppError::Export {
        code: "ERR_EINVOICE_006".to_string(),
        message: "Seller Pincode is not set in Company Profile".to_string(),
    })?;
    let seller_pin = seller_pin_str.trim().parse::<u32>().map_err(|_| AppError::Export {
        code: "ERR_EINVOICE_006".to_string(),
        message: format!("Invalid Seller Pincode format: {}", seller_pin_str),
    })?;

    let seller_stcd_raw = comp_state.ok_or_else(|| AppError::Export {
        code: "ERR_EINVOICE_007".to_string(),
        message: "Seller State Code is not set in Company Profile".to_string(),
    })?;
    let seller_stcd = format_state_code(&seller_stcd_raw);

    // 2. Fetch Credit Notes
    let mut cn_stmt = conn.prepare(
        "SELECT
            cn.credit_note_number,
            cn.invoice_number,
            cn.credit_note_date,
            cn.total_taxable,
            cn.total_cgst,
            cn.total_sgst,
            cn.total_igst,
            cn.total_value,
            cn.remarks,
            COALESCE(c.legal_name, c.report_name) AS customer_name,
            c.gstin,
            c.state_code,
            c.address1,
            c.address2,
            c.location,
            c.pincode,
            i.place_of_supply
         FROM credit_notes cn
         JOIN customers c ON cn.customer_id = c.id
         JOIN invoices i ON cn.invoice_number = i.invoice_number
         WHERE cn.credit_note_date >= ? AND cn.credit_note_date <= ?
         ORDER BY cn.credit_note_date ASC, cn.credit_note_number ASC"
    ).map_err(|e| AppError::Db {
        code: "ERR_DB_003".to_string(),
        message: format!("Failed to prepare credit notes export query: {}", e),
    })?;

    let cn_rows = cn_stmt.query_map(params![date_from, date_to], |row| {
        Ok((
            row.get::<_, String>(0)?, // credit_note_number
            row.get::<_, String>(1)?, // invoice_number
            row.get::<_, String>(2)?, // credit_note_date
            row.get::<_, f64>(3)?,    // total_taxable
            row.get::<_, f64>(4)?,    // total_cgst
            row.get::<_, f64>(5)?,    // total_sgst
            row.get::<_, f64>(6)?,    // total_igst
            row.get::<_, f64>(7)?,    // total_value
            row.get::<_, Option<String>>(8)?, // remarks
            row.get::<_, String>(9)?, // customer_name
            row.get::<_, Option<String>>(10)?, // customer gstin
            row.get::<_, Option<String>>(11)?, // customer state_code
            row.get::<_, Option<String>>(12)?, // customer address1
            row.get::<_, Option<String>>(13)?, // customer address2
            row.get::<_, Option<String>>(14)?, // customer location
            row.get::<_, Option<String>>(15)?, // customer pincode
            row.get::<_, Option<String>>(16)?, // place_of_supply (pos)
        ))
    }).map_err(|e| AppError::Db {
        code: "ERR_DB_003".to_string(),
        message: format!("Failed to execute credit notes export query: {}", e),
    })?;

    let mut docs = Vec::new();
    let mut count = 0;

    for cn_res in cn_rows {
        let (
            cn_number,
            inv_number,
            cn_date,
            total_taxable,
            total_cgst,
            total_sgst,
            total_igst,
            total_value,
            remarks,
            cust_name,
            cust_gstin_opt,
            cust_state_opt,
            cust_address1_opt,
            cust_address2_opt,
            cust_location_opt,
            cust_pincode_opt,
            pos_opt,
        ) = cn_res.map_err(|e| AppError::Db {
            code: "ERR_DB_003".to_string(),
            message: format!("Failed to parse credit note row: {}", e),
        })?;

        let cust_gstin_raw = cust_gstin_opt.unwrap_or_default();
        let cust_gstin = if cust_gstin_raw.trim().is_empty() {
            "URP".to_string()
        } else {
            cust_gstin_raw.trim().to_uppercase()
        };
        let cust_state_raw = cust_state_opt.unwrap_or_else(|| {
            if cust_gstin.len() >= 2 {
                cust_gstin[0..2].to_string()
            } else {
                "37".to_string() // fallback state code
            }
        });
        let cust_state = format_state_code(&cust_state_raw);
        let pos_raw = pos_opt.unwrap_or_else(|| cust_state.clone());
        let pos = format_state_code(&pos_raw);

        // Resolve structured or legacy buyer address
        let (buyer_addr1, buyer_addr2, buyer_loc, buyer_pin) = if cust_location_opt.is_some() || cust_pincode_opt.is_some() {
            let addr1 = cust_address1_opt.unwrap_or_default().trim().to_string();
            let addr2 = cust_address2_opt.filter(|s| !s.trim().is_empty());
            let loc = cust_location_opt.unwrap_or_else(|| "Unknown".to_string()).trim().to_string();
            let pin = cust_pincode_opt.as_deref().unwrap_or("").trim().parse::<u32>().unwrap_or(0);
            (addr1, addr2, loc, pin)
        } else {
            // Fallback for legacy customer: parse single-line address stored in address1
            parse_address(&cust_address1_opt.unwrap_or_default())
        };

        // Fetch invoice items
        let mut item_stmt = conn.prepare(
            "SELECT
                ii.part_code,
                it.part_name,
                it.hsn_code,
                it.uom_code,
                ii.quantity,
                ii.rate_pre_unit,
                ii.assessable_value,
                ii.cgst_rate,
                ii.cgst_amount,
                ii.sgst_rate,
                ii.sgst_amount,
                ii.igst_rate,
                ii.igst_amount,
                ii.total_value
             FROM invoice_items ii
             JOIN items it ON ii.part_code = it.part_code
             WHERE ii.invoice_number = ?"
        ).map_err(|e| AppError::Db {
            code: "ERR_DB_003".to_string(),
            message: format!("Failed to prepare invoice items query: {}", e),
        })?;

        let item_rows = item_stmt.query_map([&inv_number], |row| {
            Ok((
                row.get::<_, String>(0)?, // part_code
                row.get::<_, String>(1)?, // part_name
                row.get::<_, String>(2)?, // hsn_code
                row.get::<_, String>(3)?, // uom_code
                row.get::<_, f64>(4)?,    // quantity
                row.get::<_, f64>(5)?,    // rate_pre_unit
                row.get::<_, f64>(6)?,    // assessable_value
                row.get::<_, f64>(7)?,    // cgst_rate
                row.get::<_, f64>(8)?,    // cgst_amount
                row.get::<_, f64>(9)?,    // sgst_rate
                row.get::<_, f64>(10)?,   // sgst_amount
                row.get::<_, f64>(11)?,   // igst_rate
                row.get::<_, f64>(12)?,   // igst_amount
                row.get::<_, f64>(13)?,   // total_value
            ))
        }).map_err(|e| AppError::Db {
            code: "ERR_DB_003".to_string(),
            message: format!("Failed to execute invoice items query: {}", e),
        })?;

        let mut item_list = Vec::new();
        let mut sl_no_counter = 1;

        for item_res in item_rows {
            let (
                _part_code,
                part_name,
                hsn_code,
                uom_code,
                quantity,
                rate_pre_unit,
                assessable_value,
                cgst_rate,
                cgst_amount,
                sgst_rate,
                sgst_amount,
                igst_rate,
                igst_amount,
                tot_val,
            ) = item_res.map_err(|e| AppError::Db {
                code: "ERR_DB_003".to_string(),
                message: format!("Failed to parse invoice item row: {}", e),
            })?;

            let is_servc = if hsn_code.starts_with("99") { "Y" } else { "N" };

            let gst_rt = if igst_rate > 0.0 {
                igst_rate
            } else {
                cgst_rate + sgst_rate
            };

            let hsn_cd_clean: String = hsn_code.chars().filter(|c| c.is_ascii_digit()).collect();

            let item = crate::models::einvoice_models::EInvoiceItem {
                sl_no: sl_no_counter.to_string(),
                prd_desc: part_name,
                is_servc: is_servc.to_string(),
                hsn_cd: hsn_cd_clean,
                qty: quantity,
                free_qty: 0.0,
                unit: uom_code,
                unit_price: round_to_two(rate_pre_unit),
                tot_amt: round_to_two(quantity * rate_pre_unit),
                discount: 0.0,
                pre_tax_val: round_to_two(assessable_value),
                ass_amt: round_to_two(assessable_value),
                gst_rt: round_to_two(gst_rt),
                igst_amt: round_to_two(igst_amount),
                cgst_amt: round_to_two(cgst_amount),
                sgst_amt: round_to_two(sgst_amount),
                ces_rt: 0.0,
                ces_amt: 0.0,
                ces_non_advl_amt: 0.0,
                state_ces_rt: 0.0,
                state_ces_amt: 0.0,
                state_ces_non_advl_amt: 0.0,
                oth_chrg: 0.0,
                tot_item_val: round_to_two(tot_val),
            };

            item_list.push(item);
            sl_no_counter += 1;
        }

        let ref_dtls = remarks.as_ref().map(|r| crate::models::einvoice_models::RefDtls {
            inv_rm: Some(r.clone()),
        });

        let doc = crate::models::einvoice_models::EInvoiceDoc {
            version: "1.1".to_string(),
            tran_dtls: crate::models::einvoice_models::TranDtls {
                tax_sch: "GST".to_string(),
                sup_typ: "B2B".to_string(),
                igst_on_intra: "N".to_string(),
                reg_rev: "N".to_string(),
                ecm_gstin: None,
            },
            doc_dtls: crate::models::einvoice_models::DocDtls {
                typ: "CRN".to_string(),
                no: cn_number,
                dt: format_date_to_einvoice(&cn_date),
            },
            seller_dtls: crate::models::einvoice_models::SellerDtls {
                gstin: seller_gstin.clone(),
                lgl_nm: seller_lgl_nm.clone(),
                addr1: seller_addr1.clone(),
                addr2: comp_addr2.clone(),
                loc: seller_loc.clone(),
                pin: seller_pin,
                stcd: seller_stcd.clone(),
                ph: comp_phone.clone(),
                em: comp_email.clone(),
            },
            buyer_dtls: crate::models::einvoice_models::BuyerDtls {
                gstin: cust_gstin,
                lgl_nm: cust_name,
                addr1: buyer_addr1,
                addr2: buyer_addr2,
                loc: buyer_loc,
                pin: buyer_pin,
                pos,
                stcd: cust_state,
                ph: None,
                em: None,
            },
            val_dtls: crate::models::einvoice_models::ValDtls {
                ass_val: round_to_two(total_taxable),
                igst_val: round_to_two(total_igst),
                cgst_val: round_to_two(total_cgst),
                sgst_val: round_to_two(total_sgst),
                ces_val: 0.0,
                st_ces_val: 0.0,
                discount: 0.0,
                oth_chrg: 0.0,
                rnd_off_amt: 0.0,
                tot_inv_val: round_to_two(total_value),
            },
            ref_dtls,
            item_list,
        };

        docs.push(doc);
        count += 1;
    }

    if count == 0 {
        return Err(AppError::Export {
            code: "ERR_EINVOICE_008".to_string(),
            message: "No credit note data found for the selected date range".to_string(),
        });
    }

    // Write to output path as pretty JSON
    let json_data = serde_json::to_string_pretty(&docs).map_err(|e| AppError::Export {
        code: "ERR_EINVOICE_009".to_string(),
        message: format!("Failed to serialize credit notes JSON: {}", e),
    })?;

    std::fs::write(&output_path, json_data).map_err(|e| AppError::Export {
        code: "ERR_EINVOICE_010".to_string(),
        message: format!("Failed to write export file to {}: {}", output_path, e),
    })?;

    Ok(ExportResult {
        format: "E-Invoice JSON (Credit Notes)".to_string(),
        output_path,
        row_count: count as u32,
        message: format!("Successfully exported {} Credit Notes to E-Invoice JSON format", count),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_round_to_two() {
        assert_eq!(round_to_two(8323.0344), 8323.03);
        assert_eq!(round_to_two(8323.0356), 8323.04);
        assert_eq!(round_to_two(64349.759999999995), 64349.76);
    }

    #[test]
    fn test_hsn_cleaning() {
        let raw_hsn = "8708.99.00";
        let cleaned: String = raw_hsn.chars().filter(|c| c.is_ascii_digit()).collect();
        assert_eq!(cleaned, "87089900");
    }

    #[test]
    fn test_gstin_urp_default() {
        let raw_gstin = "";
        let gstin = if raw_gstin.trim().is_empty() {
            "URP".to_string()
        } else {
            raw_gstin.trim().to_uppercase()
        };
        assert_eq!(gstin, "URP");

        let raw_gstin_whitespace = "   ";
        let gstin_whitespace = if raw_gstin_whitespace.trim().is_empty() {
            "URP".to_string()
        } else {
            raw_gstin_whitespace.trim().to_uppercase()
        };
        assert_eq!(gstin_whitespace, "URP");
    }
}

