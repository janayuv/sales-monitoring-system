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

/// Update a single customer's mapping (both Tally name and Category name).
#[tauri::command]
pub fn update_customer_mapping(
    state: State<'_, DbState>,
    customer_id: i64,
    tally_name: Option<String>,
    category_name: Option<String>,
) -> Result<(), AppError> {
    let conn_guard = state
        .conn
        .lock()
        .map_err(|e| AppError::Internal(format!("Failed to acquire connection lock: {}", e)))?;
    let conn = conn_guard.as_ref().ok_or_else(|| AppError::Db {
        code: "ERR_DB_002".to_string(),
        message: "No active database connection profile".to_string(),
    })?;

    let tally_val = tally_name
        .as_ref()
        .map(|s| s.trim())
        .filter(|s| !s.is_empty())
        .map(|s| s.to_string());
    let category_val = category_name
        .as_ref()
        .map(|s| s.trim())
        .filter(|s| !s.is_empty())
        .map(|s| s.to_string());

    conn.execute(
        "UPDATE customers SET tally_customer_name = ?, category_name = ? WHERE id = ?",
        rusqlite::params![tally_val, category_val, customer_id],
    )
    .map_err(|e| AppError::Db {
        code: "ERR_DB_003".to_string(),
        message: format!("Failed to update customer mapping: {}", e),
    })?;

    Ok(())
}

#[derive(Debug, Serialize, Deserialize)]
pub struct CustomerMappingUpdatePayload {
    pub customer_id: i64,
    pub tally_name: Option<String>,
    pub category_name: Option<String>,
}

/// Bulk update customer mappings (Tally name & Category name).
#[tauri::command]
pub fn bulk_update_customer_mappings(
    state: State<'_, DbState>,
    updates: Vec<CustomerMappingUpdatePayload>,
) -> Result<(), AppError> {
    let conn_guard = state
        .conn
        .lock()
        .map_err(|e| AppError::Internal(format!("Failed to acquire connection lock: {}", e)))?;
    let conn = conn_guard.as_ref().ok_or_else(|| AppError::Db {
        code: "ERR_DB_002".to_string(),
        message: "No active database connection profile".to_string(),
    })?;

    for item in updates {
        let tally_val = item
            .tally_name
            .as_ref()
            .map(|s| s.trim())
            .filter(|s| !s.is_empty())
            .map(|s| s.to_string());
        let category_val = item
            .category_name
            .as_ref()
            .map(|s| s.trim())
            .filter(|s| !s.is_empty())
            .map(|s| s.to_string());

        conn.execute(
            "UPDATE customers SET tally_customer_name = ?, category_name = ? WHERE id = ?",
            rusqlite::params![tally_val, category_val, item.customer_id],
        )
        .map_err(|e| AppError::Db {
            code: "ERR_DB_003".to_string(),
            message: format!("Failed to update customer ID {}: {}", item.customer_id, e),
        })?;
    }

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
}
