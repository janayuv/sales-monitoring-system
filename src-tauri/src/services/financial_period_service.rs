use rusqlite::{Connection, OptionalExtension};
use crate::error::AppError;

pub struct FinancialPeriodService;

impl FinancialPeriodService {
    pub fn is_period_locked(conn: &Connection, date_str: &str) -> Result<bool, AppError> {
        let is_locked: Option<i32> = conn.query_row(
            "SELECT is_locked FROM financial_years WHERE ? BETWEEN start_date AND end_date",
            [date_str],
            |row| row.get(0),
        )
        .optional()
        .map_err(|e| AppError::Db {
            code: "ERR_DB_003".to_string(),
            message: format!("Failed to query financial year lock state: {}", e),
        })?;

        Ok(is_locked.unwrap_or(0) == 1)
    }

    pub fn get_financial_year_id_by_date(conn: &Connection, date_str: &str) -> Result<i64, AppError> {
        let fy_id: Option<i64> = conn.query_row(
            "SELECT id FROM financial_years WHERE ? BETWEEN start_date AND end_date",
            [date_str],
            |row| row.get(0),
        )
        .optional()
        .map_err(|e| AppError::Db {
            code: "ERR_DB_003".to_string(),
            message: format!("Failed to query financial year ID: {}", e),
        })?;

        fy_id.ok_or_else(|| AppError::Validation {
            code: "ERR_VAL_001".to_string(),
            message: format!("No financial year matches the date: {}", date_str),
        })
    }
}
