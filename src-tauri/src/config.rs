pub const GST_TOLERANCE: f64 = 0.05;         // Math rounding tolerance for GST values (INR)
pub const DECIMAL_PRECISION: usize = 2;       // Standard financial rounding decimal places
pub const DEFAULT_PAGINATION_SIZE: u64 = 50;  // Cursor query batch size
pub const BACKUP_INTERVAL_DAYS: i64 = 7;     // Scheduled warning trigger interval
pub const MAX_UPLOAD_SIZE_BYTES: u64 = 50 * 1024 * 1024; // Max size for Excel files (50MB)
pub const STORAGE_DATE_FORMAT: &str = "%Y-%m-%d"; // SQLite standard date format
