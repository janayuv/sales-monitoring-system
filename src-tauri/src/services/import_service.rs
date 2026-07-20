use std::collections::HashMap;
use std::path::Path;
use calamine::{open_workbook_auto, DataType, Reader};
use rusqlite::Connection;
use crate::error::AppError;
use crate::models::database_models::{
    CustomerRow, SupplierRow, ItemRow, InvoiceRow, InvoiceItemRow, ImportBatchRow, ValidationExceptionRow
};
use crate::models::domain_models::{
    ImportPreview, ValidationErrorDetail, ValidationWarningDetail
};
use crate::utils::dates::parse_date;
use crate::utils::hash::compute_file_hash;
use crate::config::GST_TOLERANCE;

pub struct ImportService;

impl ImportService {
    /// Parses and runs the validation pipeline on an Excel file.
    pub fn parse_and_preview(
        conn: &Connection,
        file_path: &str,
        template_id: i64,
        user_name: &str,
    ) -> Result<ImportPreview, AppError> {
        let path = Path::new(file_path);
        if !path.exists() {
            return Err(AppError::Excel(format!("File does not exist: {}", file_path)));
        }

        // 1. FileValidator Stage: Calculate file hash and check for duplicates
        let file_hash = compute_file_hash(path).map_err(|e| AppError::Excel(format!("Failed to read file hash: {}", e)))?;
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
            return Err(AppError::Excel("No column mappings defined for this template".to_string()));
        }

        let template_name: String = conn
            .query_row(
                "SELECT template_name FROM import_templates WHERE id = ?",
                [template_id],
                |row| row.get(0),
            )
            .map_err(|_| AppError::Excel("Template not found".to_string()))?;

        // 2. Open Workbook and read sheet
        let mut workbook = open_workbook_auto(path).map_err(|e| AppError::Excel(format!("Failed to open Excel: {}", e)))?;
        let sheet_name = workbook
            .sheet_names()
            .first()
            .cloned()
            .ok_or_else(|| AppError::Excel("Workbook contains no sheets".to_string()))?;

        let range = workbook
            .worksheet_range(&sheet_name)
            .map_err(|e| AppError::Excel(format!("Failed to read sheet {}: {}", sheet_name, e)))?;

        let mut rows_iter = range.rows();
        let headers_row = rows_iter.next().ok_or_else(|| AppError::Excel("Empty sheet: missing headers row".to_string()))?;

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
        let critical_fields = vec!["invoice_number", "invoice_date", "customer_code", "part_code", "quantity", "rate_pre_unit", "assessable_value"];
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
                file_name: path.file_name().unwrap_or_default().to_string_lossy().into_owned(),
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
            let inv_no = row_data.get("invoice_number").and_then(|c| c.as_string()).unwrap_or_default().trim().to_string();
            if inv_no.is_empty() {
                continue; // Skip completely empty rows
            }

            // 3. TemplateValidator Stage: Date and numbers conversions
            let inv_date_str = row_data.get("invoice_date").and_then(|c| c.as_string()).unwrap_or_default();
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

            let qty = row_data.get("quantity").and_then(|c| c.as_f64()).unwrap_or(0.0);
            let rate = row_data.get("rate_pre_unit").and_then(|c| c.as_f64()).unwrap_or(0.0);
            let ass_val = row_data.get("assessable_value").and_then(|c| c.as_f64()).unwrap_or(0.0);

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
            let cgst = row_data.get("cgst_amount").and_then(|c| c.as_f64()).unwrap_or(0.0);
            let sgst = row_data.get("sgst_amount").and_then(|c| c.as_f64()).unwrap_or(0.0);
            let igst = row_data.get("igst_amount").and_then(|c| c.as_f64()).unwrap_or(0.0);
            let total_val = row_data.get("total_value").and_then(|c| c.as_f64()).unwrap_or(0.0);

            // Math check: assessable_value + taxes should match total_value
            let computed_total = ass_val + cgst + sgst + igst;
            if (computed_total - total_val).abs() > GST_TOLERANCE {
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
            let cust_code = row_data.get("customer_code").and_then(|c| c.as_string()).unwrap_or_default().trim().to_string();
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

            let part_code = row_data.get("part_code").and_then(|c| c.as_string()).unwrap_or_default().trim().to_string();
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
            file_name: path.file_name().unwrap_or_default().to_string_lossy().into_owned(),
            row_count: range.height() as u32,
            mapped_template_name: template_name,
            errors,
            warnings,
            proposed_inserts,
            proposed_updates,
        })
    }

    /// Helper to load lowercase Excel header mappings from DB.
    fn load_mappings(
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

        let mut mappings = HashMap::new();
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
