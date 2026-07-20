use crate::error::AppError;
use crate::repositories::ReportRepository;
use rusqlite::{params, Connection};

/// Materializes the three summary_* rollup tables from live invoice data.
///
/// Each refresh is a full delete-and-replace for the given financial year
/// (not an incremental delta). A financial year has at most 12 months of
/// data, so recomputing the whole year on every write is cheap and avoids
/// an entire class of delta-tracking bugs.
pub struct SqliteReportRepository;

impl ReportRepository for SqliteReportRepository {
    fn refresh_monthly_summary(
        &self,
        conn: &Connection,
        financial_year_id: i64,
    ) -> Result<(), AppError> {
        conn.execute(
            "DELETE FROM summary_monthly_sales WHERE financial_year_id = ?",
            params![financial_year_id],
        )
        .map_err(|e| AppError::Db {
            code: "ERR_DB_003".to_string(),
            message: format!("Failed to clear monthly sales rollup: {}", e),
        })?;

        conn.execute(
            "INSERT INTO summary_monthly_sales
                (financial_year_id, month_no, total_taxable, total_cgst, total_sgst, total_igst, total_value, invoice_count, active_count, cancelled_count)
             SELECT
                financial_year_id,
                strftime('%Y-%m', invoice_date),
                COALESCE(SUM(CASE WHEN status NOT IN ('Cancelled', 'Draft') THEN total_taxable ELSE 0.0 END), 0.0),
                COALESCE(SUM(CASE WHEN status NOT IN ('Cancelled', 'Draft') THEN total_cgst ELSE 0.0 END), 0.0),
                COALESCE(SUM(CASE WHEN status NOT IN ('Cancelled', 'Draft') THEN total_sgst ELSE 0.0 END), 0.0),
                COALESCE(SUM(CASE WHEN status NOT IN ('Cancelled', 'Draft') THEN total_igst ELSE 0.0 END), 0.0),
                COALESCE(SUM(CASE WHEN status NOT IN ('Cancelled', 'Draft') THEN total_value ELSE 0.0 END), 0.0),
                COUNT(*),
                SUM(CASE WHEN status NOT IN ('Cancelled', 'Draft') THEN 1 ELSE 0 END),
                SUM(CASE WHEN status = 'Cancelled' THEN 1 ELSE 0 END)
             FROM invoices
             WHERE financial_year_id = ?
             GROUP BY strftime('%Y-%m', invoice_date)",
            params![financial_year_id],
        )
        .map_err(|e| AppError::Db {
            code: "ERR_DB_003".to_string(),
            message: format!("Failed to rebuild monthly sales rollup: {}", e),
        })?;

        Ok(())
    }

    fn refresh_customer_summary(
        &self,
        conn: &Connection,
        financial_year_id: i64,
    ) -> Result<(), AppError> {
        conn.execute(
            "DELETE FROM summary_customer_sales WHERE financial_year_id = ?",
            params![financial_year_id],
        )
        .map_err(|e| AppError::Db {
            code: "ERR_DB_003".to_string(),
            message: format!("Failed to clear customer sales rollup: {}", e),
        })?;

        conn.execute(
            "INSERT INTO summary_customer_sales
                (financial_year_id, customer_id, total_taxable, total_cgst, total_sgst, total_igst, total_value)
             SELECT
                i.financial_year_id,
                i.customer_id,
                COALESCE(SUM(i.total_taxable), 0.0),
                COALESCE(SUM(i.total_cgst), 0.0),
                COALESCE(SUM(i.total_sgst), 0.0),
                COALESCE(SUM(i.total_igst), 0.0),
                COALESCE(SUM(i.total_value), 0.0)
             FROM invoices i
             WHERE i.financial_year_id = ? AND i.status NOT IN ('Cancelled', 'Draft')
             GROUP BY i.customer_id",
            params![financial_year_id],
        )
        .map_err(|e| AppError::Db {
            code: "ERR_DB_003".to_string(),
            message: format!("Failed to rebuild customer sales rollup: {}", e),
        })?;

        Ok(())
    }

    fn refresh_supplier_summary(
        &self,
        conn: &Connection,
        financial_year_id: i64,
    ) -> Result<(), AppError> {
        conn.execute(
            "DELETE FROM summary_supplier_sales WHERE financial_year_id = ?",
            params![financial_year_id],
        )
        .map_err(|e| AppError::Db {
            code: "ERR_DB_003".to_string(),
            message: format!("Failed to clear supplier sales rollup: {}", e),
        })?;

        conn.execute(
            "INSERT INTO summary_supplier_sales
                (financial_year_id, supplier_id, part_code, total_qty, total_taxable, total_cgst, total_sgst, total_igst, total_value, avg_selling_price)
             SELECT
                i.financial_year_id,
                it.supplier_id,
                ii.part_code,
                COALESCE(SUM(ii.quantity), 0.0),
                COALESCE(SUM(ii.assessable_value), 0.0),
                COALESCE(SUM(ii.cgst_amount), 0.0),
                COALESCE(SUM(ii.sgst_amount), 0.0),
                COALESCE(SUM(ii.igst_amount), 0.0),
                COALESCE(SUM(ii.total_value), 0.0),
                CASE WHEN SUM(ii.quantity) > 0 THEN SUM(ii.total_value) / SUM(ii.quantity) ELSE 0.0 END
             FROM invoice_items ii
             JOIN invoices i ON ii.invoice_number = i.invoice_number
             JOIN items it ON ii.part_code = it.part_code
             WHERE i.financial_year_id = ? AND i.status NOT IN ('Cancelled', 'Draft') AND it.supplier_id IS NOT NULL
             GROUP BY it.supplier_id, ii.part_code",
            params![financial_year_id],
        )
        .map_err(|e| AppError::Db {
            code: "ERR_DB_003".to_string(),
            message: format!("Failed to rebuild supplier sales rollup: {}", e),
        })?;

        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::database::migrate::run_migrations;

    // The 0001_init.sql migration already seeds states, currencies, gst_rates
    // (incl. 18.0), uoms (incl. 'PCS'), hsn_master (incl. '8708.99.00'), and an
    // active financial_years row (auto-increment id = 1). The fixture only adds
    // the customer/supplier/item masters those seeds don't provide, and reuses
    // the seeded FY id = 1 — re-inserting seeded rows here would hit PK conflicts.
    fn setup_test_db() -> Connection {
        let mut conn = Connection::open_in_memory().unwrap();
        run_migrations(&mut conn).unwrap();

        conn.execute_batch(
            "INSERT INTO customers (id, customer_code, customer_name, status) VALUES (1, 'CUST01', 'Test Customer', 'Approved');
             INSERT INTO suppliers (id, supplier_code, supplier_name, status) VALUES (1, 'SUP01', 'Test Supplier', 'Approved');
             INSERT INTO items (part_code, part_name, hsn_code, uom_code, default_gst_rate, supplier_id, status)
                VALUES ('P01', 'Test Part', '8708.99.00', 'PCS', 18.0, 1, 'Approved');",
        )
        .unwrap();

        conn
    }

    fn insert_invoice(
        conn: &Connection,
        number: &str,
        date: &str,
        status: &str,
        taxable: f64,
        cgst: f64,
        sgst: f64,
        total: f64,
    ) {
        conn.execute(
            "INSERT INTO invoices (invoice_number, invoice_date, customer_id, financial_year_id, total_taxable, total_cgst, total_sgst, total_igst, total_value, status)
             VALUES (?, ?, 1, 1, ?, ?, ?, 0.0, ?, ?)",
            params![number, date, taxable, cgst, sgst, total, status],
        )
        .unwrap();

        conn.execute(
            "INSERT INTO invoice_items (invoice_number, part_code, quantity, rate_pre_unit, assessable_value, cgst_rate, cgst_amount, sgst_rate, sgst_amount, igst_rate, igst_amount, total_value)
             VALUES (?, 'P01', 10.0, ?, ?, 9.0, ?, 9.0, ?, 0.0, 0.0, ?)",
            params![number, taxable / 10.0, taxable, cgst, sgst, total],
        )
        .unwrap();
    }

    #[test]
    fn refresh_monthly_summary_excludes_cancelled_and_draft_invoices() {
        let conn = setup_test_db();
        insert_invoice(
            &conn,
            "INV001",
            "2025-05-10",
            "Imported",
            1000.0,
            90.0,
            90.0,
            1180.0,
        );
        insert_invoice(
            &conn,
            "INV002",
            "2025-05-15",
            "Cancelled",
            500.0,
            45.0,
            45.0,
            590.0,
        );

        let repo = SqliteReportRepository;
        repo.refresh_monthly_summary(&conn, 1).unwrap();

        let (total_value, active_count, cancelled_count): (f64, i64, i64) = conn
            .query_row(
                "SELECT total_value, active_count, cancelled_count FROM summary_monthly_sales WHERE financial_year_id = 1 AND month_no = '2025-05'",
                [],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            )
            .unwrap();

        assert_eq!(total_value, 1180.0);
        assert_eq!(active_count, 1);
        assert_eq!(cancelled_count, 1);
    }

    #[test]
    fn refresh_monthly_summary_replaces_stale_rows_on_rerun() {
        let conn = setup_test_db();
        insert_invoice(
            &conn,
            "INV001",
            "2025-05-10",
            "Imported",
            1000.0,
            90.0,
            90.0,
            1180.0,
        );

        let repo = SqliteReportRepository;
        repo.refresh_monthly_summary(&conn, 1).unwrap();
        repo.refresh_monthly_summary(&conn, 1).unwrap();

        let row_count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM summary_monthly_sales WHERE financial_year_id = 1",
                [],
                |row| row.get(0),
            )
            .unwrap();

        assert_eq!(row_count, 1, "re-running refresh should not duplicate rows");
    }

    #[test]
    fn refresh_customer_summary_aggregates_active_invoices_per_customer() {
        let conn = setup_test_db();
        insert_invoice(
            &conn,
            "INV001",
            "2025-05-10",
            "Imported",
            1000.0,
            90.0,
            90.0,
            1180.0,
        );
        insert_invoice(
            &conn,
            "INV002",
            "2025-06-10",
            "Verified",
            2000.0,
            180.0,
            180.0,
            2360.0,
        );

        let repo = SqliteReportRepository;
        repo.refresh_customer_summary(&conn, 1).unwrap();

        let total_value: f64 = conn
            .query_row(
                "SELECT total_value FROM summary_customer_sales WHERE financial_year_id = 1 AND customer_id = 1",
                [],
                |row| row.get(0),
            )
            .unwrap();

        assert_eq!(total_value, 3540.0);
    }

    #[test]
    fn refresh_supplier_summary_aggregates_active_invoice_items_per_supplier_and_part() {
        let conn = setup_test_db();
        insert_invoice(
            &conn,
            "INV001",
            "2025-05-10",
            "Imported",
            1000.0,
            90.0,
            90.0,
            1180.0,
        );

        let repo = SqliteReportRepository;
        repo.refresh_supplier_summary(&conn, 1).unwrap();

        let (total_qty, total_value): (f64, f64) = conn
            .query_row(
                "SELECT total_qty, total_value FROM summary_supplier_sales WHERE financial_year_id = 1 AND supplier_id = 1 AND part_code = 'P01'",
                [],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .unwrap();

        assert_eq!(total_qty, 10.0);
        assert_eq!(total_value, 1180.0);
    }
}
