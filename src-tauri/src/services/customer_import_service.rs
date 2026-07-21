use crate::error::AppError;
use crate::models::domain_models::CustomerImportIssue;
use crate::services::import_service::cell_to_string;
use calamine::{open_workbook_auto, Reader};
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
}
