# Customer Master Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Expand the "Customer Matching" feature into a full editable **Customer Master** (16 fields: GSTIN, legal name, full address, place of supply, contact, category, remarks) with bulk file import and manual editing.

**Architecture:** SQLite/SQLCipher schema grows via two versioned table-rebuild migrations (v4 customers, v5 import_batches). Rust Tauri commands expose full-record CRUD + a dedicated fixed-column importer with an auditable `import_batches` pipeline. The frontend tab is extracted into its own `CustomerMaster` component set. Type safety flows through `ts-rs`-generated bindings.

**Tech Stack:** Rust + `rusqlite` (SQLCipher), Tauri 2 commands, `calamine` (xlsx), `ts-rs`, React 19 + TypeScript + Tailwind.

**Spec:** `docs/superpowers/specs/2026-07-21-customer-master-design.md`

## Global Constraints

- Rust: run `cargo fmt` before every commit; no `unwrap()` in production code (tests OK); parameterized SQL only.
- Migrations are **additive and versioned** in `src-tauri/src/database/migrate.rs`; never edit `0001_init.sql` or an already-applied migration.
- `state_code` and `place_of_supply` are **free-text 2-digit GST codes** (e.g. `"33"`), no foreign key.
- Non-destructive import updates: a blank cell must **keep the existing DB value** (`COALESCE(?, col)`).
- Backend commands run under `state.conn.lock()`; reads use `.as_ref()`, writes/transactions use `.as_mut()`.
- ts-rs structs export to `../../src/types/bindings/<Name>.ts`; bindings regenerate when `cargo test` runs.
- Frontend has **no JS test harness** — verify frontend tasks with `npm run build` (runs `tsc && vite build`).
- Backend test command: `cd src-tauri && cargo test`. Run from the `src-tauri` directory.
- Commit after every task with a `feat:` / `refactor:` / `test:` message.

---

## File Structure

**Backend (`src-tauri/src/`):**
- `database/migrate.rs` — MODIFY: add rebuild-migration support + migrations v4, v5
- `models/database_models.rs` — MODIFY: `CustomerRow.customer_name → report_name`
- `models/domain_models.rs` — MODIFY: add `CustomerMasterRow`, `CustomerImportPreview`, `CustomerImportResult`, `CustomerImportIssue`
- `repositories/master_repo.rs`, `repositories/invoice_repo.rs`, `repositories/report_repo.rs` — MODIFY: column rename fan-out
- `commands/customer_commands.rs` — MODIFY: full-record CRUD, remove dead commands, `CustomerMasterRow` reads
- `commands/import_commands.rs`, `commands/invoice_commands.rs`, `commands/export_commands.rs` — MODIFY: column rename fan-out
- `commands/customer_import_commands.rs` — CREATE: preview/commit import Tauri commands
- `services/customer_import_service.rs` — CREATE: parse + validate + upsert engine
- `services/mod.rs`, `lib.rs` — MODIFY: module registration + command registration

**Frontend (`src/`):**
- `services/api.ts` — MODIFY: command bindings
- `components/CustomerMaster/CustomerMasterTab.tsx` — CREATE: container (list + wiring)
- `components/CustomerMaster/CustomerDetailForm.tsx` — CREATE: 16-field drawer form
- `components/CustomerMaster/CustomerImportPanel.tsx` — CREATE: preview → commit panel
- `App.tsx` — MODIFY: mount `CustomerMasterTab`, drop the old inline Customer Matching JSX + dead handlers

---

## Task 1: Migration engine rebuild support + v4 customers rebuild

**Files:**
- Modify: `src-tauri/src/database/migrate.rs`
- Test: `src-tauri/src/database/migrate.rs` (`#[cfg(test)]` module)

**Interfaces:**
- Produces: `customers` table with columns `id, customer_code, report_name, tally_customer_name, legal_name, gstin, address1, address2, location, pincode, state_code, place_of_supply, phone, email, category_name, remarks, status`. No FK on `state_code`.
- Produces: `Migration { version, description, sql, rebuild }` struct shape (new `rebuild: bool` field).

- [ ] **Step 1: Write the failing test**

Add to the bottom of `src-tauri/src/database/migrate.rs`:

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use rusqlite::Connection;

    fn columns(conn: &Connection, table: &str) -> Vec<String> {
        let mut stmt = conn
            .prepare(&format!("PRAGMA table_info({})", table))
            .unwrap();
        let cols = stmt
            .query_map([], |row| row.get::<_, String>(1))
            .unwrap()
            .map(|r| r.unwrap())
            .collect();
        cols
    }

    #[test]
    fn v4_customers_has_master_columns_and_free_text_state() {
        let mut conn = Connection::open_in_memory().unwrap();
        run_migrations(&mut conn).unwrap();

        let cols = columns(&conn, "customers");
        for expected in [
            "report_name", "legal_name", "address1", "address2", "location",
            "pincode", "place_of_supply", "phone", "email", "remarks",
        ] {
            assert!(cols.contains(&expected.to_string()), "missing column {expected}");
        }
        assert!(!cols.contains(&"customer_name".to_string()), "customer_name must be renamed");

        // Free-text GST state code accepted (no FK to states).
        conn.execute(
            "INSERT INTO customers (customer_code, report_name, state_code, place_of_supply, status)
             VALUES ('C1', 'Report Co', '33', '33', 'Approved')",
            [],
        )
        .unwrap();
        let state: String = conn
            .query_row("SELECT state_code FROM customers WHERE customer_code='C1'", [], |r| r.get(0))
            .unwrap();
        assert_eq!(state, "33");
    }

    #[test]
    fn v4_preserves_invoice_customer_fk_roundtrip() {
        let mut conn = Connection::open_in_memory().unwrap();
        run_migrations(&mut conn).unwrap();

        conn.execute(
            "INSERT INTO customers (id, customer_code, report_name, status) VALUES (7, 'C7', 'Seven', 'Approved')",
            [],
        )
        .unwrap();
        // financial_years id=1 is seeded by 0001. Invoice FK to customers(7) must resolve.
        conn.execute(
            "INSERT INTO invoices (invoice_number, invoice_date, customer_id, financial_year_id, total_taxable, total_value, status)
             VALUES ('INV7', '2025-05-01', 7, 1, 100.0, 118.0, 'Imported')",
            [],
        )
        .unwrap();
        let cnt: i64 = conn
            .query_row("SELECT COUNT(*) FROM invoices WHERE customer_id = 7", [], |r| r.get(0))
            .unwrap();
        assert_eq!(cnt, 1);
    }
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd src-tauri && cargo test v4_customers_has_master_columns_and_free_text_state -- --nocapture`
Expected: FAIL — `customers` still has `customer_name`, missing the new columns.

- [ ] **Step 3: Add the `rebuild` field and rebuild path to the engine**

In `src-tauri/src/database/migrate.rs`, replace the `Migration` struct and the apply loop. New struct:

```rust
pub struct Migration {
    pub version: i32,
    pub description: &'static str,
    pub sql: &'static str,
    /// When true, the migration is a full table rebuild: it runs with
    /// foreign_keys disabled and a foreign_key_check before commit, because
    /// SQLite cannot ALTER away a foreign key or CHECK constraint in place.
    pub rebuild: bool,
}
```

Add every existing migration a `rebuild: false` field, then add v4 (see Step 4). Replace the apply loop (the `for migration in migrations` block) with:

```rust
    for migration in migrations {
        if migration.version > current_version {
            log::info!("Applying migration v{}: {}", migration.version, migration.description);
            if migration.rebuild {
                apply_rebuild_migration(conn, &migration)?;
            } else {
                let tx = conn.transaction().map_err(|e| AppError::Db {
                    code: "ERR_DB_003".to_string(),
                    message: format!("Failed to begin transaction: {}", e),
                })?;
                tx.execute_batch(migration.sql).map_err(|e| AppError::Db {
                    code: "ERR_DB_003".to_string(),
                    message: format!("Failed to execute migration script: {}", e),
                })?;
                tx.execute(
                    "INSERT INTO schema_migrations (version, description) VALUES (?, ?)",
                    params![migration.version, migration.description],
                )
                .map_err(|e| AppError::Db {
                    code: "ERR_DB_003".to_string(),
                    message: format!("Failed to log migration status: {}", e),
                })?;
                tx.commit().map_err(|e| AppError::Db {
                    code: "ERR_DB_003".to_string(),
                    message: format!("Failed to commit migration transaction: {}", e),
                })?;
            }
        }
    }

    Ok(())
}

/// Applies a table-rebuild migration. `PRAGMA foreign_keys` is a no-op inside a
/// transaction, so it is toggled OFF outside, then a foreign_key_check runs
/// before commit; any violation rolls the whole rebuild back.
fn apply_rebuild_migration(conn: &mut Connection, migration: &Migration) -> Result<(), AppError> {
    conn.pragma_update(None, "foreign_keys", "OFF").map_err(|e| AppError::Db {
        code: "ERR_DB_003".to_string(),
        message: format!("Failed to disable foreign_keys for rebuild: {}", e),
    })?;

    let result = (|| {
        let tx = conn.transaction().map_err(|e| AppError::Db {
            code: "ERR_DB_003".to_string(),
            message: format!("Failed to begin rebuild transaction: {}", e),
        })?;
        tx.execute_batch(migration.sql).map_err(|e| AppError::Db {
            code: "ERR_DB_003".to_string(),
            message: format!("Failed to execute rebuild script: {}", e),
        })?;
        tx.execute(
            "INSERT INTO schema_migrations (version, description) VALUES (?, ?)",
            params![migration.version, migration.description],
        )
        .map_err(|e| AppError::Db {
            code: "ERR_DB_003".to_string(),
            message: format!("Failed to log rebuild migration: {}", e),
        })?;
        let violations: i64 = tx
            .query_row("SELECT COUNT(*) FROM pragma_foreign_key_check", [], |r| r.get(0))
            .unwrap_or(0);
        if violations > 0 {
            return Err(AppError::Db {
                code: "ERR_DB_003".to_string(),
                message: format!("Rebuild v{} failed foreign_key_check ({violations} violations)", migration.version),
            });
        }
        tx.commit().map_err(|e| AppError::Db {
            code: "ERR_DB_003".to_string(),
            message: format!("Failed to commit rebuild transaction: {}", e),
        })?;
        Ok(())
    })();

    // Restore enforcement regardless of outcome.
    conn.pragma_update(None, "foreign_keys", "ON").ok();
    result
}
```

- [ ] **Step 4: Add the v4 migration to the migrations vec**

Append to the `let migrations = vec![ ... ]` list in `run_migrations` (after v3), each existing entry now carrying `rebuild: false`:

```rust
        Migration {
            version: 4,
            description: "Rebuild customers into full customer master (rename customer_name->report_name, add master columns, drop state_code FK)",
            rebuild: true,
            sql: "
                CREATE TABLE customers_new (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    customer_code TEXT NOT NULL UNIQUE,
                    report_name TEXT NOT NULL,
                    tally_customer_name TEXT,
                    legal_name TEXT,
                    gstin TEXT,
                    address1 TEXT,
                    address2 TEXT,
                    location TEXT,
                    pincode TEXT,
                    state_code TEXT,
                    place_of_supply TEXT,
                    phone TEXT,
                    email TEXT,
                    category_name TEXT,
                    remarks TEXT,
                    status TEXT NOT NULL DEFAULT 'Approved' CHECK(status IN ('Approved', 'Pending_Review'))
                );
                INSERT INTO customers_new
                    (id, customer_code, report_name, tally_customer_name, legal_name, gstin,
                     address1, address2, location, pincode, state_code, place_of_supply,
                     phone, email, category_name, remarks, status)
                SELECT id, customer_code, customer_name, tally_customer_name, NULL, gstin,
                       address, NULL, NULL, NULL, state_code, NULL,
                       NULL, NULL, category_name, NULL, status
                FROM customers;
                DROP TABLE customers;
                ALTER TABLE customers_new RENAME TO customers;
                CREATE INDEX IF NOT EXISTS idx_customers_code ON customers(customer_code);
            ",
        },
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd src-tauri && cargo test --lib database::migrate -- --nocapture`
Expected: PASS for both `v4_*` tests.

- [ ] **Step 6: Verify existing migration-dependent tests still pass**

Run: `cd src-tauri && cargo test report_repo`
Expected: FAIL — `report_repo.rs:152` test fixture still inserts `customer_name`. That is fixed in Task 3; if you run tasks in order, expect this and proceed. To keep Task 1 self-contained and green, temporarily leave `report_repo` untouched only if its tests already reference `customer_name` — they do, so do NOT run the full suite yet; the rename fan-out lands in Task 3.

- [ ] **Step 7: Commit**

```bash
cd "D:/Sales Monitoring System"
cargo fmt --manifest-path src-tauri/Cargo.toml
git add src-tauri/src/database/migrate.rs
git commit -m "feat: add rebuild-migration support and v4 customers master rebuild"
```

---

## Task 2: v5 import_batches source_type widening

**Files:**
- Modify: `src-tauri/src/database/migrate.rs`
- Test: `src-tauri/src/database/migrate.rs` (`#[cfg(test)]` module)

**Interfaces:**
- Produces: `import_batches.source_type` CHECK accepts `'customer_master'`.

- [ ] **Step 1: Write the failing test**

Add to the `tests` module in `migrate.rs`:

```rust
    #[test]
    fn v5_import_batches_accepts_customer_master_source() {
        let mut conn = Connection::open_in_memory().unwrap();
        run_migrations(&mut conn).unwrap();

        conn.execute(
            "INSERT INTO import_batches
                (source_type, file_name, file_size_bytes, file_hash, row_count, imported_by, status)
             VALUES ('customer_master', 'cm.xlsx', 10, 'hash-cm-1', 3, 'tester', 'completed')",
            [],
        )
        .expect("customer_master source_type must be allowed after v5");

        let cnt: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM import_batches WHERE source_type='customer_master'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(cnt, 1);
    }
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd src-tauri && cargo test v5_import_batches_accepts_customer_master_source -- --nocapture`
Expected: FAIL — CHECK constraint rejects `'customer_master'`.

- [ ] **Step 3: Add the v5 migration**

Append after v4 in the `migrations` vec:

```rust
        Migration {
            version: 5,
            description: "Rebuild import_batches to allow source_type 'customer_master'",
            rebuild: true,
            sql: "
                CREATE TABLE import_batches_new (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    imported_at TEXT NOT NULL DEFAULT (datetime('now')),
                    source_type TEXT NOT NULL CHECK(source_type IN ('erp_sales_report', 'gstr1_report', 'customer_master')),
                    file_name TEXT NOT NULL,
                    file_size_bytes INTEGER NOT NULL,
                    excel_version TEXT,
                    template_version_id INTEGER,
                    file_hash TEXT NOT NULL UNIQUE,
                    row_count INTEGER NOT NULL,
                    success_count INTEGER NOT NULL DEFAULT 0,
                    warning_count INTEGER NOT NULL DEFAULT 0,
                    error_count INTEGER NOT NULL DEFAULT 0,
                    duration_ms INTEGER NOT NULL DEFAULT 0,
                    imported_by TEXT NOT NULL,
                    user_remarks TEXT,
                    rollback_reason TEXT,
                    status TEXT NOT NULL DEFAULT 'staged' CHECK(status IN ('staged', 'completed', 'failed'))
                );
                INSERT INTO import_batches_new SELECT * FROM import_batches;
                DROP TABLE import_batches;
                ALTER TABLE import_batches_new RENAME TO import_batches;
            ",
        },
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd src-tauri && cargo test --lib database::migrate -- --nocapture`
Expected: PASS for all migrate tests (`v4_*` and `v5_*`).

- [ ] **Step 5: Commit**

```bash
cd "D:/Sales Monitoring System"
cargo fmt --manifest-path src-tauri/Cargo.toml
git add src-tauri/src/database/migrate.rs
git commit -m "feat: widen import_batches source_type for customer_master (v5)"
```

---

## Task 3: Column rename fan-out (`customer_name → report_name`)

**Files:**
- Modify: `src-tauri/src/models/database_models.rs:86`
- Modify: `src-tauri/src/repositories/master_repo.rs` (lines ~12, 25, 38, 62)
- Modify: `src-tauri/src/repositories/invoice_repo.rs:123`
- Modify: `src-tauri/src/repositories/report_repo.rs:152` (test fixture)
- Modify: `src-tauri/src/commands/invoice_commands.rs:377`
- Modify: `src-tauri/src/commands/import_commands.rs:272`
- Modify: `src-tauri/src/commands/export_commands.rs` (lines ~101, 210, 520, 762)
- Test: existing `cargo test` suite is the regression gate

**Interfaces:**
- Consumes: v4 `customers.report_name` column (Task 1).
- Produces: `CustomerRow { id, customer_code, report_name, tally_customer_name, gstin, state_code, address, status }`.

- [ ] **Step 1: Rename the model field**

In `src-tauri/src/models/database_models.rs`, change the `CustomerRow` field:

```rust
    pub customer_code: String,
    pub report_name: String,
    pub tally_customer_name: Option<String>,
```

- [ ] **Step 2: Update `master_repo.rs` SQL and mapping**

In `src-tauri/src/repositories/master_repo.rs`, replace the four `customer_name` occurrences:

```rust
        // insert (line ~12)
        "INSERT INTO customers (customer_code, report_name, gstin, state_code, address, status)
         VALUES (?, ?, ?, ?, ?, ?)",
        params![row.customer_code, row.report_name, row.gstin, row.state_code, row.address, row.status],
```
```rust
        // update (line ~25)
        "UPDATE customers SET report_name = ?, gstin = ?, state_code = ?, address = ?, status = ?
         WHERE customer_code = ?",
        params![row.report_name, row.gstin, row.state_code, row.address, row.status, row.customer_code],
```
For the two `SELECT ... customer_name ...` statements (find_customer ~38 and list_customers ~62), change the selected column to `report_name` and the row mapping `customer_name: row.get(2)?` → `report_name: row.get(2)?`.

- [ ] **Step 3: Update `invoice_repo.rs` join select**

In `src-tauri/src/repositories/invoice_repo.rs:123`, change `c.customer_name` to `c.report_name AS customer_name` (keeps the `InvoiceSummary.customer_name` field populated with no mapping change):

```rust
            SELECT i.invoice_number, i.invoice_date, c.customer_code, c.report_name AS customer_name,
```

- [ ] **Step 4: Update `invoice_commands.rs` customer list**

In `src-tauri/src/commands/invoice_commands.rs:377`, change the SELECT and ORDER BY, and the row mapping:

```rust
        "SELECT id, customer_code, report_name, tally_customer_name, gstin, state_code, address, status FROM customers ORDER BY report_name ASC"
```
Then update `customer_name: row.get(2)?` → `report_name: row.get(2)?`.

- [ ] **Step 5: Update `import_commands.rs` auto-create insert**

In `src-tauri/src/commands/import_commands.rs:272`:

```rust
                    "INSERT INTO customers (customer_code, report_name, status) VALUES (?, ?, 'Pending_Review')",
```

- [ ] **Step 6: Update `export_commands.rs` SQL**

In `src-tauri/src/commands/export_commands.rs`, update each customers reference to the column's new name while keeping output aliases:
- line ~101: `COALESCE(c.tally_customer_name, c.report_name) AS customer_name,`
- line ~210: `"SELECT DISTINCT c.customer_code, c.report_name` (and any downstream `.get` index stays the same)
- line ~520: `c.report_name,`
- line ~762: `"SELECT c.report_name, scs.total_value`

- [ ] **Step 7: Update `report_repo.rs` test fixture**

In `src-tauri/src/repositories/report_repo.rs:152`:

```rust
            "INSERT INTO customers (id, customer_code, report_name, status) VALUES (1, 'CUST01', 'Test Customer', 'Approved');
```

- [ ] **Step 8: Run the full backend suite**

Run: `cd src-tauri && cargo test`
Expected: PASS — all existing tests (report_repo rollups, migrate) green with the renamed column.

- [ ] **Step 9: Regenerate + commit**

`cargo test` rewrites `src/types/bindings/CustomerRow.ts` (now `report_name`).

```bash
cd "D:/Sales Monitoring System"
cargo fmt --manifest-path src-tauri/Cargo.toml
git add src-tauri/src src/types/bindings/CustomerRow.ts
git commit -m "refactor: rename customers.customer_name to report_name across backend"
```

---

## Task 4: `CustomerMasterRow` DTO, `get_customer_master`, remove dead commands

**Files:**
- Modify: `src-tauri/src/models/domain_models.rs` (add `CustomerMasterRow`)
- Modify: `src-tauri/src/commands/customer_commands.rs` (replace `CustomerTallyMappingRow` + read command; delete two dead commands)
- Modify: `src-tauri/src/lib.rs` (registration)
- Modify: `src/services/api.ts` (bindings)
- Test: `src-tauri/src/commands/customer_commands.rs` (`#[cfg(test)]`)

**Interfaces:**
- Produces: `CustomerMasterRow` (16 stored fields + derived `match_status`), exported to `../../src/types/bindings/CustomerMasterRow.ts`.
- Produces: command `get_customer_master() -> Vec<CustomerMasterRow>`.
- Produces free function `derive_match_status(tally: Option<&str>, gstin: Option<&str>, address1: Option<&str>, state_code: Option<&str>) -> String`.

- [ ] **Step 1: Write the failing test**

Add a `tests` module at the bottom of `src-tauri/src/commands/customer_commands.rs`:

```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn match_status_needs_tally_when_tally_missing() {
        assert_eq!(derive_match_status(None, Some("33AAAA"), Some("addr"), Some("33")), "Needs Tally name");
        assert_eq!(derive_match_status(Some("  "), Some("x"), Some("y"), Some("33")), "Needs Tally name");
    }

    #[test]
    fn match_status_incomplete_when_core_field_missing() {
        assert_eq!(derive_match_status(Some("Tally Co"), None, Some("addr"), Some("33")), "Incomplete");
        assert_eq!(derive_match_status(Some("Tally Co"), Some("g"), None, Some("33")), "Incomplete");
        assert_eq!(derive_match_status(Some("Tally Co"), Some("g"), Some("a"), None), "Incomplete");
    }

    #[test]
    fn match_status_complete_when_all_present() {
        assert_eq!(derive_match_status(Some("Tally Co"), Some("g"), Some("a"), Some("33")), "Complete");
    }
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd src-tauri && cargo test derive_match_status -- --nocapture`
Expected: FAIL — `derive_match_status` not defined.

- [ ] **Step 3: Add the `CustomerMasterRow` DTO**

In `src-tauri/src/models/domain_models.rs`, add:

```rust
#[derive(Debug, Serialize, Deserialize, Clone, TS)]
#[ts(export, export_to = "../../src/types/bindings/CustomerMasterRow.ts")]
pub struct CustomerMasterRow {
    pub id: i64,
    pub customer_code: String,
    pub report_name: String,
    pub tally_name: Option<String>,
    pub legal_name: Option<String>,
    pub gstin: Option<String>,
    pub address1: Option<String>,
    pub address2: Option<String>,
    pub location: Option<String>,
    pub pincode: Option<String>,
    pub state_code: Option<String>,
    pub place_of_supply: Option<String>,
    pub phone: Option<String>,
    pub email: Option<String>,
    pub category_name: Option<String>,
    pub remarks: Option<String>,
    pub status: String,
    pub match_status: String,
}
```

- [ ] **Step 4: Add `derive_match_status` + `get_customer_master`, delete dead commands**

In `src-tauri/src/commands/customer_commands.rs`:

1. Delete the `CustomerTallyMappingRow` struct, and the commands `get_customer_tally_mappings`, `update_customer_tally_name`, `bulk_update_customer_tally_names`.
2. Add the helper (module scope):

```rust
/// Derives the UI match/completeness status for a customer row.
pub fn derive_match_status(
    tally: Option<&str>,
    gstin: Option<&str>,
    address1: Option<&str>,
    state_code: Option<&str>,
) -> String {
    let filled = |v: Option<&str>| v.map(|s| !s.trim().is_empty()).unwrap_or(false);
    if !filled(tally) {
        "Needs Tally name".to_string()
    } else if !filled(gstin) || !filled(address1) || !filled(state_code) {
        "Incomplete".to_string()
    } else {
        "Complete".to_string()
    }
}
```

3. Add the read command:

```rust
use crate::models::domain_models::CustomerMasterRow;

/// Fetch all customers as full master records for the Customer Master screen.
#[tauri::command]
pub fn get_customer_master(state: State<'_, DbState>) -> Result<Vec<CustomerMasterRow>, AppError> {
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
            "SELECT id, customer_code, report_name, tally_customer_name, legal_name, gstin,
                    address1, address2, location, pincode, state_code, place_of_supply,
                    phone, email, category_name, remarks, status
             FROM customers ORDER BY customer_code ASC",
        )
        .map_err(|e| AppError::Db {
            code: "ERR_DB_003".to_string(),
            message: format!("Failed to query customer master: {}", e),
        })?;

    let rows = stmt
        .query_map([], |row| {
            let tally: Option<String> = row.get(3)?;
            let gstin: Option<String> = row.get(5)?;
            let address1: Option<String> = row.get(6)?;
            let state_code: Option<String> = row.get(10)?;
            let match_status = derive_match_status(
                tally.as_deref(),
                gstin.as_deref(),
                address1.as_deref(),
                state_code.as_deref(),
            );
            Ok(CustomerMasterRow {
                id: row.get(0)?,
                customer_code: row.get(1)?,
                report_name: row.get(2)?,
                tally_name: tally,
                legal_name: row.get(4)?,
                gstin,
                address1,
                address2: row.get(7)?,
                location: row.get(8)?,
                pincode: row.get(9)?,
                state_code,
                place_of_supply: row.get(11)?,
                phone: row.get(12)?,
                email: row.get(13)?,
                category_name: row.get(14)?,
                remarks: row.get(15)?,
                status: row.get(16)?,
                match_status,
            })
        })
        .map_err(|e| AppError::Db {
            code: "ERR_DB_003".to_string(),
            message: format!("Failed to map customer master rows: {}", e),
        })?;

    let mut result = Vec::new();
    for r in rows {
        result.push(r.map_err(|e| AppError::Db {
            code: "ERR_DB_003".to_string(),
            message: format!("Row parse error: {}", e),
        })?);
    }
    Ok(result)
}
```

- [ ] **Step 5: Update `lib.rs` registration**

In `src-tauri/src/lib.rs`, in `generate_handler!`, remove `get_customer_tally_mappings`, `update_customer_tally_name`, `bulk_update_customer_tally_names`; add `get_customer_master`. Keep `update_customer_mapping` for now (replaced in Task 5) and `bulk_update_customer_mappings`.

- [ ] **Step 6: Run tests**

Run: `cd src-tauri && cargo test`
Expected: PASS — `derive_match_status` tests green; project compiles.

- [ ] **Step 7: Update `api.ts`**

In `src/services/api.ts`:
1. Delete the hand-written `CustomerTallyMappingRow` interface and the methods `getCustomerTallyMappings`, `updateCustomerTallyName`, `bulkUpdateCustomerTallyNames`.
2. Add the binding import and method:

```ts
import { CustomerMasterRow } from "../types/bindings/CustomerMasterRow";
export type { CustomerMasterRow };
```
```ts
  /** Fetch all customers as full master records. */
  static async getCustomerMaster(): Promise<CustomerMasterRow[]> {
    return await invoke<CustomerMasterRow[]>("get_customer_master");
  }
```

- [ ] **Step 8: Commit**

```bash
cd "D:/Sales Monitoring System"
cargo fmt --manifest-path src-tauri/Cargo.toml
git add src-tauri/src src/services/api.ts src/types/bindings/CustomerMasterRow.ts
git commit -m "feat: add CustomerMasterRow DTO and get_customer_master; drop dead mapping commands"
```

---

## Task 5: Full-record CRUD — `create_customer_master`, `update_customer_master`

**Files:**
- Modify: `src-tauri/src/commands/customer_commands.rs`
- Modify: `src-tauri/src/lib.rs`
- Modify: `src/services/api.ts`
- Test: `src-tauri/src/commands/customer_commands.rs` (`#[cfg(test)]`)

**Interfaces:**
- Consumes: `derive_match_status`, `CustomerMasterRow` (Task 4).
- Produces: `CustomerMasterPayload` (all editable fields), `validate_customer_payload(&CustomerMasterPayload) -> Result<(), AppError>`.
- Produces: commands `create_customer_master(payload) -> i64`, `update_customer_master(payload) -> ()`. Replaces `update_customer_mapping`.

- [ ] **Step 1: Write the failing test**

Add to the `tests` module in `customer_commands.rs`:

```rust
    fn sample_payload(code: &str) -> CustomerMasterPayload {
        CustomerMasterPayload {
            id: None,
            customer_code: code.to_string(),
            report_name: "Report Co".to_string(),
            tally_name: Some("Tally Co".to_string()),
            legal_name: None,
            gstin: Some("33AAACH2364M1ZM".to_string()),
            address1: Some("H-1 SIPCOT".to_string()),
            address2: None,
            location: Some("KANCHEEPURAM".to_string()),
            pincode: Some("602117".to_string()),
            state_code: Some("33".to_string()),
            place_of_supply: Some("33".to_string()),
            phone: None,
            email: None,
            category_name: None,
            remarks: None,
            status: "Approved".to_string(),
        }
    }

    #[test]
    fn validate_rejects_blank_code_and_name() {
        let mut p = sample_payload("");
        assert!(validate_customer_payload(&p).is_err());
        p = sample_payload("C1");
        p.report_name = "   ".to_string();
        assert!(validate_customer_payload(&p).is_err());
    }

    #[test]
    fn validate_rejects_bad_gstin_length() {
        let mut p = sample_payload("C1");
        p.gstin = Some("SHORT".to_string());
        assert!(validate_customer_payload(&p).is_err());
    }

    #[test]
    fn validate_accepts_good_payload() {
        assert!(validate_customer_payload(&sample_payload("C1")).is_ok());
    }
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd src-tauri && cargo test validate_customer_payload -- --nocapture`
Expected: FAIL — `CustomerMasterPayload` / `validate_customer_payload` not defined.

- [ ] **Step 3: Add payload, validation, and commands**

In `src-tauri/src/commands/customer_commands.rs`:

```rust
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct CustomerMasterPayload {
    pub id: Option<i64>,
    pub customer_code: String,
    pub report_name: String,
    pub tally_name: Option<String>,
    pub legal_name: Option<String>,
    pub gstin: Option<String>,
    pub address1: Option<String>,
    pub address2: Option<String>,
    pub location: Option<String>,
    pub pincode: Option<String>,
    pub state_code: Option<String>,
    pub place_of_supply: Option<String>,
    pub phone: Option<String>,
    pub email: Option<String>,
    pub category_name: Option<String>,
    pub remarks: Option<String>,
    pub status: String,
}

fn norm(v: &Option<String>) -> Option<String> {
    v.as_ref().map(|s| s.trim()).filter(|s| !s.is_empty()).map(|s| s.to_string())
}

/// Light field validation (spec §4.3). Required: customer_code, report_name.
pub fn validate_customer_payload(p: &CustomerMasterPayload) -> Result<(), AppError> {
    let val = |msg: &str| AppError::Validation { code: "ERR_VAL_001".to_string(), message: msg.to_string() };
    if p.customer_code.trim().is_empty() {
        return Err(val("Customer code is required"));
    }
    if p.report_name.trim().is_empty() {
        return Err(val("Report name is required"));
    }
    if let Some(g) = norm(&p.gstin) {
        if g.len() != 15 {
            return Err(val("GSTIN must be 15 characters"));
        }
    }
    if let Some(pin) = norm(&p.pincode) {
        if pin.len() != 6 || !pin.chars().all(|c| c.is_ascii_digit()) {
            return Err(val("Pincode must be 6 digits"));
        }
    }
    for (label, code) in [("State code", norm(&p.state_code)), ("Place of supply", norm(&p.place_of_supply))] {
        if let Some(c) = code {
            if c.len() != 2 || !c.chars().all(|ch| ch.is_ascii_digit()) {
                return Err(val(&format!("{label} must be a 2-digit GST code")));
            }
        }
    }
    if let Some(e) = norm(&p.email) {
        if !e.contains('@') {
            return Err(val("Email must contain @"));
        }
    }
    if p.status != "Approved" && p.status != "Pending_Review" {
        return Err(val("Status must be Approved or Pending_Review"));
    }
    Ok(())
}

/// Create a new customer master record. Returns the new row id.
#[tauri::command]
pub fn create_customer_master(state: State<'_, DbState>, payload: CustomerMasterPayload) -> Result<i64, AppError> {
    validate_customer_payload(&payload)?;
    let conn_guard = state.conn.lock()
        .map_err(|e| AppError::Internal(format!("Failed to acquire connection lock: {}", e)))?;
    let conn = conn_guard.as_ref().ok_or_else(|| AppError::Db {
        code: "ERR_DB_002".to_string(), message: "No active database connection profile".to_string(),
    })?;

    conn.execute(
        "INSERT INTO customers
            (customer_code, report_name, tally_customer_name, legal_name, gstin, address1, address2,
             location, pincode, state_code, place_of_supply, phone, email, category_name, remarks, status)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
        rusqlite::params![
            payload.customer_code.trim(), payload.report_name.trim(), norm(&payload.tally_name),
            norm(&payload.legal_name), norm(&payload.gstin), norm(&payload.address1), norm(&payload.address2),
            norm(&payload.location), norm(&payload.pincode), norm(&payload.state_code), norm(&payload.place_of_supply),
            norm(&payload.phone), norm(&payload.email), norm(&payload.category_name), norm(&payload.remarks), payload.status,
        ],
    )
    .map_err(|e| AppError::Db {
        code: "ERR_DB_003".to_string(),
        message: format!("Failed to create customer (code may already exist): {}", e),
    })?;
    Ok(conn.last_insert_rowid())
}

/// Update an existing customer master record (identified by id).
#[tauri::command]
pub fn update_customer_master(state: State<'_, DbState>, payload: CustomerMasterPayload) -> Result<(), AppError> {
    validate_customer_payload(&payload)?;
    let id = payload.id.ok_or_else(|| AppError::Validation {
        code: "ERR_VAL_001".to_string(), message: "Customer id is required for update".to_string(),
    })?;
    let conn_guard = state.conn.lock()
        .map_err(|e| AppError::Internal(format!("Failed to acquire connection lock: {}", e)))?;
    let conn = conn_guard.as_ref().ok_or_else(|| AppError::Db {
        code: "ERR_DB_002".to_string(), message: "No active database connection profile".to_string(),
    })?;

    conn.execute(
        "UPDATE customers SET
            customer_code=?, report_name=?, tally_customer_name=?, legal_name=?, gstin=?, address1=?, address2=?,
            location=?, pincode=?, state_code=?, place_of_supply=?, phone=?, email=?, category_name=?, remarks=?, status=?
         WHERE id=?",
        rusqlite::params![
            payload.customer_code.trim(), payload.report_name.trim(), norm(&payload.tally_name),
            norm(&payload.legal_name), norm(&payload.gstin), norm(&payload.address1), norm(&payload.address2),
            norm(&payload.location), norm(&payload.pincode), norm(&payload.state_code), norm(&payload.place_of_supply),
            norm(&payload.phone), norm(&payload.email), norm(&payload.category_name), norm(&payload.remarks), payload.status, id,
        ],
    )
    .map_err(|e| AppError::Db {
        code: "ERR_DB_003".to_string(),
        message: format!("Failed to update customer: {}", e),
    })?;
    Ok(())
}
```

Then delete the old `update_customer_mapping` command (superseded).

- [ ] **Step 4: Update `lib.rs`**

In `generate_handler!`: remove `update_customer_mapping`; add `create_customer_master`, `update_customer_master`.

- [ ] **Step 5: Run tests**

Run: `cd src-tauri && cargo test`
Expected: PASS — validation tests green, compiles.

- [ ] **Step 6: Update `api.ts`**

Remove `updateCustomerMapping`. Add a shared payload type + two methods:

```ts
export interface CustomerMasterPayload {
  id: number | null;
  customer_code: string;
  report_name: string;
  tally_name: string | null;
  legal_name: string | null;
  gstin: string | null;
  address1: string | null;
  address2: string | null;
  location: string | null;
  pincode: string | null;
  state_code: string | null;
  place_of_supply: string | null;
  phone: string | null;
  email: string | null;
  category_name: string | null;
  remarks: string | null;
  status: "Approved" | "Pending_Review";
}
```
```ts
  static async createCustomerMaster(payload: CustomerMasterPayload): Promise<number> {
    return await invoke<number>("create_customer_master", { payload });
  }
  static async updateCustomerMaster(payload: CustomerMasterPayload): Promise<void> {
    await invoke("update_customer_master", { payload });
  }
```

- [ ] **Step 7: Commit**

```bash
cd "D:/Sales Monitoring System"
cargo fmt --manifest-path src-tauri/Cargo.toml
git add src-tauri/src src/services/api.ts
git commit -m "feat: full-record customer master create/update commands with validation"
```

---

## Task 6: Customer master import service (parse + validate + preview)

**Files:**
- Create: `src-tauri/src/services/customer_import_service.rs`
- Modify: `src-tauri/src/services/mod.rs` (add `pub mod customer_import_service;`)
- Modify: `src-tauri/src/models/domain_models.rs` (add import DTOs)
- Test: `src-tauri/src/services/customer_import_service.rs` (`#[cfg(test)]`)

**Interfaces:**
- Produces DTOs: `CustomerImportIssue`, `CustomerImportPreview`, `CustomerImportResult`.
- Produces: `struct ParsedCustomerRow { row_no: i32, code, report_name, tally, legal, gstin, address1, address2, location, pincode, state_code, place_of_supply, phone, email, status, remarks: Option<String> }` (all `Option<String>` except `row_no`).
- Produces: `fn parse_customer_sheet(path: &str) -> Result<Vec<ParsedCustomerRow>, AppError>`.
- Produces: `fn validate_row(r: &ParsedCustomerRow, exists: bool) -> Vec<CustomerImportIssue>`.

- [ ] **Step 1: Add import DTOs to `domain_models.rs`**

```rust
#[derive(Debug, Serialize, Deserialize, Clone, TS)]
#[ts(export, export_to = "../../src/types/bindings/CustomerImportIssue.ts")]
pub struct CustomerImportIssue {
    pub row_no: i32,
    pub customer_code: Option<String>,
    pub severity: String, // "error" | "warning"
    pub message: String,
}

#[derive(Debug, Serialize, Deserialize, Clone, TS)]
#[ts(export, export_to = "../../src/types/bindings/CustomerImportPreview.ts")]
pub struct CustomerImportPreview {
    pub file_name: String,
    pub row_count: u32,
    pub to_insert: u32,
    pub to_update: u32,
    pub errors: Vec<CustomerImportIssue>,
    pub warnings: Vec<CustomerImportIssue>,
}

#[derive(Debug, Serialize, Deserialize, Clone, TS)]
#[ts(export, export_to = "../../src/types/bindings/CustomerImportResult.ts")]
pub struct CustomerImportResult {
    pub batch_id: i64,
    pub inserted: u32,
    pub updated: u32,
    pub skipped: u32,
    pub errors: Vec<CustomerImportIssue>,
}
```

- [ ] **Step 2: Write the failing test**

Create `src-tauri/src/services/customer_import_service.rs` with only the test module first:

```rust
#[cfg(test)]
mod tests {
    use super::*;

    fn row(code: Option<&str>, name: Option<&str>, gstin: Option<&str>) -> ParsedCustomerRow {
        ParsedCustomerRow {
            row_no: 2,
            code: code.map(|s| s.to_string()),
            report_name: name.map(|s| s.to_string()),
            tally: None, legal: None, gstin: gstin.map(|s| s.to_string()),
            address1: None, address2: None, location: None, pincode: None,
            state_code: None, place_of_supply: None, phone: None, email: None,
            status: None, remarks: None,
        }
    }

    #[test]
    fn new_row_missing_code_is_error() {
        let issues = validate_row(&row(None, Some("Co"), None), false);
        assert!(issues.iter().any(|i| i.severity == "error"));
    }

    #[test]
    fn new_row_missing_name_is_error() {
        let issues = validate_row(&row(Some("C1"), None, None), false);
        assert!(issues.iter().any(|i| i.severity == "error"));
    }

    #[test]
    fn existing_row_without_name_is_not_error() {
        // On update, blank report_name keeps existing -> no error.
        let issues = validate_row(&row(Some("C1"), None, None), true);
        assert!(!issues.iter().any(|i| i.severity == "error"));
    }

    #[test]
    fn bad_gstin_length_is_warning_not_error() {
        let issues = validate_row(&row(Some("C1"), Some("Co"), Some("SHORT")), true);
        assert!(issues.iter().any(|i| i.severity == "warning"));
        assert!(!issues.iter().any(|i| i.severity == "error"));
    }
}
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd src-tauri && cargo test customer_import_service -- --nocapture`
Expected: FAIL — types/functions not defined (won't compile).

- [ ] **Step 4: Implement parse + validate**

Prepend to `customer_import_service.rs` (above the test module):

```rust
use std::collections::HashMap;
use std::path::Path;
use calamine::{open_workbook_auto, Reader};
use crate::error::AppError;
use crate::models::domain_models::CustomerImportIssue;
use crate::services::import_service::cell_to_string;

#[derive(Debug, Clone)]
pub struct ParsedCustomerRow {
    pub row_no: i32,
    pub code: Option<String>,
    pub report_name: Option<String>,
    pub tally: Option<String>,
    pub legal: Option<String>,
    pub gstin: Option<String>,
    pub address1: Option<String>,
    pub address2: Option<String>,
    pub location: Option<String>,
    pub pincode: Option<String>,
    pub state_code: Option<String>,
    pub place_of_supply: Option<String>,
    pub phone: Option<String>,
    pub email: Option<String>,
    pub status: Option<String>,
    pub remarks: Option<String>,
}

fn norm_key(h: &str) -> String {
    h.trim().to_lowercase().replace([' ', '_', '-'], "")
}

/// Maps a normalized header to the canonical field key.
fn field_for_header(h: &str) -> Option<&'static str> {
    match norm_key(h).as_str() {
        "customercode" | "custcode" | "code" => Some("customer_code"),
        "reportname" | "custname" | "customername" | "name" => Some("report_name"),
        "tallyname" | "tallycustomername" => Some("tally_name"),
        "legalname" => Some("legal_name"),
        "gstin" | "gst" => Some("gstin"),
        "address1" | "addressline1" | "address" => Some("address1"),
        "address2" | "addressline2" => Some("address2"),
        "location" | "city" => Some("location"),
        "pincode" | "pin" | "zip" => Some("pincode"),
        "placeofsupply" | "pos" => Some("place_of_supply"),
        "statecode" | "state" => Some("state_code"),
        "phone" | "mobile" | "contact" => Some("phone"),
        "email" | "mail" => Some("email"),
        "status" => Some("status"),
        "remarks" | "notes" => Some("remarks"),
        _ => None,
    }
}

/// Reads the first worksheet; row 1 is the header row.
pub fn parse_customer_sheet(file_path: &str) -> Result<Vec<ParsedCustomerRow>, AppError> {
    let clean = file_path.trim().trim_matches('"').trim_matches('\'');
    let path = Path::new(clean);
    if !path.exists() {
        return Err(AppError::Excel(format!("File not found: {}", clean)));
    }
    let mut workbook = open_workbook_auto(path)
        .map_err(|e| AppError::Excel(format!("Failed to open workbook: {}", e)))?;
    let sheet_name = workbook
        .sheet_names()
        .first()
        .cloned()
        .ok_or_else(|| AppError::Excel("Workbook has no sheets".to_string()))?;
    let range = workbook
        .worksheet_range(&sheet_name)
        .map_err(|e| AppError::Excel(format!("Failed to read sheet: {}", e)))?;

    let mut rows_iter = range.rows();
    let header = match rows_iter.next() {
        Some(h) => h,
        None => return Ok(Vec::new()),
    };
    let mut col_field: HashMap<usize, &'static str> = HashMap::new();
    for (idx, cell) in header.iter().enumerate() {
        if let Some(field) = field_for_header(&cell_to_string(cell)) {
            col_field.insert(idx, field);
        }
    }

    let mut parsed = Vec::new();
    for (i, row) in rows_iter.enumerate() {
        let get = |field: &str| -> Option<String> {
            col_field.iter().find(|(_, f)| **f == field).and_then(|(idx, _)| {
                row.get(*idx).map(cell_to_string).filter(|s| !s.trim().is_empty())
            })
        };
        // Skip fully-empty rows.
        if col_field.keys().all(|idx| row.get(*idx).map(cell_to_string).unwrap_or_default().trim().is_empty()) {
            continue;
        }
        parsed.push(ParsedCustomerRow {
            row_no: (i as i32) + 2,
            code: get("customer_code"),
            report_name: get("report_name"),
            tally: get("tally_name"),
            legal: get("legal_name"),
            gstin: get("gstin"),
            address1: get("address1"),
            address2: get("address2"),
            location: get("location"),
            pincode: get("pincode"),
            state_code: get("state_code"),
            place_of_supply: get("place_of_supply"),
            phone: get("phone"),
            email: get("email"),
            status: get("status"),
            remarks: get("remarks"),
        });
    }
    Ok(parsed)
}

/// Validates one parsed row. `exists` = true when the customer_code is already
/// in the DB (an update, where a blank report_name simply keeps the existing).
pub fn validate_row(r: &ParsedCustomerRow, exists: bool) -> Vec<CustomerImportIssue> {
    let mut issues = Vec::new();
    let err = |m: String| CustomerImportIssue { row_no: r.row_no, customer_code: r.code.clone(), severity: "error".to_string(), message: m };
    let warn = |m: String| CustomerImportIssue { row_no: r.row_no, customer_code: r.code.clone(), severity: "warning".to_string(), message: m };

    let has = |v: &Option<String>| v.as_ref().map(|s| !s.trim().is_empty()).unwrap_or(false);

    if !has(&r.code) {
        issues.push(err("Missing customer_code".to_string()));
        return issues; // nothing else is meaningful without a code
    }
    if !exists && !has(&r.report_name) {
        issues.push(err("New customer requires report_name".to_string()));
    }
    if let Some(g) = &r.gstin {
        if g.trim().len() != 15 {
            issues.push(warn("GSTIN is not 15 characters".to_string()));
        }
    }
    if let Some(p) = &r.pincode {
        let p = p.trim();
        if p.len() != 6 || !p.chars().all(|c| c.is_ascii_digit()) {
            issues.push(warn("Pincode is not 6 digits".to_string()));
        }
    }
    for (label, code) in [("state_code", &r.state_code), ("place_of_supply", &r.place_of_supply)] {
        if let Some(c) = code {
            let c = c.trim();
            if c.len() != 2 || !c.chars().all(|ch| ch.is_ascii_digit()) {
                issues.push(warn(format!("{label} is not a 2-digit GST code")));
            }
        }
    }
    if let Some(e) = &r.email {
        if !e.contains('@') {
            issues.push(warn("Email missing @".to_string()));
        }
    }
    issues
}
```

- [ ] **Step 5: Register the module**

In `src-tauri/src/services/mod.rs` add:

```rust
pub mod customer_import_service;
```

- [ ] **Step 6: Run tests**

Run: `cd src-tauri && cargo test customer_import_service -- --nocapture`
Expected: PASS — all four validate tests green.

- [ ] **Step 7: Commit**

```bash
cd "D:/Sales Monitoring System"
cargo fmt --manifest-path src-tauri/Cargo.toml
git add src-tauri/src
git commit -m "feat: customer master import parse + row validation service"
```

---

## Task 7: Import preview/commit commands (auditable upsert pipeline)

**Files:**
- Create: `src-tauri/src/commands/customer_import_commands.rs`
- Modify: `src-tauri/src/commands/mod.rs` (add `pub mod customer_import_commands;`)
- Modify: `src-tauri/src/services/customer_import_service.rs` (add `preview` + `commit` fns operating on a `Connection`)
- Modify: `src-tauri/src/lib.rs` (register commands)
- Modify: `src/services/api.ts`
- Test: `src-tauri/src/services/customer_import_service.rs` (`#[cfg(test)]` upsert tests)

**Interfaces:**
- Consumes: `parse_customer_sheet`, `validate_row`, DTOs (Task 6); `compute_file_hash` from `crate::utils::hash`.
- Produces: `fn commit_import(conn: &mut Connection, file_path: &str, user: &str) -> Result<CustomerImportResult, AppError>`.
- Produces: `fn preview_import(conn: &Connection, file_path: &str) -> Result<CustomerImportPreview, AppError>`.
- Produces: commands `preview_customer_master_import(file_path) -> CustomerImportPreview`, `commit_customer_master_import(file_path, user) -> CustomerImportResult`.

- [ ] **Step 1: Write the failing upsert test**

Add to the `tests` module in `customer_import_service.rs` a helper that builds a DB and drives `commit_import` through an in-memory xlsx substitute. Since writing an xlsx in a unit test is heavy, test the **upsert core** directly by extracting it. Add this test:

```rust
    use rusqlite::Connection;
    use crate::database::migrate::run_migrations;

    fn db() -> Connection {
        let mut c = Connection::open_in_memory().unwrap();
        run_migrations(&mut c).unwrap();
        c
    }

    #[test]
    fn upsert_inserts_new_then_updates_keeping_blanks() {
        let mut conn = db();

        let insert_row = ParsedCustomerRow {
            row_no: 2, code: Some("C1".into()), report_name: Some("First Name".into()),
            tally: Some("Tally One".into()), legal: None, gstin: Some("33AAACH2364M1ZM".into()),
            address1: Some("Addr 1".into()), address2: None, location: None, pincode: None,
            state_code: Some("33".into()), place_of_supply: None, phone: None, email: None,
            status: None, remarks: None,
        };
        upsert_row(&conn, &insert_row, false).unwrap();

        // Update with blank report_name + blank gstin -> must keep existing values.
        let update_row = ParsedCustomerRow {
            row_no: 3, code: Some("C1".into()), report_name: None,
            tally: Some("Tally CHANGED".into()), legal: None, gstin: None,
            address1: None, address2: None, location: Some("CityX".into()), pincode: None,
            state_code: None, place_of_supply: None, phone: None, email: None,
            status: None, remarks: None,
        };
        upsert_row(&conn, &update_row, true).unwrap();

        let (name, tally, gstin, location): (String, String, String, String) = conn
            .query_row(
                "SELECT report_name, tally_customer_name, gstin, location FROM customers WHERE customer_code='C1'",
                [],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)),
            )
            .unwrap();
        assert_eq!(name, "First Name", "blank report_name must keep existing");
        assert_eq!(gstin, "33AAACH2364M1ZM", "blank gstin must keep existing");
        assert_eq!(tally, "Tally CHANGED", "provided value overwrites");
        assert_eq!(location, "CityX", "new value fills previously-null column");
    }
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd src-tauri && cargo test upsert_inserts_new_then_updates_keeping_blanks -- --nocapture`
Expected: FAIL — `upsert_row` not defined.

- [ ] **Step 3: Implement `upsert_row`, `preview_import`, `commit_import`**

Add to `customer_import_service.rs` (production section). Note `upsert_row` uses `COALESCE(?, col)` so blank (`None`) keeps the existing value:

```rust
use rusqlite::{params, Connection};
use crate::models::domain_models::{CustomerImportPreview, CustomerImportResult};
use crate::utils::hash::compute_file_hash;

fn opt(v: &Option<String>) -> Option<String> {
    v.as_ref().map(|s| s.trim()).filter(|s| !s.is_empty()).map(|s| s.to_string())
}

/// Inserts a new customer or updates an existing one by customer_code.
/// On update, NULL (blank) values keep the existing column via COALESCE.
pub fn upsert_row(conn: &Connection, r: &ParsedCustomerRow, exists: bool) -> Result<(), AppError> {
    let code = r.code.as_ref().map(|s| s.trim().to_string()).unwrap_or_default();
    if exists {
        conn.execute(
            "UPDATE customers SET
                report_name = COALESCE(?, report_name),
                tally_customer_name = COALESCE(?, tally_customer_name),
                legal_name = COALESCE(?, legal_name),
                gstin = COALESCE(?, gstin),
                address1 = COALESCE(?, address1),
                address2 = COALESCE(?, address2),
                location = COALESCE(?, location),
                pincode = COALESCE(?, pincode),
                state_code = COALESCE(?, state_code),
                place_of_supply = COALESCE(?, place_of_supply),
                phone = COALESCE(?, phone),
                email = COALESCE(?, email),
                remarks = COALESCE(?, remarks),
                status = COALESCE(?, status)
             WHERE customer_code = ?",
            params![
                opt(&r.report_name), opt(&r.tally), opt(&r.legal), opt(&r.gstin),
                opt(&r.address1), opt(&r.address2), opt(&r.location), opt(&r.pincode),
                opt(&r.state_code), opt(&r.place_of_supply), opt(&r.phone), opt(&r.email),
                opt(&r.remarks), opt(&r.status), code,
            ],
        ).map_err(|e| AppError::Db { code: "ERR_DB_003".to_string(), message: format!("Update failed for {code}: {e}") })?;
    } else {
        conn.execute(
            "INSERT INTO customers
                (customer_code, report_name, tally_customer_name, legal_name, gstin, address1, address2,
                 location, pincode, state_code, place_of_supply, phone, email, remarks, status)
             VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?, COALESCE(?, 'Approved'))",
            params![
                code, opt(&r.report_name), opt(&r.tally), opt(&r.legal), opt(&r.gstin),
                opt(&r.address1), opt(&r.address2), opt(&r.location), opt(&r.pincode),
                opt(&r.state_code), opt(&r.place_of_supply), opt(&r.phone), opt(&r.email),
                opt(&r.remarks), opt(&r.status),
            ],
        ).map_err(|e| AppError::Db { code: "ERR_DB_003".to_string(), message: format!("Insert failed for {code}: {e}") })?;
    }
    Ok(())
}

fn code_exists(conn: &Connection, code: &str) -> bool {
    conn.query_row(
        "SELECT EXISTS(SELECT 1 FROM customers WHERE customer_code = ?)",
        [code], |r| r.get::<_, bool>(0),
    ).unwrap_or(false)
}

pub fn preview_import(conn: &Connection, file_path: &str) -> Result<CustomerImportPreview, AppError> {
    let rows = parse_customer_sheet(file_path)?;
    let file_name = Path::new(file_path.trim().trim_matches('"')).file_name()
        .map(|s| s.to_string_lossy().to_string()).unwrap_or_default();

    let (mut to_insert, mut to_update) = (0u32, 0u32);
    let (mut errors, mut warnings) = (Vec::new(), Vec::new());
    for r in &rows {
        let exists = r.code.as_ref().map(|c| code_exists(conn, c.trim())).unwrap_or(false);
        let issues = validate_row(r, exists);
        let has_error = issues.iter().any(|i| i.severity == "error");
        for i in issues {
            if i.severity == "error" { errors.push(i); } else { warnings.push(i); }
        }
        if has_error { continue; }
        if exists { to_update += 1; } else { to_insert += 1; }
    }
    Ok(CustomerImportPreview {
        file_name, row_count: rows.len() as u32, to_insert, to_update, errors, warnings,
    })
}

pub fn commit_import(conn: &mut Connection, file_path: &str, user: &str) -> Result<CustomerImportResult, AppError> {
    let start = std::time::Instant::now();
    let clean = file_path.trim().trim_matches('"').trim_matches('\'');
    let path = Path::new(clean);
    let file_hash = compute_file_hash(path)
        .map_err(|e| AppError::Excel(format!("Failed to hash file: {e}")))?;

    let dup: bool = conn.query_row(
        "SELECT EXISTS(SELECT 1 FROM import_batches WHERE file_hash = ? AND status = 'completed')",
        [&file_hash], |r| r.get(0),
    ).unwrap_or(false);
    if dup {
        return Err(AppError::Validation {
            code: "ERR_CM_DUP".to_string(),
            message: "This file was already imported.".to_string(),
        });
    }

    let rows = parse_customer_sheet(clean)?;
    let file_name = path.file_name().map(|s| s.to_string_lossy().to_string()).unwrap_or_default();
    let file_size = std::fs::metadata(path).map(|m| m.len() as i64).unwrap_or(0);

    let tx = conn.transaction().map_err(|e| AppError::Db {
        code: "ERR_DB_003".to_string(), message: format!("Failed to begin import tx: {e}"),
    })?;

    tx.execute(
        "INSERT INTO import_batches (source_type, file_name, file_size_bytes, file_hash, row_count, imported_by, status)
         VALUES ('customer_master', ?, ?, ?, ?, ?, 'staged')",
        params![file_name, file_size, file_hash, rows.len() as i64, user],
    ).map_err(|e| AppError::Db { code: "ERR_DB_003".to_string(), message: format!("Failed to create batch: {e}") })?;
    let batch_id = tx.last_insert_rowid();

    let (mut inserted, mut updated, mut skipped, mut warning_count) = (0u32, 0u32, 0u32, 0u32);
    let mut errors = Vec::new();

    for r in &rows {
        let exists = r.code.as_ref().map(|c| code_exists(&tx, c.trim())).unwrap_or(false);
        let issues = validate_row(r, exists);
        for i in &issues {
            tx.execute(
                "INSERT INTO validation_exceptions (level, batch_id, row_no, invoice_no, severity, exception_type, field_name, expected_value, actual_value)
                 VALUES ('row', ?, ?, NULL, ?, 'customer_master', NULL, NULL, ?)",
                params![batch_id, i.row_no, i.severity, i.message],
            ).ok();
            if i.severity == "warning" { warning_count += 1; }
        }
        if issues.iter().any(|i| i.severity == "error") {
            skipped += 1;
            errors.extend(issues.into_iter().filter(|i| i.severity == "error"));
            continue;
        }
        upsert_row(&tx, r, exists)?;
        if exists { updated += 1; } else { inserted += 1; }
    }

    let duration = start.elapsed().as_millis() as i64;
    tx.execute(
        "UPDATE import_batches SET success_count=?, warning_count=?, error_count=?, duration_ms=?, status='completed' WHERE id=?",
        params![(inserted + updated) as i64, warning_count as i64, skipped as i64, duration, batch_id],
    ).map_err(|e| AppError::Db { code: "ERR_DB_003".to_string(), message: format!("Failed to finalize batch: {e}") })?;

    tx.commit().map_err(|e| AppError::Db { code: "ERR_DB_003".to_string(), message: format!("Failed to commit import: {e}") })?;

    Ok(CustomerImportResult { batch_id, inserted, updated, skipped, errors })
}
```

- [ ] **Step 4: Run tests**

Run: `cd src-tauri && cargo test customer_import_service -- --nocapture`
Expected: PASS — `upsert_inserts_new_then_updates_keeping_blanks` and the Task 6 tests all green.

- [ ] **Step 5: Create the Tauri command wrappers**

Create `src-tauri/src/commands/customer_import_commands.rs`:

```rust
use crate::error::AppError;
use crate::models::domain_models::{CustomerImportPreview, CustomerImportResult};
use crate::services::customer_import_service::{commit_import, preview_import};
use crate::state::DbState;
use tauri::State;

#[tauri::command]
pub fn preview_customer_master_import(
    state: State<'_, DbState>,
    file_path: String,
) -> Result<CustomerImportPreview, AppError> {
    let guard = state.conn.lock()
        .map_err(|e| AppError::Internal(format!("lock: {e}")))?;
    let conn = guard.as_ref().ok_or_else(|| AppError::Db {
        code: "ERR_DB_002".to_string(), message: "No active database connection profile".to_string(),
    })?;
    preview_import(conn, &file_path)
}

#[tauri::command]
pub fn commit_customer_master_import(
    state: State<'_, DbState>,
    file_path: String,
    user: String,
) -> Result<CustomerImportResult, AppError> {
    let mut guard = state.conn.lock()
        .map_err(|e| AppError::Internal(format!("lock: {e}")))?;
    let conn = guard.as_mut().ok_or_else(|| AppError::Db {
        code: "ERR_DB_002".to_string(), message: "No active database connection profile".to_string(),
    })?;
    commit_import(conn, &file_path, &user)
}
```

- [ ] **Step 6: Register module + commands**

In `src-tauri/src/commands/mod.rs` add `pub mod customer_import_commands;`. In `src-tauri/src/lib.rs` `generate_handler!` add:

```rust
            commands::customer_import_commands::preview_customer_master_import,
            commands::customer_import_commands::commit_customer_master_import,
```

- [ ] **Step 7: Run full backend suite**

Run: `cd src-tauri && cargo test`
Expected: PASS — everything compiles and all tests green; bindings for the 3 import DTOs generated.

- [ ] **Step 8: Update `api.ts`**

```ts
import { CustomerImportPreview } from "../types/bindings/CustomerImportPreview";
import { CustomerImportResult } from "../types/bindings/CustomerImportResult";
export type { CustomerImportPreview, CustomerImportResult };
```
```ts
  static async previewCustomerMasterImport(filePath: string): Promise<CustomerImportPreview> {
    return await invoke<CustomerImportPreview>("preview_customer_master_import", { filePath });
  }
  static async commitCustomerMasterImport(filePath: string, user: string): Promise<CustomerImportResult> {
    return await invoke<CustomerImportResult>("commit_customer_master_import", { filePath, user });
  }
```

- [ ] **Step 9: Commit**

```bash
cd "D:/Sales Monitoring System"
cargo fmt --manifest-path src-tauri/Cargo.toml
git add src-tauri/src src/services/api.ts src/types/bindings/CustomerImport*.ts
git commit -m "feat: customer master import preview/commit commands with auditable pipeline"
```

---

## Task 8: Frontend — extract CustomerMaster component set and wire into App

**Files:**
- Create: `src/components/CustomerMaster/CustomerMasterTab.tsx`
- Create: `src/components/CustomerMaster/CustomerDetailForm.tsx`
- Create: `src/components/CustomerMaster/CustomerImportPanel.tsx`
- Modify: `src/App.tsx` (mount tab; remove old inline Customer Matching JSX + now-dead handlers/state)
- Verify: `npm run build`

**Interfaces:**
- Consumes: `ApiService.getCustomerMaster`, `createCustomerMaster`, `updateCustomerMaster`, `bulkUpdateCustomerMappings`, `getCustomerCategories`, `createCustomerCategory`, `deleteCustomerCategory`, `previewCustomerMasterImport`, `commitCustomerMasterImport`; types `CustomerMasterRow`, `CustomerMasterPayload`, `CustomerCategoryRow`, `CustomerImportPreview`.

- [ ] **Step 1: Create the detail form**

Create `src/components/CustomerMaster/CustomerDetailForm.tsx`:

```tsx
import { useState } from "react";
import { CustomerMasterRow } from "../../types/bindings/CustomerMasterRow";
import { CustomerCategoryRow } from "../../types/bindings/CustomerCategoryRow";
import { ApiService, CustomerMasterPayload } from "../../services/api";

interface Props {
  initial: CustomerMasterRow | null; // null = create mode
  categories: CustomerCategoryRow[];
  onClose: () => void;
  onSaved: () => void;
}

const EMPTY: CustomerMasterPayload = {
  id: null, customer_code: "", report_name: "", tally_name: null, legal_name: null,
  gstin: null, address1: null, address2: null, location: null, pincode: null,
  state_code: null, place_of_supply: null, phone: null, email: null,
  category_name: null, remarks: null, status: "Approved",
};

function toPayload(r: CustomerMasterRow): CustomerMasterPayload {
  return {
    id: r.id, customer_code: r.customer_code, report_name: r.report_name,
    tally_name: r.tally_name, legal_name: r.legal_name, gstin: r.gstin,
    address1: r.address1, address2: r.address2, location: r.location, pincode: r.pincode,
    state_code: r.state_code, place_of_supply: r.place_of_supply, phone: r.phone,
    email: r.email, category_name: r.category_name, remarks: r.remarks,
    status: r.status === "Pending_Review" ? "Pending_Review" : "Approved",
  };
}

export default function CustomerDetailForm({ initial, categories, onClose, onSaved }: Props) {
  const [form, setForm] = useState<CustomerMasterPayload>(initial ? toPayload(initial) : EMPTY);
  const [saving, setSaving] = useState(false);
  const isCreate = initial === null;

  const set = (k: keyof CustomerMasterPayload, v: string) =>
    setForm((f) => ({ ...f, [k]: v === "" ? (k === "customer_code" || k === "report_name" || k === "status" ? v : null) : v }));

  const handleSave = async () => {
    setSaving(true);
    try {
      if (isCreate) await ApiService.createCustomerMaster(form);
      else await ApiService.updateCustomerMaster(form);
      onSaved();
      onClose();
    } catch (err: any) {
      alert(`Save failed: ${err.message || err}`);
    } finally {
      setSaving(false);
    }
  };

  const field = (label: string, k: keyof CustomerMasterPayload, required = false) => (
    <label className="flex flex-col gap-1 text-xs">
      <span className="text-slate-400">{label}{required && <span className="text-rose-400"> *</span>}</span>
      <input
        value={(form[k] as string | null) ?? ""}
        onChange={(e) => set(k, e.target.value)}
        className="bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-slate-200 focus:outline-none focus:border-indigo-500"
      />
    </label>
  );

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex justify-end" onClick={onClose}>
      <div className="w-[560px] h-full bg-slate-900 border-l border-slate-800 overflow-y-auto p-6 space-y-6" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-lg font-bold text-slate-100">{isCreate ? "Add Customer" : `Edit ${form.customer_code}`}</h3>

        <section className="space-y-3">
          <h4 className="text-[11px] uppercase tracking-wide text-indigo-400 font-bold">Identity</h4>
          {field("Customer Code", "customer_code", true)}
          {field("Report Name", "report_name", true)}
          {field("Tally Name", "tally_name")}
          {field("Legal Name", "legal_name")}
          {field("GSTIN", "gstin")}
        </section>

        <section className="space-y-3">
          <h4 className="text-[11px] uppercase tracking-wide text-indigo-400 font-bold">Address</h4>
          {field("Address 1", "address1")}
          {field("Address 2", "address2")}
          {field("Location", "location")}
          {field("Pincode", "pincode")}
          {field("State Code (GST)", "state_code")}
          {field("Place of Supply (GST)", "place_of_supply")}
        </section>

        <section className="space-y-3">
          <h4 className="text-[11px] uppercase tracking-wide text-indigo-400 font-bold">Contact</h4>
          {field("Phone", "phone")}
          {field("Email", "email")}
        </section>

        <section className="space-y-3">
          <h4 className="text-[11px] uppercase tracking-wide text-indigo-400 font-bold">Meta</h4>
          <label className="flex flex-col gap-1 text-xs">
            <span className="text-slate-400">Category</span>
            <select
              value={form.category_name ?? ""}
              onChange={(e) => set("category_name", e.target.value)}
              className="bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-slate-200"
            >
              <option value="">Uncategorized</option>
              {categories.map((c) => <option key={c.id} value={c.name}>{c.name}</option>)}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-xs">
            <span className="text-slate-400">Status</span>
            <select
              value={form.status}
              onChange={(e) => setForm((f) => ({ ...f, status: e.target.value === "Pending_Review" ? "Pending_Review" : "Approved" }))}
              className="bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-slate-200"
            >
              <option value="Approved">Approved</option>
              <option value="Pending_Review">Pending Review</option>
            </select>
          </label>
          {field("Remarks", "remarks")}
        </section>

        <div className="flex gap-3 pt-2">
          <button onClick={handleSave} disabled={saving} className="bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold px-5 py-2 rounded-lg disabled:opacity-50">
            {saving ? "Saving…" : "Save"}
          </button>
          <button onClick={onClose} className="bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold px-5 py-2 rounded-lg">Cancel</button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Create the import panel**

Create `src/components/CustomerMaster/CustomerImportPanel.tsx`:

```tsx
import { useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { ApiService } from "../../services/api";
import { CustomerImportPreview } from "../../types/bindings/CustomerImportPreview";

interface Props {
  onClose: () => void;
  onImported: () => void;
}

export default function CustomerImportPanel({ onClose, onImported }: Props) {
  const [filePath, setFilePath] = useState("");
  const [preview, setPreview] = useState<CustomerImportPreview | null>(null);
  const [busy, setBusy] = useState(false);

  const pick = async () => {
    const sel = await open({ multiple: false, filters: [{ name: "Excel & CSV", extensions: ["xlsx", "xls", "csv"] }] });
    if (!sel) return;
    const p = (Array.isArray(sel) ? sel[0] : sel) as string;
    setFilePath(p);
    setPreview(null);
    setBusy(true);
    try {
      setPreview(await ApiService.previewCustomerMasterImport(p));
    } catch (err: any) {
      alert(`Preview failed: ${err.message || err}`);
    } finally {
      setBusy(false);
    }
  };

  const commit = async () => {
    setBusy(true);
    try {
      const res = await ApiService.commitCustomerMasterImport(filePath, "System User");
      alert(`Imported: ${res.inserted} new, ${res.updated} updated, ${res.skipped} skipped.`);
      onImported();
      onClose();
    } catch (err: any) {
      alert(`Import failed: ${err.message || err}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center" onClick={onClose}>
      <div className="w-[520px] bg-slate-900 border border-slate-800 rounded-xl p-6 space-y-4" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-lg font-bold text-slate-100">Import Customer Master</h3>
        <button onClick={pick} className="bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold px-4 py-2 rounded-lg">Select Excel / CSV…</button>
        {filePath && <p className="text-[11px] text-slate-500 truncate">{filePath}</p>}
        {busy && <p className="text-xs text-indigo-400">Working…</p>}
        {preview && (
          <div className="bg-slate-950 border border-slate-800 rounded-lg p-4 text-xs text-slate-300 space-y-1">
            <div>Rows: <strong>{preview.row_count}</strong></div>
            <div>To insert: <strong className="text-emerald-400">{preview.to_insert}</strong></div>
            <div>To update: <strong className="text-indigo-400">{preview.to_update}</strong></div>
            <div>Errors: <strong className="text-rose-400">{preview.errors.length}</strong>, Warnings: <strong className="text-amber-400">{preview.warnings.length}</strong></div>
          </div>
        )}
        <div className="flex gap-3">
          <button onClick={commit} disabled={!preview || busy || preview.to_insert + preview.to_update === 0} className="bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold px-5 py-2 rounded-lg disabled:opacity-50">Confirm Import</button>
          <button onClick={onClose} className="bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold px-5 py-2 rounded-lg">Close</button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Create the tab container**

Create `src/components/CustomerMaster/CustomerMasterTab.tsx`:

```tsx
import { useEffect, useState } from "react";
import { ApiService, CustomerCategoryRow } from "../../services/api";
import { CustomerMasterRow } from "../../types/bindings/CustomerMasterRow";
import CustomerDetailForm from "./CustomerDetailForm";
import CustomerImportPanel from "./CustomerImportPanel";

export default function CustomerMasterTab() {
  const [rows, setRows] = useState<CustomerMasterRow[]>([]);
  const [categories, setCategories] = useState<CustomerCategoryRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState<CustomerMasterRow | null | undefined>(undefined); // undefined=closed, null=create
  const [showImport, setShowImport] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const [r, c] = await Promise.all([ApiService.getCustomerMaster(), ApiService.getCustomerCategories()]);
      setRows(r);
      setCategories(c);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const filtered = rows.filter((r) =>
    r.customer_code.toLowerCase().includes(search.toLowerCase()) ||
    r.report_name.toLowerCase().includes(search.toLowerCase())
  );

  const pill = (s: string) =>
    s === "Complete" ? "bg-emerald-500/10 text-emerald-400"
    : s === "Incomplete" ? "bg-amber-500/10 text-amber-400"
    : "bg-rose-500/10 text-rose-400";

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4 bg-slate-900 border border-slate-800 p-4 rounded-xl">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search code or name…"
          className="bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-xs text-slate-200 w-72 focus:outline-none focus:border-indigo-500"
        />
        <div className="flex gap-2">
          <button onClick={() => setShowImport(true)} className="bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold px-4 py-2 rounded-lg">Import Customer Master</button>
          <button onClick={() => setEditing(null)} className="bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold px-4 py-2 rounded-lg">+ Add Customer</button>
        </div>
      </div>

      <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden">
        <table className="w-full text-left text-xs">
          <thead>
            <tr className="bg-slate-950 text-slate-400 font-bold border-b border-slate-800">
              <th className="p-3">Code</th><th className="p-3">Report Name</th><th className="p-3">Tally Name</th>
              <th className="p-3">GSTIN</th><th className="p-3">Location</th><th className="p-3">Status</th><th className="p-3"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800/60">
            {loading ? (
              <tr><td colSpan={7} className="p-8 text-center text-slate-500">Loading…</td></tr>
            ) : filtered.length === 0 ? (
              <tr><td colSpan={7} className="p-8 text-center text-slate-500">No customers.</td></tr>
            ) : filtered.map((r) => (
              <tr key={r.id} className="hover:bg-slate-800/35 cursor-pointer" onDoubleClick={() => setEditing(r)}>
                <td className="p-3 font-mono text-indigo-400">{r.customer_code}</td>
                <td className="p-3 text-slate-200">{r.report_name}</td>
                <td className="p-3 text-slate-300">{r.tally_name ?? "—"}</td>
                <td className="p-3 text-slate-400">{r.gstin ?? "—"}</td>
                <td className="p-3 text-slate-400">{r.location ?? "—"}</td>
                <td className="p-3"><span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold ${pill(r.match_status)}`}>{r.match_status}</span></td>
                <td className="p-3 text-right"><button onClick={() => setEditing(r)} className="text-slate-400 hover:text-slate-100">Edit</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {editing !== undefined && (
        <CustomerDetailForm initial={editing} categories={categories} onClose={() => setEditing(undefined)} onSaved={load} />
      )}
      {showImport && <CustomerImportPanel onClose={() => setShowImport(false)} onImported={load} />}
    </div>
  );
}
```

- [ ] **Step 4: Mount the tab in App.tsx and remove the old inline block**

In `src/App.tsx`:
1. Add `import CustomerMasterTab from "./components/CustomerMaster/CustomerMasterTab";`.
2. Replace the entire `{activeTab === "customer_matching" && ( … )}` block with:

```tsx
          {activeTab === "customer_matching" && <CustomerMasterTab />}
```
3. Rename the sidebar label "Customer Matching" → "Customer Master" (the button text under the `Users` icon).
4. Delete now-dead state/handlers used only by the old block: `customerMappings`, `loadingCustomerMappings`, `categories`, `isCategoryModalOpen`, `newCatName`, `newCatDesc`, `isCreatingCategory`, `categoryFilter`, and the functions `loadCustomerMappings`, `handleTallyNameInputChange`, `handleCategoryInputChange`, `handleCreateCategory`, `handleDeleteCategory`, `handleSaveCustomerMapping`, `handleAutoFillDefaultTallyNames`, `handleBulkSaveCustomerMappings`, plus the `customer_matching` branch in the navigation `useEffect` (the tab now self-loads). Leave category-modal JSX only if it lived outside the removed block — if it references deleted state, remove it too.

- [ ] **Step 5: Build to verify**

Run: `cd "D:/Sales Monitoring System" && npm run build`
Expected: PASS — `tsc` reports no unused-symbol or type errors, `vite build` completes. Fix any remaining references to deleted handlers/state that `tsc` flags.

- [ ] **Step 6: Commit**

```bash
cd "D:/Sales Monitoring System"
git add src/components/CustomerMaster src/App.tsx
git commit -m "feat: extract Customer Master tab with detail form and import panel"
```

---

## Self-Review

**Spec coverage:**
- §3.1 columns → Task 1 (v4). §3.2 v4/v5 rebuilds → Tasks 1, 2. §3.3 migrate.rs enhancement → Task 1. §4.1 DTO + match_status → Task 4. §4.2 command surface (rename/replace/remove/new) → Tasks 4, 5, 7. §4.3 validation → Task 5. §4.4 rename fan-out → Task 3. §5 importer (fixed columns, preview/commit, hash dedup, import_batches, validation_exceptions level='row', COALESCE keep-existing) → Tasks 6, 7. §6 frontend (tab rename, list, detail form, import, extraction) → Task 8. §7 error handling → Tasks 5, 7. §8 testing → tests embedded per task. All covered.
- "Download template" (§6) is intentionally omitted from tasks as a minor nice-to-have to keep scope tight; add later if wanted. (Noted so it's a conscious deferral, not a gap.)

**Placeholder scan:** No TBD/TODO; every code step shows full code; commands and expected outputs are concrete.

**Type consistency:** `CustomerMasterRow` fields match between Task 4 (DTO), Task 5 (payload mirrors it), and Task 8 (`toPayload`). `ParsedCustomerRow` field names (`code`, `report_name`, `tally`, `legal`, …) are identical across Tasks 6 and 7. `upsert_row(conn, row, exists)`, `validate_row(row, exists)`, `preview_import(conn, path)`, `commit_import(&mut conn, path, user)` signatures match their call sites. `derive_match_status` order (tally, gstin, address1, state_code) is consistent between Task 4 definition and the `get_customer_master` call.
