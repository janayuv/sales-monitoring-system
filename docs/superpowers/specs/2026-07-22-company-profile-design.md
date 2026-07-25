# Company Profile (GST Master) — Design Spec

**Date:** 2026-07-22
**Branch context:** `feature/phase5-reports`
**Status:** Approved design, pending implementation plan

## 1. Summary

Add a **Company Profile** master: a single editable record per company DB holding
the seller company's own GST/registration and contact details (the "from" party).
It lives in the **Company Settings** tab. This iteration is **store & edit only**
(standalone) — wiring the profile into Tally export / printed invoices is a later,
separate feature.

Parallels the Customer Master ([2026-07-21-customer-master-design.md](2026-07-21-customer-master-design.md))
but is simpler: one record, an additive migration (no table rebuild), no list, no importer.

## 2. Decisions Log

| # | Decision | Choice |
|---|----------|--------|
| 1 | What it is | Our company's own profile — one record per company DB (the seller "from" party) |
| 2 | Scope this iteration | Store & edit only (standalone); export/doc wiring deferred |
| 3 | Extra fields beyond core | Logo (bank/website/CIN not included) |
| 4 | Logo storage | Embedded in the DB as a base64 data-URL (travels with backups) |
| 5 | Storage approach | Dedicated single-row `company_profile` table (not app_settings key-value) |
| 6 | Required fields | None — all optional; format checks only when a value is present |

## 3. Data Model

New **additive** migration **v6** (no rebuild — brand-new table) appended after v5 in
`src-tauri/src/database/migrate.rs`, with `rebuild: false`:

```sql
CREATE TABLE IF NOT EXISTS company_profile (
    id INTEGER PRIMARY KEY CHECK (id = 1),   -- exactly one row
    company_name TEXT,
    legal_name   TEXT,
    gstin        TEXT,
    pan          TEXT,
    address1     TEXT,
    address2     TEXT,
    location     TEXT,
    pincode      TEXT,
    state_code   TEXT,                        -- 2-digit GST code, free text
    phone        TEXT,
    email        TEXT,
    logo         TEXT,                        -- base64 data-URL, e.g. "data:image/png;base64,…"
    updated_at   TEXT NOT NULL DEFAULT (datetime('now'))
);
```

- **All fields optional.** The user fills/edits the profile incrementally.
- **Single row enforced** two ways: `CHECK (id = 1)`, and `save` always targets `id = 1`.
- No seed row; `get` returns empty defaults when the table is empty.

## 4. Backend

### 4.1 DTO — `CompanyProfileRow` (ts-rs exported)

Exported to `../../src/types/bindings/CompanyProfileRow.ts`:

```
id, company_name?, legal_name?, gstin?, pan?, address1?, address2?,
location?, pincode?, state_code?, phone?, email?, logo?
```

`updated_at` stays server-side (not in the DTO).

### 4.2 Commands (new `commands/company_commands.rs`; register in `lib.rs` + `api.ts`)

| Command | Behavior |
|---------|----------|
| `get_company_profile() -> CompanyProfileRow` | returns the `id = 1` row, or an all-empty default (`id: 1`, fields null) if unset |
| `save_company_profile(payload) -> ()` | `INSERT INTO company_profile (id, …) VALUES (1, …) ON CONFLICT(id) DO UPDATE SET …, updated_at = datetime('now')` |

`save` validates first, then upserts. The `CompanyProfilePayload` mirrors the DTO's
editable fields (no `id` needed — always row 1). The logo is stored verbatim as the
base64 string on the payload (no server-side image processing).

### 4.3 Validation (`validate_company_profile`)

Nothing is required. When present: `gstin` 15 chars; `pan` 10 chars; `pincode` 6 digits;
`state_code` 2 digits; `email` contains `@`. Blank strings normalize to NULL (same
`norm` helper pattern as `customer_commands`).

## 5. Frontend

A **Company Profile** card in the existing **Company Settings** tab, extracted into
`src/components/CompanySettings/CompanyProfileForm.tsx` (keeps `App.tsx` from growing).

- **Load** on entering Settings via `ApiService.getCompanyProfile()`; **Save** →
  `ApiService.saveCompanyProfile(payload)` with a success toast.
- **Fields** grouped: Identity (company_name, legal_name, gstin, pan), Address
  (address1, address2, location, pincode, state_code), Contact (phone, email) — same
  input style as the customer detail form.
- **Logo:**
  - "Choose logo…" → Tauri file dialog (png/jpg/svg) → read bytes via
    `@tauri-apps/plugin-fs` `readFile` → base64-encode → build `data:<mime>;base64,…`
    → store in form state.
  - `<img>` **preview** of current/selected logo + a "Remove" link (sets logo null).
  - **Size guard (frontend):** if the picked file exceeds ~512 KB, warn and skip
    (keeps the embedded logo — and the DB — lean).
- Sits alongside existing Settings content (Tally register code, maintenance/backup),
  which is untouched.

## 6. Error Handling

Reuses `AppError`: validation failures → `AppError::Validation` with a friendly
message (e.g. "GSTIN must be 15 characters"); DB errors → `AppError::Db`. The frontend
surfaces these in the Save handler's `catch` (alert), matching the rest of the app.
The logo size guard is a frontend check before the value reaches the backend.

## 7. Testing

**Backend** (in-memory SQLite + `run_migrations`, matching existing repo/command tests):
- v6 creates `company_profile`; `CHECK (id = 1)` rejects a second row.
- `save_company_profile` → `get_company_profile` round-trips all fields (incl. a logo
  string); a second save updates the same row (no duplicate).
- `validate_company_profile`: rejects bad gstin/pan/pincode/state_code/email; accepts an
  all-empty payload and a fully-valid one.

**Frontend:** no JS test harness — `npm run build` (tsc + vite) is the gate.

## 8. Out of Scope

- Wiring the company profile into Tally export, printed PDF/invoices, or any document
  as the "from" party (deferred per Decision #2).
- Bank details, website, CIN fields (not selected).
- Multiple company GSTINs / branch registrations (single record only).
- Any frontend test-runner setup.
