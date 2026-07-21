use crate::error::AppError;
use crate::models::domain_models::{
    CustomerImportIssue, CustomerImportPreview, CustomerImportResult,
};
use crate::services::import_service::cell_to_string;
use crate::utils::hash::compute_file_hash;
use calamine::{open_workbook_auto, Reader};
use rusqlite::{params, Connection};
use std::collections::HashMap;
use std::path::Path;

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
    if col_field.is_empty() {
        return Err(AppError::Excel(
            "No recognized customer-master columns found in the header row. Expected headers like customer_code, report_name, gstin, address1, etc.".to_string(),
        ));
    }

    let mut parsed = Vec::new();
    for (i, row) in rows_iter.enumerate() {
        let get = |field: &str| -> Option<String> {
            col_field
                .iter()
                .find(|(_, f)| **f == field)
                .and_then(|(idx, _)| {
                    row.get(*idx)
                        .map(cell_to_string)
                        .filter(|s| !s.trim().is_empty())
                })
        };
        // Skip fully-empty rows.
        if col_field.keys().all(|idx| {
            row.get(*idx)
                .map(cell_to_string)
                .unwrap_or_default()
                .trim()
                .is_empty()
        }) {
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
    let err = |m: String| CustomerImportIssue {
        row_no: r.row_no,
        customer_code: r.code.clone(),
        severity: "error".to_string(),
        message: m,
    };
    let warn = |m: String| CustomerImportIssue {
        row_no: r.row_no,
        customer_code: r.code.clone(),
        severity: "warning".to_string(),
        message: m,
    };

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
    for (label, code) in [
        ("state_code", &r.state_code),
        ("place_of_supply", &r.place_of_supply),
    ] {
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

/// Trims a value and turns it into `None` if it's empty, otherwise `Some(trimmed)`.
/// Used to build `COALESCE(?, col)` params so a blank cell keeps the existing DB value.
fn opt(v: &Option<String>) -> Option<String> {
    v.as_ref()
        .map(|s| s.trim())
        .filter(|s| !s.is_empty())
        .map(|s| s.to_string())
}

/// Inserts a new customer or updates an existing one by customer_code.
/// On update, NULL (blank) values keep the existing column via COALESCE, so
/// re-importing a sheet with some blank cells never destroys previously-set data.
pub fn upsert_row(conn: &Connection, r: &ParsedCustomerRow, exists: bool) -> Result<(), AppError> {
    let code = r
        .code
        .as_ref()
        .map(|s| s.trim().to_string())
        .unwrap_or_default();
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
                opt(&r.report_name),
                opt(&r.tally),
                opt(&r.legal),
                opt(&r.gstin),
                opt(&r.address1),
                opt(&r.address2),
                opt(&r.location),
                opt(&r.pincode),
                opt(&r.state_code),
                opt(&r.place_of_supply),
                opt(&r.phone),
                opt(&r.email),
                opt(&r.remarks),
                opt(&r.status),
                code,
            ],
        )
        .map_err(|e| AppError::Db {
            code: "ERR_DB_003".to_string(),
            message: format!("Update failed for {code}: {e}"),
        })?;
    } else {
        conn.execute(
            "INSERT INTO customers
                (customer_code, report_name, tally_customer_name, legal_name, gstin, address1, address2,
                 location, pincode, state_code, place_of_supply, phone, email, remarks, status)
             VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?, COALESCE(?, 'Approved'))",
            params![
                code,
                opt(&r.report_name),
                opt(&r.tally),
                opt(&r.legal),
                opt(&r.gstin),
                opt(&r.address1),
                opt(&r.address2),
                opt(&r.location),
                opt(&r.pincode),
                opt(&r.state_code),
                opt(&r.place_of_supply),
                opt(&r.phone),
                opt(&r.email),
                opt(&r.remarks),
                opt(&r.status),
            ],
        )
        .map_err(|e| AppError::Db {
            code: "ERR_DB_003".to_string(),
            message: format!("Insert failed for {code}: {e}"),
        })?;
    }
    Ok(())
}

fn code_exists(conn: &Connection, code: &str) -> bool {
    conn.query_row(
        "SELECT EXISTS(SELECT 1 FROM customers WHERE customer_code = ?)",
        [code],
        |r| r.get::<_, bool>(0),
    )
    .unwrap_or(false)
}

/// Parses and validates a customer master sheet without writing anything to the DB.
pub fn preview_import(
    conn: &Connection,
    file_path: &str,
) -> Result<CustomerImportPreview, AppError> {
    let rows = parse_customer_sheet(file_path)?;
    let file_name = Path::new(file_path.trim().trim_matches('"'))
        .file_name()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_default();

    let (mut to_insert, mut to_update) = (0u32, 0u32);
    let (mut errors, mut warnings) = (Vec::new(), Vec::new());
    for r in &rows {
        let exists = r
            .code
            .as_ref()
            .map(|c| code_exists(conn, c.trim()))
            .unwrap_or(false);
        let issues = validate_row(r, exists);
        let has_error = issues.iter().any(|i| i.severity == "error");
        for i in issues {
            if i.severity == "error" {
                errors.push(i);
            } else {
                warnings.push(i);
            }
        }
        if has_error {
            continue;
        }
        if exists {
            to_update += 1;
        } else {
            to_insert += 1;
        }
    }
    Ok(CustomerImportPreview {
        file_name,
        row_count: rows.len() as u32,
        to_insert,
        to_update,
        errors,
        warnings,
    })
}

/// Parses, validates, and upserts a customer master sheet inside a single
/// transaction, recording an auditable `import_batches` row and per-row
/// `validation_exceptions`. Rejects re-import of a file already committed
/// (matched by content hash) to prevent duplicate imports.
pub fn commit_import(
    conn: &mut Connection,
    file_path: &str,
    user: &str,
) -> Result<CustomerImportResult, AppError> {
    let start = std::time::Instant::now();
    let clean = file_path.trim().trim_matches('"').trim_matches('\'');
    let path = Path::new(clean);
    let file_hash = compute_file_hash(path)
        .map_err(|e| AppError::Excel(format!("Failed to hash file: {e}")))?;

    let dup: bool = conn
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM import_batches WHERE file_hash = ? AND status = 'completed')",
            [&file_hash],
            |r| r.get(0),
        )
        .unwrap_or(false);
    if dup {
        return Err(AppError::Validation {
            code: "ERR_CM_DUP".to_string(),
            message: "This file was already imported.".to_string(),
        });
    }

    let rows = parse_customer_sheet(clean)?;
    let file_name = path
        .file_name()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_default();
    let file_size = std::fs::metadata(path).map(|m| m.len() as i64).unwrap_or(0);

    let tx = conn.transaction().map_err(|e| AppError::Db {
        code: "ERR_DB_003".to_string(),
        message: format!("Failed to begin import tx: {e}"),
    })?;

    tx.execute(
        "INSERT INTO import_batches (source_type, file_name, file_size_bytes, file_hash, row_count, imported_by, status)
         VALUES ('customer_master', ?, ?, ?, ?, ?, 'staged')",
        params![file_name, file_size, file_hash, rows.len() as i64, user],
    )
    .map_err(|e| AppError::Db {
        code: "ERR_DB_003".to_string(),
        message: format!("Failed to create batch: {e}"),
    })?;
    let batch_id = tx.last_insert_rowid();

    let (mut inserted, mut updated, mut skipped, mut warning_count) = (0u32, 0u32, 0u32, 0u32);
    let mut errors = Vec::new();

    for r in &rows {
        let exists = r
            .code
            .as_ref()
            .map(|c| code_exists(&tx, c.trim()))
            .unwrap_or(false);
        let issues = validate_row(r, exists);
        for i in &issues {
            tx.execute(
                "INSERT INTO validation_exceptions (level, batch_id, row_no, invoice_no, severity, exception_type, field_name, expected_value, actual_value)
                 VALUES ('row', ?, ?, NULL, ?, 'customer_master', NULL, NULL, ?)",
                params![batch_id, i.row_no, i.severity, i.message],
            )
            .ok();
            if i.severity == "warning" {
                warning_count += 1;
            }
        }
        if issues.iter().any(|i| i.severity == "error") {
            skipped += 1;
            errors.extend(issues.into_iter().filter(|i| i.severity == "error"));
            continue;
        }
        upsert_row(&tx, r, exists)?;
        if exists {
            updated += 1;
        } else {
            inserted += 1;
        }
    }

    let duration = start.elapsed().as_millis() as i64;
    tx.execute(
        "UPDATE import_batches SET success_count=?, warning_count=?, error_count=?, duration_ms=?, status='completed' WHERE id=?",
        params![(inserted + updated) as i64, warning_count as i64, skipped as i64, duration, batch_id],
    )
    .map_err(|e| AppError::Db {
        code: "ERR_DB_003".to_string(),
        message: format!("Failed to finalize batch: {e}"),
    })?;

    tx.commit().map_err(|e| AppError::Db {
        code: "ERR_DB_003".to_string(),
        message: format!("Failed to commit import: {e}"),
    })?;

    Ok(CustomerImportResult {
        batch_id,
        inserted,
        updated,
        skipped,
        errors,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn row(code: Option<&str>, name: Option<&str>, gstin: Option<&str>) -> ParsedCustomerRow {
        ParsedCustomerRow {
            row_no: 2,
            code: code.map(|s| s.to_string()),
            report_name: name.map(|s| s.to_string()),
            tally: None,
            legal: None,
            gstin: gstin.map(|s| s.to_string()),
            address1: None,
            address2: None,
            location: None,
            pincode: None,
            state_code: None,
            place_of_supply: None,
            phone: None,
            email: None,
            status: None,
            remarks: None,
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

    // --- parse_customer_sheet coverage -------------------------------------

    use std::sync::atomic::{AtomicU32, Ordering};

    static TEST_FILE_COUNTER: AtomicU32 = AtomicU32::new(0);

    /// Builds a unique path in the OS temp dir for a scratch .xlsx test file.
    fn unique_temp_xlsx_path(tag: &str) -> std::path::PathBuf {
        let counter = TEST_FILE_COUNTER.fetch_add(1, Ordering::SeqCst);
        let file_name = format!(
            "customer_import_service_test_{}_{}_{}.xlsx",
            std::process::id(),
            tag,
            counter
        );
        std::env::temp_dir().join(file_name)
    }

    /// Writes a minimal single-sheet workbook with `header` as row 1 and
    /// `data_rows` as the following rows, to `path`.
    fn write_test_workbook(path: &std::path::Path, header: &[&str], data_rows: &[Vec<&str>]) {
        use rust_xlsxwriter::Workbook;

        let mut workbook = Workbook::new();
        let worksheet = workbook.add_worksheet();

        for (col, h) in header.iter().enumerate() {
            worksheet
                .write_string(0, col as u16, *h)
                .expect("failed to write header cell in test workbook");
        }
        for (r, data_row) in data_rows.iter().enumerate() {
            let excel_row = (r + 1) as u32;
            for (col, value) in data_row.iter().enumerate() {
                worksheet
                    .write_string(excel_row, col as u16, *value)
                    .expect("failed to write data cell in test workbook");
            }
        }

        workbook
            .save(path)
            .expect("failed to save test workbook to temp path");
    }

    #[test]
    fn parse_returns_error_when_no_headers_recognized() {
        let path = unique_temp_xlsx_path("no_headers");
        write_test_workbook(&path, &["foo", "bar", "baz"], &[vec!["v1", "v2", "v3"]]);

        let result = parse_customer_sheet(path.to_str().expect("path is valid utf-8"));

        let _ = std::fs::remove_file(&path);

        assert!(
            result.is_err(),
            "expected an error when no headers are recognized, got: {result:?}"
        );
    }

    #[test]
    fn parse_maps_headers_and_row_numbers() {
        let path = unique_temp_xlsx_path("maps_headers");
        write_test_workbook(
            &path,
            &["customer_code", "report_name", "gstin"],
            &[vec!["C1", "Report Co", "33AAACH2364M1ZM"]],
        );

        let result = parse_customer_sheet(path.to_str().expect("path is valid utf-8"));

        let _ = std::fs::remove_file(&path);

        let rows = result.expect("expected parse to succeed for recognized headers");
        assert_eq!(rows.len(), 1);
        let row = &rows[0];
        assert_eq!(row.code, Some("C1".to_string()));
        assert_eq!(row.report_name, Some("Report Co".to_string()));
        assert_eq!(row.gstin, Some("33AAACH2364M1ZM".to_string()));
        assert_eq!(row.row_no, 2);
    }

    // --- upsert_row coverage -------------------------------------------------

    use crate::database::migrate::run_migrations;
    use rusqlite::Connection;

    fn db() -> Connection {
        let mut c = Connection::open_in_memory().unwrap();
        run_migrations(&mut c).unwrap();
        c
    }

    #[test]
    fn upsert_inserts_new_then_updates_keeping_blanks() {
        let conn = db();

        let insert_row = ParsedCustomerRow {
            row_no: 2,
            code: Some("C1".into()),
            report_name: Some("First Name".into()),
            tally: Some("Tally One".into()),
            legal: None,
            gstin: Some("33AAACH2364M1ZM".into()),
            address1: Some("Addr 1".into()),
            address2: None,
            location: None,
            pincode: None,
            state_code: Some("33".into()),
            place_of_supply: None,
            phone: None,
            email: None,
            status: None,
            remarks: None,
        };
        upsert_row(&conn, &insert_row, false).unwrap();

        // Update with blank report_name + blank gstin -> must keep existing values.
        let update_row = ParsedCustomerRow {
            row_no: 3,
            code: Some("C1".into()),
            report_name: None,
            tally: Some("Tally CHANGED".into()),
            legal: None,
            gstin: None,
            address1: None,
            address2: None,
            location: Some("CityX".into()),
            pincode: None,
            state_code: None,
            place_of_supply: None,
            phone: None,
            email: None,
            status: None,
            remarks: None,
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
}
