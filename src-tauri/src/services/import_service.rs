use crate::config::GST_TOLERANCE;
use crate::error::AppError;
use crate::models::domain_models::{ImportPreview, ValidationErrorDetail, ValidationWarningDetail};
use crate::utils::dates::parse_date;
use crate::utils::hash::compute_file_hash;
use calamine::{open_workbook_auto, Data, DataType, Reader};
use rusqlite::Connection;
use std::collections::HashMap;
use std::path::Path;

pub fn cell_to_string(cell: &Data) -> String {
    match cell {
        Data::String(s) => s.trim().to_string(),
        Data::Float(f) => {
            let val = *f as i64;
            if (val as f64 - *f).abs() < 0.00001 {
                val.to_string()
            } else {
                f.to_string()
            }
        }
        Data::Int(i) => i.to_string(),
        Data::DateTime(dt) => {
            let val = dt.as_f64() as i64;
            let days = val - 25569;
            if let Some(epoch) = chrono::NaiveDate::from_ymd_opt(1970, 1, 1) {
                (epoch + chrono::Duration::days(days))
                    .format("%Y-%m-%d")
                    .to_string()
            } else {
                dt.to_string()
            }
        }
        Data::DateTimeIso(s) => s.trim().to_string(),
        Data::DurationIso(s) => s.trim().to_string(),
        Data::Bool(b) => b.to_string(),
        Data::Error(_) | Data::Empty => "".to_string(),
    }
}

pub fn cell_to_f64(cell: &Data) -> f64 {
    match cell {
        Data::Float(f) => *f,
        Data::Int(i) => *i as f64,
        Data::String(s) => s.trim().parse::<f64>().unwrap_or(0.0),
        _ => 0.0,
    }
}

pub struct ImportService;

impl ImportService {
    /// Parses and runs the validation pipeline on an Excel file.
    pub fn parse_and_preview(
        conn: &Connection,
        file_path: &str,
        template_id: i64,
        _user_name: &str,
    ) -> Result<ImportPreview, AppError> {
        let clean_file_path = file_path.trim().trim_matches('"').trim_matches('\'');
        let path = Path::new(clean_file_path);
        if !path.exists() {
            return Err(AppError::Excel(format!(
                "File does not exist or cannot be accessed: {}",
                clean_file_path
            )));
        }

        // 1. FileValidator Stage: Calculate file hash and check for duplicates
        let file_hash = compute_file_hash(path)
            .map_err(|e| AppError::Excel(format!("Failed to read file hash: {}", e)))?;
        let is_duplicate: bool = conn
            .query_row(
                "SELECT EXISTS(SELECT 1 FROM import_batches WHERE file_hash = ? AND status = 'completed')",
                [&file_hash],
                |row| row.get(0),
            )
            .unwrap_or(false);

        let mut errors = Vec::new();
        let mut warnings = Vec::new();

        if is_duplicate {
            errors.push(ValidationErrorDetail {
                row_no: 0,
                invoice_no: None,
                field_name: "file_hash".to_string(),
                error_type: "ERR_IMPORT_002".to_string(),
                actual_value: file_hash.clone(),
                expected_value: "Unique file hash".to_string(),
            });
        }

        // Load mappings
        let mappings = Self::load_mappings(conn, template_id)?;
        if mappings.is_empty() {
            return Err(AppError::Excel(
                "No column mappings defined for this template".to_string(),
            ));
        }

        let template_name: String = conn
            .query_row(
                "SELECT template_name FROM import_templates WHERE id = ?",
                [template_id],
                |row| row.get(0),
            )
            .map_err(|_| AppError::Excel("Template not found".to_string()))?;

        // 2. Open Workbook and read sheet
        let mut workbook = open_workbook_auto(path)
            .map_err(|e| AppError::Excel(format!("Failed to open Excel: {}", e)))?;
        let sheet_name = workbook
            .sheet_names()
            .first()
            .cloned()
            .ok_or_else(|| AppError::Excel("Workbook contains no sheets".to_string()))?;

        let range = workbook
            .worksheet_range(&sheet_name)
            .map_err(|e| AppError::Excel(format!("Failed to read sheet {}: {}", sheet_name, e)))?;

        let mut rows_iter = range.rows();
        let headers_row = rows_iter
            .next()
            .ok_or_else(|| AppError::Excel("Empty sheet: missing headers row".to_string()))?;

        // Map column index to internal field keys
        let mut col_index_to_key = HashMap::new();
        for (idx, cell) in headers_row.iter().enumerate() {
            if let Some(header_str) = cell.as_string() {
                let header_clean = header_str.trim().to_lowercase();
                if let Some(key) = mappings.get(&header_clean) {
                    col_index_to_key.insert(idx, key.clone());
                }
            }
        }

        // Verify that minimum critical fields are mapped
        let mapped_keys: Vec<&String> = col_index_to_key.values().collect();
        let critical_fields = vec![
            "invoice_number",
            "invoice_date",
            "customer_code",
            "part_code",
            "quantity",
            "rate_pre_unit",
            "assessable_value",
        ];
        for field in critical_fields {
            if !mapped_keys.contains(&&field.to_string()) {
                errors.push(ValidationErrorDetail {
                    row_no: 0,
                    invoice_no: None,
                    field_name: field.to_string(),
                    error_type: "ERR_IMPORT_001".to_string(),
                    actual_value: "Missing".to_string(),
                    expected_value: format!("Header mapped to '{}'", field),
                });
            }
        }

        // If fatal file-level errors occurred, return preview immediately
        if !errors.is_empty() {
            return Ok(ImportPreview {
                batch_hash: file_hash,
                file_name: path
                    .file_name()
                    .unwrap_or_default()
                    .to_string_lossy()
                    .into_owned(),
                row_count: range.height() as u32,
                mapped_template_name: template_name,
                errors,
                warnings,
                proposed_inserts: 0,
                proposed_updates: 0,
            });
        }

        let mut proposed_inserts = 0;
        let mut proposed_updates = 0;
        let mut row_idx = 1; // 1-indexed count for Excel rows

        for row in rows_iter {
            row_idx += 1;
            let mut row_data = HashMap::new();
            for (col_idx, cell) in row.iter().enumerate() {
                if let Some(key) = col_index_to_key.get(&col_idx) {
                    row_data.insert(key.as_str(), cell.clone());
                }
            }

            // Extract core fields
            let inv_no = row_data
                .get("invoice_number")
                .map(cell_to_string)
                .unwrap_or_default();
            if inv_no.is_empty() {
                continue; // Skip completely empty rows
            }

            // 3. TemplateValidator Stage: Date and numbers conversions
            let inv_date_str = row_data
                .get("invoice_date")
                .map(cell_to_string)
                .unwrap_or_default();
            let parsed_inv_date = parse_date(&inv_date_str);
            if parsed_inv_date.is_none() {
                errors.push(ValidationErrorDetail {
                    row_no: row_idx,
                    invoice_no: Some(inv_no.clone()),
                    field_name: "invoice_date".to_string(),
                    error_type: "ERR_VALIDATION_001".to_string(),
                    actual_value: inv_date_str.clone(),
                    expected_value: "Valid date format (YYYY-MM-DD, DD-MM-YYYY)".to_string(),
                });
            }

            let qty = row_data.get("quantity").map(cell_to_f64).unwrap_or(0.0);
            let rate = row_data
                .get("rate_pre_unit")
                .map(cell_to_f64)
                .unwrap_or(0.0);
            let ass_val = row_data
                .get("assessable_value")
                .map(cell_to_f64)
                .unwrap_or(0.0);

            // 4. BusinessValidator Stage: Basic limits and calculations
            if qty <= 0.0 {
                errors.push(ValidationErrorDetail {
                    row_no: row_idx,
                    invoice_no: Some(inv_no.clone()),
                    field_name: "quantity".to_string(),
                    error_type: "ERR_VALIDATION_002".to_string(),
                    actual_value: qty.to_string(),
                    expected_value: "Greater than 0".to_string(),
                });
            }
            if rate < 0.0 {
                errors.push(ValidationErrorDetail {
                    row_no: row_idx,
                    invoice_no: Some(inv_no.clone()),
                    field_name: "rate_pre_unit".to_string(),
                    error_type: "ERR_VALIDATION_002".to_string(),
                    actual_value: rate.to_string(),
                    expected_value: "Greater than or equal to 0".to_string(),
                });
            }

            // Tax values
            let cgst = row_data.get("cgst_amount").map(cell_to_f64).unwrap_or(0.0);
            let sgst = row_data.get("sgst_amount").map(cell_to_f64).unwrap_or(0.0);
            let igst = row_data.get("igst_amount").map(cell_to_f64).unwrap_or(0.0);
            let total_val = row_data.get("total_value").map(cell_to_f64).unwrap_or(0.0);

            // Math check: assessable_value + taxes should match total_value if total_value is provided
            let computed_total = ass_val + cgst + sgst + igst;
            if total_val > 0.0 && (computed_total - total_val).abs() > GST_TOLERANCE {
                warnings.push(ValidationWarningDetail {
                    row_no: row_idx,
                    invoice_no: Some(inv_no.clone()),
                    field_name: "total_value".to_string(),
                    warning_type: "ERR_VALIDATION_003".to_string(),
                    actual_value: total_val.to_string(),
                    expected_value: computed_total.to_string(),
                });
            }

            // 5. DatabaseValidator Stage: Check references
            let cust_code = row_data
                .get("customer_code")
                .map(cell_to_string)
                .unwrap_or_default();
            let customer_exists: bool = conn
                .query_row(
                    "SELECT EXISTS(SELECT 1 FROM customers WHERE customer_code = ?)",
                    [&cust_code],
                    |row| row.get(0),
                )
                .unwrap_or(false);

            if !customer_exists && !cust_code.is_empty() {
                warnings.push(ValidationWarningDetail {
                    row_no: row_idx,
                    invoice_no: Some(inv_no.clone()),
                    field_name: "customer_code".to_string(),
                    warning_type: "ERR_VALIDATION_004".to_string(),
                    actual_value: cust_code.clone(),
                    expected_value: "Existing customer reference in master registry".to_string(),
                });
            }

            let part_code = row_data
                .get("part_code")
                .map(cell_to_string)
                .unwrap_or_default();
            let part_exists: bool = conn
                .query_row(
                    "SELECT EXISTS(SELECT 1 FROM items WHERE part_code = ?)",
                    [&part_code],
                    |row| row.get(0),
                )
                .unwrap_or(false);

            if !part_exists && !part_code.is_empty() {
                warnings.push(ValidationWarningDetail {
                    row_no: row_idx,
                    invoice_no: Some(inv_no.clone()),
                    field_name: "part_code".to_string(),
                    warning_type: "ERR_VALIDATION_004".to_string(),
                    actual_value: part_code.clone(),
                    expected_value: "Existing part reference in master registry".to_string(),
                });
            }

            // Estimate inserts vs updates
            let invoice_exists: bool = conn
                .query_row(
                    "SELECT EXISTS(SELECT 1 FROM invoices WHERE invoice_number = ?)",
                    [&inv_no],
                    |row| row.get(0),
                )
                .unwrap_or(false);

            if invoice_exists {
                proposed_updates += 1;
            } else {
                proposed_inserts += 1;
            }
        }

        Ok(ImportPreview {
            batch_hash: file_hash,
            file_name: path
                .file_name()
                .unwrap_or_default()
                .to_string_lossy()
                .into_owned(),
            row_count: range.height() as u32,
            mapped_template_name: template_name,
            errors,
            warnings,
            proposed_inserts,
            proposed_updates,
        })
    }

    /// Helper to load lowercase Excel header mappings from DB.
    pub fn load_mappings(
        conn: &Connection,
        template_id: i64,
    ) -> Result<HashMap<String, String>, AppError> {
        let mut stmt = conn
            .prepare(
                "SELECT excel_column_header, target_field_key 
                 FROM import_template_mappings 
                 WHERE template_id = ?",
            )
            .map_err(|e| AppError::Db {
                code: "ERR_DB_003".to_string(),
                message: format!("Failed to fetch mappings: {}", e),
            })?;

        let rows = stmt
            .query_map([template_id], |row| {
                let header: String = row.get(0)?;
                let key: String = row.get(1)?;
                Ok((header.trim().to_lowercase(), key))
            })
            .map_err(|e| AppError::Db {
                code: "ERR_DB_003".to_string(),
                message: format!("Failed to read mappings rows: {}", e),
            })?;

        // Pre-populate built-in aliases for robust ERP header matching
        let built_in_aliases: &[(&str, &[&str])] = &[
            (
                "invoice_number",
                &[
                    "invno",
                    "inv no",
                    "invoice no",
                    "invoice_no",
                    "invoice number",
                    "bill no",
                    "vch no",
                    "doc no",
                    "invoice_number",
                ],
            ),
            (
                "invoice_date",
                &[
                    "io_date",
                    "inv date",
                    "invoice date",
                    "inv_date",
                    "date",
                    "billing date",
                    "inv dt",
                    "invoice_date",
                ],
            ),
            (
                "customer_code",
                &[
                    "cust_cde",
                    "cust code",
                    "customer code",
                    "cust_code",
                    "party code",
                    "customer",
                    "client code",
                    "customer_code",
                ],
            ),
            (
                "customer_name",
                &[
                    "cust_name",
                    "cust name",
                    "customer name",
                    "cust_name",
                    "party name",
                    "client name",
                    "customer_name",
                ],
            ),
            (
                "part_code",
                &[
                    "prod_cde",
                    "prod_cust_no",
                    "part code",
                    "part_code",
                    "item code",
                    "part no",
                    "part number",
                    "material code",
                    "item_code",
                    "part_code",
                ],
            ),
            (
                "part_name",
                &[
                    "prod_name_ko",
                    "part name",
                    "part_name",
                    "item name",
                    "item description",
                    "material name",
                    "part description",
                    "part_name",
                ],
            ),
            (
                "hsn_code",
                &[
                    "tariff_code",
                    "tariff",
                    "hsn",
                    "hsn_code",
                    "hsn code",
                    "tariff code",
                ],
            ),
            (
                "quantity",
                &["io_qty", "qty", "quantity", "billed qty", "billed_quantity"],
            ),
            (
                "rate_pre_unit",
                &["rate_pre_unit", "rate", "unit rate", "basic rate", "price"],
            ),
            (
                "assessable_value",
                &[
                    "assessable_value",
                    "assessable value",
                    "taxable value",
                    "taxable_amt",
                    "taxable amount",
                    "taxable val",
                ],
            ),
            ("cgst_rate", &["cgst_rate", "cgst %", "cgst rate"]),
            (
                "cgst_amount",
                &["cgst_amt", "cgst_amount", "cgst", "cgst amt"],
            ),
            ("sgst_rate", &["sgst_rate", "sgst %", "sgst rate"]),
            (
                "sgst_amount",
                &["sgst_amt", "sgst_amount", "sgst", "sgst amt"],
            ),
            ("igst_rate", &["igst_rate", "igst %", "igst rate"]),
            (
                "igst_amount",
                &["igst_amt", "igst_amount", "igst", "igst amt"],
            ),
            (
                "total_value",
                &[
                    "total_inv_value",
                    "invoice_total",
                    "grand_total",
                    "total",
                    "total_value",
                    "total value",
                    "inv total",
                ],
            ),
        ];

        let mut mappings = HashMap::new();
        for (target_key, aliases) in built_in_aliases {
            for alias in *aliases {
                mappings.insert(alias.to_string(), target_key.to_string());
            }
        }

        for r in rows {
            let (header, key) = r.map_err(|e| AppError::Db {
                code: "ERR_DB_003".to_string(),
                message: format!("Mapping read parsing error: {}", e),
            })?;
            mappings.insert(header, key);
        }

        Ok(mappings)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::database::migrate::run_migrations;

    #[test]
    fn test_e2e_user_report_file_parsing() {
        let file_path = r"D:\Sales report\Sales report.xls";
        if !Path::new(file_path).exists() {
            println!("User report file not found at path, skipping test.");
            return;
        }

        let mut conn = rusqlite::Connection::open_in_memory().unwrap();
        run_migrations(&mut conn).unwrap();

        let preview = ImportService::parse_and_preview(&conn, file_path, 1, "Playwright-Agent")
            .expect("Parse and preview failed!");
        assert_eq!(
            preview.errors.len(),
            0,
            "User report file must parse with 0 errors!"
        );
        assert!(
            preview.row_count > 3000,
            "Parsed row count should be > 3000 rows"
        );
        println!("Successfully verified D:\\Sales report\\Sales report.xls! Parsed {} rows with 0 errors.", preview.row_count);
    }
}
