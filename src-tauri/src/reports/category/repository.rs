use rusqlite::Connection;
use crate::reports::common::ReportError;
use crate::reports::query_builder::ReportQueryBuilder;
use crate::reports::category::models::{CategoryReportFilter, CategorySalesRow, CategoryCustomerBreakdownRow};

pub struct CategoryReportRepository;

impl CategoryReportRepository {
    /// Fetch Category Sales Summary using canonical category_id join
    pub fn fetch_category_sales(
        conn: &Connection,
        filter: &CategoryReportFilter,
    ) -> Result<Vec<CategorySalesRow>, ReportError> {
        let mut qb = ReportQueryBuilder::new();
        qb.apply_common_filters(&filter.common, "i.invoice_date", "i.status");

        if let Some(ref cat_ids) = filter.category_ids {
            if !cat_ids.is_empty() {
                let placeholders = vec!["?"; cat_ids.len()].join(", ");
                qb.where_clause(
                    format!("COALESCE(cat.id, 0) IN ({})", placeholders),
                    None,
                );
                // Bind each category ID parameter
                for id in cat_ids {
                    qb.where_clause("", Some(Box::new(*id)));
                }
            }
        }

        let show_empty = filter.show_empty_categories.unwrap_or(false);

        let where_sql = qb.build_where_sql();
        let query = format!(
            "SELECT
                cat.id AS category_id,
                COALESCE(cat.name, c.category_name, 'Uncategorized') AS category_name,
                COUNT(DISTINCT i.customer_id) AS customer_count,
                COUNT(DISTINCT i.invoice_number) AS invoice_count,
                COALESCE(SUM(i.total_taxable), 0.0) AS total_taxable,
                COALESCE(SUM(i.total_cgst), 0.0) AS total_cgst,
                COALESCE(SUM(i.total_sgst), 0.0) AS total_sgst,
                COALESCE(SUM(i.total_igst), 0.0) AS total_igst,
                COALESCE(SUM(i.total_value), 0.0) AS total_value
            FROM invoices i
            LEFT JOIN customers c ON i.customer_id = c.id
            LEFT JOIN customer_categories cat ON c.category_id = cat.id
            {}
            GROUP BY COALESCE(cat.id, 0), COALESCE(cat.name, c.category_name, 'Uncategorized')
            HAVING invoice_count > 0 OR {} = 1
            ORDER BY total_value DESC, category_name ASC",
            where_sql,
            if show_empty { 1 } else { 0 }
        );

        let mut stmt = conn.prepare(&query)?;
        let params = qb.params_as_refs();
        let rows = stmt.query_map(&params[..], |row| {
            Ok(CategorySalesRow {
                category_id: row.get(0)?,
                category_name: row.get(1)?,
                customer_count: row.get(2)?,
                invoice_count: row.get(3)?,
                total_taxable: row.get(4)?,
                total_cgst: row.get(5)?,
                total_sgst: row.get(6)?,
                total_igst: row.get(7)?,
                total_value: row.get(8)?,
            })
        })?;

        let mut result = Vec::new();
        for r in rows {
            result.push(r?);
        }

        Ok(result)
    }

    /// Fetch customer sales breakdown under a specific category
    pub fn fetch_customer_breakdown(
        conn: &Connection,
        filter: &CategoryReportFilter,
        category_id: Option<i64>,
        category_name: &str,
    ) -> Result<Vec<CategoryCustomerBreakdownRow>, ReportError> {
        let mut qb = ReportQueryBuilder::new();
        qb.apply_common_filters(&filter.common, "i.invoice_date", "i.status");

        if let Some(cat_id) = category_id {
            if cat_id > 0 {
                qb.where_clause("c.category_id = ?", Some(Box::new(cat_id)));
            } else {
                qb.where_clause("(c.category_id IS NULL OR c.category_id = 0)", None);
            }
        } else if category_name.to_lowercase() == "uncategorized" {
            qb.where_clause("(c.category_id IS NULL OR c.category_name IS NULL)", None);
        } else {
            qb.where_clause("(c.category_name = ? OR cat.name = ?)", Some(Box::new(category_name.to_string())));
            qb.where_clause("", Some(Box::new(category_name.to_string())));
        }

        let where_sql = qb.build_where_sql();
        let query = format!(
            "SELECT
                c.id AS customer_id,
                COALESCE(c.customer_code, 'UNASSIGNED') AS customer_code,
                COALESCE(c.report_name, 'Unknown Customer') AS report_name,
                COUNT(DISTINCT i.invoice_number) AS invoice_count,
                MAX(i.invoice_date) AS last_invoice_date,
                COALESCE(SUM(i.total_taxable), 0.0) AS total_taxable,
                COALESCE(SUM(i.total_cgst + i.total_sgst + i.total_igst), 0.0) AS total_gst,
                COALESCE(SUM(i.total_value), 0.0) AS total_value
            FROM invoices i
            LEFT JOIN customers c ON i.customer_id = c.id
            LEFT JOIN customer_categories cat ON c.category_id = cat.id
            {}
            GROUP BY c.id, c.customer_code, c.report_name
            ORDER BY total_value DESC, report_name ASC",
            where_sql
        );

        let mut stmt = conn.prepare(&query)?;
        let params = qb.params_as_refs();
        let rows = stmt.query_map(&params[..], |row| {
            Ok(CategoryCustomerBreakdownRow {
                customer_id: row.get(0)?,
                customer_code: row.get(1)?,
                report_name: row.get(2)?,
                invoice_count: row.get(3)?,
                last_invoice_date: row.get(4)?,
                total_taxable: row.get(5)?,
                total_gst: row.get(6)?,
                total_value: row.get(7)?,
            })
        })?;

        let mut result = Vec::new();
        for r in rows {
            result.push(r?);
        }

        Ok(result)
    }
}
