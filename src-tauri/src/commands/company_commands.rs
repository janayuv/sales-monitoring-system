use crate::error::AppError;
use crate::models::domain_models::CompanyProfileRow;
use crate::state::DbState;
use base64::{engine::general_purpose::STANDARD, Engine as _};
use serde::{Deserialize, Serialize};
use std::path::Path;
use tauri::State;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct CompanyProfilePayload {
    pub company_name: Option<String>,
    pub legal_name: Option<String>,
    pub gstin: Option<String>,
    pub pan: Option<String>,
    pub address1: Option<String>,
    pub address2: Option<String>,
    pub location: Option<String>,
    pub pincode: Option<String>,
    pub state_code: Option<String>,
    pub phone: Option<String>,
    pub email: Option<String>,
    pub logo: Option<String>,
}

fn norm(v: &Option<String>) -> Option<String> {
    v.as_ref()
        .map(|s| s.trim())
        .filter(|s| !s.is_empty())
        .map(|s| s.to_string())
}

/// Light field validation (spec §4.3). Nothing is required; checks apply only
/// when a value is present.
pub fn validate_company_profile(p: &CompanyProfilePayload) -> Result<(), AppError> {
    let val = |msg: &str| AppError::Validation {
        code: "ERR_VAL_001".to_string(),
        message: msg.to_string(),
    };
    if let Some(g) = norm(&p.gstin) {
        if g.len() != 15 {
            return Err(val("GSTIN must be 15 characters"));
        }
    }
    if let Some(pan) = norm(&p.pan) {
        if pan.len() != 10 {
            return Err(val("PAN must be 10 characters"));
        }
    }
    if let Some(pin) = norm(&p.pincode) {
        if pin.len() != 6 || !pin.chars().all(|c| c.is_ascii_digit()) {
            return Err(val("Pincode must be 6 digits"));
        }
    }
    if let Some(sc) = norm(&p.state_code) {
        if sc.len() != 2 || !sc.chars().all(|c| c.is_ascii_digit()) {
            return Err(val("State code must be a 2-digit GST code"));
        }
    }
    if let Some(e) = norm(&p.email) {
        if !e.contains('@') {
            return Err(val("Email must contain @"));
        }
    }
    Ok(())
}

/// Fetch the single company profile row, or empty defaults if unset.
#[tauri::command]
pub fn get_company_profile(state: State<'_, DbState>) -> Result<CompanyProfileRow, AppError> {
    let guard = state
        .conn
        .lock()
        .map_err(|e| AppError::Internal(format!("Failed to acquire connection lock: {}", e)))?;
    let conn = guard.as_ref().ok_or_else(|| AppError::Db {
        code: "ERR_DB_002".to_string(),
        message: "No active database connection profile".to_string(),
    })?;

    let row = conn.query_row(
        "SELECT id, company_name, legal_name, gstin, pan, address1, address2,
                location, pincode, state_code, phone, email, logo
         FROM company_profile WHERE id = 1",
        [],
        |r| {
            Ok(CompanyProfileRow {
                id: r.get(0)?,
                company_name: r.get(1)?,
                legal_name: r.get(2)?,
                gstin: r.get(3)?,
                pan: r.get(4)?,
                address1: r.get(5)?,
                address2: r.get(6)?,
                location: r.get(7)?,
                pincode: r.get(8)?,
                state_code: r.get(9)?,
                phone: r.get(10)?,
                email: r.get(11)?,
                logo: r.get(12)?,
            })
        },
    );

    match row {
        Ok(profile) => Ok(profile),
        Err(rusqlite::Error::QueryReturnedNoRows) => Ok(CompanyProfileRow {
            id: 1,
            company_name: None,
            legal_name: None,
            gstin: None,
            pan: None,
            address1: None,
            address2: None,
            location: None,
            pincode: None,
            state_code: None,
            phone: None,
            email: None,
            logo: None,
        }),
        Err(e) => Err(AppError::Db {
            code: "ERR_DB_003".to_string(),
            message: format!("Failed to load company profile: {}", e),
        }),
    }
}

/// Insert or update the single company profile row (id = 1).
#[tauri::command]
pub fn save_company_profile(
    state: State<'_, DbState>,
    payload: CompanyProfilePayload,
) -> Result<(), AppError> {
    validate_company_profile(&payload)?;
    let guard = state
        .conn
        .lock()
        .map_err(|e| AppError::Internal(format!("Failed to acquire connection lock: {}", e)))?;
    let conn = guard.as_ref().ok_or_else(|| AppError::Db {
        code: "ERR_DB_002".to_string(),
        message: "No active database connection profile".to_string(),
    })?;

    conn.execute(
        "INSERT INTO company_profile
            (id, company_name, legal_name, gstin, pan, address1, address2,
             location, pincode, state_code, phone, email, logo, updated_at)
         VALUES (1, ?,?,?,?,?,?,?,?,?,?,?,?, datetime('now'))
         ON CONFLICT(id) DO UPDATE SET
            company_name=excluded.company_name, legal_name=excluded.legal_name,
            gstin=excluded.gstin, pan=excluded.pan, address1=excluded.address1,
            address2=excluded.address2, location=excluded.location, pincode=excluded.pincode,
            state_code=excluded.state_code, phone=excluded.phone, email=excluded.email,
            logo=excluded.logo, updated_at=datetime('now')",
        rusqlite::params![
            norm(&payload.company_name),
            norm(&payload.legal_name),
            norm(&payload.gstin),
            norm(&payload.pan),
            norm(&payload.address1),
            norm(&payload.address2),
            norm(&payload.location),
            norm(&payload.pincode),
            norm(&payload.state_code),
            norm(&payload.phone),
            norm(&payload.email),
            norm(&payload.logo),
        ],
    )
    .map_err(|e| AppError::Db {
        code: "ERR_DB_003".to_string(),
        message: format!("Failed to save company profile: {}", e),
    })?;
    Ok(())
}

const MAX_LOGO_BYTES: u64 = 512 * 1024;

/// Reads a picked image file and returns a base64 `data:` URL. Enforces a
/// 512 KB cap and an image-extension allowlist (the size guard lives here so it
/// cannot be bypassed from the UI).
#[tauri::command]
pub fn read_logo_as_data_url(file_path: String) -> Result<String, AppError> {
    let clean = file_path.trim().trim_matches('"').trim_matches('\'');
    let path = Path::new(clean);

    let meta = std::fs::metadata(path).map_err(|e| AppError::Validation {
        code: "ERR_VAL_001".to_string(),
        message: format!("Cannot read image: {e}"),
    })?;
    if meta.len() > MAX_LOGO_BYTES {
        return Err(AppError::Validation {
            code: "ERR_VAL_001".to_string(),
            message: "Logo must be under 512 KB".to_string(),
        });
    }

    let ext = path
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_lowercase();
    let mime = match ext.as_str() {
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "svg" => "image/svg+xml",
        _ => {
            return Err(AppError::Validation {
                code: "ERR_VAL_001".to_string(),
                message: "Unsupported image type (use png, jpg, gif, webp, or svg)".to_string(),
            })
        }
    };

    let bytes = std::fs::read(path).map_err(|e| AppError::Validation {
        code: "ERR_VAL_001".to_string(),
        message: format!("Cannot read image: {e}"),
    })?;
    Ok(format!("data:{};base64,{}", mime, STANDARD.encode(bytes)))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample() -> CompanyProfilePayload {
        CompanyProfilePayload {
            company_name: Some("Acme Auto Parts".to_string()),
            legal_name: Some("Acme Auto Parts Pvt Ltd".to_string()),
            gstin: Some("33AAACH2364M1ZM".to_string()),
            pan: Some("AAACH2364M".to_string()),
            address1: Some("H-1 SIPCOT".to_string()),
            address2: None,
            location: Some("Kancheepuram".to_string()),
            pincode: Some("602117".to_string()),
            state_code: Some("33".to_string()),
            phone: None,
            email: None,
            logo: None,
        }
    }

    #[test]
    fn validate_accepts_empty_payload() {
        let empty = CompanyProfilePayload {
            company_name: None,
            legal_name: None,
            gstin: None,
            pan: None,
            address1: None,
            address2: None,
            location: None,
            pincode: None,
            state_code: None,
            phone: None,
            email: None,
            logo: None,
        };
        assert!(validate_company_profile(&empty).is_ok());
    }

    #[test]
    fn validate_accepts_valid_payload() {
        assert!(validate_company_profile(&sample()).is_ok());
    }

    #[test]
    fn validate_rejects_bad_gstin_pan_pincode_state_email() {
        let mut p = sample();
        p.gstin = Some("SHORT".to_string());
        assert!(validate_company_profile(&p).is_err());

        p = sample();
        p.pan = Some("ABC".to_string());
        assert!(validate_company_profile(&p).is_err());

        p = sample();
        p.pincode = Some("12".to_string());
        assert!(validate_company_profile(&p).is_err());

        p = sample();
        p.state_code = Some("333".to_string());
        assert!(validate_company_profile(&p).is_err());

        p = sample();
        p.email = Some("no-at-sign".to_string());
        assert!(validate_company_profile(&p).is_err());
    }

    use crate::database::migrate::run_migrations;
    use rusqlite::Connection;

    fn db() -> Connection {
        let mut c = Connection::open_in_memory().unwrap();
        run_migrations(&mut c).unwrap();
        c
    }

    // Mirrors save_company_profile's SQL without the Tauri State wrapper.
    fn save_raw(conn: &Connection, p: &CompanyProfilePayload) {
        conn.execute(
            "INSERT INTO company_profile
                (id, company_name, legal_name, gstin, pan, address1, address2,
                 location, pincode, state_code, phone, email, logo, updated_at)
             VALUES (1, ?,?,?,?,?,?,?,?,?,?,?,?, datetime('now'))
             ON CONFLICT(id) DO UPDATE SET
                company_name=excluded.company_name, legal_name=excluded.legal_name,
                gstin=excluded.gstin, pan=excluded.pan, address1=excluded.address1,
                address2=excluded.address2, location=excluded.location, pincode=excluded.pincode,
                state_code=excluded.state_code, phone=excluded.phone, email=excluded.email,
                logo=excluded.logo, updated_at=datetime('now')",
            rusqlite::params![
                norm(&p.company_name),
                norm(&p.legal_name),
                norm(&p.gstin),
                norm(&p.pan),
                norm(&p.address1),
                norm(&p.address2),
                norm(&p.location),
                norm(&p.pincode),
                norm(&p.state_code),
                norm(&p.phone),
                norm(&p.email),
                norm(&p.logo),
            ],
        )
        .unwrap();
    }

    #[test]
    fn save_then_read_roundtrips_and_second_save_updates_same_row() {
        let conn = db();

        let mut p = sample();
        p.logo = Some("data:image/png;base64,AAAA".to_string());
        save_raw(&conn, &p);

        let (name, gstin, logo): (String, String, String) = conn
            .query_row(
                "SELECT company_name, gstin, logo FROM company_profile WHERE id = 1",
                [],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
            )
            .unwrap();
        assert_eq!(name, "Acme Auto Parts");
        assert_eq!(gstin, "33AAACH2364M1ZM");
        assert_eq!(logo, "data:image/png;base64,AAAA");

        // Second save updates the same single row.
        let mut p2 = sample();
        p2.company_name = Some("Acme Renamed".to_string());
        save_raw(&conn, &p2);

        let (count, name2): (i64, String) = conn
            .query_row(
                "SELECT COUNT(*), MAX(company_name) FROM company_profile",
                [],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .unwrap();
        assert_eq!(count, 1, "must stay a single row");
        assert_eq!(name2, "Acme Renamed");
    }

    #[test]
    fn logo_reads_small_png_as_data_url() {
        let mut path = std::env::temp_dir();
        path.push(format!("cp_logo_{}.png", std::process::id()));
        std::fs::write(&path, [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]).unwrap();

        let url = read_logo_as_data_url(path.to_string_lossy().to_string()).unwrap();
        assert!(url.starts_with("data:image/png;base64,"), "got {url}");

        std::fs::remove_file(&path).ok();
    }

    #[test]
    fn logo_rejects_unsupported_extension() {
        let mut path = std::env::temp_dir();
        path.push(format!("cp_logo_{}.txt", std::process::id()));
        std::fs::write(&path, b"hello").unwrap();

        let res = read_logo_as_data_url(path.to_string_lossy().to_string());
        assert!(res.is_err(), "non-image extension must be rejected");

        std::fs::remove_file(&path).ok();
    }

    #[test]
    fn logo_rejects_oversized_file() {
        let mut path = std::env::temp_dir();
        path.push(format!("cp_logo_big_{}.png", std::process::id()));
        std::fs::write(&path, vec![0u8; 600 * 1024]).unwrap(); // 600 KB > 512 KB cap

        let res = read_logo_as_data_url(path.to_string_lossy().to_string());
        assert!(res.is_err(), "files over 512 KB must be rejected");

        std::fs::remove_file(&path).ok();
    }
}
