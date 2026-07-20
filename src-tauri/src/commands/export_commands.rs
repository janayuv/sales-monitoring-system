use tauri::State;
use rusqlite::params;
use crate::error::AppError;
use crate::state::DbState;
use crate::models::domain_models::{
    TallyExportRow, DashboardMetrics, GstSummaryBreakdown,
};
use crate::models::database_models::FinancialYearRow;
use crate::services::export_service::{Exporter, TallyExcelExporter, StandardExcelExporter, CsvExporter};

// ======================== Report Data Models ========================

use serde::{Serialize, Deserialize};
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
    let conn_guard = state.conn.lock().map_err(|e| {
        AppError::Internal(format!("Failed to acquire connection lock: {}", e))
    })?;
    let conn = conn_guard.as_ref().ok_or_else(|| AppError::Db {
        code: "ERR_DB_002".to_string(),
        message: "No active database connection profile".to_string(),
    })?;

    let status_clause = match status_filter.as_deref() {
        Some("ALL") | None => String::new(),
        Some(s) => format!("AND i.status = '{}'", s.replace('\'', "''")),
    };

    let query = format!(
        "SELECT
            c.customer_code,
            c.customer_name,
            i.invoice_date,
            COALESCE(i.invoice_type, 'Regular B2B'),
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
    let rows = query_tally_export_rows(state, date_from, date_to, None)?;

    if rows.is_empty() {
        return Err(AppError::Export {
            code: "ERR_TALLY_001".to_string(),
            message: "No invoice data found for the selected date range".to_string(),
        });
    }

    let exporter = TallyExcelExporter;
    let row_count = exporter.export(&rows, &output_path)?;

    log::info!("Tally Excel export completed: {} rows → {}", row_count, output_path);

    Ok(ExportResult {
        format: exporter.format_name().to_string(),
        output_path,
        row_count,
        message: format!("Successfully exported {} rows with multi-rate splitting applied", row_count),
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

    log::info!("Standard Excel export completed: {} rows → {}", row_count, output_path);

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

// ======================== Report Query Commands ========================

/// Get monthly sales summary for the Report Center chart
#[tauri::command]
pub fn get_monthly_sales_summary(
    state: State<'_, DbState>,
    financial_year_id: Option<i64>,
) -> Result<Vec<MonthlySalesRow>, AppError> {
    let conn_guard = state.conn.lock().map_err(|e| {
        AppError::Internal(format!("Failed to acquire connection lock: {}", e))
    })?;
    let conn = conn_guard.as_ref().ok_or_else(|| AppError::Db {
        code: "ERR_DB_002".to_string(),
        message: "No active database connection profile".to_string(),
    })?;

    let fy_clause = match financial_year_id {
        Some(id) => format!("AND i.financial_year_id = {}", id),
        None => String::new(),
    };

    let query = format!(
        "SELECT
            strftime('%Y-%m', i.invoice_date) AS month_label,
            COALESCE(SUM(i.total_taxable), 0.0),
            COALESCE(SUM(i.total_cgst), 0.0),
            COALESCE(SUM(i.total_sgst), 0.0),
            COALESCE(SUM(i.total_igst), 0.0),
            COALESCE(SUM(i.total_value), 0.0),
            COUNT(DISTINCT i.invoice_number)
        FROM invoices i
        WHERE i.status NOT IN ('Cancelled', 'Draft')
          {}
        GROUP BY strftime('%Y-%m', i.invoice_date)
        ORDER BY month_label ASC",
        fy_clause
    );

    let mut stmt = conn.prepare(&query).map_err(|e| AppError::Db {
        code: "ERR_DB_003".to_string(),
        message: format!("Failed to prepare monthly sales query: {}", e),
    })?;

    let rows = stmt.query_map([], |row| {
        Ok(MonthlySalesRow {
            month_label: row.get(0)?,
            total_taxable: row.get(1)?,
            total_cgst: row.get(2)?,
            total_sgst: row.get(3)?,
            total_igst: row.get(4)?,
            total_value: row.get(5)?,
            invoice_count: row.get(6)?,
        })
    }).map_err(|e| AppError::Db {
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
    let conn_guard = state.conn.lock().map_err(|e| {
        AppError::Internal(format!("Failed to acquire connection lock: {}", e))
    })?;
    let conn = conn_guard.as_ref().ok_or_else(|| AppError::Db {
        code: "ERR_DB_002".to_string(),
        message: "No active database connection profile".to_string(),
    })?;

    let mut stmt = conn.prepare(
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
        ORDER BY gst_rate ASC"
    ).map_err(|e| AppError::Db {
        code: "ERR_DB_003".to_string(),
        message: format!("Failed to prepare GST rate summary query: {}", e),
    })?;

    let rows = stmt.query_map(params![date_from, date_to], |row| {
        Ok(GstRateSummaryRow {
            gst_rate: row.get(0)?,
            taxable_amount: row.get(1)?,
            cgst_amount: row.get(2)?,
            sgst_amount: row.get(3)?,
            igst_amount: row.get(4)?,
            total_tax: row.get(5)?,
            invoice_count: row.get(6)?,
        })
    }).map_err(|e| AppError::Db {
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
    let conn_guard = state.conn.lock().map_err(|e| {
        AppError::Internal(format!("Failed to acquire connection lock: {}", e))
    })?;
    let conn = conn_guard.as_ref().ok_or_else(|| AppError::Db {
        code: "ERR_DB_002".to_string(),
        message: "No active database connection profile".to_string(),
    })?;

    let mut stmt = conn.prepare(
        "SELECT
            c.customer_code,
            c.customer_name,
            COALESCE(SUM(i.total_value), 0.0),
            0.0,
            COUNT(DISTINCT i.invoice_number)
        FROM invoices i
        JOIN customers c ON i.customer_id = c.id
        WHERE i.invoice_date >= ? AND i.invoice_date <= ?
          AND i.status NOT IN ('Cancelled', 'Draft')
        GROUP BY c.id
        ORDER BY SUM(i.total_value) DESC
        LIMIT ?"
    ).map_err(|e| AppError::Db {
        code: "ERR_DB_003".to_string(),
        message: format!("Failed to prepare top customers query: {}", e),
    })?;

    let rows = stmt.query_map(params![date_from, date_to, limit], |row| {
        Ok(RankingRow {
            rank: 0, // will be assigned below
            code: row.get(0)?,
            name: row.get(1)?,
            total_value: row.get(2)?,
            total_qty: row.get(3)?,
            invoice_count: row.get(4)?,
        })
    }).map_err(|e| AppError::Db {
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
    let conn_guard = state.conn.lock().map_err(|e| {
        AppError::Internal(format!("Failed to acquire connection lock: {}", e))
    })?;
    let conn = conn_guard.as_ref().ok_or_else(|| AppError::Db {
        code: "ERR_DB_002".to_string(),
        message: "No active database connection profile".to_string(),
    })?;

    let mut stmt = conn.prepare(
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
        LIMIT ?"
    ).map_err(|e| AppError::Db {
        code: "ERR_DB_003".to_string(),
        message: format!("Failed to prepare top items query: {}", e),
    })?;

    let rows = stmt.query_map(params![date_from, date_to, limit], |row| {
        Ok(RankingRow {
            rank: 0,
            code: row.get(0)?,
            name: row.get(1)?,
            total_value: row.get(2)?,
            total_qty: row.get(3)?,
            invoice_count: row.get(4)?,
        })
    }).map_err(|e| AppError::Db {
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

/// Load aggregated dashboard metrics from the database (or materialized tables).
/// This replaces direct cache management — the frontend Zustand store handles caching.
#[tauri::command]
pub fn get_dashboard_metrics(
    state: State<'_, DbState>,
) -> Result<DashboardMetrics, AppError> {
    let conn_guard = state.conn.lock().map_err(|e| {
        AppError::Internal(format!("Failed to acquire connection lock: {}", e))
    })?;
    let conn = conn_guard.as_ref().ok_or_else(|| AppError::Db {
        code: "ERR_DB_002".to_string(),
        message: "No active database connection profile".to_string(),
    })?;

    let today = chrono::Local::now().format("%Y-%m-%d").to_string();
    let month_start = chrono::Local::now().format("%Y-%m-01").to_string();

    // Active FY
    let fy_start: String = conn.query_row(
        "SELECT COALESCE(start_date, '2025-04-01') FROM financial_years WHERE is_active = 1 LIMIT 1",
        [],
        |row| row.get(0),
    ).unwrap_or_else(|_| "2025-04-01".to_string());

    // Today's sales
    let today_sales: f64 = conn.query_row(
        "SELECT COALESCE(SUM(total_value), 0.0) FROM invoices WHERE invoice_date = ? AND status NOT IN ('Cancelled', 'Draft')",
        [&today],
        |row| row.get(0),
    ).unwrap_or(0.0);

    // MTD sales
    let mtd_sales: f64 = conn.query_row(
        "SELECT COALESCE(SUM(total_value), 0.0) FROM invoices WHERE invoice_date >= ? AND invoice_date <= ? AND status NOT IN ('Cancelled', 'Draft')",
        [&month_start, &today],
        |row| row.get(0),
    ).unwrap_or(0.0);

    // YTD sales
    let ytd_sales: f64 = conn.query_row(
        "SELECT COALESCE(SUM(total_value), 0.0) FROM invoices WHERE invoice_date >= ? AND invoice_date <= ? AND status NOT IN ('Cancelled', 'Draft')",
        [&fy_start, &today],
        |row| row.get(0),
    ).unwrap_or(0.0);

    // Pending notes counts
    let pending_cn: u32 = conn.query_row(
        "SELECT COUNT(*) FROM credit_notes WHERE status IN ('Draft', 'Review')",
        [],
        |row| row.get::<_, i64>(0),
    ).unwrap_or(0) as u32;

    let pending_dn: u32 = conn.query_row(
        "SELECT COUNT(*) FROM debit_notes WHERE status IN ('Draft', 'Review')",
        [],
        |row| row.get::<_, i64>(0),
    ).unwrap_or(0) as u32;

    let cancelled_count: u32 = conn.query_row(
        "SELECT COUNT(*) FROM invoices WHERE status = 'Cancelled' AND invoice_date >= ?",
        [&fy_start],
        |row| row.get::<_, i64>(0),
    ).unwrap_or(0) as u32;

    let import_errors: u32 = conn.query_row(
        "SELECT COUNT(*) FROM validation_exceptions WHERE resolved = 0 AND severity = 'error'",
        [],
        |row| row.get::<_, i64>(0),
    ).unwrap_or(0) as u32;

    // GST payable summary for active FY
    let gst_summary = conn.query_row(
        "SELECT
            COALESCE(SUM(total_taxable), 0.0),
            COALESCE(SUM(total_cgst), 0.0),
            COALESCE(SUM(total_sgst), 0.0),
            COALESCE(SUM(total_igst), 0.0),
            COALESCE(SUM(total_value), 0.0)
        FROM invoices
        WHERE invoice_date >= ? AND invoice_date <= ?
          AND status NOT IN ('Cancelled', 'Draft')",
        [&fy_start, &today],
        |row| {
            Ok(GstSummaryBreakdown {
                total_taxable: row.get(0)?,
                total_cgst: row.get(1)?,
                total_sgst: row.get(2)?,
                total_igst: row.get(3)?,
                total_gross: row.get(4)?,
            })
        },
    ).unwrap_or_else(|_| GstSummaryBreakdown {
        total_taxable: 0.0,
        total_cgst: 0.0,
        total_sgst: 0.0,
        total_igst: 0.0,
        total_gross: 0.0,
    });

    // Top 10 customers
    let top_customers = {
        let mut stmt = conn.prepare(
            "SELECT c.customer_name, COALESCE(SUM(i.total_value), 0.0)
             FROM invoices i JOIN customers c ON i.customer_id = c.id
             WHERE i.invoice_date >= ? AND i.status NOT IN ('Cancelled', 'Draft')
             GROUP BY c.id ORDER BY SUM(i.total_value) DESC LIMIT 10"
        ).unwrap();
        let rows = stmt.query_map([&fy_start], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, f64>(1)?))
        }).unwrap();
        rows.filter_map(|r| r.ok()).collect::<Vec<_>>()
    };

    // Top 10 suppliers (by items sold via their parts)
    let top_suppliers = {
        let mut stmt = conn.prepare(
            "SELECT s.supplier_name, COALESCE(SUM(ii.total_value), 0.0)
             FROM invoice_items ii
             JOIN items it ON ii.part_code = it.part_code
             JOIN suppliers s ON it.supplier_id = s.id
             JOIN invoices i ON ii.invoice_number = i.invoice_number
             WHERE i.invoice_date >= ? AND i.status NOT IN ('Cancelled', 'Draft')
             GROUP BY s.id ORDER BY SUM(ii.total_value) DESC LIMIT 10"
        ).unwrap();
        let rows = stmt.query_map([&fy_start], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, f64>(1)?))
        }).unwrap();
        rows.filter_map(|r| r.ok()).collect::<Vec<_>>()
    };

    // Top 20 parts
    let top_parts = {
        let mut stmt = conn.prepare(
            "SELECT it.part_name, COALESCE(SUM(ii.total_value), 0.0)
             FROM invoice_items ii
             JOIN items it ON ii.part_code = it.part_code
             JOIN invoices i ON ii.invoice_number = i.invoice_number
             WHERE i.invoice_date >= ? AND i.status NOT IN ('Cancelled', 'Draft')
             GROUP BY it.part_code ORDER BY SUM(ii.total_value) DESC LIMIT 20"
        ).unwrap();
        let rows = stmt.query_map([&fy_start], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, f64>(1)?))
        }).unwrap();
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

    // Comparative growth (YTD this year vs last year same period)
    let growth_percent = {
        let last_fy_start = fy_start.replace("2025", "2024").replace("2026", "2025");
        let last_today = today.replace("2025", "2024").replace("2026", "2025");
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

    Ok(DashboardMetrics {
        today_sales,
        mtd_sales,
        ytd_sales,
        comparative_growth_percent: growth_percent,
        pending_credit_notes_count: pending_cn,
        pending_debit_notes_count: pending_dn,
        cancelled_invoices_count: cancelled_count,
        top_10_customers: top_customers,
        top_10_suppliers: top_suppliers,
        top_20_parts: top_parts,
        gst_payable_summary: gst_summary,
        import_errors_count: import_errors,
        recent_activity,
    })
}

/// Get financial years list for the report center dropdowns
#[tauri::command]
pub fn get_financial_years_list(
    state: State<'_, DbState>,
) -> Result<Vec<FinancialYearRow>, AppError> {
    let conn_guard = state.conn.lock().map_err(|e| {
        AppError::Internal(format!("Failed to acquire connection lock: {}", e))
    })?;
    let conn = conn_guard.as_ref().ok_or_else(|| AppError::Db {
        code: "ERR_DB_002".to_string(),
        message: "No active database connection profile".to_string(),
    })?;

    let mut stmt = conn.prepare(
        "SELECT id, label, start_date, end_date, is_active, is_locked, closed_at
         FROM financial_years ORDER BY start_date DESC"
    ).map_err(|e| AppError::Db {
        code: "ERR_DB_003".to_string(),
        message: format!("Failed to prepare financial years query: {}", e),
    })?;

    let rows = stmt.query_map([], |row| {
        Ok(FinancialYearRow {
            id: Some(row.get(0)?),
            label: row.get(1)?,
            start_date: row.get(2)?,
            end_date: row.get(3)?,
            is_active: row.get(4)?,
            is_locked: row.get(5)?,
            closed_at: row.get(6)?,
        })
    }).map_err(|e| AppError::Db {
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
