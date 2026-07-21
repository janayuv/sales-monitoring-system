# Customer Master — Design Spec

**Date:** 2026-07-21
**Branch context:** `feature/phase5-reports`
**Status:** Approved design, pending implementation plan

## 1. Summary

Expand the existing **Customer Matching** feature (a thin report-name ↔ tally-name
mapping) into a full **Customer Master**: an editable customer record carrying legal
name, GSTIN, full address, place of supply, contact details, category, and remarks.
Data enters two ways — a bulk customer-master file import **and** manual per-customer
editing in the UI. Categories and the match-status pill from the current screen are
retained.

### Target record shape (source example)

```json
{
  "customer_code": "CUS000001",
  "report_name": "HYUNDAI MOTOR INDIA LIMITED PLANT II",
  "tally_name": "HYUNDAI MOTOR INDIA LIMITED PLANT II",
  "gstin": "33AAACH2364M1ZM",
  "legal_name": "HYUNDAI MOTOR INDIA LIMITED PLANT II",
  "address1": "H-1 SIPCOT INDUSTRIAL ESTATE",
  "address2": "IRRUNGATTUKOTTAI",
  "location": "KANCHEEPURAM",
  "pincode": "602117",
  "place_of_supply": "33",
  "state_code": "33",
  "phone": "",
  "email": "",
  "status": "Approved",
  "remarks": ""
}
```

## 2. Decisions Log

| # | Decision | Choice |
|---|----------|--------|
| 1 | Purpose | Complete, standalone customer master (record-keeping/reference) — not export-driven |
| 2 | Data entry | Both: bulk file import **and** manual per-customer editing |
| 3 | Categories & match-status | Keep both |
| 4 | State representation | `state_code` / `place_of_supply` stored as free-text 2-digit GST codes (e.g. `"33"`), no foreign key |
| 5 | `customer_name` → `report_name` | Real physical column rename (done inside the v4 rebuild) — clarifies import-matching intent |
| 6 | Importer style | Dedicated, fixed-column importer (not the template-mapping wizard) |
| 7 | Blank cells on update | Keep existing value (non-destructive partial updates) |
| 8 | Import tracking | Full auditable pipeline (`import_batches` + hash dedup + `validation_exceptions`) |
| 9 | UI | Rename tab to "Customer Master"; list + detail form; extract into its own component set |
| 10 | Unused commands | Remove `update_customer_tally_name`, `bulk_update_customer_tally_names` |
| 11 | Frontend tests | None added — repo has no JS harness; rely on ts-rs bindings + tsc/build + manual |

## 3. Data Model

### 3.1 `customers` — target physical columns

| Column | Type | Notes |
|--------|------|-------|
| `id` | INTEGER PK | unchanged — invoices/credit_notes join on this; ids preserved across rebuild |
| `customer_code` | TEXT NOT NULL UNIQUE | required; dedup key for import |
| `report_name` | TEXT NOT NULL | **renamed** from `customer_name`; name as it appears in the sales report |
| `tally_customer_name` | TEXT | exposed as `tally_name` |
| `legal_name` | TEXT | new |
| `gstin` | TEXT | existing |
| `address1` | TEXT | existing `address` migrates into this |
| `address2` | TEXT | new |
| `location` | TEXT | new |
| `pincode` | TEXT | new |
| `state_code` | TEXT | **FK dropped**; free-text GST numeric ("33") |
| `place_of_supply` | TEXT | new; free-text GST numeric |
| `phone` | TEXT | new |
| `email` | TEXT | new |
| `category_name` | TEXT | existing (categories kept) |
| `remarks` | TEXT | new |
| `status` | TEXT NOT NULL | existing; `CHECK(status IN ('Approved','Pending_Review'))`, default `Approved` |

`idx_customers_code` recreated after the rebuild.

**Required fields:** `customer_code`, `report_name`. All others nullable, so a customer
auto-created during ERP import (code + name only) remains valid, just "Incomplete".

### 3.2 Migrations

Both are **table rebuilds** (SQLite cannot `ALTER` a foreign key or a CHECK constraint
in place). They require a `migrate.rs` enhancement (see 3.3).

**v4 — rebuild `customers`:**
1. `PRAGMA foreign_keys=OFF`
2. `BEGIN`
3. `CREATE TABLE customers_new (...)` with the target shape (no `state_code` FK)
4. Copy all rows: `customer_name → report_name`, `address → address1`, other new columns
   default NULL, **preserving `id`**
5. `DROP TABLE customers`
6. `ALTER TABLE customers_new RENAME TO customers`
7. Recreate `idx_customers_code`
8. `PRAGMA foreign_key_check` (abort on violation)
9. `COMMIT`
10. `PRAGMA foreign_keys=ON`

**v5 — rebuild `import_batches`:** identical procedure, widening the CHECK to
`source_type IN ('erp_sales_report','gstr1_report','customer_master')`. `import_batches`
is referenced by `invoices.import_batch_id` (ON DELETE SET NULL) and
`validation_exceptions.batch_id` (ON DELETE CASCADE); ids preserved, `foreign_key_check`
run before commit.

### 3.3 `migrate.rs` enhancement

Add a rebuild-capable path. Add `requires_rebuild: bool` (or equivalent) to `Migration`.
For rebuild migrations, run **outside** the standard per-migration transaction wrapper:
set `PRAGMA foreign_keys=OFF`, open a transaction, execute the rebuild SQL + record
`schema_migrations`, run `foreign_key_check`, commit, then restore
`PRAGMA foreign_keys=ON`. Non-rebuild migrations keep the current behavior. (`PRAGMA
foreign_keys` is a no-op inside a transaction, so it must be toggled outside — hence the
special path.)

## 4. Backend

### 4.1 DTO — `CustomerMasterRow` (ts-rs exported)

Replaces the thin `CustomerTallyMappingRow`:

```
id, customer_code, report_name,
tally_name?, legal_name?, gstin?,
address1?, address2?, location?, pincode?,
state_code?, place_of_supply?, phone?, email?,
category_name?, remarks?,
status,          // stored: Approved / Pending_Review
match_status     // DERIVED, not stored
```

**`match_status` derivation (on read):**
- `"Needs Tally name"` — `tally_name` empty
- else `"Incomplete"` — any of `gstin` / `address1` / `state_code` empty
- else `"Complete"`

### 4.2 Command surface (`customer_commands.rs`, `lib.rs`, `api.ts`)

| Command | Change | Purpose |
|---------|--------|---------|
| `get_customer_master` | renamed from `get_customer_tally_mappings`; returns full rows | list for master screen |
| `update_customer_master(payload)` | replaces `update_customer_mapping` | save one full record from detail form |
| `create_customer_master(payload)` | new | manually add a customer |
| `bulk_save_customer_mappings` | keep (was `bulk_update_customer_mappings`) | inline quick-save of tally name + category |
| `get_customer_categories` / `create_customer_category` / `delete_customer_category` | unchanged | categories retained |
| `update_customer_tally_name` | **removed** | unused by UI |
| `bulk_update_customer_tally_names` | **removed** | unused by UI |
| `preview_customer_master_import` / `commit_customer_master_import` | new (see §5) | file import |

### 4.3 Validation (create / update)

- `customer_code`, `report_name` required and trimmed; empty strings → NULL for optionals.
- `customer_code` unique (DB constraint → friendly error on conflict).
- If present: `gstin` 15 chars; `pincode` 6 digits; `state_code` / `place_of_supply` 2 digits; `email` contains `@`.

### 4.4 Model / repo fan-out (from the rename)

- `CustomerRow.customer_name → report_name` in `database_models.rs`; update `master_repo.rs`
  SQL. `master_repo` stays a thin legacy path writing only core columns (new columns
  default NULL). Full 16-field writes are hand-written SQL in `customer_commands.rs`
  (consistent with how that file already works).
- SQL sites updated for the column rename: `import_commands.rs:272`,
  `export_commands.rs:101/210/520/762`, `invoice_commands.rs:377`,
  `customer_commands.rs:190`, `master_repo.rs:12/25/38/62`, `invoice_repo.rs:123`,
  `report_repo.rs:152` (test fixture).
- **Deliberately unchanged:** `InvoiceSummary.customer_name` (invoice-register display
  field, populated from `report_name` via join); the ERP-import mapping key
  `'customer_name'` in `import_service.rs:339` / `0001_init.sql:412` (sales-report column
  alias, not the master column).

## 5. Customer Master Importer

Dedicated fixed-column importer (Excel/CSV), full auditable pipeline.

**Expected columns** (case-insensitive, tolerant header matching like `import_service`):
the 15 keys from the sample record. Mandatory: `customer_code` (and `report_name` for new
customers). Reuses the calamine-based sheet reader from `import_service` (factor a small
shared helper if needed).

**Commands:**
- `preview_customer_master_import(file_path)` → `CustomerImportPreview { file_name, row_count, to_insert, to_update, errors[], warnings[] }` — parse + validate in memory, no writes.
- `commit_customer_master_import(file_path, user)` → `CustomerImportResult { inserted, updated, skipped, errors[] }`.

**Commit behavior (single transaction):**
1. Compute `file_hash` (reuse `utils/hash.rs`). If a `completed` `import_batches` row with
   the same hash exists → reject as duplicate.
2. Insert an `import_batches` row: `source_type='customer_master'`,
   `template_version_id=NULL`, counts filled at the end, `status` transitions to
   `completed`/`failed`.
3. Per row, upsert by `customer_code`:
   - new code → INSERT (blank cells → NULL).
   - existing code → UPDATE using `COALESCE(?, existing_col)` per column so **blank cells
     keep the existing value** (non-destructive partial update).
4. Row-level problems → `validation_exceptions` with `level='row'`, `batch_id` set;
   valid rows still upsert (non-fatal).
5. Duplicate `customer_code` within one file: last row wins; a warning is recorded.

## 6. Frontend

Rename tab **Customer Matching → Customer Master**. Extract into its own component set
under `src/components/CustomerMaster/` (App.tsx is already ~2,860 lines; this avoids
growing it further — a targeted improvement in code we're already touching).

- **List view** (evolves current table): search + category filter + status pill retained.
  Columns: `customer_code`, `report_name`, `tally_name`, `gstin`, `location`,
  `match_status`. Inline edit kept for tally name + category; "Save All Mappings"
  bulk-save (→ `bulk_save_customer_mappings`) retained.
- **Detail form** (new): per-row **Edit** opens a drawer/modal with all 16 fields grouped —
  Identity (code, report/legal name, tally name, GSTIN), Address (address1/2, location,
  pincode, state_code, place_of_supply), Contact (phone, email), Meta (category, status,
  remarks). Save → `update_customer_master`. **"+ Add Customer"** opens the blank form →
  `create_customer_master`.
- **Import** (new): **"Import Customer Master"** → native file pick →
  `preview_customer_master_import` shows a summary card (rows / to-insert / to-update /
  errors) → **Confirm** → `commit_customer_master_import`, then reload. A small
  **"Download template"** link writes a blank CSV of the expected headers client-side
  (like the existing note-register CSV exports).

## 7. Error Handling

Reuses existing `AppError` variants (`Db`, `Validation`, `Export`, `Io`, `Internal`).

- Duplicate `customer_code` on create/insert → friendly "customer code already exists".
- Import file-hash already committed → "this file was already imported".
- Per-row import problems non-fatal — surfaced in preview, written to
  `validation_exceptions` on commit; valid rows still upsert.
- Migration rebuild: `foreign_key_check` before `COMMIT`; failure rolls back, DB untouched.

## 8. Testing

**Backend** (in-memory SQLite + `run_migrations`, matching `report_repo.rs` style):
- v4/v5 rebuild: existing customer rows preserved; `address → address1`; `id`s intact so
  invoice FKs resolve; free-text `state_code="33"` accepted with no FK error.
- Upsert: insert-new; update-existing; blank-cell-keeps-existing (COALESCE);
  duplicate-code-in-file handling.
- `match_status` derivation across all 3 states.
- Field validation (required + gstin/pincode/email/state format).
- File-hash dedup rejects re-commit.

**Frontend:** no JS test harness exists in the repo; correctness rests on the
auto-generated ts-rs bindings (compile-time contract), `tsc` / `vite build`, and manual
verification. No test runner introduced by this feature.

## 9. Out of Scope

- Feeding the new master fields into Tally export / printed documents / invoice GST logic
  (the master is standalone per Decision #1; wiring it into exports can be a later feature).
- Any frontend test-runner setup.
- Changes to the ERP sales importer beyond the `report_name` column rename.
