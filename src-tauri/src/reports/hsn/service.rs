use std::time::Instant;
use rusqlite::params;
use crate::reports::common::{ReportContext, ReportError, ReportMetadata, ReportResult};
use crate::reports::constants::{HSN_REPORT_NAME, HSN_REPORT_VERSION};
use crate::reports::query_builder::ReportQueryBuilder;
use crate::reports::hsn::models::{
    HsnReportFilter, HsnSalesRow, HsnItemBreakdownRow, HsnInvoiceBreakdownRow, HsnGrandTotals,
};
use crate::reports::hsn::repository::HsnReportRepository;

pub struct HsnReportService;

impl HsnReportService {
    pub fn generate_report(
        ctx: &ReportContext<'_>,
        mut filter: HsnReportFilter,
    ) -> Result<ReportResult<HsnSalesRow, HsnGrandTotals, HsnReportFilter>, ReportError> {
        let start_time = Instant::now();

        // 1. Validate date formats
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

        let page = filter.common.page.unwrap_or(1).max(1);
        let page_size = filter.common.page_size.unwrap_or(100).min(10000);
        filter.common.page = Some(page);
        filter.common.page_size = Some(page_size);

        // 2. Fetch HSN summary rows
        let rows = HsnReportRepository::fetch_hsn_sales(ctx.conn, &filter)?;

        // 3. Compute distinct overall invoice and customer counts for the filtered scope
        let mut count_qb = ReportQueryBuilder::new();
        count_qb.apply_common_filters(&filter.common, "i.invoice_date", "i.status");

        if let Some(ref hsn_codes) = filter.hsn_codes {
            if !hsn_codes.is_empty() {
                let placeholders = vec!["?"; hsn_codes.len()].join(", ");
                count_qb.where_clause(
                    format!("COALESCE(NULLIF(TRIM(h.hsn_code), ''), NULLIF(TRIM(it.hsn_code), ''), 'UNASSIGNED') IN ({})", placeholders),
                    None,
                );
                for code in hsn_codes {
                    count_qb.where_clause("", Some(Box::new(code.clone())));
                }
            }
        }

        if let Some(ref term) = filter.common.search_term {
            let t = term.trim();
            if !t.is_empty() {
                let pattern = format!("%{}%", t);
                count_qb.where_clause(
                    "(COALESCE(NULLIF(TRIM(h.hsn_code), ''), NULLIF(TRIM(it.hsn_code), ''), 'UNASSIGNED') LIKE ? OR h.description LIKE ? OR it.part_name LIKE ?)",
                    Some(Box::new(pattern.clone())),
                );
                count_qb.where_clause("", Some(Box::new(pattern.clone())));
                count_qb.where_clause("", Some(Box::new(pattern)));
            }
        }


        let count_where = count_qb.build_where_sql();
        let count_query = format!(
            "SELECT 
                COUNT(DISTINCT i.invoice_number), 
                COUNT(DISTINCT i.customer_id),
                COUNT(DISTINCT ii.part_code)
             FROM invoice_items ii
             JOIN invoices i ON ii.invoice_number = i.invoice_number
             JOIN items it ON ii.part_code = it.part_code
             LEFT JOIN hsn_master h ON it.hsn_code = h.hsn_code
             {}",
            count_where
        );

        let (total_invoices, total_customers, total_items): (i64, i64, i64) = ctx
            .conn
            .query_row(&count_query, &count_qb.params_as_refs()[..], |row| {
                Ok((row.get(0)?, row.get(1)?, row.get(2)?))
            })
            .unwrap_or((0, 0, 0));

        // 4. Compute Grand Totals & Analytics
        let mut grand_totals = HsnGrandTotals {
            total_hsn_codes: rows.len() as u32,
            total_items,
            total_customers,
            total_invoices,
            ..Default::default()
        };

        for r in &rows {
            grand_totals.total_quantity += r.total_quantity;
            grand_totals.total_taxable += r.total_taxable;
            grand_totals.total_cgst += r.total_cgst;
            grand_totals.total_sgst += r.total_sgst;
            grand_totals.total_igst += r.total_igst;
            grand_totals.total_tax += r.total_tax;
            grand_totals.grand_total_value += r.total_value;
        }

        if grand_totals.grand_total_value > 0.0 {
            if let Some(top) = rows
                .iter()
                .filter(|r| r.total_value > 0.0)
                .max_by(|a, b| a.total_value.partial_cmp(&b.total_value).unwrap_or(std::cmp::Ordering::Equal))
            {
                grand_totals.top_hsn_code = top.hsn_code.clone();
                grand_totals.top_hsn_description = top.description.clone().unwrap_or_else(|| "N/A".to_string());
                grand_totals.top_hsn_share = (top.total_value / grand_totals.grand_total_value) * 100.0;
            }
        }

        let elapsed_ms = start_time.elapsed().as_millis() as u64;

        // 5. Build Report Metadata
        let total_records = rows.len() as u32;
        let total_pages = if total_records == 0 { 1 } else { (total_records + page_size - 1) / page_size };
        let filter_hash = format!("{:?}", filter);

        let metadata = ReportMetadata {
            report_name: HSN_REPORT_NAME.to_string(),
            report_version: HSN_REPORT_VERSION,
            generated_at: ctx.generated_at.clone(),
            execution_time_ms: elapsed_ms,
            filter_hash,
            total_records,
            total_pages,
            page,
            page_size,
        };

        // 6. Audit Log Telemetry
        let user = ctx.user_name.as_deref().unwrap_or("System");
        let details = format!(
            "HSN Report generated: {} rows returned in {} ms for user {}",
            total_records, elapsed_ms, user
        );

        let _ = ctx.conn.execute(
            "INSERT INTO audit_log (event_type, table_name, record_id, changed_by, old_values, new_values) VALUES (?, ?, ?, ?, ?, ?)",
            params!["REPORT_GENERATED", "invoices", "hsn_sales_report", user, Option::<String>::None, details],
        );

        Ok(ReportResult {
            metadata,
            filter,
            grand_totals,
            rows,
        })
    }

    pub fn get_item_breakdown(
        ctx: &ReportContext<'_>,
        filter: HsnReportFilter,
        hsn_code: &str,
    ) -> Result<Vec<HsnItemBreakdownRow>, ReportError> {
        HsnReportRepository::fetch_hsn_item_breakdown(ctx.conn, &filter, hsn_code)
    }

    pub fn get_invoice_breakdown(
        ctx: &ReportContext<'_>,
        filter: HsnReportFilter,
        hsn_code: &str,
        part_code: Option<&str>,
    ) -> Result<Vec<HsnInvoiceBreakdownRow>, ReportError> {
        HsnReportRepository::fetch_hsn_invoice_breakdown(ctx.conn, &filter, hsn_code, part_code)
    }

    fn is_valid_date(d: &str) -> bool {
        chrono::NaiveDate::parse_from_str(d, "%Y-%m-%d").is_ok()
    }
}
