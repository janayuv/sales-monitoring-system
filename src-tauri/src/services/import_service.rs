use crate::config::GST_TOLERANCE;
use crate::error::AppError;
use crate::models::database_models::{InvoiceItemRow, InvoiceRow};
use crate::models::domain_models::{
    ImportMode, ImportPreview, ValidationErrorDetail, ValidationWarningDetail,
};
use crate::repositories::report_repo::SqliteReportRepository;
use crate::repositories::ReportRepository;
use crate::utils::dates::format_db_date;
use crate::utils::dates::parse_date;
use crate::utils::hash::compute_file_hash;
use calamine::{open_workbook_auto, Data, DataType, Reader};
use rusqlite::{params, Connection};
use std::collections::{HashMap, HashSet};
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
        let existing_batch: Option<(i64, String)> = conn
            .query_row(
                "SELECT id, imported_at FROM import_batches WHERE file_hash = ? AND status = 'completed'",
                [&file_hash],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .ok();

        let is_duplicate = existing_batch.is_some();
        let (existing_batch_id, existing_batch_imported_at) = match existing_batch {
            Some((id, dt)) => (Some(id), Some(dt)),
            None => (None, None),
        };

        let mut errors = Vec::new();
        let mut warnings = Vec::new();

        if is_duplicate {
            warnings.push(ValidationWarningDetail {
                row_no: 0,
                invoice_no: None,
                field_name: "file_hash".to_string(),
                warning_type: "WARN_DUPLICATE_BATCH".to_string(),
                actual_value: file_hash.clone(),
                expected_value: "File was previously imported. Use ReSync mode to synchronize existing records without losing data.".to_string(),
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
                is_duplicate,
                existing_batch_id,
                existing_batch_imported_at,
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
            is_duplicate,
            existing_batch_id,
            existing_batch_imported_at,
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
                &["cgst_amt", "cgst_amount", "cgst", "cgst amt", "cgst amount"],
            ),
            ("sgst_rate", &["sgst_rate", "sgst %", "sgst rate"]),
            (
                "sgst_amount",
                &["sgst_amt", "sgst_amount", "sgst", "sgst amt", "sgst amount"],
            ),
            ("igst_rate", &["igst_rate", "igst %", "igst rate"]),
            (
                "igst_amount",
                &["igst_amt", "igst_amount", "igst", "igst amt", "igst amount"],
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

    /// Executes the outward invoice import pipeline in either Append or ReSync mode.
    pub fn execute_import(
        conn: &mut Connection,
        file_path: &str,
        template_id: i64,
        user_name: &str,
        user_remarks: Option<&str>,
        mode: ImportMode,
    ) -> Result<i64, AppError> {
        let clean_file_path = file_path.trim().trim_matches('"').trim_matches('\'');
        let path = Path::new(clean_file_path);
        if !path.exists() {
            return Err(AppError::Excel(format!(
                "File does not exist or cannot be accessed: {}",
                clean_file_path
            )));
        }

        let file_hash = compute_file_hash(path)
            .map_err(|e| AppError::Excel(format!("Failed to read file hash: {}", e)))?;
        let file_size = path.metadata().map(|m| m.len() as i64).unwrap_or(0);
        let file_name = path
            .file_name()
            .unwrap_or_default()
            .to_string_lossy()
            .into_owned();

        // 1. Check for duplicate batch
        let existing_batch: Option<i64> = conn
            .query_row(
                "SELECT id FROM import_batches WHERE file_hash = ? AND status = 'completed'",
                [&file_hash],
                |row| row.get(0),
            )
            .ok();

        if existing_batch.is_some() && mode == ImportMode::Append {
            return Err(AppError::Validation {
                code: "ERR_IMPORT_002".to_string(),
                message: "This file has already been imported. Switch to ReSync mode to synchronize existing records.".to_string(),
            });
        }

        // Load active template mappings
        let mappings = Self::load_mappings(conn, template_id)?;

        let source_type: String = conn
            .query_row(
                "SELECT source_type FROM import_templates WHERE id = ?",
                [template_id],
                |row| row.get(0),
            )
            .map_err(|_| AppError::Excel("Template source type lookup failed".to_string()))?;

        // Open workbook
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
            .ok_or_else(|| AppError::Excel("Missing headers row".to_string()))?;

        let mut col_index_to_key = HashMap::new();
        for (idx, cell) in headers_row.iter().enumerate() {
            let header_str = cell_to_string(cell);
            let header_clean = header_str.trim().to_lowercase();
            if let Some(key) = mappings.get(&header_clean) {
                col_index_to_key.insert(idx, key.clone());
            }
        }

        // Verify active financial year exists
        let _ = conn
            .query_row(
                "SELECT id FROM financial_years WHERE is_active = 1",
                [],
                |row| row.get::<_, i64>(0),
            )
            .map_err(|_| AppError::Db {
                code: "ERR_DB_001".to_string(),
                message: "No active financial year defined. Create an active financial year first."
                    .to_string(),
            })?;

        // Wrap operations inside a single database transaction (Unit of Work)
        let tx = conn.transaction().map_err(|e| AppError::Db {
            code: "ERR_DB_003".to_string(),
            message: format!("Failed to start transaction: {}", e),
        })?;

        // Insert or update import batch record
        let batch_id = match (existing_batch, mode) {
            (Some(id), ImportMode::ReSync) => {
                tx.execute(
                    "UPDATE import_batches 
                     SET imported_at = datetime('now'), imported_by = ?, user_remarks = COALESCE(?, user_remarks), status = 'staged'
                     WHERE id = ?",
                    params![user_name, user_remarks, id],
                )
                .map_err(|e| AppError::Db {
                    code: "ERR_DB_003".to_string(),
                    message: format!("Failed to update existing batch record for ReSync: {}", e),
                })?;
                id
            }
            _ => {
                tx.execute(
                    "INSERT INTO import_batches (source_type, file_name, file_size_bytes, template_version_id, file_hash, row_count, imported_by, user_remarks, status)
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'staged')",
                    params![
                        source_type,
                        file_name,
                        file_size,
                        template_id,
                        file_hash,
                        (range.height() - 1) as u32,
                        user_name,
                        user_remarks
                    ],
                )
                .map_err(|e| AppError::Db {
                    code: "ERR_DB_003".to_string(),
                    message: format!("Failed to create batch record: {}", e),
                })?;
                tx.last_insert_rowid()
            }
        };

        let mut success_count = 0;
        let mut warning_count = 0;
        let mut error_count = 0;

        let mut invoice_items_buffer: HashMap<String, Vec<InvoiceItemRow>> = HashMap::new();
        let mut invoice_headers_buffer: HashMap<String, InvoiceRow> = HashMap::new();

        for row in rows_iter {
            let mut row_data = HashMap::new();
            for (col_idx, cell) in row.iter().enumerate() {
                if let Some(key) = col_index_to_key.get(&col_idx) {
                    row_data.insert(key.as_str(), cell.clone());
                }
            }

            let inv_no = row_data
                .get("invoice_number")
                .map(cell_to_string)
                .unwrap_or_default();
            if inv_no.is_empty() {
                continue;
            }

            let inv_date_str = row_data
                .get("invoice_date")
                .map(cell_to_string)
                .unwrap_or_default();
            let parsed_inv_date = parse_date(&inv_date_str);
            if parsed_inv_date.is_none() {
                error_count += 1;
                continue;
            }
            let inv_date_obj = parsed_inv_date.unwrap();
            let inv_date = format_db_date(inv_date_obj);

            // Resolve or create Financial Year dynamically
            use chrono::Datelike;
            let year = inv_date_obj.year();
            let month = inv_date_obj.month();
            let (fy_start_year, fy_end_year) = if month >= 4 {
                (year, year + 1)
            } else {
                (year - 1, year)
            };
            let fy_label = format!("FY {}-{}", fy_start_year, fy_end_year % 100);
            let fy_start = format!("{}-04-01", fy_start_year);
            let fy_end = format!("{}-03-31", fy_end_year);

            let active_fy_id: i64 = match tx.query_row(
                "SELECT id FROM financial_years WHERE label = ?",
                [&fy_label],
                |row| row.get(0),
            ) {
                Ok(id) => {
                    tx.execute("UPDATE financial_years SET is_active = (id = ?)", [id])
                        .ok();
                    id
                }
                Err(_) => {
                    tx.execute("UPDATE financial_years SET is_active = 0", [])
                        .ok();
                    tx.execute(
                        "INSERT INTO financial_years (label, start_date, end_date, is_active, is_locked) VALUES (?, ?, ?, 1, 0)",
                        params![fy_label, fy_start, fy_end],
                    )
                    .map_err(|e| AppError::Db {
                        code: "ERR_DB_003".to_string(),
                        message: format!("Failed to create financial year: {}", e),
                    })?;
                    tx.last_insert_rowid()
                }
            };

            // Customer
            let cust_code = row_data
                .get("customer_code")
                .map(cell_to_string)
                .unwrap_or_default();
            let cust_name = row_data
                .get("customer_name")
                .map(cell_to_string)
                .unwrap_or_default();
            let customer_id: i64 = match tx.query_row(
                "SELECT id FROM customers WHERE customer_code = ?",
                [&cust_code],
                |row| row.get(0),
            ) {
                Ok(id) => id,
                Err(_) => {
                    tx.execute(
                        "INSERT INTO customers (customer_code, report_name, status) VALUES (?, ?, 'Pending_Review')",
                        params![cust_code, cust_name],
                    )
                    .map_err(|e| AppError::Db {
                        code: "ERR_DB_003".to_string(),
                        message: format!("Failed to insert customer review registry: {}", e),
                    })?;
                    warning_count += 1;
                    tx.last_insert_rowid()
                }
            };

            // Values
            let qty = row_data.get("quantity").map(cell_to_f64).unwrap_or(0.0);
            let rate = row_data
                .get("rate_pre_unit")
                .map(cell_to_f64)
                .unwrap_or(0.0);
            let ass_val = row_data
                .get("assessable_value")
                .map(cell_to_f64)
                .unwrap_or(0.0);
            let cgst_rate = row_data.get("cgst_rate").map(cell_to_f64).unwrap_or(0.0);
            let cgst = row_data.get("cgst_amount").map(cell_to_f64).unwrap_or(0.0);
            let sgst_rate = row_data.get("sgst_rate").map(cell_to_f64).unwrap_or(0.0);
            let sgst = row_data.get("sgst_amount").map(cell_to_f64).unwrap_or(0.0);
            let igst_rate = row_data.get("igst_rate").map(cell_to_f64).unwrap_or(0.0);
            let igst = row_data.get("igst_amount").map(cell_to_f64).unwrap_or(0.0);
            let line_item_total = ((ass_val + cgst + sgst + igst) * 100.0).round() / 100.0;

            let total_gst_rate = if igst_rate > 0.0 {
                igst_rate
            } else if cgst_rate + sgst_rate > 0.0 {
                cgst_rate + sgst_rate
            } else {
                18.0
            };

            // HSN
            let raw_hsn = row_data
                .get("hsn_code")
                .or_else(|| row_data.get("tariff_code"))
                .or_else(|| row_data.get("tariff"))
                .map(cell_to_string)
                .unwrap_or_default();
            let clean_hsn = raw_hsn.trim().to_string();

            // Part
            let part_code = row_data
                .get("part_code")
                .map(cell_to_string)
                .unwrap_or_default();
            let part_name = row_data
                .get("part_name")
                .map(cell_to_string)
                .unwrap_or_default();

            let target_hsn = if !clean_hsn.is_empty() {
                tx.execute(
                    "INSERT OR IGNORE INTO gst_rates (rate, description) VALUES (?, ?)",
                    params![total_gst_rate, format!("{}% GST", total_gst_rate)],
                )
                .map_err(|e| AppError::Db {
                    code: "ERR_DB_003".to_string(),
                    message: format!("Failed to ensure gst_rate: {}", e),
                })?;

                let hsn_desc = if !part_name.is_empty() {
                    part_name.clone()
                } else {
                    format!("HSN {}", clean_hsn)
                };
                tx.execute(
                    "INSERT OR IGNORE INTO hsn_master (hsn_code, description, gst_rate) VALUES (?, ?, ?)",
                    params![clean_hsn, hsn_desc, total_gst_rate],
                )
                .map_err(|e| AppError::Db {
                    code: "ERR_DB_003".to_string(),
                    message: format!("Failed to auto-populate hsn_master: {}", e),
                })?;

                clean_hsn.clone()
            } else {
                tx.execute(
                    "INSERT OR IGNORE INTO gst_rates (rate, description) VALUES (18.0, '18% GST')",
                    [],
                )
                .ok();
                tx.execute(
                    "INSERT OR IGNORE INTO hsn_master (hsn_code, description, gst_rate) VALUES ('UNASSIGNED', 'Unassigned HSN', 18.0)",
                    [],
                )
                .ok();
                "UNASSIGNED".to_string()
            };

            let part_exists: bool = tx
                .query_row(
                    "SELECT EXISTS(SELECT 1 FROM items WHERE part_code = ?)",
                    [&part_code],
                    |row| row.get(0),
                )
                .unwrap_or(false);

            if !part_exists && !part_code.is_empty() {
                tx.execute(
                    "INSERT INTO items (part_code, part_name, hsn_code, uom_code, default_gst_rate, status)
                     VALUES (?, ?, ?, 'PCS', ?, 'Pending_Review')",
                    params![part_code, part_name, target_hsn, total_gst_rate],
                )
                .map_err(|e| AppError::Db {
                    code: "ERR_DB_003".to_string(),
                    message: format!("Failed to insert item review registry: {}", e),
                })?;
                warning_count += 1;
            }

            let item_hsn = if !clean_hsn.is_empty() {
                Some(clean_hsn.clone())
            } else {
                None
            };

            let item_row = InvoiceItemRow {
                id: None,
                invoice_number: inv_no.clone(),
                part_code,
                description: None,
                quantity: qty,
                rate_pre_unit: rate,
                assessable_value: ass_val,
                cgst_rate,
                cgst_amount: cgst,
                sgst_rate,
                sgst_amount: sgst,
                igst_rate,
                igst_amount: igst,
                total_value: line_item_total,
                hsn_code: item_hsn,
            };

            invoice_items_buffer
                .entry(inv_no.clone())
                .or_insert_with(Vec::new)
                .push(item_row);

            let header = invoice_headers_buffer
                .entry(inv_no.clone())
                .or_insert_with(|| InvoiceRow {
                    invoice_number: inv_no.clone(),
                    invoice_no_long: None,
                    invoice_date: inv_date.clone(),
                    customer_id,
                    financial_year_id: active_fy_id,
                    total_taxable: 0.0,
                    total_cgst: 0.0,
                    total_sgst: 0.0,
                    total_igst: 0.0,
                    total_cess: 0.0,
                    total_value: 0.0,
                    irn: None,
                    irn_date: None,
                    place_of_supply: None,
                    reverse_charge: Some("N".to_string()),
                    invoice_type: Some("Regular B2B".to_string()),
                    status: "Imported".to_string(),
                    cancellation_date: None,
                    import_batch_id: Some(batch_id),
                    created_at: "".to_string(),
                    updated_at: "".to_string(),
                    version: 1,
                });

            header.total_taxable += ass_val;
            header.total_cgst += cgst;
            header.total_sgst += sgst;
            header.total_igst += igst;
            header.total_value += line_item_total;

            success_count += 1;
        }

        // Clean up rounding on headers
        for header in invoice_headers_buffer.values_mut() {
            header.total_taxable = (header.total_taxable * 100.0).round() / 100.0;
            header.total_cgst = (header.total_cgst * 100.0).round() / 100.0;
            header.total_sgst = (header.total_sgst * 100.0).round() / 100.0;
            header.total_igst = (header.total_igst * 100.0).round() / 100.0;
            header.total_value = (header.total_value * 100.0).round() / 100.0;
        }

        let mut affected_fy_ids = HashSet::new();

        for (inv_no, header) in invoice_headers_buffer {
            affected_fy_ids.insert(header.financial_year_id);

            // Upsert header (preserving special statuses like Cancelled, Credit Note Generated)
            tx.execute(
                "INSERT INTO invoices (
                    invoice_number, invoice_date, customer_id, financial_year_id,
                    total_taxable, total_cgst, total_sgst, total_igst, total_cess, total_value,
                    reverse_charge, invoice_type, status, import_batch_id
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(invoice_number) DO UPDATE SET
                    invoice_date = excluded.invoice_date,
                    customer_id = excluded.customer_id,
                    financial_year_id = excluded.financial_year_id,
                    total_taxable = excluded.total_taxable,
                    total_cgst = excluded.total_cgst,
                    total_sgst = excluded.total_sgst,
                    total_igst = excluded.total_igst,
                    total_cess = excluded.total_cess,
                    total_value = excluded.total_value,
                    reverse_charge = COALESCE(excluded.reverse_charge, invoices.reverse_charge),
                    invoice_type = COALESCE(excluded.invoice_type, invoices.invoice_type),
                    status = CASE 
                        WHEN invoices.status IN ('Cancelled', 'Cancelled_Audit', 'Credit Note Generated', 'Debit Note Generated', 'Posted', 'Closed') 
                        THEN invoices.status 
                        ELSE excluded.status 
                    END,
                    import_batch_id = excluded.import_batch_id,
                    updated_at = datetime('now'),
                    version = invoices.version + 1",
                params![
                    header.invoice_number,
                    header.invoice_date,
                    header.customer_id,
                    header.financial_year_id,
                    header.total_taxable,
                    header.total_cgst,
                    header.total_sgst,
                    header.total_igst,
                    header.total_cess,
                    header.total_value,
                    header.reverse_charge,
                    header.invoice_type,
                    header.status,
                    header.import_batch_id
                ],
            )
            .map_err(|e| AppError::Db {
                code: "ERR_DB_003".to_string(),
                message: format!("Failed to commit invoice header: {}", e),
            })?;

            // Confident line-item matching & in-place update (preserving line item IDs for debit notes and audits)
            let mut existing_items_stmt = tx
                .prepare("SELECT id, part_code, hsn_code FROM invoice_items WHERE invoice_number = ? ORDER BY id ASC")
                .map_err(|e| AppError::Db {
                    code: "ERR_DB_003".to_string(),
                    message: format!("Failed to fetch existing invoice items: {}", e),
                })?;

            let mut existing_items: Vec<(i64, String, Option<String>)> = existing_items_stmt
                .query_map([&inv_no], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)))
                .map_err(|e| AppError::Db {
                    code: "ERR_DB_003".to_string(),
                    message: format!("Failed to read existing items: {}", e),
                })?
                .filter_map(|r| r.ok())
                .collect();

            if let Some(incoming_items) = invoice_items_buffer.get(&inv_no) {
                let mut matched_existing_ids = HashSet::new();

                for item in incoming_items {
                    // Match by part_code with an existing item that hasn't been matched in this batch
                    let matched_pos = existing_items.iter().position(|(id, part, _)| {
                        part == &item.part_code && !matched_existing_ids.contains(id)
                    });

                    if let Some(pos) = matched_pos {
                        let (existing_id, _, existing_hsn) = existing_items.remove(pos);
                        matched_existing_ids.insert(existing_id);

                        // If spreadsheet supplies an authoritative HSN, use it; otherwise preserve existing HSN
                        let final_hsn = item.hsn_code.clone().or(existing_hsn);

                        tx.execute(
                            "UPDATE invoice_items
                             SET quantity = ?,
                                 rate_pre_unit = ?,
                                 assessable_value = ?,
                                 cgst_rate = ?,
                                 cgst_amount = ?,
                                 sgst_rate = ?,
                                 sgst_amount = ?,
                                 igst_rate = ?,
                                 igst_amount = ?,
                                 total_value = ?,
                                 hsn_code = ?
                             WHERE id = ?",
                            params![
                                item.quantity,
                                item.rate_pre_unit,
                                item.assessable_value,
                                item.cgst_rate,
                                item.cgst_amount,
                                item.sgst_rate,
                                item.sgst_amount,
                                item.igst_rate,
                                item.igst_amount,
                                item.total_value,
                                final_hsn,
                                existing_id
                            ],
                        )
                        .map_err(|e| AppError::Db {
                            code: "ERR_DB_003".to_string(),
                            message: format!("Failed to update existing invoice line item: {}", e),
                        })?;
                    } else {
                        // Insert new line item
                        tx.execute(
                            "INSERT INTO invoice_items (invoice_number, part_code, quantity, rate_pre_unit, assessable_value,
                                                        cgst_rate, cgst_amount, sgst_rate, sgst_amount, igst_rate, igst_amount, total_value, hsn_code)
                             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                            params![
                                item.invoice_number,
                                item.part_code,
                                item.quantity,
                                item.rate_pre_unit,
                                item.assessable_value,
                                item.cgst_rate,
                                item.cgst_amount,
                                item.sgst_rate,
                                item.sgst_amount,
                                item.igst_rate,
                                item.igst_amount,
                                item.total_value,
                                item.hsn_code
                            ],
                        )
                        .map_err(|e| AppError::Db {
                            code: "ERR_DB_003".to_string(),
                            message: format!("Failed to insert new invoice line item: {}", e),
                        })?;
                    }
                }
            }

            // Recalculate invoice header totals from invoice_items table
            tx.execute(
                "UPDATE invoices
                 SET total_taxable = ROUND((SELECT COALESCE(SUM(assessable_value), invoices.total_taxable) FROM invoice_items WHERE invoice_items.invoice_number = invoices.invoice_number), 2),
                     total_cgst = ROUND((SELECT COALESCE(SUM(cgst_amount), invoices.total_cgst) FROM invoice_items WHERE invoice_items.invoice_number = invoices.invoice_number), 2),
                     total_sgst = ROUND((SELECT COALESCE(SUM(sgst_amount), invoices.total_sgst) FROM invoice_items WHERE invoice_items.invoice_number = invoices.invoice_number), 2),
                     total_igst = ROUND((SELECT COALESCE(SUM(igst_amount), invoices.total_igst) FROM invoice_items WHERE invoice_items.invoice_number = invoices.invoice_number), 2),
                     total_value = ROUND((SELECT COALESCE(SUM(total_value), invoices.total_value) FROM invoice_items WHERE invoice_items.invoice_number = invoices.invoice_number), 2)
                 WHERE invoice_number = ?",
                [&inv_no],
            )
            .map_err(|e| AppError::Db {
                code: "ERR_DB_003".to_string(),
                message: format!("Failed to recalculate invoice totals: {}", e),
            })?;
        }

        // Rebuild materialized summary rollups for all affected financial years
        let report_repo = SqliteReportRepository;
        for fy_id in affected_fy_ids {
            report_repo.refresh_monthly_summary(&tx, fy_id)?;
            report_repo.refresh_customer_summary(&tx, fy_id)?;
            report_repo.refresh_supplier_summary(&tx, fy_id)?;
        }

        // Update batch status to completed
        tx.execute(
            "UPDATE import_batches 
             SET status = 'completed', success_count = ?, warning_count = ?, error_count = ?
             WHERE id = ?",
            params![success_count, warning_count, error_count, batch_id],
        )
        .map_err(|e| AppError::Db {
            code: "ERR_DB_003".to_string(),
            message: format!("Failed to finalize batch record counts: {}", e),
        })?;

        // Central Audit log logging
        let action_desc = match mode {
            ImportMode::ReSync => "Excel Outward Invoices Import Batch ReSynced",
            ImportMode::Append => "Excel Outward Invoices Import Batch Committed",
        };
        tx.execute(
            "INSERT INTO audit_log (user_action, table_name, record_id, old_value, new_value)
             VALUES (?, 'import_batches', ?, NULL, ?)",
            params![
                action_desc,
                batch_id.to_string(),
                format!("Mode: {:?}. Rows: {}. File: {}", mode, success_count, file_name)
            ],
        )
        .map_err(|e| AppError::Db {
            code: "ERR_DB_003".to_string(),
            message: format!("Failed to write audit logs: {}", e),
        })?;

        // Commit Transaction
        tx.commit().map_err(|e| AppError::Db {
            code: "ERR_DB_003".to_string(),
            message: format!("Failed to commit import transaction: {}", e),
        })?;

        Ok(batch_id)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::database::migrate::run_migrations;
    use std::fs;

    fn setup_test_db() -> Connection {
        let mut conn = Connection::open_in_memory().unwrap();
        run_migrations(&mut conn).unwrap();

        // Seed default active financial year
        conn.execute(
            "INSERT OR IGNORE INTO financial_years (id, label, start_date, end_date, is_active, is_locked)
             VALUES (1, 'FY 2026-27', '2026-04-01', '2027-03-31', 1, 0)",
            [],
        ).unwrap();

        conn
    }

    fn create_test_excel(
        file_path: &Path,
        rows: &[(&str, &str, &str, &str, &str, &str, f64, f64, f64, f64, f64, f64, f64, f64, &str)],
    ) {
        use rust_xlsxwriter::*;
        let mut workbook = Workbook::new();
        let worksheet = workbook.add_worksheet();

        let headers = [
            "Invoice Number", "Invoice Date", "Customer Code", "Customer Name",
            "Part Code", "Part Name", "Quantity", "Rate", "Assessable Value",
            "CGST Rate", "CGST Amount", "SGST Rate", "SGST Amount", "Total Value", "HSN Code",
        ];
        for (col, h) in headers.iter().enumerate() {
            worksheet.write_string(0, col as u16, *h).unwrap();
        }

        for (row_idx, row) in rows.iter().enumerate() {
            let r = (row_idx + 1) as u32;
            worksheet.write_string(r, 0, row.0).unwrap();
            worksheet.write_string(r, 1, row.1).unwrap();
            worksheet.write_string(r, 2, row.2).unwrap();
            worksheet.write_string(r, 3, row.3).unwrap();
            worksheet.write_string(r, 4, row.4).unwrap();
            worksheet.write_string(r, 5, row.5).unwrap();
            worksheet.write_number(r, 6, row.6).unwrap();
            worksheet.write_number(r, 7, row.7).unwrap();
            worksheet.write_number(r, 8, row.8).unwrap();
            worksheet.write_number(r, 9, row.9).unwrap();
            worksheet.write_number(r, 10, row.10).unwrap();
            worksheet.write_number(r, 11, row.11).unwrap();
            worksheet.write_number(r, 12, row.12).unwrap();
            worksheet.write_number(r, 13, row.13).unwrap();
            worksheet.write_string(r, 14, row.14).unwrap();
        }

        workbook.save(file_path).unwrap();
    }

    #[test]
    fn test_import_mode_append_and_duplicate_rejection() {
        let mut conn = setup_test_db();
        let temp_dir = std::env::temp_dir();
        let file_path = temp_dir.join(format!("test_import_append_{}.xlsx", uuid::Uuid::new_v4()));

        let rows = [
            (
                "INV-1001", "2026-07-15", "CUST-A", "Customer A",
                "PART-1", "Part 1", 10.0, 100.0, 1000.0,
                9.0, 90.0, 9.0, 90.0, 1180.0, "8708.99.00",
            ),
            (
                "INV-1002", "2026-07-16", "CUST-B", "Customer B",
                "PART-2", "Part 2", 5.0, 200.0, 1000.0,
                9.0, 90.0, 9.0, 90.0, 1180.0, "8708.99.00",
            ),
        ];
        create_test_excel(&file_path, &rows);

        // 1. First import in Append mode -> Must succeed
        let batch_id = ImportService::execute_import(
            &mut conn,
            file_path.to_str().unwrap(),
            1,
            "TestUser",
            Some("Initial append"),
            ImportMode::Append,
        )
        .unwrap();

        assert!(batch_id > 0);

        let invoice_count: i64 = conn
            .query_row("SELECT COUNT(*) FROM invoices", [], |r| r.get(0))
            .unwrap();
        assert_eq!(invoice_count, 2);

        // 2. Second import of the EXACT same file in Append mode -> Must be rejected with ERR_IMPORT_002
        let duplicate_err = ImportService::execute_import(
            &mut conn,
            file_path.to_str().unwrap(),
            1,
            "TestUser",
            Some("Duplicate append"),
            ImportMode::Append,
        );

        match duplicate_err {
            Err(AppError::Validation { code, .. }) => {
                assert_eq!(code, "ERR_IMPORT_002");
            }
            _ => panic!("Expected ERR_IMPORT_002 validation error on duplicate append"),
        }

        let _ = fs::remove_file(file_path);
    }

    #[test]
    fn test_duplicate_detection_returns_preview_metadata_without_fatal_error() {
        let mut conn = setup_test_db();
        let temp_dir = std::env::temp_dir();
        let file_path = temp_dir.join(format!("test_preview_dup_{}.xlsx", uuid::Uuid::new_v4()));

        let rows = [
            (
                "INV-2001", "2026-07-15", "CUST-A", "Customer A",
                "PART-1", "Part 1", 10.0, 100.0, 1000.0,
                9.0, 90.0, 9.0, 90.0, 1180.0, "8708.99.00",
            ),
        ];
        create_test_excel(&file_path, &rows);

        // Import once to establish duplicate batch record
        let batch_id = ImportService::execute_import(
            &mut conn,
            file_path.to_str().unwrap(),
            1,
            "TestUser",
            None,
            ImportMode::Append,
        )
        .unwrap();

        // Run parse_and_preview on the duplicate file
        let preview = ImportService::parse_and_preview(
            &conn,
            file_path.to_str().unwrap(),
            1,
            "TestUser",
        )
        .unwrap();

        assert_eq!(preview.is_duplicate, true);
        assert_eq!(preview.existing_batch_id, Some(batch_id));
        assert!(preview.existing_batch_imported_at.is_some());
        assert_eq!(preview.errors.len(), 0, "Duplicate file must NOT produce fatal errors blocking preview");
        assert_eq!(preview.proposed_updates, 1);

        let _ = fs::remove_file(file_path);
    }

    #[test]
    fn test_import_mode_resync_updates_existing_records_in_place() {
        let mut conn = setup_test_db();
        let temp_dir = std::env::temp_dir();
        let file_path = temp_dir.join(format!("test_resync_{}.xlsx", uuid::Uuid::new_v4()));

        let initial_rows = [
            (
                "INV-3001", "2026-07-15", "CUST-A", "Customer A",
                "PART-1", "Part 1", 10.0, 100.0, 1000.0,
                9.0, 90.0, 9.0, 90.0, 1180.0, "8708.99.00",
            ),
        ];
        create_test_excel(&file_path, &initial_rows);

        ImportService::execute_import(
            &mut conn,
            file_path.to_str().unwrap(),
            1,
            "TestUser",
            None,
            ImportMode::Append,
        )
        .unwrap();

        let initial_item_id: i64 = conn
            .query_row(
                "SELECT id FROM invoice_items WHERE invoice_number = 'INV-3001' AND part_code = 'PART-1'",
                [],
                |r| r.get(0),
            )
            .unwrap();

        // Create updated file with revised rate and HSN
        let updated_rows = [
            (
                "INV-3001", "2026-07-15", "CUST-A", "Customer A",
                "PART-1", "Part 1", 10.0, 150.0, 1500.0,
                9.0, 135.0, 9.0, 135.0, 1770.0, "8409.91.99",
            ),
        ];
        create_test_excel(&file_path, &updated_rows);

        // Execute ReSync
        let resync_batch_id = ImportService::execute_import(
            &mut conn,
            file_path.to_str().unwrap(),
            1,
            "TestUser",
            Some("ReSync with updated rates and HSN"),
            ImportMode::ReSync,
        )
        .unwrap();

        assert!(resync_batch_id > 0);

        // Verify line item was updated in place (same ID!)
        let (updated_item_id, rate, total_val, hsn): (i64, f64, f64, Option<String>) = conn
            .query_row(
                "SELECT id, rate_pre_unit, total_value, hsn_code FROM invoice_items WHERE invoice_number = 'INV-3001'",
                [],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)),
            )
            .unwrap();

        assert_eq!(updated_item_id, initial_item_id, "ReSync must preserve invoice_item_id");
        assert_eq!(rate, 150.0);
        assert_eq!(total_val, 1770.0);
        assert_eq!(hsn, Some("8409.91.99".to_string()));

        // Verify header totals and version
        let (header_total, version): (f64, i32) = conn
            .query_row(
                "SELECT total_value, version FROM invoices WHERE invoice_number = 'INV-3001'",
                [],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .unwrap();
        assert_eq!(header_total, 1770.0);
        assert_eq!(version, 2);

        let _ = fs::remove_file(file_path);
    }

    #[test]
    fn test_resync_preserves_debit_note_mappings_and_foreign_keys() {
        let mut conn = setup_test_db();
        let temp_dir = std::env::temp_dir();
        let file_path = temp_dir.join(format!("test_resync_dn_{}.xlsx", uuid::Uuid::new_v4()));

        let rows = [
            (
                "INV-4001", "2026-07-15", "CUST-A", "Customer A",
                "PART-1", "Part 1", 10.0, 100.0, 1000.0,
                9.0, 90.0, 9.0, 90.0, 1180.0, "8708.99.00",
            ),
        ];
        create_test_excel(&file_path, &rows);

        ImportService::execute_import(
            &mut conn,
            file_path.to_str().unwrap(),
            1,
            "TestUser",
            None,
            ImportMode::Append,
        )
        .unwrap();

        let item_id: i64 = conn
            .query_row(
                "SELECT id FROM invoice_items WHERE invoice_number = 'INV-4001'",
                [],
                |r| r.get(0),
            )
            .unwrap();

        // Create Revision, Recovery Case, and Debit Note linking directly to item_id
        conn.execute(
            "INSERT INTO customer_price_revisions (id, revision_no, customer_id, effective_from, created_by)
             VALUES (1, 'REV-01', 1, '2026-07-01', 'Admin')",
            [],
        ).unwrap();

        conn.execute(
            "INSERT INTO customer_recovery_cases (id, uuid, case_no, customer_id, revision_id, financial_year_id, period_from, period_to, created_by)
             VALUES (1, 'uuid-case-1', 'CASE-001', 1, 1, 1, '2026-07-01', '2026-07-31', 'Admin')",
            [],
        ).unwrap();

        conn.execute(
            "INSERT INTO customer_debit_notes (id, uuid, case_id, financial_year_id, debit_note_no, annexure_no, customer_id, debit_note_date, status, created_by, frozen_customer_name)
             VALUES (1, 'uuid-4001', 1, 1, 'CDN-4001', 'ANN-4001', 1, '2026-07-20', 'Created', 'Admin', 'Customer A')",
            [],
        ).unwrap();

        conn.execute(
            "INSERT INTO customer_debit_note_invoice_map (
                debit_note_id, invoice_id, invoice_number, invoice_item_id,
                part_code, quantity, recovered_qty, balance_qty, rate_pre_unit,
                new_price, difference, assessable_difference, hsn_code, gst_type, frozen_part_number
             ) VALUES (1, 1, 'INV-4001', ?, 'PART-1', 10.0, 0.0, 10.0, 100.0, 120.0, 20.0, 200, '8708.99.00', 'Local', 'PART-1')",
            params![item_id],
        ).unwrap();

        // ReSync the file with updated amount
        let updated_rows = [
            (
                "INV-4001", "2026-07-15", "CUST-A", "Customer A",
                "PART-1", "Part 1", 10.0, 110.0, 1100.0,
                9.0, 99.0, 9.0, 99.0, 1298.0, "8708.99.00",
            ),
        ];
        create_test_excel(&file_path, &updated_rows);

        ImportService::execute_import(
            &mut conn,
            file_path.to_str().unwrap(),
            1,
            "TestUser",
            None,
            ImportMode::ReSync,
        )
        .unwrap();

        // Verify that the debit note mapping row still correctly references item_id
        let mapped_item_id: i64 = conn
            .query_row(
                "SELECT invoice_item_id FROM customer_debit_note_invoice_map WHERE debit_note_id = 1",
                [],
                |r| r.get(0),
            )
            .unwrap();

        assert_eq!(mapped_item_id, item_id, "Debit note mapping must point to the same invoice_item_id after ReSync");

        let _ = fs::remove_file(file_path);
    }

    #[test]
    fn test_partial_spreadsheet_resync_never_deletes_absent_invoices() {
        let mut conn = setup_test_db();
        let temp_dir = std::env::temp_dir();
        let file_path1 = temp_dir.join(format!("test_partial_full_{}.xlsx", uuid::Uuid::new_v4()));
        let file_path2 = temp_dir.join(format!("test_partial_sub_{}.xlsx", uuid::Uuid::new_v4()));

        // Initial batch with INV-5001 and INV-5002
        let full_rows = [
            (
                "INV-5001", "2026-07-15", "CUST-A", "Customer A",
                "PART-1", "Part 1", 10.0, 100.0, 1000.0,
                9.0, 90.0, 9.0, 90.0, 1180.0, "8708.99.00",
            ),
            (
                "INV-5002", "2026-07-16", "CUST-B", "Customer B",
                "PART-2", "Part 2", 5.0, 200.0, 1000.0,
                9.0, 90.0, 9.0, 90.0, 1180.0, "8708.99.00",
            ),
        ];
        create_test_excel(&file_path1, &full_rows);

        ImportService::execute_import(
            &mut conn,
            file_path1.to_str().unwrap(),
            1,
            "TestUser",
            None,
            ImportMode::Append,
        )
        .unwrap();

        assert_eq!(
            conn.query_row::<i64, _, _>("SELECT COUNT(*) FROM invoices", [], |r| r.get(0)).unwrap(),
            2
        );

        // ReSync with a partial spreadsheet containing ONLY INV-5001
        let partial_rows = [
            (
                "INV-5001", "2026-07-15", "CUST-A", "Customer A",
                "PART-1", "Part 1", 12.0, 100.0, 1200.0,
                9.0, 108.0, 9.0, 108.0, 1416.0, "8708.99.00",
            ),
        ];
        create_test_excel(&file_path2, &partial_rows);

        ImportService::execute_import(
            &mut conn,
            file_path2.to_str().unwrap(),
            1,
            "TestUser",
            Some("Partial resync"),
            ImportMode::ReSync,
        )
        .unwrap();

        // Crucial check: Both INV-5001 AND INV-5002 must still exist!
        let total_invoices: i64 = conn
            .query_row("SELECT COUNT(*) FROM invoices", [], |r| r.get(0))
            .unwrap();
        assert_eq!(total_invoices, 2, "Partial spreadsheet ReSync must NEVER delete absent invoices");

        let inv2_exists: bool = conn
            .query_row(
                "SELECT EXISTS(SELECT 1 FROM invoices WHERE invoice_number = 'INV-5002')",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert!(inv2_exists, "INV-5002 must be preserved");

        let _ = fs::remove_file(file_path1);
        let _ = fs::remove_file(file_path2);
    }

    #[test]
    fn test_import_transaction_rollback_on_failure() {
        let mut conn = setup_test_db();
        let temp_dir = std::env::temp_dir();
        let file_path = temp_dir.join(format!("test_rollback_{}.xlsx", uuid::Uuid::new_v4()));

        let rows = [
            (
                "INV-6001", "2026-07-15", "CUST-A", "Customer A",
                "PART-1", "Part 1", 10.0, 100.0, 1000.0,
                9.0, 90.0, 9.0, 90.0, 1180.0, "8708.99.00",
            ),
        ];
        create_test_excel(&file_path, &rows);

        // Intentionally delete financial years so foreign key / financial year resolution triggers an error inside the transaction
        conn.execute("DELETE FROM financial_years", []).unwrap();

        let result = ImportService::execute_import(
            &mut conn,
            file_path.to_str().unwrap(),
            1,
            "TestUser",
            None,
            ImportMode::Append,
        );

        assert!(result.is_err(), "Import must fail when database preconditions fail");

        // Verify zero invoices and zero import batches were committed
        let invoice_count: i64 = conn
            .query_row("SELECT COUNT(*) FROM invoices", [], |r| r.get(0))
            .unwrap_or(0);
        let batch_count: i64 = conn
            .query_row("SELECT COUNT(*) FROM import_batches", [], |r| r.get(0))
            .unwrap_or(0);

        assert_eq!(invoice_count, 0, "No invoices must be committed on failure");
        assert_eq!(batch_count, 0, "No import batches must be committed on failure");

        let _ = fs::remove_file(file_path);
    }

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
