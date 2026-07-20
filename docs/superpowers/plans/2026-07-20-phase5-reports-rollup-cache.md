# Phase 5 Completion — Rollup, Dashboard Cache, PDF Export & Reports UI — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Finish the remaining Phase 5 work from `implementation_plan.md` §18 ("Tally Exporter Splitting & Rollup" and "Report Builder & Dashboard Cache"): populate the materialized summary rollup tables, add an in-memory dashboard cache, add a PDF exporter, and build the Reports & Export / Dashboard KPI frontend UI that already has wired state and API calls but renders nothing.

**Architecture:** Backend stays in the existing flat `src-tauri/src/` module layout (commands/services/repositories/models/database/utils) — no Cargo workspace split, matching what Phases 1-4 actually built. A new `ReportRepository` trait + `SqliteReportRepository` impl does full-FY recompute-and-replace rollups (simpler and more correct than incremental deltas) into the three already-existing `summary_*` tables, triggered from the write commands that change invoice data. `DbState` gains a `Mutex<Option<DashboardMetrics>>` cache invalidated by those same triggers. The frontend follows the existing single-file `App.tsx` convention (no Zustand/React Router — those aren't installed and adding them is out of scope) but extracts the two sizable new UI pieces (`DashboardKpis`, `ReportsPanel`) into their own presentational components so `App.tsx` doesn't grow past ~1700 lines.

**Tech Stack:** Rust (Tauri v2, rusqlite w/ bundled-sqlcipher, rust_xlsxwriter, printpdf [new], chrono, ts-rs), React 19 + TypeScript + Tailwind v4 (no new frontend deps).

## Global Constraints

- Follow the existing flat `src-tauri/src/` module layout — do not introduce the Cargo-workspace split described in the architecture doc §3.1, it does not match the actual codebase.
- `Exporter::export(&self, data: &[TallyExportRow], output_path: &str) -> Result<u32, AppError>` — no `template_path` param (already established by `TallyExcelExporter`/`StandardExcelExporter`/`CsvExporter`; the new `PdfExporter` must match).
- Error codes: reuse the existing `ERR_DB_003` (query failure), `ERR_TALLY_001`/`ERR_TALLY_002` (export failure) codes from `src-tauri/src/error.rs` — do not invent new codes for this work.
- SQL: use bound parameters (`params![...]`) for all new queries — never string-interpolate user-controlled values (the existing `status_filter` string interpolation in `query_tally_export_rows` is pre-existing and out of scope here).
- `get_gst_rate_summary`, `get_top_customers`, `get_top_items` stay as **live** aggregation queries — they serve arbitrary user-picked date ranges that the FY-scoped rollup tables cannot correctly answer. Only `get_monthly_sales_summary` and the active-FY sections of `get_dashboard_metrics` move to the rollup tables.
- No new frontend dependencies (no Zustand, no React Router, no charting library) — out of scope per user decision. Trend/ranking data renders as tables, not charts.
- Rust: `cargo fmt` + no new `cargo clippy -- -D warnings` violations before considering any task done. Never `unwrap()`/`expect()` outside `#[cfg(test)]`.
- Frontend has zero existing test infrastructure (no Vitest/Jest/RTL configured) — this plan does not introduce one (that's a separate, larger decision). Frontend tasks are verified by running the app via `preview_start`/Browser tools, not automated tests. Backend tasks get real Rust `#[test]`s, matching the codebase's existing pattern in `export_service.rs`.

---

## Task 1: `ReportRepository` — rollup population for the three summary tables

**Files:**
- Modify: `src-tauri/src/repositories/mod.rs`
- Create: `src-tauri/src/repositories/report_repo.rs`

**Interfaces:**
- Produces: `pub trait ReportRepository` with `refresh_monthly_summary`, `refresh_customer_summary`, `refresh_supplier_summary` (all `fn(&self, conn: &Connection, financial_year_id: i64) -> Result<(), AppError>`), and `pub struct SqliteReportRepository;` implementing it. Task 2 calls these three methods.

- [ ] **Step 1: Add the trait to `repositories/mod.rs`**

Add `pub mod report_repo;` next to the other `pub mod` lines (after `pub mod note_repo;`), and add this trait at the end of the file:

```rust
pub trait ReportRepository: Send + Sync {
    /// Recomputes summary_monthly_sales for one financial year from `invoices`.
    fn refresh_monthly_summary(&self, conn: &Connection, financial_year_id: i64) -> Result<(), AppError>;
    /// Recomputes summary_customer_sales for one financial year from `invoices`.
    fn refresh_customer_summary(&self, conn: &Connection, financial_year_id: i64) -> Result<(), AppError>;
    /// Recomputes summary_supplier_sales for one financial year from `invoice_items`.
    fn refresh_supplier_summary(&self, conn: &Connection, financial_year_id: i64) -> Result<(), AppError>;
}
```

- [ ] **Step 2: Write `src-tauri/src/repositories/report_repo.rs`**

```rust
use rusqlite::{params, Connection};
use crate::error::AppError;
use crate::repositories::ReportRepository;

/// Materializes the three summary_* rollup tables from live invoice data.
///
/// Each refresh is a full delete-and-replace for the given financial year
/// (not an incremental delta). A financial year has at most 12 months of
/// data, so recomputing the whole year on every write is cheap and avoids
/// an entire class of delta-tracking bugs.
pub struct SqliteReportRepository;

impl ReportRepository for SqliteReportRepository {
    fn refresh_monthly_summary(&self, conn: &Connection, financial_year_id: i64) -> Result<(), AppError> {
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

    fn refresh_customer_summary(&self, conn: &Connection, financial_year_id: i64) -> Result<(), AppError> {
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

    fn refresh_supplier_summary(&self, conn: &Connection, financial_year_id: i64) -> Result<(), AppError> {
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

    fn insert_invoice(conn: &Connection, number: &str, date: &str, status: &str, taxable: f64, cgst: f64, sgst: f64, total: f64) {
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
        insert_invoice(&conn, "INV001", "2025-05-10", "Imported", 1000.0, 90.0, 90.0, 1180.0);
        insert_invoice(&conn, "INV002", "2025-05-15", "Cancelled", 500.0, 45.0, 45.0, 590.0);

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
        insert_invoice(&conn, "INV001", "2025-05-10", "Imported", 1000.0, 90.0, 90.0, 1180.0);

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
        insert_invoice(&conn, "INV001", "2025-05-10", "Imported", 1000.0, 90.0, 90.0, 1180.0);
        insert_invoice(&conn, "INV002", "2025-06-10", "Verified", 2000.0, 180.0, 180.0, 2360.0);

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
        insert_invoice(&conn, "INV001", "2025-05-10", "Imported", 1000.0, 90.0, 90.0, 1180.0);

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
```

- [ ] **Step 3: Run the tests**

```bash
cd "src-tauri" && cargo test report_repo
```

Expected: 4 tests pass (`refresh_monthly_summary_excludes_cancelled_and_draft_invoices`, `refresh_monthly_summary_replaces_stale_rows_on_rerun`, `refresh_customer_summary_aggregates_active_invoices_per_customer`, `refresh_supplier_summary_aggregates_active_invoice_items_per_supplier_and_part`).

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/repositories/mod.rs src-tauri/src/repositories/report_repo.rs
git commit -m "feat: add ReportRepository for materialized summary rollups"
```

(If this repo has no git history yet, run `git init` first and skip commits between tasks — just commit once at the end. Check `git status` before this step to decide.)

---

## Task 2: Dashboard cache + wire rollup refresh into write commands

**Files:**
- Modify: `src-tauri/src/state.rs`
- Modify: `src-tauri/src/commands/import_commands.rs`
- Modify: `src-tauri/src/commands/invoice_commands.rs`
- Modify: `src-tauri/src/commands/revision_commands.rs`
- Modify: `src-tauri/src/commands/profile_commands.rs`

**Interfaces:**
- Consumes: `ReportRepository::refresh_monthly_summary/refresh_customer_summary/refresh_supplier_summary` from Task 1.
- Produces: `DbState.dashboard_cache: Mutex<Option<DashboardMetrics>>` — Task 3's `get_dashboard_metrics` reads/writes it.

- [ ] **Step 1: Add the cache field to `DbState`**

Replace the full contents of `src-tauri/src/state.rs`:

```rust
use std::sync::Mutex;
use rusqlite::Connection;
use crate::models::domain_models::DashboardMetrics;

pub struct DbState {
    pub conn: Mutex<Option<Connection>>,
    pub dashboard_cache: Mutex<Option<DashboardMetrics>>,
}

impl DbState {
    pub fn new() -> Self {
        Self {
            conn: Mutex::new(None),
            dashboard_cache: Mutex::new(None),
        }
    }
}
```

- [ ] **Step 2: Wire refresh + cache invalidation into `commit_import_batch`**

In `src-tauri/src/commands/import_commands.rs`, add to the imports at the top:

```rust
use crate::repositories::report_repo::SqliteReportRepository;
use crate::repositories::ReportRepository;
```

Find the end of the "Flush buffers into database transactions" `for` loop (the loop starting `for (inv_no, mut header) in invoice_headers_buffer {`, ending just before the `// Update batch status to completed` comment). Insert immediately after that loop's closing `}` and before `// Update batch status to completed`:

```rust
    // Rebuild materialized summary rollups for the active financial year (Phase 5 rollup)
    let report_repo = SqliteReportRepository;
    report_repo.refresh_monthly_summary(&tx, active_fy_id)?;
    report_repo.refresh_customer_summary(&tx, active_fy_id)?;
    report_repo.refresh_supplier_summary(&tx, active_fy_id)?;
```

Then find `tx.commit().map_err(|e| AppError::Db {` near the end of the function. Immediately after that `tx.commit()...?;` statement (i.e. right before `log::info!("Successfully committed import batch ID: {}", batch_id);`), insert:

```rust
    if let Ok(mut cache) = state.dashboard_cache.lock() {
        *cache = None;
    }
```

- [ ] **Step 3: Wire refresh + cache invalidation into `update_invoice_status` and `delete_invoice_record`**

In `src-tauri/src/commands/invoice_commands.rs`, add to the imports:

```rust
use crate::repositories::report_repo::SqliteReportRepository;
use crate::repositories::ReportRepository;
```

In `update_invoice_status`, immediately before the final `tx.commit().map_err(|e| AppError::Db {` call, insert:

```rust
    let report_repo = SqliteReportRepository;
    report_repo.refresh_monthly_summary(&tx, old_invoice.financial_year_id)?;
    report_repo.refresh_customer_summary(&tx, old_invoice.financial_year_id)?;
    report_repo.refresh_supplier_summary(&tx, old_invoice.financial_year_id)?;
```

Then immediately after that function's `tx.commit()...?;` and before its `Ok(())`, insert:

```rust
    if let Ok(mut cache) = state.dashboard_cache.lock() {
        *cache = None;
    }
```

Do the same in `delete_invoice_record`: insert the three `report_repo.refresh_*` calls before its `tx.commit()`, and the cache-clear block after `tx.commit()...?;` and before `Ok(())`. `delete_invoice_record` already has `old_invoice.financial_year_id` in scope from its existing `find_invoice` call — reuse it.

- [ ] **Step 4: Wire cache invalidation into `auto_generate_credit_note` and `approve_debit_note`**

In `src-tauri/src/commands/revision_commands.rs`, add to the imports:

```rust
use crate::repositories::report_repo::SqliteReportRepository;
use crate::repositories::ReportRepository;
```

In `auto_generate_credit_note`, the existing query is:

```rust
    let (customer_id, total_taxable, total_cgst, total_sgst, total_igst, total_value, status) = tx.query_row(
        "SELECT customer_id, total_taxable, total_cgst, total_sgst, total_igst, total_value, status
         FROM invoices WHERE invoice_number = ?",
```

Replace it (and its destructure) with:

```rust
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
```

This transitions the invoice out of `'Cancelled'` (excluded from rollup sums) into `'Credit Note Generated'` (included), so before the function's `tx.commit()`, insert:

```rust
    let report_repo = SqliteReportRepository;
    report_repo.refresh_monthly_summary(&tx, financial_year_id)?;
    report_repo.refresh_customer_summary(&tx, financial_year_id)?;
    report_repo.refresh_supplier_summary(&tx, financial_year_id)?;
```

And after `tx.commit()...?;` in both `auto_generate_credit_note` and `approve_debit_note` (the latter doesn't touch `invoices`/`invoice_items` so it only needs the cache clear, not a rollup refresh — `pending_debit_notes_count` on the dashboard is a live query, not part of the summary tables, but it's still served by the cached `DashboardMetrics`), insert:

```rust
    if let Ok(mut cache) = state.dashboard_cache.lock() {
        *cache = None;
    }
```

- [ ] **Step 5: Clear the cache on company profile switch**

In `src-tauri/src/commands/profile_commands.rs`, in `switch_company_profile`, immediately after `*conn_guard = Some(conn);` and before the `log::info!(...)` / `Ok(())`, insert:

```rust
    if let Ok(mut cache) = state.dashboard_cache.lock() {
        *cache = None;
    }
```

In `close_active_profile`, immediately after `*conn_guard = None;` and before `Ok(())`, insert the same block.

- [ ] **Step 6: Verify it compiles**

```bash
cd "src-tauri" && cargo build 2>&1 | tail -50
```

Expected: no errors (this task only adds wiring; behavior is exercised by Task 1's tests already passing and Task 3's cache tests below).

- [ ] **Step 7: Commit**

```bash
git add src-tauri/src/state.rs src-tauri/src/commands/import_commands.rs src-tauri/src/commands/invoice_commands.rs src-tauri/src/commands/revision_commands.rs src-tauri/src/commands/profile_commands.rs
git commit -m "feat: wire rollup refresh and dashboard cache invalidation into write commands"
```

---

## Task 3: Point dashboard & monthly summary reads at the rollup tables; fix YoY growth calculation

**Files:**
- Modify: `src-tauri/src/models/domain_models.rs`
- Modify: `src-tauri/src/commands/export_commands.rs`
- Modify: `src-tauri/src/utils/dates.rs`

**Interfaces:**
- Consumes: `DbState.dashboard_cache` (Task 2), `summary_monthly_sales`/`summary_customer_sales`/`summary_supplier_sales` (Task 1's rollup).
- Produces: `DashboardMetrics` gains `active_invoices_count: u32` — `src/types/bindings/DashboardMetrics.ts` regenerates via `cargo test` (ts-rs exports on test run). Task 5's `DashboardKpis.tsx` consumes this new field.

- [ ] **Step 1: Add `active_invoices_count` to `DashboardMetrics`**

In `src-tauri/src/models/domain_models.rs`, in the `DashboardMetrics` struct, add a field right after `cancelled_invoices_count: u32,`:

```rust
    pub active_invoices_count: u32,
```

- [ ] **Step 2: Add a year-shift date helper**

In `src-tauri/src/utils/dates.rs`, change the top import line from `use chrono::{NaiveDate, ParseResult};` to:

```rust
use chrono::{Datelike, NaiveDate, ParseResult};
```

Then append this function and its tests to the file:

```rust
/// Shifts a "YYYY-MM-DD" date string by a number of years (negative to go
/// back). Falls back to the previous day if the exact day doesn't exist in
/// the target year's month (e.g. Feb 29 on a non-leap year becomes Feb 28),
/// instead of the fragile string-replace hack this replaces.
pub fn shift_years(date_str: &str, years: i32) -> Option<String> {
    let date = NaiveDate::parse_from_str(date_str, "%Y-%m-%d").ok()?;
    let target_year = date.year() + years;
    NaiveDate::from_ymd_opt(target_year, date.month(), date.day())
        .or_else(|| NaiveDate::from_ymd_opt(target_year, date.month(), date.day() - 1))
        .map(format_db_date)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn shift_years_moves_a_normal_date_back_one_year() {
        assert_eq!(shift_years("2026-07-20", -1), Some("2025-07-20".to_string()));
    }

    #[test]
    fn shift_years_falls_back_a_day_for_leap_day_in_a_non_leap_target_year() {
        // 2024 is a leap year, 2025 is not.
        assert_eq!(shift_years("2024-02-29", 1), Some("2025-02-28".to_string()));
    }

    #[test]
    fn shift_years_returns_none_for_unparseable_input() {
        assert_eq!(shift_years("not-a-date", -1), None);
    }
}
```

- [ ] **Step 3: Rewrite `get_monthly_sales_summary` to read `summary_monthly_sales`**

In `src-tauri/src/commands/export_commands.rs`, replace the entire body of `get_monthly_sales_summary` (from `#[tauri::command]` above it through its closing `}`) with:

```rust
/// Get monthly sales summary for the Report Center chart, read from the
/// materialized rollup table instead of scanning `invoices` live.
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
```

Note: `MonthlySalesRow.month_label` now comes from `summary_monthly_sales.month_no`, which Task 1 populates as a `"YYYY-MM"` string (not the `'01'..'12'` the SQL comment in the migration suggests) — this deliberately matches the existing `"YYYY-MM"` contract this command already produced via `strftime('%Y-%m', ...)`, so the frontend needs no changes. `invoice_count` is sourced from the `active_count` column (excludes cancelled/draft), matching the old live query's `COUNT(DISTINCT i.invoice_number)` which was computed after the same `status NOT IN ('Cancelled','Draft')` filter.

- [ ] **Step 4: Rewrite `get_dashboard_metrics` — cache check, rollup reads, fixed YoY calc**

Replace the entire body of `get_dashboard_metrics` (from `#[tauri::command]` above it through its closing `}`) with:

```rust
/// Load aggregated dashboard metrics, serving from the in-memory cache when
/// warm and falling back to the materialized rollup tables (or, for
/// day/month-granular figures the rollup can't serve, a live query) when cold.
#[tauri::command]
pub fn get_dashboard_metrics(
    state: State<'_, DbState>,
) -> Result<DashboardMetrics, AppError> {
    if let Ok(cache) = state.dashboard_cache.lock() {
        if let Some(cached) = cache.as_ref() {
            return Ok(cached.clone());
        }
    }

    let conn_guard = state.conn.lock().map_err(|e| {
        AppError::Internal(format!("Failed to acquire connection lock: {}", e))
    })?;
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

    // Active invoice count for the FY — from the monthly rollup
    let active_invoices_count: u32 = conn.query_row(
        "SELECT COALESCE(SUM(active_count), 0) FROM summary_monthly_sales WHERE financial_year_id = ?",
        [active_fy_id],
        |row| row.get::<_, i64>(0),
    ).unwrap_or(0) as u32;

    // GST payable summary — from the monthly rollup instead of a live scan
    let gst_summary = conn.query_row(
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
    ).unwrap_or_else(|_| GstSummaryBreakdown {
        total_taxable: 0.0,
        total_cgst: 0.0,
        total_sgst: 0.0,
        total_igst: 0.0,
        total_gross: 0.0,
    });

    // Top 10 customers — from the customer rollup
    let top_customers = {
        let mut stmt = conn.prepare(
            "SELECT c.customer_name, scs.total_value
             FROM summary_customer_sales scs
             JOIN customers c ON scs.customer_id = c.id
             WHERE scs.financial_year_id = ?
             ORDER BY scs.total_value DESC LIMIT 10"
        ).unwrap();
        let rows = stmt.query_map([active_fy_id], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, f64>(1)?))
        }).unwrap();
        rows.filter_map(|r| r.ok()).collect::<Vec<_>>()
    };

    // Top 10 suppliers — aggregated from the supplier/part rollup
    let top_suppliers = {
        let mut stmt = conn.prepare(
            "SELECT s.supplier_name, SUM(sss.total_value) AS supplier_total
             FROM summary_supplier_sales sss
             JOIN suppliers s ON sss.supplier_id = s.id
             WHERE sss.financial_year_id = ?
             GROUP BY s.id
             ORDER BY supplier_total DESC LIMIT 10"
        ).unwrap();
        let rows = stmt.query_map([active_fy_id], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, f64>(1)?))
        }).unwrap();
        rows.filter_map(|r| r.ok()).collect::<Vec<_>>()
    };

    // Top 20 parts — from the supplier/part rollup
    let top_parts = {
        let mut stmt = conn.prepare(
            "SELECT it.part_name, SUM(sss.total_value) AS part_total
             FROM summary_supplier_sales sss
             JOIN items it ON sss.part_code = it.part_code
             WHERE sss.financial_year_id = ?
             GROUP BY sss.part_code
             ORDER BY part_total DESC LIMIT 20"
        ).unwrap();
        let rows = stmt.query_map([active_fy_id], |row| {
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

    // Comparative growth (YTD this year vs. the same period one year earlier)
    let growth_percent = {
        let last_fy_start = crate::utils::dates::shift_years(&fy_start, -1).unwrap_or_else(|| fy_start.clone());
        let last_today = crate::utils::dates::shift_years(&today, -1).unwrap_or_else(|| today.clone());
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
```

- [ ] **Step 5: Run backend tests and regenerate TS bindings**

```bash
cd "src-tauri" && cargo test 2>&1 | tail -60
```

Expected: all existing tests plus Task 1's 4 new tests plus this task's 3 `shift_years` tests pass (running `cargo test` also re-runs ts-rs's export hooks, which regenerates `src/types/bindings/DashboardMetrics.ts` with the new `active_invoices_count` field — verify with `git diff src/types/bindings/DashboardMetrics.ts` that it now includes `active_invoices_count: number;`).

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src/models/domain_models.rs src-tauri/src/commands/export_commands.rs src-tauri/src/utils/dates.rs src/types/bindings/DashboardMetrics.ts
git commit -m "feat: serve dashboard/monthly reports from rollup tables with in-memory cache; fix YoY date math"
```

---

## Task 4: PDF exporter

**Files:**
- Modify: `src-tauri/Cargo.toml`
- Modify: `src-tauri/src/services/export_service.rs`
- Modify: `src-tauri/src/commands/export_commands.rs`
- Modify: `src-tauri/src/lib.rs`
- Modify: `src/services/api.ts`

**Interfaces:**
- Produces: `pub struct PdfExporter;` implementing `Exporter`, Tauri command `export_pdf(state, date_from, date_to, output_path) -> Result<ExportResult, AppError>`, `ApiService.exportPdf(dateFrom, dateTo, outputPath): Promise<ExportResult>`. Task 6's `ReportsPanel` consumes `ApiService.exportPdf`.
- Note: `PdfExporter` intentionally condenses to a subset of columns (unlike the full-fidelity Tally/Excel/CSV exporters) — plan §9 describes it as a "print-layout" report for human review, not a machine-import format, so a curated column set for on-page readability is the correct design, not a shortcut.

- [ ] **Step 1: Add the `printpdf` dependency**

```bash
cd "src-tauri" && cargo add printpdf
```

Expected: `Cargo.toml` gains a `printpdf = "..."` line under `[dependencies]` with whatever the current published version is (do not hand-edit a version number — let `cargo add` resolve it).

- [ ] **Step 2: Add `PdfExporter` to `export_service.rs`**

Append this to the end of `src-tauri/src/services/export_service.rs`, before the `// ======================== Unit Tests ========================` marker:

```rust
/// PDF Exporter — produces a print-layout PDF report of the export rows.
///
/// Unlike the Tally/Standard Excel/CSV exporters (full-fidelity data
/// interchange formats), this is a condensed human-readable report: it
/// keeps only the columns a reviewer reads on a printed page.
pub struct PdfExporter;

const PDF_ROWS_PER_PAGE: usize = 40;

impl PdfExporter {
    fn truncate(value: &str, max_chars: usize) -> String {
        if value.chars().count() <= max_chars {
            value.to_string()
        } else {
            let mut s: String = value.chars().take(max_chars.saturating_sub(1)).collect();
            s.push('…');
            s
        }
    }

    fn header_line() -> String {
        format!(
            "{:<12} {:<9} {:<11} {:<10} {:>8} {:>10} {:>9} {:>9} {:>9} {:>10} {:<4} {:>6}",
            "Inv No", "Cust Code", "Inv Date", "Part Code", "Qty", "BasPrice",
            "CGST", "SGST", "IGST", "InvVal", "IGST", "Rate%"
        )
    }

    fn format_row(row: &TallyExportRow) -> String {
        format!(
            "{:<12} {:<9} {:<11} {:<10} {:>8.2} {:>10.2} {:>9.2} {:>9.2} {:>9.2} {:>10.2} {:<4} {:>6.2}",
            Self::truncate(&row.inv_no, 12),
            Self::truncate(&row.cust_code, 9),
            row.inv_date,
            Self::truncate(&row.part_code, 10),
            row.qty,
            row.bas_price,
            row.cgst,
            row.sgst,
            row.igst,
            row.inv_val,
            row.igst_yes_no,
            row.percentage,
        )
    }

    fn build_page(rows: &[&TallyExportRow], page_num: usize, total_pages: usize) -> printpdf::PdfPage {
        use printpdf::*;

        let mut ops = vec![
            Op::StartTextSection,
            Op::SetTextCursor { pos: Point::new(Mm(10.0), Mm(195.0)) },
            Op::SetFillColor { col: Color::Rgb(Rgb { r: 0.1, g: 0.1, b: 0.1, icc_profile: None }) },
            Op::SetFont { font: PdfFontHandle::Builtin(BuiltinFont::HelveticaBold), size: Pt(12.0) },
            Op::SetLineHeight { lh: Pt(16.0) },
            Op::ShowText {
                items: vec![TextItem::Text(format!("Sales Export Report — Page {} of {}", page_num, total_pages))],
            },
            Op::AddLineBreak,
            Op::SetFont { font: PdfFontHandle::Builtin(BuiltinFont::CourierBold), size: Pt(8.0) },
            Op::SetLineHeight { lh: Pt(11.0) },
            Op::ShowText { items: vec![TextItem::Text(Self::header_line())] },
            Op::AddLineBreak,
            Op::SetFont { font: PdfFontHandle::Builtin(BuiltinFont::Courier), size: Pt(8.0) },
        ];

        for row in rows {
            ops.push(Op::ShowText { items: vec![TextItem::Text(Self::format_row(row))] });
            ops.push(Op::AddLineBreak);
        }

        ops.push(Op::EndTextSection);
        PdfPage::new(Mm(297.0), Mm(210.0), ops)
    }
}

impl Exporter for PdfExporter {
    fn format_name(&self) -> &str {
        "PDF"
    }

    fn export(&self, data: &[TallyExportRow], output_path: &str) -> Result<u32, AppError> {
        use printpdf::{PdfDocument, PdfSaveOptions};

        let row_count = data.len() as u32;
        let row_refs: Vec<&TallyExportRow> = data.iter().collect();
        let total_pages = row_refs.chunks(PDF_ROWS_PER_PAGE).len().max(1);

        let pages: Vec<_> = if row_refs.is_empty() {
            vec![Self::build_page(&[], 1, 1)]
        } else {
            row_refs
                .chunks(PDF_ROWS_PER_PAGE)
                .enumerate()
                .map(|(idx, chunk)| Self::build_page(chunk, idx + 1, total_pages))
                .collect()
        };

        let doc = PdfDocument::new("Sales Export Report");
        let pdf_bytes = doc
            .with_pages(pages)
            .save(&PdfSaveOptions::default(), &mut Vec::new());

        std::fs::write(output_path, pdf_bytes).map_err(|e| AppError::Export {
            code: "ERR_TALLY_002".to_string(),
            message: format!("Failed to write PDF export file: {}", e),
        })?;

        Ok(row_count)
    }
}
```

Then add these two tests inside the existing `#[cfg(test)] mod tests { ... }` block at the bottom of the file (alongside the existing 4 tests, reusing the existing `make_row` helper):

```rust
    #[test]
    fn test_pdf_exporter_writes_file_with_all_rows() {
        let rows = vec![
            make_row("PDF001", "P01", 18.0, 1000.0),
            make_row("PDF002", "P02", 0.0, 500.0),
        ];
        let dir = std::env::temp_dir();
        let path = dir.join(format!("test_pdf_export_{}.pdf", std::process::id()));
        let path_str = path.to_str().unwrap();

        let exporter = PdfExporter;
        let row_count = exporter.export(&rows, path_str).expect("PDF export should succeed");

        assert_eq!(row_count, 2);
        let metadata = std::fs::metadata(path_str).expect("PDF file should exist");
        assert!(metadata.len() > 0, "PDF file should not be empty");

        std::fs::remove_file(path_str).ok();
    }

    #[test]
    fn test_pdf_exporter_paginates_large_row_sets() {
        let rows: Vec<TallyExportRow> = (0..95)
            .map(|i| make_row(&format!("INV{:04}", i), "P01", 18.0, 100.0))
            .collect();
        let dir = std::env::temp_dir();
        let path = dir.join(format!("test_pdf_paginate_{}.pdf", std::process::id()));
        let path_str = path.to_str().unwrap();

        let exporter = PdfExporter;
        let row_count = exporter.export(&rows, path_str).expect("PDF export should succeed");

        assert_eq!(row_count, 95);
        std::fs::remove_file(path_str).ok();
    }
```

- [ ] **Step 3: Compile and fix any `printpdf` API mismatch**

```bash
cd "src-tauri" && cargo build 2>&1 | tail -80
```

The `Op`/`BuiltinFont`/`PdfPage`/`PdfDocument`/`PdfSaveOptions` API above was verified against the current `printpdf` docs (context7 `/fschutt/printpdf`) at plan-writing time, but if `cargo add` resolved a version with a different enum variant name (e.g. if `BuiltinFont::CourierBold` doesn't exist), the compiler error will name the exact missing variant — fix by checking `cargo doc --open -p printpdf` or the installed version's `BuiltinFont` enum definition and substituting the correct variant name only (do not change the overall structure).

- [ ] **Step 4: Run the new tests**

```bash
cd "src-tauri" && cargo test export_service::tests 2>&1 | tail -40
```

Expected: 6 tests pass total (the original 4 splitting tests + `test_pdf_exporter_writes_file_with_all_rows` + `test_pdf_exporter_paginates_large_row_sets`).

- [ ] **Step 5: Add the `export_pdf` command**

In `src-tauri/src/commands/export_commands.rs`, change the import line:

```rust
use crate::services::export_service::{Exporter, TallyExcelExporter, StandardExcelExporter, CsvExporter};
```

to:

```rust
use crate::services::export_service::{Exporter, TallyExcelExporter, StandardExcelExporter, CsvExporter, PdfExporter};
```

Then add this command right after `export_csv`'s closing `}` (before the `// ======================== Report Query Commands ========================` marker):

```rust
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
```

- [ ] **Step 6: Register the command**

In `src-tauri/src/lib.rs`, in the `tauri::generate_handler![...]` list, add `commands::export_commands::export_pdf,` right after `commands::export_commands::export_csv,`.

- [ ] **Step 7: Add the frontend API wrapper**

In `src/services/api.ts`, add this method right after `exportCsv`:

```typescript
  /**
   * Export invoices to a print-layout PDF report.
   */
  static async exportPdf(
    dateFrom: string,
    dateTo: string,
    outputPath: string
  ): Promise<ExportResult> {
    return await invoke<ExportResult>("export_pdf", {
      dateFrom,
      dateTo,
      outputPath,
    });
  }
```

- [ ] **Step 8: Verify full backend build + test suite**

```bash
cd "src-tauri" && cargo build 2>&1 | tail -30 && cargo test 2>&1 | tail -60
```

Expected: clean build, all tests pass (should now be 4 + 4 [Task 1] + 3 [Task 3] + 2 [this task] = 13 backend tests total, plus whatever pre-existed elsewhere).

- [ ] **Step 9: Commit**

```bash
git add src-tauri/Cargo.toml src-tauri/Cargo.lock src-tauri/src/services/export_service.rs src-tauri/src/commands/export_commands.rs src-tauri/src/lib.rs src/services/api.ts
git commit -m "feat: add PDF exporter (print-layout report)"
```

---

## Task 5: `DashboardKpis` component — bind fetched metrics to the Dashboard tab

**Files:**
- Create: `src/components/DashboardKpis.tsx`
- Modify: `src/App.tsx`

**Interfaces:**
- Consumes: `DashboardMetrics` (from `src/types/bindings/DashboardMetrics.ts`, now including `active_invoices_count` from Task 3).
- Produces: `export default function DashboardKpis({ metrics }: { metrics: DashboardMetrics | null }): JSX.Element` — mounted in `App.tsx`'s `dashboard` tab panel.

- [ ] **Step 1: Write `src/components/DashboardKpis.tsx`**

```tsx
import { TrendingUp, TrendingDown, FileWarning, Tag, Receipt, PieChart, Clock } from "lucide-react";
import { DashboardMetrics } from "../types/bindings/DashboardMetrics";

interface DashboardKpisProps {
  metrics: DashboardMetrics | null;
}

function formatCurrency(value: number): string {
  return `₹${value.toLocaleString("en-IN", { minimumFractionDigits: 2 })}`;
}

export default function DashboardKpis({ metrics }: DashboardKpisProps) {
  const growth = metrics?.comparative_growth_percent ?? 0;
  const isPositiveGrowth = growth >= 0;

  return (
    <div className="space-y-6">
      {/* KPI Summary Grid */}
      <div className="grid grid-cols-4 gap-6">
        <div className="bg-slate-900 border border-slate-800/80 rounded-xl p-6 relative overflow-hidden">
          <div className="absolute top-0 right-0 w-32 h-32 bg-indigo-500/5 rounded-full translate-x-12 -translate-y-12 blur-xl" />
          <p className="text-xs font-semibold text-slate-400">Total Sales (YTD)</p>
          <h3 className="text-2xl font-bold text-slate-100 mt-2">{formatCurrency(metrics?.ytd_sales ?? 0)}</h3>
          <div className="flex items-center gap-1.5 text-slate-400 text-xs mt-3">
            {isPositiveGrowth ? (
              <TrendingUp className="w-3.5 h-3.5 text-emerald-400" />
            ) : (
              <TrendingDown className="w-3.5 h-3.5 text-rose-400" />
            )}
            <span className={`font-semibold ${isPositiveGrowth ? "text-emerald-400" : "text-rose-400"}`}>
              {growth.toFixed(1)}% Growth
            </span>{" "}
            vs last year
          </div>
        </div>

        <div className="bg-slate-900 border border-slate-800/80 rounded-xl p-6 relative overflow-hidden">
          <div className="absolute top-0 right-0 w-32 h-32 bg-emerald-500/5 rounded-full translate-x-12 -translate-y-12 blur-xl" />
          <p className="text-xs font-semibold text-slate-400">Sales Invoices (Active, FY)</p>
          <h3 className="text-2xl font-bold text-slate-100 mt-2">{metrics?.active_invoices_count ?? 0}</h3>
          <div className="flex items-center gap-1.5 text-slate-400 text-xs mt-3">
            <FileWarning className="w-3.5 h-3.5 text-amber-400" />
            <span className="text-amber-400 font-semibold">{metrics?.import_errors_count ?? 0}</span> import errors pending
          </div>
        </div>

        <div className="bg-slate-900 border border-slate-800/80 rounded-xl p-6 relative overflow-hidden">
          <div className="absolute top-0 right-0 w-32 h-32 bg-amber-500/5 rounded-full translate-x-12 -translate-y-12 blur-xl" />
          <p className="text-xs font-semibold text-slate-400">Debit Notes Pending</p>
          <h3 className="text-2xl font-bold text-slate-100 mt-2">{metrics?.pending_debit_notes_count ?? 0}</h3>
          <div className="flex items-center gap-1.5 text-slate-400 text-xs mt-3">
            <Tag className="w-3.5 h-3.5 text-amber-400" />
            <span className="text-amber-400 font-semibold">awaiting approval</span>
          </div>
        </div>

        <div className="bg-slate-900 border border-slate-800/80 rounded-xl p-6 relative overflow-hidden">
          <div className="absolute top-0 right-0 w-32 h-32 bg-rose-500/5 rounded-full translate-x-12 -translate-y-12 blur-xl" />
          <p className="text-xs font-semibold text-slate-400">Credit Notes Pending</p>
          <h3 className="text-2xl font-bold text-slate-100 mt-2">{metrics?.pending_credit_notes_count ?? 0}</h3>
          <div className="flex items-center gap-1.5 text-slate-400 text-xs mt-3">
            <Receipt className="w-3.5 h-3.5 text-rose-400" />
            <span className="text-rose-400 font-semibold">{metrics?.cancelled_invoices_count ?? 0}</span> cancelled invoices (FY)
          </div>
        </div>
      </div>

      {/* GST Summary + Recent Activity */}
      <div className="grid grid-cols-3 gap-6">
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 col-span-1">
          <h4 className="text-xs font-bold text-slate-300 uppercase tracking-wider border-b border-slate-800 pb-3 mb-4 flex items-center gap-2">
            <PieChart className="w-4 h-4 text-indigo-400" /> GST Payable Summary (FY)
          </h4>
          <div className="space-y-3 text-xs">
            <div className="flex justify-between">
              <span className="text-slate-400">Taxable Value</span>
              <span className="font-mono text-slate-200">{formatCurrency(metrics?.gst_payable_summary.total_taxable ?? 0)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-400">CGST</span>
              <span className="font-mono text-slate-200">{formatCurrency(metrics?.gst_payable_summary.total_cgst ?? 0)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-400">SGST</span>
              <span className="font-mono text-slate-200">{formatCurrency(metrics?.gst_payable_summary.total_sgst ?? 0)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-400">IGST</span>
              <span className="font-mono text-slate-200">{formatCurrency(metrics?.gst_payable_summary.total_igst ?? 0)}</span>
            </div>
            <div className="flex justify-between border-t border-slate-800 pt-3 font-bold">
              <span className="text-slate-300">Total Value</span>
              <span className="font-mono text-indigo-400">{formatCurrency(metrics?.gst_payable_summary.total_gross ?? 0)}</span>
            </div>
          </div>
        </div>

        <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 col-span-2">
          <h4 className="text-xs font-bold text-slate-300 uppercase tracking-wider border-b border-slate-800 pb-3 mb-4 flex items-center gap-2">
            <Clock className="w-4 h-4 text-indigo-400" /> Recent Activity
          </h4>
          {!metrics || metrics.recent_activity.length === 0 ? (
            <p className="text-xs text-slate-500 text-center py-8">No recent activity recorded.</p>
          ) : (
            <div className="space-y-2 max-h-64 overflow-y-auto">
              {metrics.recent_activity.map((entry, idx) => (
                <div key={idx} className="text-[11px] text-slate-400 border-b border-slate-800/40 pb-2">
                  {entry}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Top rankings */}
      <div className="grid grid-cols-3 gap-6">
        {[
          { title: "Top Customers (FY)", data: metrics?.top_10_customers ?? [] },
          { title: "Top Suppliers (FY)", data: metrics?.top_10_suppliers ?? [] },
          { title: "Top Parts (FY)", data: metrics?.top_20_parts.slice(0, 10) ?? [] },
        ].map((panel) => (
          <div key={panel.title} className="bg-slate-900 border border-slate-800 rounded-xl p-6">
            <h4 className="text-xs font-bold text-slate-300 uppercase tracking-wider border-b border-slate-800 pb-3 mb-4">
              {panel.title}
            </h4>
            {panel.data.length === 0 ? (
              <p className="text-xs text-slate-500 text-center py-6">No data for the active financial year.</p>
            ) : (
              <div className="space-y-2 text-xs">
                {panel.data.map(([name, value], idx) => (
                  <div key={idx} className="flex justify-between">
                    <span className="text-slate-400 truncate max-w-[65%]">{name}</span>
                    <span className="font-mono text-slate-200">{formatCurrency(value)}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Wire it into `App.tsx`**

In `src/App.tsx`, add the import right after the other bindings imports (near `import { DashboardMetrics } from "./types/bindings/DashboardMetrics";`):

```typescript
import DashboardKpis from "./components/DashboardKpis";
```

Then find the hardcoded KPI grid inside the `activeTab === "dashboard"` block — it starts at `{/* KPI Summary Grid */}` and its enclosing `<div className="grid grid-cols-4 gap-6">...</div>` (currently four cards with hardcoded `₹0.00` / `0` values). Replace that entire `<div className="grid grid-cols-4 gap-6">...</div>` block with:

```tsx
              <DashboardKpis metrics={dashboardMetrics} />
```

Also remove the now-unused `PieChart` import from the top-level lucide-react import list in `App.tsx` (it moved into `DashboardKpis.tsx`) — delete the `PieChart` entry from the `import { ... } from "lucide-react";` block at the top of `App.tsx`.

- [ ] **Step 3: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

Expected: no type errors.

- [ ] **Step 4: Manually verify in the running app**

Start the dev server and confirm the Dashboard tab renders real numbers (not `₹0.00`/`0`) once connected to the `DEMO` profile, including the GST summary panel, recent activity feed, and top-10 lists. If the `DEMO` database has no invoices yet, at minimum confirm no console errors and that empty states ("No data for the active financial year.") render correctly.

- [ ] **Step 5: Commit**

```bash
git add src/components/DashboardKpis.tsx src/App.tsx
git commit -m "feat: bind Dashboard KPI cards, GST summary, and top rankings to fetched metrics"
```

---

## Task 6: `ReportsPanel` component — render the Reports & Export tab

**Files:**
- Create: `src/components/ReportsPanel.tsx`
- Modify: `src/App.tsx`

**Interfaces:**
- Consumes: `ApiService.exportPdf` (Task 4), all the already-existing `reportSubTab`/`reportDateFrom`/`reportDateTo`/`exportFormat`/`isExporting`/`exportResult`/`monthlySales`/`gstRateSummary`/`topCustomers`/`topItems`/`loadingReports` state and `handleExport`/`loadReportData` handlers already defined in `App.tsx`.
- Produces: `export default function ReportsPanel(props: ReportsPanelProps): JSX.Element` — mounted in `App.tsx` for `activeTab === "reports"`.

- [ ] **Step 1: Write `src/components/ReportsPanel.tsx`**

```tsx
import { Download, RefreshCw, CheckCircle } from "lucide-react";
import { MonthlySalesRow } from "../types/bindings/MonthlySalesRow";
import { GstRateSummaryRow } from "../types/bindings/GstRateSummaryRow";
import { RankingRow } from "../types/bindings/RankingRow";
import { ExportResult } from "../types/bindings/ExportResult";

type ReportSubTab = "export" | "monthly" | "gst" | "customers" | "items";
type ExportFormat = "tally" | "excel" | "csv" | "pdf";

interface ReportsPanelProps {
  reportSubTab: ReportSubTab;
  onSubTabChange: (tab: ReportSubTab) => void;
  reportDateFrom: string;
  reportDateTo: string;
  onDateFromChange: (value: string) => void;
  onDateToChange: (value: string) => void;
  exportFormat: ExportFormat;
  onExportFormatChange: (value: ExportFormat) => void;
  isExporting: boolean;
  exportResult: ExportResult | null;
  onExport: () => void;
  monthlySales: MonthlySalesRow[];
  gstRateSummary: GstRateSummaryRow[];
  topCustomers: RankingRow[];
  topItems: RankingRow[];
  loadingReports: boolean;
  onLoadReportData: () => void;
}

const SUB_TABS: { key: ReportSubTab; label: string }[] = [
  { key: "export", label: "Export" },
  { key: "monthly", label: "Monthly Sales" },
  { key: "gst", label: "GST Breakdown" },
  { key: "customers", label: "Top Customers" },
  { key: "items", label: "Top Items" },
];

const EXPORT_FORMATS: { key: ExportFormat; label: string }[] = [
  { key: "tally", label: "Tally Excel (multi-rate split)" },
  { key: "excel", label: "Standard Excel" },
  { key: "csv", label: "CSV" },
  { key: "pdf", label: "PDF Report" },
];

function formatCurrency(value: number): string {
  return `₹${value.toLocaleString("en-IN", { minimumFractionDigits: 2 })}`;
}

export default function ReportsPanel({
  reportSubTab,
  onSubTabChange,
  reportDateFrom,
  reportDateTo,
  onDateFromChange,
  onDateToChange,
  exportFormat,
  onExportFormatChange,
  isExporting,
  exportResult,
  onExport,
  monthlySales,
  gstRateSummary,
  topCustomers,
  topItems,
  loadingReports,
  onLoadReportData,
}: ReportsPanelProps) {
  const dateRangeSet = Boolean(reportDateFrom && reportDateTo);

  return (
    <div className="space-y-6">
      {/* Subtab Toggle */}
      <div className="flex gap-2 border-b border-slate-800 pb-3">
        {SUB_TABS.map((tab) => (
          <button
            key={tab.key}
            onClick={() => onSubTabChange(tab.key)}
            className={`px-4 py-2 text-xs font-semibold rounded-lg transition-all ${
              reportSubTab === tab.key ? "bg-indigo-600 text-white shadow-md" : "text-slate-400 hover:text-slate-200"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Shared date range picker (used by export + gst/customers/items subtabs) */}
      {reportSubTab !== "monthly" && (
        <div className="flex items-end gap-4 bg-slate-900 border border-slate-800 p-4 rounded-xl">
          <div>
            <label className="block text-xs font-semibold text-slate-400 mb-2">From Date</label>
            <input
              type="date"
              value={reportDateFrom}
              onChange={(e) => onDateFromChange(e.target.value)}
              className="bg-slate-950 border border-slate-800 rounded-lg p-2.5 text-xs text-slate-200 focus:outline-none focus:border-indigo-500"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-400 mb-2">To Date</label>
            <input
              type="date"
              value={reportDateTo}
              onChange={(e) => onDateToChange(e.target.value)}
              className="bg-slate-950 border border-slate-800 rounded-lg p-2.5 text-xs text-slate-200 focus:outline-none focus:border-indigo-500"
            />
          </div>

          {reportSubTab === "export" ? (
            <div className="flex-1">
              <label className="block text-xs font-semibold text-slate-400 mb-2">Export Format</label>
              <select
                value={exportFormat}
                onChange={(e) => onExportFormatChange(e.target.value as ExportFormat)}
                className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2.5 text-xs text-slate-200 focus:outline-none focus:border-indigo-500"
              >
                {EXPORT_FORMATS.map((f) => (
                  <option key={f.key} value={f.key}>
                    {f.label}
                  </option>
                ))}
              </select>
            </div>
          ) : (
            <button
              onClick={onLoadReportData}
              disabled={!dateRangeSet || loadingReports}
              className="bg-indigo-600 hover:bg-indigo-500 text-white font-semibold text-xs px-4 py-2.5 rounded-lg transition-colors flex items-center gap-1.5 disabled:opacity-50"
            >
              {loadingReports ? <RefreshCw className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
              Load Report
            </button>
          )}

          {reportSubTab === "export" && (
            <button
              onClick={onExport}
              disabled={!dateRangeSet || isExporting}
              className="bg-indigo-600 hover:bg-indigo-500 text-white font-semibold text-xs px-5 py-2.5 rounded-lg transition-colors flex items-center gap-1.5 disabled:opacity-50"
            >
              {isExporting ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
              Export
            </button>
          )}
        </div>
      )}

      {reportSubTab === "export" && exportResult && (
        <div className="bg-emerald-950/20 border border-emerald-900/60 rounded-xl p-4 flex gap-4 text-emerald-200">
          <CheckCircle className="w-5 h-5 flex-shrink-0 mt-0.5" />
          <div>
            <h4 className="font-bold text-sm">{exportResult.format} Export Completed</h4>
            <p className="text-xs text-emerald-400/90 mt-1">{exportResult.message}</p>
            <p className="text-[10px] text-emerald-400/70 mt-1 font-mono">{exportResult.output_path}</p>
          </div>
        </div>
      )}

      {reportSubTab === "monthly" && (
        <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden text-xs">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-slate-950 text-slate-400 font-bold border-b border-slate-800">
                <th className="p-4">Month</th>
                <th className="p-4 text-right">Taxable</th>
                <th className="p-4 text-right">CGST</th>
                <th className="p-4 text-right">SGST</th>
                <th className="p-4 text-right">IGST</th>
                <th className="p-4 text-right">Total Value</th>
                <th className="p-4 text-right">Invoices</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60">
              {loadingReports ? (
                <tr>
                  <td colSpan={7} className="p-8 text-center text-slate-500">Loading monthly sales...</td>
                </tr>
              ) : monthlySales.length === 0 ? (
                <tr>
                  <td colSpan={7} className="p-8 text-center text-slate-500">No monthly sales data yet.</td>
                </tr>
              ) : (
                monthlySales.map((row) => (
                  <tr key={row.month_label} className="hover:bg-slate-800/20">
                    <td className="p-4 font-mono font-bold text-indigo-400">{row.month_label}</td>
                    <td className="p-4 text-right font-mono text-slate-300">{formatCurrency(row.total_taxable)}</td>
                    <td className="p-4 text-right font-mono text-slate-400">{formatCurrency(row.total_cgst)}</td>
                    <td className="p-4 text-right font-mono text-slate-400">{formatCurrency(row.total_sgst)}</td>
                    <td className="p-4 text-right font-mono text-slate-400">{formatCurrency(row.total_igst)}</td>
                    <td className="p-4 text-right font-mono font-bold text-slate-100">{formatCurrency(row.total_value)}</td>
                    <td className="p-4 text-right font-mono text-slate-300">{row.invoice_count}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}

      {reportSubTab === "gst" && (
        <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden text-xs">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-slate-950 text-slate-400 font-bold border-b border-slate-800">
                <th className="p-4">GST Rate</th>
                <th className="p-4 text-right">Taxable Amount</th>
                <th className="p-4 text-right">CGST</th>
                <th className="p-4 text-right">SGST</th>
                <th className="p-4 text-right">IGST</th>
                <th className="p-4 text-right">Total Tax</th>
                <th className="p-4 text-right">Invoices</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60">
              {gstRateSummary.length === 0 ? (
                <tr>
                  <td colSpan={7} className="p-8 text-center text-slate-500">
                    {dateRangeSet ? "No GST data for this range." : "Pick a date range and click Load Report."}
                  </td>
                </tr>
              ) : (
                gstRateSummary.map((row) => (
                  <tr key={row.gst_rate} className="hover:bg-slate-800/20">
                    <td className="p-4 font-mono font-bold text-indigo-400">{row.gst_rate.toFixed(1)}%</td>
                    <td className="p-4 text-right font-mono text-slate-300">{formatCurrency(row.taxable_amount)}</td>
                    <td className="p-4 text-right font-mono text-slate-400">{formatCurrency(row.cgst_amount)}</td>
                    <td className="p-4 text-right font-mono text-slate-400">{formatCurrency(row.sgst_amount)}</td>
                    <td className="p-4 text-right font-mono text-slate-400">{formatCurrency(row.igst_amount)}</td>
                    <td className="p-4 text-right font-mono font-bold text-slate-100">{formatCurrency(row.total_tax)}</td>
                    <td className="p-4 text-right font-mono text-slate-300">{row.invoice_count}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}

      {(reportSubTab === "customers" || reportSubTab === "items") && (
        <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden text-xs">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-slate-950 text-slate-400 font-bold border-b border-slate-800">
                <th className="p-4">Rank</th>
                <th className="p-4">{reportSubTab === "customers" ? "Customer" : "Part"}</th>
                <th className="p-4 text-right">Total Value</th>
                <th className="p-4 text-right">Total Qty</th>
                <th className="p-4 text-right">Invoices</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60">
              {(reportSubTab === "customers" ? topCustomers : topItems).length === 0 ? (
                <tr>
                  <td colSpan={5} className="p-8 text-center text-slate-500">
                    {dateRangeSet ? "No data for this range." : "Pick a date range and click Load Report."}
                  </td>
                </tr>
              ) : (
                (reportSubTab === "customers" ? topCustomers : topItems).map((row) => (
                  <tr key={row.rank} className="hover:bg-slate-800/20">
                    <td className="p-4 font-mono text-slate-500">#{row.rank}</td>
                    <td className="p-4">
                      <div className="font-semibold text-slate-200">{row.name}</div>
                      <div className="text-[10px] text-slate-500 mt-0.5 font-mono">{row.code}</div>
                    </td>
                    <td className="p-4 text-right font-mono font-bold text-slate-100">{formatCurrency(row.total_value)}</td>
                    <td className="p-4 text-right font-mono text-slate-400">{row.total_qty.toLocaleString("en-IN")}</td>
                    <td className="p-4 text-right font-mono text-slate-400">{row.invoice_count}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Wire it into `App.tsx`**

Add the import right after the `DashboardKpis` import added in Task 5:

```typescript
import ReportsPanel from "./components/ReportsPanel";
```

Extend the `exportFormat` state type to include `"pdf"` — find:

```typescript
  const [exportFormat, setExportFormat] = useState<"tally" | "excel" | "csv">("tally");
```

and change it to:

```typescript
  const [exportFormat, setExportFormat] = useState<"tally" | "excel" | "csv" | "pdf">("tally");
```

In `handleExport`, find:

```typescript
    const ext = exportFormat === "csv" ? "csv" : "xlsx";
    const filterName = exportFormat === "csv" ? "CSV Files" : "Excel Files";
```

and replace with:

```typescript
    const ext = exportFormat === "csv" ? "csv" : exportFormat === "pdf" ? "pdf" : "xlsx";
    const filterName = exportFormat === "csv" ? "CSV Files" : exportFormat === "pdf" ? "PDF Files" : "Excel Files";
```

Then find:

```typescript
      let result: ExportResult;
      if (exportFormat === "tally") {
        result = await ApiService.exportTallyExcel(reportDateFrom, reportDateTo, savePath);
      } else if (exportFormat === "excel") {
        result = await ApiService.exportStandardExcel(reportDateFrom, reportDateTo, savePath);
      } else {
        result = await ApiService.exportCsv(reportDateFrom, reportDateTo, savePath);
      }
```

and replace with:

```typescript
      let result: ExportResult;
      if (exportFormat === "tally") {
        result = await ApiService.exportTallyExcel(reportDateFrom, reportDateTo, savePath);
      } else if (exportFormat === "excel") {
        result = await ApiService.exportStandardExcel(reportDateFrom, reportDateTo, savePath);
      } else if (exportFormat === "pdf") {
        result = await ApiService.exportPdf(reportDateFrom, reportDateTo, savePath);
      } else {
        result = await ApiService.exportCsv(reportDateFrom, reportDateTo, savePath);
      }
```

Now find the "Reload lists on navigation" `useEffect` (it currently ends with `}, [activeTab, isConnected]);` and has an `else if (activeTab === "reports") { loadMonthlySales(); }` branch). Replace the whole effect body with:

```typescript
  useEffect(() => {
    if (isConnected) {
      if (activeTab === "registers") {
        loadInvoices();
      } else if (activeTab === "revisions") {
        loadRevisions();
        loadSuppliers();
      } else if (activeTab === "notes") {
        loadNotes();
      } else if (activeTab === "reports") {
        if (reportSubTab === "monthly") {
          loadMonthlySales();
        } else if (reportSubTab !== "export" && reportDateFrom && reportDateTo) {
          loadReportData();
        }
      } else if (activeTab === "dashboard") {
        loadDashboardMetrics();
      }
    }
  }, [activeTab, isConnected, reportSubTab, reportDateFrom, reportDateTo]);
```

Finally, insert the panel itself. Find the closing of the `import` tab block — the sequence:

```tsx
                </div>
              )}
            </div>
          )}

          {activeTab === "settings" && (
```

(the `)}` that closes `{activeTab === "import" && (...)}`, immediately followed by `{activeTab === "settings" && (`). Insert this block between them:

```tsx
          {activeTab === "reports" && (
            <ReportsPanel
              reportSubTab={reportSubTab}
              onSubTabChange={setReportSubTab}
              reportDateFrom={reportDateFrom}
              reportDateTo={reportDateTo}
              onDateFromChange={setReportDateFrom}
              onDateToChange={setReportDateTo}
              exportFormat={exportFormat}
              onExportFormatChange={setExportFormat}
              isExporting={isExporting}
              exportResult={exportResult}
              onExport={handleExport}
              monthlySales={monthlySales}
              gstRateSummary={gstRateSummary}
              topCustomers={topCustomers}
              topItems={topItems}
              loadingReports={loadingReports}
              onLoadReportData={loadReportData}
            />
          )}

```

- [ ] **Step 3: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

Expected: no type errors.

- [ ] **Step 4: Manually verify in the running app**

Start the dev server (`npm run tauri dev`, or use the `preview_start`/Browser tools against the Vite dev server if a full Tauri build isn't available in this environment), connect to the `DEMO` profile, click "Reports & Export", and confirm:
- The 5 subtabs switch correctly.
- "Monthly Sales" loads and shows a table (may be empty if `DEMO` has no invoices — confirm the empty state renders, not a blank screen).
- Picking a date range on "GST Breakdown" / "Top Customers" / "Top Items" and clicking "Load Report" populates their tables (or shows the empty state).
- On the "Export" subtab, picking a date range, choosing each of the 4 formats (Tally/Excel/CSV/PDF), and clicking Export triggers the native save dialog and, after picking a path, shows a success banner with the row count. Verify the exported file actually exists at the chosen path for at least the PDF format (open it to confirm it's a valid, readable PDF).

- [ ] **Step 5: Commit**

```bash
git add src/components/ReportsPanel.tsx src/App.tsx
git commit -m "feat: render the Reports & Export panel (was wired but never rendered)"
```

---

## Task 7: Final full-stack verification

**Files:** none (verification only)

- [ ] **Step 1: Full backend check**

```bash
cd "src-tauri" && cargo fmt --check && cargo clippy -- -D warnings && cargo test 2>&1 | tail -80
```

Fix any formatting/lint/test failures before proceeding — do not skip or suppress warnings.

- [ ] **Step 2: Full frontend check**

```bash
npx tsc --noEmit && npm run build
```

Expected: clean TypeScript build and a successful Vite production build.

- [ ] **Step 3: End-to-end manual pass**

With the app running (`npm run tauri dev` or equivalent), walk through: connect to `DEMO` → import a sample sales Excel file if one is available → confirm Dashboard KPIs update to non-zero values → confirm Reports & Export's Monthly Sales table shows the new month → run a Tally export and confirm the output file opens correctly with multi-rate rows split as `INVNO`/`INVNOA` where applicable → run a PDF export and confirm the file is a valid multi-page PDF for a large date range.

- [ ] **Step 4: Commit (if anything changed during verification)**

```bash
git add -A
git commit -m "chore: fix lint/format/build issues found during Phase 5 verification"
```
