use chrono::{Datelike, NaiveDate, ParseResult};

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

/// Shifts a "YYYY-MM-DD" date string by a number of years (negative to go
/// back). Falls back to the previous day if the exact day doesn't exist in
/// the target year's month (e.g. Feb 29 on a non-leap year becomes Feb 28),
/// instead of the fragile string-replace hack this replaces.
pub fn shift_years(date_str: &str, years: i32) -> Option<String> {
    let date = NaiveDate::parse_from_str(date_str, "%Y-%m-%d").ok()?;
    let target_year = date.year() + years;
    NaiveDate::from_ymd_opt(target_year, date.month(), date.day())
        .or_else(|| NaiveDate::from_ymd_opt(target_year, date.month(), date.day() - 1))
        .map(format_db_date)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn shift_years_moves_a_normal_date_back_one_year() {
        assert_eq!(
            shift_years("2026-07-20", -1),
            Some("2025-07-20".to_string())
        );
    }

    #[test]
    fn shift_years_falls_back_a_day_for_leap_day_in_a_non_leap_target_year() {
        // 2024 is a leap year, 2025 is not.
        assert_eq!(shift_years("2024-02-29", 1), Some("2025-02-28".to_string()));
    }

    #[test]
    fn shift_years_returns_none_for_unparseable_input() {
        assert_eq!(shift_years("not-a-date", -1), None);
    }
}
