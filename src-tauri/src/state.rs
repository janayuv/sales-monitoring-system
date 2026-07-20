use crate::models::domain_models::DashboardMetrics;
use rusqlite::Connection;
use std::sync::Mutex;

pub struct DbState {
    pub conn: Mutex<Option<Connection>>,
    pub dashboard_cache: Mutex<Option<DashboardMetrics>>,
}

impl DbState {
    pub fn new() -> Self {
        Self {
            conn: Mutex::new(None),
            dashboard_cache: Mutex::new(None),
        }
    }
}
