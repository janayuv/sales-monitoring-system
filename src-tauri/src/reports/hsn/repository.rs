use std::collections::HashSet;
use rusqlite::Connection;
use crate::reports::common::ReportError;
use crate::reports::query_builder::ReportQueryBuilder;
use crate::reports::hsn::models::{
    HsnReportFilter, HsnSalesRow, HsnItemBreakdownRow, HsnInvoiceBreakdownRow,
};

pub struct HsnReportRepository;

impl HsnReportRepository {
    /// Level 1: Fetch aggregated HSN summary rows.
    /// Aggregates sales invoices by HSN code (fallback to 'UNASSIGNED' if null or unmapped).
    pub fn fetch_hsn_sales(
        conn: &Connection,
        filter: &HsnReportFilter,
    ) -> Result<Vec<HsnSalesRow>, ReportError> {
        let mut qb = ReportQueryBuilder::new();
        qb.apply_common_filters(&filter.common, "i.invoice_date", "i.status");

        // Specific HSN codes filter
        if let Some(ref hsn_codes) = filter.hsn_codes {
            if !hsn_codes.is_empty() {
                let placeholders = vec!["?"; hsn_codes.len()].join(", ");
                qb.where_clause(
                    format!("COALESCE(NULLIF(TRIM(ii.hsn_code), ''), NULLIF(TRIM(it.hsn_code), ''), 'UNASSIGNED') IN ({})", placeholders),
                    None,
                );
                for code in hsn_codes {
                    qb.where_clause("", Some(Box::new(code.clone())));
                }
            }
        }

        // Search term filtering (HSN code, HSN description, or Part Name)
        if let Some(ref term) = filter.common.search_term {
            let t = term.trim();
            if !t.is_empty() {
                let pattern = format!("%{}%", t);
                qb.where_clause(
                    "(COALESCE(NULLIF(TRIM(ii.hsn_code), ''), NULLIF(TRIM(it.hsn_code), ''), 'UNASSIGNED') LIKE ? OR h.description LIKE ? OR it.part_name LIKE ?)",
                    Some(Box::new(pattern.clone())),
                );
                qb.where_clause("", Some(Box::new(pattern.clone())));
                qb.where_clause("", Some(Box::new(pattern)));
            }
        }

        let where_sql = qb.build_where_sql();
        let query = format!(
            "SELECT
                COALESCE(NULLIF(TRIM(ii.hsn_code), ''), NULLIF(TRIM(it.hsn_code), ''), 'UNASSIGNED') AS hsn_code,
                MAX(h.description) AS description,
                MAX(it.uom_code) AS uom_code,
                COALESCE(MAX(h.gst_rate), MAX(it.default_gst_rate), 0.0) AS gst_rate,
                COALESCE(SUM(ii.quantity), 0.0) AS total_quantity,
                COUNT(DISTINCT ii.part_code) AS item_count,
                COUNT(DISTINCT i.customer_id) AS customer_count,
                COUNT(DISTINCT i.invoice_number) AS invoice_count,
                COALESCE(SUM(ii.assessable_value), 0.0) AS total_taxable,
                COALESCE(SUM(ii.cgst_amount), 0.0) AS total_cgst,
                COALESCE(SUM(ii.sgst_amount), 0.0) AS total_sgst,
                COALESCE(SUM(ii.igst_amount), 0.0) AS total_igst,
                COALESCE(SUM(ii.cgst_amount + ii.sgst_amount + ii.igst_amount), 0.0) AS total_tax,
                COALESCE(SUM(ii.total_value), 0.0) AS total_value
            FROM invoice_items ii
            JOIN invoices i ON ii.invoice_number = i.invoice_number
            JOIN items it ON ii.part_code = it.part_code
            LEFT JOIN hsn_master h ON COALESCE(NULLIF(TRIM(ii.hsn_code), ''), NULLIF(TRIM(it.hsn_code), ''), 'UNASSIGNED') = h.hsn_code
            {}
            GROUP BY COALESCE(NULLIF(TRIM(ii.hsn_code), ''), NULLIF(TRIM(it.hsn_code), ''), 'UNASSIGNED')
            ORDER BY total_value DESC, hsn_code ASC",
            where_sql
        );


        let mut stmt = conn.prepare(&query)?;
        let params = qb.params_as_refs();
        let rows = stmt.query_map(&params[..], |row| {
            Ok(HsnSalesRow {
                hsn_code: row.get(0)?,
                description: row.get(1)?,
                uom_code: row.get(2)?,
                gst_rate: row.get(3)?,
                total_quantity: row.get(4)?,
                item_count: row.get(5)?,
                customer_count: row.get(6)?,
                invoice_count: row.get(7)?,
                total_taxable: row.get(8)?,
                total_cgst: row.get(9)?,
                total_sgst: row.get(10)?,
                total_igst: row.get(11)?,
                total_tax: row.get(12)?,
                total_value: row.get(13)?,
            })
        })?;

        let mut result = Vec::new();
        let mut seen_hsn_codes = HashSet::new();

        for r in rows {
            let row = r?;
            seen_hsn_codes.insert(row.hsn_code.clone());
            result.push(row);
        }

        // If show_empty_hsn is true, pull all HSN master entries not in the active result set
        if filter.show_empty_hsn.unwrap_or(false) {
            let mut master_stmt = conn.prepare(
                "SELECT hsn_code, description, gst_rate FROM hsn_master ORDER BY hsn_code ASC",
            )?;
            let master_rows = master_stmt.query_map([], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, Option<String>>(1)?,
                    row.get::<_, f64>(2)?,
                ))
            })?;

            for m in master_rows {
                let (hsn_code, description, gst_rate) = m?;
                if !seen_hsn_codes.contains(&hsn_code) {
                    // Check search filter if present
                    if let Some(ref term) = filter.common.search_term {
                        let t = term.to_lowercase();
                        let matches_code = hsn_code.to_lowercase().contains(&t);
                        let matches_desc = description.as_deref().map(|d| d.to_lowercase().contains(&t)).unwrap_or(false);
                        if !matches_code && !matches_desc {
                            continue;
                        }
                    }

                    result.push(HsnSalesRow {
                        hsn_code,
                        description,
                        uom_code: None,
                        gst_rate,
                        total_quantity: 0.0,
                        item_count: 0,
                        customer_count: 0,
                        invoice_count: 0,
                        total_taxable: 0.0,
                        total_cgst: 0.0,
                        total_sgst: 0.0,
                        total_igst: 0.0,
                        total_tax: 0.0,
                        total_value: 0.0,
                    });
                }
            }
        }

        Ok(result)
    }

    /// Level 2: Fetch item breakdown for a selected HSN code.
    pub fn fetch_hsn_item_breakdown(
        conn: &Connection,
        filter: &HsnReportFilter,
        hsn_code: &str,
    ) -> Result<Vec<HsnItemBreakdownRow>, ReportError> {
        let mut qb = ReportQueryBuilder::new();
        qb.apply_common_filters(&filter.common, "i.invoice_date", "i.status");

        if hsn_code.to_uppercase() == "UNASSIGNED" {
            qb.where_clause("COALESCE(NULLIF(TRIM(ii.hsn_code), ''), NULLIF(TRIM(it.hsn_code), ''), 'UNASSIGNED') = 'UNASSIGNED'", None);
        } else {
            qb.where_clause(
                "COALESCE(NULLIF(TRIM(ii.hsn_code), ''), NULLIF(TRIM(it.hsn_code), ''), 'UNASSIGNED') = ?",
                Some(Box::new(hsn_code.to_string())),
            );
        }

        let where_sql = qb.build_where_sql();
        let query = format!(
            "SELECT
                COALESCE(NULLIF(TRIM(ii.hsn_code), ''), NULLIF(TRIM(it.hsn_code), ''), 'UNASSIGNED') AS hsn_code,
                it.part_code,
                it.part_name,
                COALESCE(it.uom_code, 'NOS') AS uom_code,
                COALESCE(it.default_gst_rate, 0.0) AS default_gst_rate,
                COALESCE(SUM(ii.quantity), 0.0) AS total_quantity,
                CASE WHEN SUM(ii.quantity) > 0 THEN SUM(ii.assessable_value) / SUM(ii.quantity) ELSE 0.0 END AS avg_rate,
                COUNT(DISTINCT i.customer_id) AS customer_count,
                COUNT(DISTINCT i.invoice_number) AS invoice_count,
                COALESCE(SUM(ii.assessable_value), 0.0) AS total_taxable,
                COALESCE(SUM(ii.cgst_amount), 0.0) AS total_cgst,
                COALESCE(SUM(ii.sgst_amount), 0.0) AS total_sgst,
                COALESCE(SUM(ii.igst_amount), 0.0) AS total_igst,
                COALESCE(SUM(ii.cgst_amount + ii.sgst_amount + ii.igst_amount), 0.0) AS total_tax,
                COALESCE(SUM(ii.total_value), 0.0) AS total_value
            FROM invoice_items ii
            JOIN invoices i ON ii.invoice_number = i.invoice_number
            JOIN items it ON ii.part_code = it.part_code
            LEFT JOIN hsn_master h ON COALESCE(NULLIF(TRIM(ii.hsn_code), ''), NULLIF(TRIM(it.hsn_code), ''), 'UNASSIGNED') = h.hsn_code
            {}
            GROUP BY it.part_code, it.part_name, it.uom_code, it.default_gst_rate
            ORDER BY total_value DESC, it.part_code ASC",
            where_sql
        );


        let mut stmt = conn.prepare(&query)?;
        let params = qb.params_as_refs();
        let rows = stmt.query_map(&params[..], |row| {
            Ok(HsnItemBreakdownRow {
                hsn_code: row.get(0)?,
                part_code: row.get(1)?,
                part_name: row.get(2)?,
                uom_code: row.get(3)?,
                default_gst_rate: row.get(4)?,
                total_quantity: row.get(5)?,
                avg_rate: row.get(6)?,
                customer_count: row.get(7)?,
                invoice_count: row.get(8)?,
                total_taxable: row.get(9)?,
                total_cgst: row.get(10)?,
                total_sgst: row.get(11)?,
                total_igst: row.get(12)?,
                total_tax: row.get(13)?,
                total_value: row.get(14)?,
            })
        })?;

        let mut result = Vec::new();
        for r in rows {
            result.push(r?);
        }

        Ok(result)
    }

    /// Level 3: Fetch invoice line item breakdown for a selected HSN code and optional part_code.
    pub fn fetch_hsn_invoice_breakdown(
        conn: &Connection,
        filter: &HsnReportFilter,
        hsn_code: &str,
        part_code: Option<&str>,
    ) -> Result<Vec<HsnInvoiceBreakdownRow>, ReportError> {
        let mut qb = ReportQueryBuilder::new();
        qb.apply_common_filters(&filter.common, "i.invoice_date", "i.status");

        if hsn_code.to_uppercase() == "UNASSIGNED" {
            qb.where_clause("COALESCE(NULLIF(TRIM(ii.hsn_code), ''), NULLIF(TRIM(it.hsn_code), ''), 'UNASSIGNED') = 'UNASSIGNED'", None);
        } else {
            qb.where_clause(
                "COALESCE(NULLIF(TRIM(ii.hsn_code), ''), NULLIF(TRIM(it.hsn_code), ''), 'UNASSIGNED') = ?",
                Some(Box::new(hsn_code.to_string())),
            );
        }


        if let Some(part) = part_code {
            if !part.trim().is_empty() {
                qb.where_clause("ii.part_code = ?", Some(Box::new(part.to_string())));
            }
        }

        let where_sql = qb.build_where_sql();
        let query = format!(
            "SELECT
                i.invoice_number,
                i.invoice_date,
                COALESCE(c.customer_code, 'UNASSIGNED') AS customer_code,
                COALESCE(c.report_name, 'Unknown Customer') AS customer_name,
                ii.part_code,
                it.part_name,
                ii.quantity,
                COALESCE(it.uom_code, 'NOS') AS uom_code,
                ii.rate_pre_unit,
                ii.assessable_value,
                ii.cgst_rate,
                ii.cgst_amount,
                ii.sgst_rate,
                ii.sgst_amount,
                ii.igst_rate,
                ii.igst_amount,
                ii.total_value,
                i.status
            FROM invoice_items ii
            JOIN invoices i ON ii.invoice_number = i.invoice_number
            JOIN items it ON ii.part_code = it.part_code
            LEFT JOIN hsn_master h ON COALESCE(NULLIF(TRIM(ii.hsn_code), ''), NULLIF(TRIM(it.hsn_code), ''), 'UNASSIGNED') = h.hsn_code
            LEFT JOIN customers c ON i.customer_id = c.id
            {}
            ORDER BY i.invoice_date DESC, i.invoice_number DESC, ii.id ASC",
            where_sql
        );

        let mut stmt = conn.prepare(&query)?;
        let params = qb.params_as_refs();
        let rows = stmt.query_map(&params[..], |row| {
            Ok(HsnInvoiceBreakdownRow {
                invoice_number: row.get(0)?,
                invoice_date: row.get(1)?,
                customer_code: row.get(2)?,
                customer_name: row.get(3)?,
                part_code: row.get(4)?,
                part_name: row.get(5)?,
                quantity: row.get(6)?,
                uom_code: row.get(7)?,
                rate_pre_unit: row.get(8)?,
                assessable_value: row.get(9)?,
                cgst_rate: row.get(10)?,
                cgst_amount: row.get(11)?,
                sgst_rate: row.get(12)?,
                sgst_amount: row.get(13)?,
                igst_rate: row.get(14)?,
                igst_amount: row.get(15)?,
                total_value: row.get(16)?,
                status: row.get(17)?,
            })
        })?;

        let mut result = Vec::new();
        for r in rows {
            result.push(r?);
        }

        Ok(result)
    }
}
