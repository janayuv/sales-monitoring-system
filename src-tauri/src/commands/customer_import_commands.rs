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
    let guard = state
        .conn
        .lock()
        .map_err(|e| AppError::Internal(format!("lock: {e}")))?;
    let conn = guard.as_ref().ok_or_else(|| AppError::Db {
        code: "ERR_DB_002".to_string(),
        message: "No active database connection profile".to_string(),
    })?;
    preview_import(conn, &file_path)
}

#[tauri::command]
pub fn commit_customer_master_import(
    state: State<'_, DbState>,
    file_path: String,
    user: String,
) -> Result<CustomerImportResult, AppError> {
    let mut guard = state
        .conn
        .lock()
        .map_err(|e| AppError::Internal(format!("lock: {e}")))?;
    let conn = guard.as_mut().ok_or_else(|| AppError::Db {
        code: "ERR_DB_002".to_string(),
        message: "No active database connection profile".to_string(),
    })?;
    commit_import(conn, &file_path, &user)
}

/// Canonical customer-master import headers, in column order. These are the
/// primary names matched by the importer's `field_for_header`.
const TEMPLATE_HEADERS: [&str; 15] = [
    "customer_code",
    "report_name",
    "tally_name",
    "legal_name",
    "gstin",
    "address1",
    "address2",
    "location",
    "pincode",
    "place_of_supply",
    "state_code",
    "phone",
    "email",
    "status",
    "remarks",
];

/// Writes a blank customer-master import template as a real .xlsx workbook with
/// a bold header row, ready for the user to fill in and re-import.
#[tauri::command]
pub fn export_customer_master_template(output_path: String) -> Result<(), AppError> {
    use rust_xlsxwriter::{Format, Workbook};

    let mut workbook = Workbook::new();
    let worksheet = workbook.add_worksheet();
    worksheet
        .set_name("Customer Master")
        .map_err(|e| AppError::Export {
            code: "ERR_CM_TPL_001".to_string(),
            message: format!("Failed to set worksheet name: {e}"),
        })?;

    let header_fmt = Format::new().set_bold();
    for (col, header) in TEMPLATE_HEADERS.iter().enumerate() {
        worksheet
            .write_string_with_format(0, col as u16, *header, &header_fmt)
            .map_err(|e| AppError::Export {
                code: "ERR_CM_TPL_001".to_string(),
                message: format!("Failed to write header '{header}': {e}"),
            })?;
        worksheet.set_column_width(col as u16, 18.0).ok();
    }

    workbook.save(&output_path).map_err(|e| AppError::Export {
        code: "ERR_CM_TPL_001".to_string(),
        message: format!("Failed to save template: {e}"),
    })?;

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::services::import_service::cell_to_string;
    use calamine::{open_workbook_auto, Reader};

    #[test]
    fn template_writes_xlsx_with_expected_header_row() {
        let mut path = std::env::temp_dir();
        path.push(format!("cm_template_test_{}.xlsx", std::process::id()));
        let path_str = path.to_string_lossy().to_string();

        export_customer_master_template(path_str.clone()).expect("template should write");
        assert!(path.exists(), "template .xlsx should exist on disk");

        let mut wb = open_workbook_auto(&path).expect("should open written workbook");
        let sheet = wb.sheet_names()[0].clone();
        let range = wb.worksheet_range(&sheet).expect("should read sheet");
        let header: Vec<String> = range
            .rows()
            .next()
            .expect("header row present")
            .iter()
            .map(cell_to_string)
            .collect();

        let expected: Vec<String> = TEMPLATE_HEADERS.iter().map(|s| s.to_string()).collect();
        assert_eq!(header, expected, "row 1 must be the 15 canonical headers");

        std::fs::remove_file(&path).ok();
    }
}
