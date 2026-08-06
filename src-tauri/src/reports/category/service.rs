use std::time::Instant;
use rusqlite::params;
use crate::reports::common::{ReportContext, ReportError, ReportMetadata, ReportResult};
use crate::reports::constants::{CATEGORY_REPORT_NAME, CATEGORY_REPORT_VERSION};
use crate::reports::category::models::{CategoryReportFilter, CategorySalesRow, CategoryCustomerBreakdownRow, CategoryGrandTotals};
use crate::reports::category::repository::CategoryReportRepository;

pub struct CategoryReportService;

impl CategoryReportService {
    pub fn generate_report(
        ctx: &ReportContext<'_>,
        mut filter: CategoryReportFilter,
    ) -> Result<ReportResult<CategorySalesRow, CategoryGrandTotals, CategoryReportFilter>, ReportError> {
        let start_time = Instant::now();

        // 1. Validate & Normalize Filter Dates
        if let Some(ref from) = filter.common.date_from {
            if !from.trim().is_empty() && !Self::is_valid_date(from) {
                return Err(ReportError::Validation(format!("Invalid date_from format: {}", from)));
            }
        }
        if let Some(ref to) = filter.common.date_to {
            if !to.trim().is_empty() && !Self::is_valid_date(to) {
                return Err(ReportError::Validation(format!("Invalid date_to format: {}", to)));
            }
        }

        // Default pagination if unspecified
        let page = filter.common.page.unwrap_or(1).max(1);
        let page_size = filter.common.page_size.unwrap_or(100).min(10000);
        filter.common.page = Some(page);
        filter.common.page_size = Some(page_size);

        // 2. Execute Repository Query
        let rows = CategoryReportRepository::fetch_category_sales(ctx.conn, &filter)?;

        // 3. Compute Grand Totals & Analytics
        let mut grand_totals = CategoryGrandTotals::default();
        grand_totals.total_categories = rows.len() as u32;

        for r in &rows {
            grand_totals.total_customers += r.customer_count;
            grand_totals.total_invoices += r.invoice_count;
            grand_totals.total_taxable += r.total_taxable;
            grand_totals.total_cgst += r.total_cgst;
            grand_totals.total_sgst += r.total_sgst;
            grand_totals.total_igst += r.total_igst;
            grand_totals.grand_total_value += r.total_value;

            if r.total_value > 0.0 && r.total_value > (grand_totals.grand_total_value - r.total_value) {
                grand_totals.largest_category_name = r.category_name.clone();
            }
        }

        if grand_totals.grand_total_value > 0.0 {
            if let Some(top) = rows.iter().max_by(|a, b| a.total_value.partial_cmp(&b.total_value).unwrap_or(std::cmp::Ordering::Equal)) {
                grand_totals.largest_category_name = top.category_name.clone();
                grand_totals.largest_category_share = (top.total_value / grand_totals.grand_total_value) * 100.0;
            }
        }

        let elapsed_ms = start_time.elapsed().as_millis() as u64;

        // 4. Construct Metadata
        let total_records = rows.len() as u32;
        let total_pages = if total_records == 0 { 1 } else { (total_records + page_size - 1) / page_size };
        let filter_hash = format!("{:?}", filter);

        let metadata = ReportMetadata {
            report_name: CATEGORY_REPORT_NAME.to_string(),
            report_version: CATEGORY_REPORT_VERSION,
            generated_at: ctx.generated_at.clone(),
            execution_time_ms: elapsed_ms,
            filter_hash,
            total_records,
            total_pages,
            page,
            page_size,
        };

        // 5. Audit Log Telemetry
        let user = ctx.user_name.as_deref().unwrap_or("System");
        let details = format!(
            "Category Report generated: {} rows returned in {} ms for user {}",
            total_records, elapsed_ms, user
        );

        let _ = ctx.conn.execute(
            "INSERT INTO audit_log (event_type, table_name, record_id, changed_by, old_values, new_values) VALUES (?, ?, ?, ?, ?, ?)",
            params!["REPORT_GENERATED", "invoices", "category_sales_report", user, Option::<String>::None, details],
        );

        Ok(ReportResult {
            metadata,
            filter,
            grand_totals,
            rows,
        })
    }

    pub fn get_customer_breakdown(
        ctx: &ReportContext<'_>,
        filter: CategoryReportFilter,
        category_id: Option<i64>,
        category_name: &str,
    ) -> Result<Vec<CategoryCustomerBreakdownRow>, ReportError> {
        CategoryReportRepository::fetch_customer_breakdown(ctx.conn, &filter, category_id, category_name)
    }

    fn is_valid_date(d: &str) -> bool {
        chrono::NaiveDate::parse_from_str(d, "%Y-%m-%d").is_ok()
    }
}
