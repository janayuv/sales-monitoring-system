use chrono::{NaiveDate, ParseResult};

/// Standardizes date parsing from common formats found in Excel (like "DD-MM-YYYY", "DD/MM/YYYY", "YYYY-MM-DD")
pub fn parse_date(date_str: &str) -> Option<NaiveDate> {
    let cleaned = date_str.trim();
    if cleaned.is_empty() {
        return None;
    }

    // Try YYYY-MM-DD
    if let Ok(d) = NaiveDate::parse_from_str(cleaned, "%Y-%m-%d") {
        return Some(d);
    }
    // Try DD-MM-YYYY
    if let Ok(d) = NaiveDate::parse_from_str(cleaned, "%d-%m-%Y") {
        return Some(d);
    }
    // Try DD/MM/YYYY
    if let Ok(d) = NaiveDate::parse_from_str(cleaned, "%d/%m/%Y") {
        return Some(d);
    }
    // Try YYYY/MM/DD
    if let Ok(d) = NaiveDate::parse_from_str(cleaned, "%Y/%m/%d") {
        return Some(d);
    }

    None
}

/// Formats date to the standard DB storage format
pub fn format_db_date(date: NaiveDate) -> String {
    date.format("%Y-%m-%d").to_string()
}
