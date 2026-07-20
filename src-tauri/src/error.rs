use serde::{Serialize, Serializer};
use thiserror::Error;

#[derive(Error, Debug)]
pub enum AppError {
    #[error("Database error: {message}")]
    Db { code: String, message: String },

    #[error("Excel error: {0}")]
    Excel(String),

    #[error("Validation error: {message}")]
    Validation { code: String, message: String },

    #[error("Export error: {message}")]
    Export { code: String, message: String },

    #[error("Backup error: {message}")]
    Backup { code: String, message: String },

    #[error("I/O error: {0}")]
    Io(#[from] std::io::Error),

    #[error("Internal system error: {0}")]
    Internal(String),
}

impl AppError {
    pub fn code(&self) -> String {
        match self {
            AppError::Db { code, .. } => code.clone(),
            AppError::Validation { code, .. } => code.clone(),
            AppError::Export { code, .. } => code.clone(),
            AppError::Backup { code, .. } => code.clone(),
            AppError::Excel(_) => "ERR_IMPORT_001".to_string(),
            AppError::Io(_) => "ERR_FS_001".to_string(),
            AppError::Internal(_) => "ERR_SYS_001".to_string(),
        }
    }

    pub fn message(&self) -> String {
        self.to_string()
    }
}

impl Serialize for AppError {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        #[derive(Serialize)]
        struct SerializedError {
            code: String,
            message: String,
        }

        let err = SerializedError {
            code: self.code(),
            message: self.message(),
        };
        err.serialize(serializer)
    }
}
