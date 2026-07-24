use crate::error::AppError;
use crate::models::domain_models::CustomerMasterRow;
use crate::state::DbState;
use serde::{Deserialize, Serialize};
use tauri::State;
use ts_rs::TS;

#[derive(Debug, Serialize, Deserialize, Clone, TS)]
#[ts(export, export_to = "../../src/types/bindings/CustomerCategoryRow.ts")]
pub struct CustomerCategoryRow {
    pub id: i64,
    pub name: String,
    pub description: Option<String>,
    pub created_at: String,
}

/// Fetch all customer categories.
#[tauri::command]
pub fn get_customer_categories(
    state: State<'_, DbState>,
) -> Result<Vec<CustomerCategoryRow>, AppError> {
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
            "SELECT id, name, description, created_at FROM customer_categories ORDER BY name ASC",
        )
        .map_err(|e| AppError::Db {
            code: "ERR_DB_003".to_string(),
            message: format!("Failed to query customer categories: {}", e),
        })?;

    let rows = stmt
        .query_map([], |row| {
            Ok(CustomerCategoryRow {
                id: row.get(0)?,
                name: row.get(1)?,
                description: row.get(2)?,
                created_at: row.get(3)?,
            })
        })
        .map_err(|e| AppError::Db {
            code: "ERR_DB_003".to_string(),
            message: format!("Failed to map category rows: {}", e),
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

/// Create a new customer category.
#[tauri::command]
pub fn create_customer_category(
    state: State<'_, DbState>,
    name: String,
    description: Option<String>,
) -> Result<CustomerCategoryRow, AppError> {
    let conn_guard = state
        .conn
        .lock()
        .map_err(|e| AppError::Internal(format!("Failed to acquire connection lock: {}", e)))?;
    let conn = conn_guard.as_ref().ok_or_else(|| AppError::Db {
        code: "ERR_DB_002".to_string(),
        message: "No active database connection profile".to_string(),
    })?;

    let trimmed_name = name.trim();
    if trimmed_name.is_empty() {
        return Err(AppError::Validation {
            code: "ERR_VAL_001".to_string(),
            message: "Category name cannot be empty".to_string(),
        });
    }

    let trimmed_desc = description
        .as_ref()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty());

    conn.execute(
        "INSERT INTO customer_categories (name, description) VALUES (?, ?)",
        rusqlite::params![trimmed_name, trimmed_desc],
    )
    .map_err(|e| AppError::Db {
        code: "ERR_DB_003".to_string(),
        message: format!("Failed to create category (name may already exist): {}", e),
    })?;

    let id = conn.last_insert_rowid();

    let category = conn
        .query_row(
            "SELECT id, name, description, created_at FROM customer_categories WHERE id = ?",
            [id],
            |row| {
                Ok(CustomerCategoryRow {
                    id: row.get(0)?,
                    name: row.get(1)?,
                    description: row.get(2)?,
                    created_at: row.get(3)?,
                })
            },
        )
        .map_err(|e| AppError::Db {
            code: "ERR_DB_003".to_string(),
            message: format!("Failed to fetch created category: {}", e),
        })?;

    Ok(category)
}

/// Delete a customer category by ID.
#[tauri::command]
pub fn delete_customer_category(
    state: State<'_, DbState>,
    category_id: i64,
) -> Result<(), AppError> {
    let conn_guard = state
        .conn
        .lock()
        .map_err(|e| AppError::Internal(format!("Failed to acquire connection lock: {}", e)))?;
    let conn = conn_guard.as_ref().ok_or_else(|| AppError::Db {
        code: "ERR_DB_002".to_string(),
        message: "No active database connection profile".to_string(),
    })?;

    let category_name: Option<String> = conn
        .query_row(
            "SELECT name FROM customer_categories WHERE id = ?",
            [category_id],
            |row| row.get(0),
        )
        .ok();

    if let Some(cat_name) = category_name {
        // Reset category_name on customers using this category
        let _ = conn.execute(
            "UPDATE customers SET category_name = NULL WHERE category_name = ?",
            [cat_name],
        );
    }

    conn.execute(
        "DELETE FROM customer_categories WHERE id = ?",
        [category_id],
    )
    .map_err(|e| AppError::Db {
        code: "ERR_DB_003".to_string(),
        message: format!("Failed to delete category: {}", e),
    })?;

    Ok(())
}

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
    v.as_ref()
        .map(|s| s.trim())
        .filter(|s| !s.is_empty())
        .map(|s| s.to_string())
}

/// Light field validation (spec §4.3). Required: customer_code, report_name.
pub fn validate_customer_payload(p: &CustomerMasterPayload) -> Result<(), AppError> {
    let val = |msg: &str| AppError::Validation {
        code: "ERR_VAL_001".to_string(),
        message: msg.to_string(),
    };
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
    for (label, code) in [
        ("State code", norm(&p.state_code)),
        ("Place of supply", norm(&p.place_of_supply)),
    ] {
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
pub fn create_customer_master(
    state: State<'_, DbState>,
    payload: CustomerMasterPayload,
) -> Result<i64, AppError> {
    validate_customer_payload(&payload)?;
    let conn_guard = state
        .conn
        .lock()
        .map_err(|e| AppError::Internal(format!("Failed to acquire connection lock: {}", e)))?;
    let conn = conn_guard.as_ref().ok_or_else(|| AppError::Db {
        code: "ERR_DB_002".to_string(),
        message: "No active database connection profile".to_string(),
    })?;

    conn.execute(
        "INSERT INTO customers
            (customer_code, report_name, tally_customer_name, legal_name, gstin, address1, address2,
             location, pincode, state_code, place_of_supply, phone, email, category_name, remarks, status)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
        rusqlite::params![
            payload.customer_code.trim(),
            payload.report_name.trim(),
            norm(&payload.tally_name),
            norm(&payload.legal_name),
            norm(&payload.gstin),
            norm(&payload.address1),
            norm(&payload.address2),
            norm(&payload.location),
            norm(&payload.pincode),
            norm(&payload.state_code),
            norm(&payload.place_of_supply),
            norm(&payload.phone),
            norm(&payload.email),
            norm(&payload.category_name),
            norm(&payload.remarks),
            payload.status,
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
pub fn update_customer_master(
    state: State<'_, DbState>,
    payload: CustomerMasterPayload,
) -> Result<(), AppError> {
    validate_customer_payload(&payload)?;
    let id = payload.id.ok_or_else(|| AppError::Validation {
        code: "ERR_VAL_001".to_string(),
        message: "Customer id is required for update".to_string(),
    })?;
    let conn_guard = state
        .conn
        .lock()
        .map_err(|e| AppError::Internal(format!("Failed to acquire connection lock: {}", e)))?;
    let conn = conn_guard.as_ref().ok_or_else(|| AppError::Db {
        code: "ERR_DB_002".to_string(),
        message: "No active database connection profile".to_string(),
    })?;

    conn.execute(
        "UPDATE customers SET
            customer_code=?, report_name=?, tally_customer_name=?, legal_name=?, gstin=?, address1=?, address2=?,
            location=?, pincode=?, state_code=?, place_of_supply=?, phone=?, email=?, category_name=?, remarks=?, status=?
         WHERE id=?",
        rusqlite::params![
            payload.customer_code.trim(),
            payload.report_name.trim(),
            norm(&payload.tally_name),
            norm(&payload.legal_name),
            norm(&payload.gstin),
            norm(&payload.address1),
            norm(&payload.address2),
            norm(&payload.location),
            norm(&payload.pincode),
            norm(&payload.state_code),
            norm(&payload.place_of_supply),
            norm(&payload.phone),
            norm(&payload.email),
            norm(&payload.category_name),
            norm(&payload.remarks),
            payload.status,
            id,
        ],
    )
    .map_err(|e| AppError::Db {
        code: "ERR_DB_003".to_string(),
        message: format!("Failed to update customer: {}", e),
    })?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn match_status_needs_tally_when_tally_missing() {
        assert_eq!(
            derive_match_status(None, Some("33AAAA"), Some("addr"), Some("33")),
            "Needs Tally name"
        );
        assert_eq!(
            derive_match_status(Some("  "), Some("x"), Some("y"), Some("33")),
            "Needs Tally name"
        );
    }

    #[test]
    fn match_status_incomplete_when_core_field_missing() {
        assert_eq!(
            derive_match_status(Some("Tally Co"), None, Some("addr"), Some("33")),
            "Incomplete"
        );
        assert_eq!(
            derive_match_status(Some("Tally Co"), Some("g"), None, Some("33")),
            "Incomplete"
        );
        assert_eq!(
            derive_match_status(Some("Tally Co"), Some("g"), Some("a"), None),
            "Incomplete"
        );
    }

    #[test]
    fn match_status_complete_when_all_present() {
        assert_eq!(
            derive_match_status(Some("Tally Co"), Some("g"), Some("a"), Some("33")),
            "Complete"
        );
    }

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
}
