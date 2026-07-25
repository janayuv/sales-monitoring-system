# Company Profile (GST Master) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a single editable Company Profile record per company DB (the seller "from" party — GST/registration + contact + embedded logo), edited in the Company Settings tab.

**Architecture:** An additive `company_profile` table (single row, `CHECK(id=1)`), backed by `get`/`save` Tauri commands with light validation, plus a backend command that reads a picked image file and returns a base64 data-URL (avoids granting frontend binary-read capability). A `CompanyProfileForm` component is mounted in the existing Settings tab.

**Tech Stack:** Rust + `rusqlite` (SQLCipher), `base64`, Tauri 2 commands, `ts-rs`, React 19 + TypeScript + Tailwind, `@tauri-apps/plugin-dialog`.

**Spec:** `docs/superpowers/specs/2026-07-22-company-profile-design.md`

## Global Constraints

- Rust: run `cargo fmt` before every commit; no `unwrap()`/`expect()` in production code (tests OK); parameterized SQL only.
- Migrations are additive and versioned in `src-tauri/src/database/migrate.rs`; never edit `0001_init.sql` or an already-applied migration. v6 is a plain `CREATE TABLE` with `rebuild: false`.
- All company-profile fields are optional; format checks apply only when a value is present: `gstin` 15 chars, `pan` 10 chars, `pincode` 6 digits, `state_code` 2 digits, `email` contains `@`. Blank strings normalize to NULL.
- Single row enforced by `CHECK(id = 1)` and `save` always targeting `id = 1` via upsert.
- Logo is stored verbatim as a base64 data-URL TEXT; the **backend** reads the image file and enforces a **512 KB** size cap (design refinement over the spec's frontend read — same UX, avoids granting frontend binary-read capability, makes the size guard un-bypassable).
- Backend commands run under `state.conn.lock()`; reads use `.as_ref()`, writes use `.as_ref()` (single-row upsert needs only a shared `&Connection`).
- ts-rs structs export to `../../src/types/bindings/<Name>.ts`; bindings regenerate when `cargo test` runs.
- Frontend has no JS test harness — verify frontend tasks with `npm run build` (`tsc && vite build`).
- Backend test command (this environment): `cd src-tauri && OPENSSL_NO_VENDOR=1 OPENSSL_LIB_DIR="C:/Program Files/OpenSSL-Win64/lib/VC/x64/MD" OPENSSL_INCLUDE_DIR="C:/Program Files/OpenSSL-Win64/include" cargo test`. (The branch's vendored-OpenSSL build needs Perl/NASM that aren't installed; these env vars link the pre-installed OpenSSL instead.)
- Working tree is intentionally dirty (pre-existing phase-5 work). Stage only the files each task lists; never `git add -A`.
- Commit after every task.

---

## File Structure

**Backend (`src-tauri/`):**
- `Cargo.toml` — MODIFY: add `base64 = "0.22"` direct dependency
- `src/database/migrate.rs` — MODIFY: add migration v6 (`company_profile` table)
- `src/models/domain_models.rs` — MODIFY: add `CompanyProfileRow` DTO
- `src/commands/company_commands.rs` — CREATE: `get`/`save` + validation + `read_logo_as_data_url`
- `src/commands/mod.rs`, `src/lib.rs` — MODIFY: module + command registration

**Frontend (`src/`):**
- `services/api.ts` — MODIFY: `CompanyProfilePayload` type + 3 methods
- `components/CompanySettings/CompanyProfileForm.tsx` — CREATE: the profile card
- `App.tsx` — MODIFY: mount `<CompanyProfileForm />` in the Settings tab

---

## Task 1: v6 migration — `company_profile` table

**Files:**
- Modify: `src-tauri/src/database/migrate.rs`
- Test: `src-tauri/src/database/migrate.rs` (`#[cfg(test)]` module)

**Interfaces:**
- Produces: `company_profile` table with columns `id, company_name, legal_name, gstin, pan, address1, address2, location, pincode, state_code, phone, email, logo, updated_at`; single row enforced by `CHECK(id = 1)`.

- [ ] **Step 1: Write the failing test**

Add to the `tests` module in `src-tauri/src/database/migrate.rs`:

```rust
    #[test]
    fn v6_company_profile_table_is_single_row() {
        let mut conn = Connection::open_in_memory().unwrap();
        run_migrations(&mut conn).unwrap();

        // Columns exist.
        let cols = columns(&conn, "company_profile");
        for expected in [
            "company_name", "legal_name", "gstin", "pan", "address1", "address2",
            "location", "pincode", "state_code", "phone", "email", "logo",
        ] {
            assert!(cols.contains(&expected.to_string()), "missing column {expected}");
        }

        // Row 1 inserts fine.
        conn.execute(
            "INSERT INTO company_profile (id, company_name) VALUES (1, 'Acme')",
            [],
        )
        .expect("id=1 row should insert");

        // A second row (id != 1) is rejected by the CHECK constraint.
        let second = conn.execute(
            "INSERT INTO company_profile (id, company_name) VALUES (2, 'Other')",
            [],
        );
        assert!(second.is_err(), "CHECK(id=1) must reject a second row");
    }
```

(The `columns()` helper already exists in this test module from the customer-master migrations.)

- [ ] **Step 2: Run test to verify it fails**

Run: `cd src-tauri && OPENSSL_NO_VENDOR=1 OPENSSL_LIB_DIR="C:/Program Files/OpenSSL-Win64/lib/VC/x64/MD" OPENSSL_INCLUDE_DIR="C:/Program Files/OpenSSL-Win64/include" cargo test --lib database::migrate::tests::v6_company_profile_table_is_single_row -- --nocapture`
Expected: FAIL — `no such table: company_profile`.

- [ ] **Step 3: Add the v6 migration**

Append to the `migrations` vec in `run_migrations` (after v5):

```rust
        Migration {
            version: 6,
            description: "Add company_profile single-row table (company GST master)",
            rebuild: false,
            sql: "
                CREATE TABLE IF NOT EXISTS company_profile (
                    id INTEGER PRIMARY KEY CHECK (id = 1),
                    company_name TEXT,
                    legal_name   TEXT,
                    gstin        TEXT,
                    pan          TEXT,
                    address1     TEXT,
                    address2     TEXT,
                    location     TEXT,
                    pincode      TEXT,
                    state_code   TEXT,
                    phone        TEXT,
                    email        TEXT,
                    logo         TEXT,
                    updated_at   TEXT NOT NULL DEFAULT (datetime('now'))
                );
            ",
        },
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd src-tauri && OPENSSL_NO_VENDOR=1 OPENSSL_LIB_DIR="C:/Program Files/OpenSSL-Win64/lib/VC/x64/MD" OPENSSL_INCLUDE_DIR="C:/Program Files/OpenSSL-Win64/include" cargo test --lib database::migrate -- --nocapture`
Expected: PASS — all migrate tests including `v6_company_profile_table_is_single_row`.

- [ ] **Step 5: Commit**

```bash
cd "D:/Sales Monitoring System"
cargo fmt --manifest-path src-tauri/Cargo.toml
git add src-tauri/src/database/migrate.rs
git commit -m "feat: add company_profile single-row table (v6)"
```

---

## Task 2: Backend — `CompanyProfileRow` DTO, `get`/`save`, validation

**Files:**
- Modify: `src-tauri/src/models/domain_models.rs` (add DTO)
- Create: `src-tauri/src/commands/company_commands.rs`
- Modify: `src-tauri/src/commands/mod.rs` (add `pub mod company_commands;`)
- Modify: `src-tauri/src/lib.rs` (register `get_company_profile`, `save_company_profile`)
- Modify: `src/services/api.ts` (type + 2 methods)
- Test: `src-tauri/src/commands/company_commands.rs` (`#[cfg(test)]`)

**Interfaces:**
- Consumes: `company_profile` table (Task 1).
- Produces: `CompanyProfileRow` DTO (ts-rs), `CompanyProfilePayload` struct, `validate_company_profile(&CompanyProfilePayload) -> Result<(), AppError>`, commands `get_company_profile() -> CompanyProfileRow` and `save_company_profile(payload: CompanyProfilePayload) -> ()`.

- [ ] **Step 1: Add the `CompanyProfileRow` DTO**

In `src-tauri/src/models/domain_models.rs`:

```rust
#[derive(Debug, Serialize, Deserialize, Clone, TS)]
#[ts(export, export_to = "../../src/types/bindings/CompanyProfileRow.ts")]
pub struct CompanyProfileRow {
    pub id: i64,
    pub company_name: Option<String>,
    pub legal_name: Option<String>,
    pub gstin: Option<String>,
    pub pan: Option<String>,
    pub address1: Option<String>,
    pub address2: Option<String>,
    pub location: Option<String>,
    pub pincode: Option<String>,
    pub state_code: Option<String>,
    pub phone: Option<String>,
    pub email: Option<String>,
    pub logo: Option<String>,
}
```

- [ ] **Step 2: Write the failing test**

Create `src-tauri/src/commands/company_commands.rs` with the test module first (plus the imports it needs):

```rust
use crate::error::AppError;
use crate::models::domain_models::CompanyProfileRow;
use crate::state::DbState;
use serde::{Deserialize, Serialize};
use tauri::State;

#[cfg(test)]
mod tests {
    use super::*;

    fn sample() -> CompanyProfilePayload {
        CompanyProfilePayload {
            company_name: Some("Acme Auto Parts".to_string()),
            legal_name: Some("Acme Auto Parts Pvt Ltd".to_string()),
            gstin: Some("33AAACH2364M1ZM".to_string()),
            pan: Some("AAACH2364M".to_string()),
            address1: Some("H-1 SIPCOT".to_string()),
            address2: None,
            location: Some("Kancheepuram".to_string()),
            pincode: Some("602117".to_string()),
            state_code: Some("33".to_string()),
            phone: None,
            email: None,
            logo: None,
        }
    }

    #[test]
    fn validate_accepts_empty_payload() {
        let empty = CompanyProfilePayload {
            company_name: None, legal_name: None, gstin: None, pan: None,
            address1: None, address2: None, location: None, pincode: None,
            state_code: None, phone: None, email: None, logo: None,
        };
        assert!(validate_company_profile(&empty).is_ok());
    }

    #[test]
    fn validate_accepts_valid_payload() {
        assert!(validate_company_profile(&sample()).is_ok());
    }

    #[test]
    fn validate_rejects_bad_gstin_pan_pincode_state_email() {
        let mut p = sample();
        p.gstin = Some("SHORT".to_string());
        assert!(validate_company_profile(&p).is_err());

        p = sample();
        p.pan = Some("ABC".to_string());
        assert!(validate_company_profile(&p).is_err());

        p = sample();
        p.pincode = Some("12".to_string());
        assert!(validate_company_profile(&p).is_err());

        p = sample();
        p.state_code = Some("333".to_string());
        assert!(validate_company_profile(&p).is_err());

        p = sample();
        p.email = Some("no-at-sign".to_string());
        assert!(validate_company_profile(&p).is_err());
    }
}
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd src-tauri && OPENSSL_NO_VENDOR=1 OPENSSL_LIB_DIR="C:/Program Files/OpenSSL-Win64/lib/VC/x64/MD" OPENSSL_INCLUDE_DIR="C:/Program Files/OpenSSL-Win64/include" cargo test --lib company_commands 2>&1 | head`
Expected: FAIL — `CompanyProfilePayload` / `validate_company_profile` not defined (module not registered yet — also add `pub mod company_commands;` to `commands/mod.rs` so it compiles).

- [ ] **Step 4: Implement payload, validation, and the two commands**

Register the module: add `pub mod company_commands;` to `src-tauri/src/commands/mod.rs`.

Then add to `src-tauri/src/commands/company_commands.rs` (above the test module):

```rust
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct CompanyProfilePayload {
    pub company_name: Option<String>,
    pub legal_name: Option<String>,
    pub gstin: Option<String>,
    pub pan: Option<String>,
    pub address1: Option<String>,
    pub address2: Option<String>,
    pub location: Option<String>,
    pub pincode: Option<String>,
    pub state_code: Option<String>,
    pub phone: Option<String>,
    pub email: Option<String>,
    pub logo: Option<String>,
}

fn norm(v: &Option<String>) -> Option<String> {
    v.as_ref().map(|s| s.trim()).filter(|s| !s.is_empty()).map(|s| s.to_string())
}

/// Light field validation (spec §4.3). Nothing is required; checks apply only
/// when a value is present.
pub fn validate_company_profile(p: &CompanyProfilePayload) -> Result<(), AppError> {
    let val = |msg: &str| AppError::Validation { code: "ERR_VAL_001".to_string(), message: msg.to_string() };
    if let Some(g) = norm(&p.gstin) {
        if g.len() != 15 {
            return Err(val("GSTIN must be 15 characters"));
        }
    }
    if let Some(pan) = norm(&p.pan) {
        if pan.len() != 10 {
            return Err(val("PAN must be 10 characters"));
        }
    }
    if let Some(pin) = norm(&p.pincode) {
        if pin.len() != 6 || !pin.chars().all(|c| c.is_ascii_digit()) {
            return Err(val("Pincode must be 6 digits"));
        }
    }
    if let Some(sc) = norm(&p.state_code) {
        if sc.len() != 2 || !sc.chars().all(|c| c.is_ascii_digit()) {
            return Err(val("State code must be a 2-digit GST code"));
        }
    }
    if let Some(e) = norm(&p.email) {
        if !e.contains('@') {
            return Err(val("Email must contain @"));
        }
    }
    Ok(())
}

/// Fetch the single company profile row, or empty defaults if unset.
#[tauri::command]
pub fn get_company_profile(state: State<'_, DbState>) -> Result<CompanyProfileRow, AppError> {
    let guard = state.conn.lock()
        .map_err(|e| AppError::Internal(format!("Failed to acquire connection lock: {}", e)))?;
    let conn = guard.as_ref().ok_or_else(|| AppError::Db {
        code: "ERR_DB_002".to_string(), message: "No active database connection profile".to_string(),
    })?;

    let row = conn.query_row(
        "SELECT id, company_name, legal_name, gstin, pan, address1, address2,
                location, pincode, state_code, phone, email, logo
         FROM company_profile WHERE id = 1",
        [],
        |r| {
            Ok(CompanyProfileRow {
                id: r.get(0)?,
                company_name: r.get(1)?,
                legal_name: r.get(2)?,
                gstin: r.get(3)?,
                pan: r.get(4)?,
                address1: r.get(5)?,
                address2: r.get(6)?,
                location: r.get(7)?,
                pincode: r.get(8)?,
                state_code: r.get(9)?,
                phone: r.get(10)?,
                email: r.get(11)?,
                logo: r.get(12)?,
            })
        },
    );

    match row {
        Ok(profile) => Ok(profile),
        Err(rusqlite::Error::QueryReturnedNoRows) => Ok(CompanyProfileRow {
            id: 1,
            company_name: None, legal_name: None, gstin: None, pan: None,
            address1: None, address2: None, location: None, pincode: None,
            state_code: None, phone: None, email: None, logo: None,
        }),
        Err(e) => Err(AppError::Db {
            code: "ERR_DB_003".to_string(),
            message: format!("Failed to load company profile: {}", e),
        }),
    }
}

/// Insert or update the single company profile row (id = 1).
#[tauri::command]
pub fn save_company_profile(state: State<'_, DbState>, payload: CompanyProfilePayload) -> Result<(), AppError> {
    validate_company_profile(&payload)?;
    let guard = state.conn.lock()
        .map_err(|e| AppError::Internal(format!("Failed to acquire connection lock: {}", e)))?;
    let conn = guard.as_ref().ok_or_else(|| AppError::Db {
        code: "ERR_DB_002".to_string(), message: "No active database connection profile".to_string(),
    })?;

    conn.execute(
        "INSERT INTO company_profile
            (id, company_name, legal_name, gstin, pan, address1, address2,
             location, pincode, state_code, phone, email, logo, updated_at)
         VALUES (1, ?,?,?,?,?,?,?,?,?,?,?,?, datetime('now'))
         ON CONFLICT(id) DO UPDATE SET
            company_name=excluded.company_name, legal_name=excluded.legal_name,
            gstin=excluded.gstin, pan=excluded.pan, address1=excluded.address1,
            address2=excluded.address2, location=excluded.location, pincode=excluded.pincode,
            state_code=excluded.state_code, phone=excluded.phone, email=excluded.email,
            logo=excluded.logo, updated_at=datetime('now')",
        rusqlite::params![
            norm(&payload.company_name), norm(&payload.legal_name), norm(&payload.gstin),
            norm(&payload.pan), norm(&payload.address1), norm(&payload.address2),
            norm(&payload.location), norm(&payload.pincode), norm(&payload.state_code),
            norm(&payload.phone), norm(&payload.email), norm(&payload.logo),
        ],
    )
    .map_err(|e| AppError::Db {
        code: "ERR_DB_003".to_string(),
        message: format!("Failed to save company profile: {}", e),
    })?;
    Ok(())
}
```

- [ ] **Step 5: Add a round-trip test**

Add to the `tests` module in `company_commands.rs` (exercises the SQL against a migrated DB via the repo-test pattern — save then get, and confirm a second save updates the same row):

```rust
    use crate::database::migrate::run_migrations;
    use rusqlite::Connection;

    fn db() -> Connection {
        let mut c = Connection::open_in_memory().unwrap();
        run_migrations(&mut c).unwrap();
        c
    }

    // Mirrors save_company_profile's SQL without the Tauri State wrapper.
    fn save_raw(conn: &Connection, p: &CompanyProfilePayload) {
        conn.execute(
            "INSERT INTO company_profile
                (id, company_name, legal_name, gstin, pan, address1, address2,
                 location, pincode, state_code, phone, email, logo, updated_at)
             VALUES (1, ?,?,?,?,?,?,?,?,?,?,?,?, datetime('now'))
             ON CONFLICT(id) DO UPDATE SET
                company_name=excluded.company_name, legal_name=excluded.legal_name,
                gstin=excluded.gstin, pan=excluded.pan, address1=excluded.address1,
                address2=excluded.address2, location=excluded.location, pincode=excluded.pincode,
                state_code=excluded.state_code, phone=excluded.phone, email=excluded.email,
                logo=excluded.logo, updated_at=datetime('now')",
            rusqlite::params![
                norm(&p.company_name), norm(&p.legal_name), norm(&p.gstin), norm(&p.pan),
                norm(&p.address1), norm(&p.address2), norm(&p.location), norm(&p.pincode),
                norm(&p.state_code), norm(&p.phone), norm(&p.email), norm(&p.logo),
            ],
        ).unwrap();
    }

    #[test]
    fn save_then_read_roundtrips_and_second_save_updates_same_row() {
        let conn = db();

        let mut p = sample();
        p.logo = Some("data:image/png;base64,AAAA".to_string());
        save_raw(&conn, &p);

        let (name, gstin, logo): (String, String, String) = conn
            .query_row(
                "SELECT company_name, gstin, logo FROM company_profile WHERE id = 1",
                [],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
            )
            .unwrap();
        assert_eq!(name, "Acme Auto Parts");
        assert_eq!(gstin, "33AAACH2364M1ZM");
        assert_eq!(logo, "data:image/png;base64,AAAA");

        // Second save updates the same single row.
        let mut p2 = sample();
        p2.company_name = Some("Acme Renamed".to_string());
        save_raw(&conn, &p2);

        let (count, name2): (i64, String) = conn
            .query_row(
                "SELECT COUNT(*), MAX(company_name) FROM company_profile",
                [],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .unwrap();
        assert_eq!(count, 1, "must stay a single row");
        assert_eq!(name2, "Acme Renamed");
    }
```

- [ ] **Step 6: Register commands in `lib.rs`**

In `src-tauri/src/lib.rs` `generate_handler!`, add:

```rust
            commands::company_commands::get_company_profile,
            commands::company_commands::save_company_profile,
```

- [ ] **Step 7: Run tests**

Run: `cd src-tauri && OPENSSL_NO_VENDOR=1 OPENSSL_LIB_DIR="C:/Program Files/OpenSSL-Win64/lib/VC/x64/MD" OPENSSL_INCLUDE_DIR="C:/Program Files/OpenSSL-Win64/include" cargo test`
Expected: PASS — full suite green including the new `company_commands` tests and the `export_bindings_companyprofilerow` ts-rs test.

- [ ] **Step 8: Update `api.ts`**

In `src/services/api.ts`:

```ts
import { CompanyProfileRow } from "../types/bindings/CompanyProfileRow";
export type { CompanyProfileRow };

export interface CompanyProfilePayload {
  company_name: string | null;
  legal_name: string | null;
  gstin: string | null;
  pan: string | null;
  address1: string | null;
  address2: string | null;
  location: string | null;
  pincode: string | null;
  state_code: string | null;
  phone: string | null;
  email: string | null;
  logo: string | null;
}
```
And two methods inside `ApiService`:
```ts
  static async getCompanyProfile(): Promise<CompanyProfileRow> {
    return await invoke<CompanyProfileRow>("get_company_profile");
  }
  static async saveCompanyProfile(payload: CompanyProfilePayload): Promise<void> {
    await invoke("save_company_profile", { payload });
  }
```

- [ ] **Step 9: Commit**

```bash
cd "D:/Sales Monitoring System"
cargo fmt --manifest-path src-tauri/Cargo.toml
git add src-tauri/src src/services/api.ts src/types/bindings/CompanyProfileRow.ts
git commit -m "feat: company profile DTO, get/save commands, and validation"
```

---

## Task 3: Backend — `read_logo_as_data_url` command

**Files:**
- Modify: `src-tauri/Cargo.toml` (add `base64 = "0.22"`)
- Modify: `src-tauri/src/commands/company_commands.rs` (add command)
- Modify: `src-tauri/src/lib.rs` (register command)
- Modify: `src/services/api.ts` (method)
- Test: `src-tauri/src/commands/company_commands.rs` (`#[cfg(test)]`)

**Interfaces:**
- Produces: `read_logo_as_data_url(file_path: String) -> Result<String, AppError>` returning a `data:<mime>;base64,<…>` string; rejects files > 512 KB and unsupported extensions.

- [ ] **Step 1: Add the base64 dependency**

In `src-tauri/Cargo.toml` under `[dependencies]`, add:

```toml
base64 = "0.22"
```

- [ ] **Step 2: Write the failing test**

Add to the `tests` module in `company_commands.rs`:

```rust
    #[test]
    fn logo_reads_small_png_as_data_url() {
        let mut path = std::env::temp_dir();
        path.push(format!("cp_logo_{}.png", std::process::id()));
        std::fs::write(&path, [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]).unwrap();

        let url = read_logo_as_data_url(path.to_string_lossy().to_string()).unwrap();
        assert!(url.starts_with("data:image/png;base64,"), "got {url}");

        std::fs::remove_file(&path).ok();
    }

    #[test]
    fn logo_rejects_unsupported_extension() {
        let mut path = std::env::temp_dir();
        path.push(format!("cp_logo_{}.txt", std::process::id()));
        std::fs::write(&path, b"hello").unwrap();

        let res = read_logo_as_data_url(path.to_string_lossy().to_string());
        assert!(res.is_err(), "non-image extension must be rejected");

        std::fs::remove_file(&path).ok();
    }

    #[test]
    fn logo_rejects_oversized_file() {
        let mut path = std::env::temp_dir();
        path.push(format!("cp_logo_big_{}.png", std::process::id()));
        std::fs::write(&path, vec![0u8; 600 * 1024]).unwrap(); // 600 KB > 512 KB cap

        let res = read_logo_as_data_url(path.to_string_lossy().to_string());
        assert!(res.is_err(), "files over 512 KB must be rejected");

        std::fs::remove_file(&path).ok();
    }
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd src-tauri && OPENSSL_NO_VENDOR=1 OPENSSL_LIB_DIR="C:/Program Files/OpenSSL-Win64/lib/VC/x64/MD" OPENSSL_INCLUDE_DIR="C:/Program Files/OpenSSL-Win64/include" cargo test --lib company_commands::tests::logo_reads_small_png_as_data_url 2>&1 | head`
Expected: FAIL — `read_logo_as_data_url` not defined.

- [ ] **Step 4: Implement the command**

Add to `src-tauri/src/commands/company_commands.rs` (above the test module):

```rust
use base64::{engine::general_purpose::STANDARD, Engine as _};
use std::path::Path;

const MAX_LOGO_BYTES: u64 = 512 * 1024;

/// Reads a picked image file and returns a base64 `data:` URL. Enforces a
/// 512 KB cap and an image-extension allowlist (the size guard lives here so it
/// cannot be bypassed from the UI).
#[tauri::command]
pub fn read_logo_as_data_url(file_path: String) -> Result<String, AppError> {
    let clean = file_path.trim().trim_matches('"').trim_matches('\'');
    let path = Path::new(clean);

    let meta = std::fs::metadata(path)
        .map_err(|e| AppError::Validation { code: "ERR_VAL_001".to_string(), message: format!("Cannot read image: {e}") })?;
    if meta.len() > MAX_LOGO_BYTES {
        return Err(AppError::Validation {
            code: "ERR_VAL_001".to_string(),
            message: "Logo must be under 512 KB".to_string(),
        });
    }

    let ext = path.extension().and_then(|e| e.to_str()).unwrap_or("").to_lowercase();
    let mime = match ext.as_str() {
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "svg" => "image/svg+xml",
        _ => {
            return Err(AppError::Validation {
                code: "ERR_VAL_001".to_string(),
                message: "Unsupported image type (use png, jpg, gif, webp, or svg)".to_string(),
            })
        }
    };

    let bytes = std::fs::read(path)
        .map_err(|e| AppError::Validation { code: "ERR_VAL_001".to_string(), message: format!("Cannot read image: {e}") })?;
    Ok(format!("data:{};base64,{}", mime, STANDARD.encode(bytes)))
}
```

- [ ] **Step 5: Register the command in `lib.rs`**

In `generate_handler!` add:

```rust
            commands::company_commands::read_logo_as_data_url,
```

- [ ] **Step 6: Run tests**

Run: `cd src-tauri && OPENSSL_NO_VENDOR=1 OPENSSL_LIB_DIR="C:/Program Files/OpenSSL-Win64/lib/VC/x64/MD" OPENSSL_INCLUDE_DIR="C:/Program Files/OpenSSL-Win64/include" cargo test`
Expected: PASS — full suite incl. the three logo tests.

- [ ] **Step 7: Update `api.ts`**

Add to `ApiService`:
```ts
  static async readLogoAsDataUrl(filePath: string): Promise<string> {
    return await invoke<string>("read_logo_as_data_url", { filePath });
  }
```

- [ ] **Step 8: Commit**

```bash
cd "D:/Sales Monitoring System"
cargo fmt --manifest-path src-tauri/Cargo.toml
git add src-tauri/Cargo.toml src-tauri/Cargo.lock src-tauri/src src/services/api.ts
git commit -m "feat: read_logo_as_data_url command (base64 data-URL, 512KB cap)"
```

---

## Task 4: Frontend — `CompanyProfileForm` in Company Settings

**Files:**
- Create: `src/components/CompanySettings/CompanyProfileForm.tsx`
- Modify: `src/App.tsx` (import + mount in the Settings tab)
- Verify: `npm run build`

**Interfaces:**
- Consumes: `ApiService.getCompanyProfile`, `saveCompanyProfile`, `readLogoAsDataUrl`; types `CompanyProfileRow`, `CompanyProfilePayload`.

- [ ] **Step 1: Create the form component**

Create `src/components/CompanySettings/CompanyProfileForm.tsx`:

```tsx
import { useEffect, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { ApiService, CompanyProfilePayload } from "../../services/api";
import { CompanyProfileRow } from "../../types/bindings/CompanyProfileRow";

const EMPTY: CompanyProfilePayload = {
  company_name: null, legal_name: null, gstin: null, pan: null,
  address1: null, address2: null, location: null, pincode: null,
  state_code: null, phone: null, email: null, logo: null,
};

function toPayload(r: CompanyProfileRow): CompanyProfilePayload {
  return {
    company_name: r.company_name, legal_name: r.legal_name, gstin: r.gstin, pan: r.pan,
    address1: r.address1, address2: r.address2, location: r.location, pincode: r.pincode,
    state_code: r.state_code, phone: r.phone, email: r.email, logo: r.logo,
  };
}

export default function CompanyProfileForm() {
  const [form, setForm] = useState<CompanyProfilePayload>(EMPTY);
  const [saving, setSaving] = useState(false);

  const load = async () => {
    try {
      setForm(toPayload(await ApiService.getCompanyProfile()));
    } catch (err) {
      // Not connected yet, or empty — leave the blank form.
      console.error(err);
    }
  };

  useEffect(() => { load(); }, []);

  const set = (k: keyof CompanyProfilePayload, v: string) =>
    setForm((f) => ({ ...f, [k]: v === "" ? null : v }));

  const chooseLogo = async () => {
    const sel = await open({ multiple: false, filters: [{ name: "Image", extensions: ["png", "jpg", "jpeg", "gif", "webp", "svg"] }] });
    if (!sel) return;
    const p = (Array.isArray(sel) ? sel[0] : sel) as string;
    try {
      const dataUrl = await ApiService.readLogoAsDataUrl(p);
      setForm((f) => ({ ...f, logo: dataUrl }));
    } catch (err: any) {
      alert(`Could not load logo: ${err.message || err}`);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await ApiService.saveCompanyProfile(form);
      alert("Company profile saved.");
    } catch (err: any) {
      alert(`Save failed: ${err.message || err}`);
    } finally {
      setSaving(false);
    }
  };

  const field = (label: string, k: keyof CompanyProfilePayload) => (
    <label className="flex flex-col gap-1 text-xs">
      <span className="text-slate-400">{label}</span>
      <input
        value={(form[k] as string | null) ?? ""}
        onChange={(e) => set(k, e.target.value)}
        className="bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-slate-200 focus:outline-none focus:border-indigo-500"
      />
    </label>
  );

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 space-y-6">
      <h3 className="text-sm font-bold uppercase tracking-wider text-indigo-400">Company Profile (GST Master)</h3>

      <div className="grid grid-cols-2 gap-4">
        {field("Company Name", "company_name")}
        {field("Legal Name", "legal_name")}
        {field("GSTIN", "gstin")}
        {field("PAN", "pan")}
        {field("Address 1", "address1")}
        {field("Address 2", "address2")}
        {field("Location", "location")}
        {field("Pincode", "pincode")}
        {field("State Code (GST)", "state_code")}
        {field("Phone", "phone")}
        {field("Email", "email")}
      </div>

      <div className="flex items-center gap-4 pt-2 border-t border-slate-800">
        {form.logo ? (
          <img src={form.logo} alt="Company logo" className="w-20 h-20 object-contain bg-slate-950 border border-slate-800 rounded-lg" />
        ) : (
          <div className="w-20 h-20 flex items-center justify-center bg-slate-950 border border-slate-800 rounded-lg text-[10px] text-slate-600">No logo</div>
        )}
        <div className="flex flex-col gap-2">
          <button onClick={chooseLogo} className="bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold px-4 py-2 rounded-lg">Choose logo…</button>
          {form.logo && (
            <button onClick={() => setForm((f) => ({ ...f, logo: null }))} className="text-rose-400 hover:text-rose-300 text-[11px] text-left">Remove logo</button>
          )}
          <span className="text-[10px] text-slate-500">PNG/JPG/SVG, under 512 KB.</span>
        </div>
      </div>

      <div className="flex justify-end pt-2 border-t border-slate-800">
        <button onClick={handleSave} disabled={saving} className="bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold px-5 py-2 rounded-lg disabled:opacity-50">
          {saving ? "Saving…" : "Save Company Profile"}
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Mount it in the Settings tab**

In `src/App.tsx`:
1. Add the import near the other component imports (after the `DashboardKpis` import around line 49):
```tsx
import CompanyProfileForm from "./components/CompanySettings/CompanyProfileForm";
```
2. In the Settings panel, insert `<CompanyProfileForm />` between the Database Connection Switcher card's closing `</div>` and the `{/* Tally Register Code Card */}` comment. Find this boundary (around line 1994-1996):
```tsx
                </div>
              </div>

              {/* Tally Register Code Card */}
```
and change it to:
```tsx
                </div>
              </div>

              <CompanyProfileForm />

              {/* Tally Register Code Card */}
```

- [ ] **Step 3: Build to verify**

Run: `cd "D:/Sales Monitoring System" && npm run build`
Expected: PASS — `tsc` clean, `vite build` completes.

- [ ] **Step 4: Commit**

```bash
cd "D:/Sales Monitoring System"
git add src/components/CompanySettings src/App.tsx
git commit -m "feat: add Company Profile form to Company Settings"
```

---

## Self-Review

**Spec coverage:**
- §3 table → Task 1 (v6, `CHECK(id=1)`). §4.1 DTO → Task 2. §4.2 get/save → Task 2. §4.3 validation → Task 2. §5 frontend form + logo pick/preview/remove → Task 4; logo read + size guard → Task 3 (moved to backend, noted in Global Constraints as a deliberate refinement). §6 error handling → Tasks 2/3 (`AppError::Validation`/`Db`) + Task 4 catch/alert. §7 testing → embedded per task. §8 out-of-scope respected (no export/doc wiring, no bank/website/CIN, single record). All covered.

**Placeholder scan:** No TBD/TODO; every code step has complete code; commands + expected outputs are concrete.

**Type consistency:** `CompanyProfileRow` (Task 2 DTO) fields match `CompanyProfilePayload` (minus `id`) and the `toPayload` map (Task 4). `validate_company_profile`, `get_company_profile`, `save_company_profile`, `read_logo_as_data_url` signatures match their registrations and api.ts calls. `norm` helper reused consistently. The migration column list, the `get`/`save` SQL, and the DTO field order all align (id, company_name, legal_name, gstin, pan, address1, address2, location, pincode, state_code, phone, email, logo).
