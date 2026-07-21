use crate::error::AppError;
use crate::models::database_models::{CustomerRow, FinancialYearRow, ItemRow, SupplierRow};
use crate::repositories::MasterRepository;
use rusqlite::{params, Connection, OptionalExtension};

pub struct SqliteMasterRepository;

impl MasterRepository for SqliteMasterRepository {
    // Customers
    fn insert_customer(&self, conn: &mut Connection, row: &CustomerRow) -> Result<(), AppError> {
        conn.execute(
            "INSERT INTO customers (customer_code, report_name, gstin, state_code, address, status)
             VALUES (?, ?, ?, ?, ?, ?)",
            params![
                row.customer_code,
                row.report_name,
                row.gstin,
                row.state_code,
                row.address,
                row.status
            ],
        )
        .map_err(|e| AppError::Db {
            code: "ERR_DB_003".to_string(),
            message: format!("Failed to insert customer: {}", e),
        })?;
        Ok(())
    }

    fn update_customer(&self, conn: &mut Connection, row: &CustomerRow) -> Result<(), AppError> {
        conn.execute(
            "UPDATE customers SET report_name = ?, gstin = ?, state_code = ?, address = ?, status = ?
             WHERE customer_code = ?",
            params![row.report_name, row.gstin, row.state_code, row.address, row.status, row.customer_code],
        )
        .map_err(|e| AppError::Db {
            code: "ERR_DB_003".to_string(),
            message: format!("Failed to update customer: {}", e),
        })?;
        Ok(())
    }

    fn find_customer(
        &self,
        conn: &Connection,
        code: &str,
    ) -> Result<Option<CustomerRow>, AppError> {
        conn.query_row(
            "SELECT id, customer_code, report_name, tally_customer_name, gstin, state_code, address, status
             FROM customers WHERE customer_code = ?",
            [code],
            |row| {
                Ok(CustomerRow {
                    id: Some(row.get(0)?),
                    customer_code: row.get(1)?,
                    report_name: row.get(2)?,
                    tally_customer_name: row.get(3)?,
                    gstin: row.get(4)?,
                    state_code: row.get(5)?,
                    address: row.get(6)?,
                    status: row.get(7)?,
                })
            },
        )
        .optional()
        .map_err(|e| AppError::Db {
            code: "ERR_DB_003".to_string(),
            message: format!("Failed to find customer: {}", e),
        })
    }

    fn list_customers(
        &self,
        conn: &Connection,
        status: Option<&str>,
    ) -> Result<Vec<CustomerRow>, AppError> {
        let mut query = "SELECT id, customer_code, report_name, tally_customer_name, gstin, state_code, address, status FROM customers".to_string();
        let mut params_vec: Vec<String> = Vec::new();
        if let Some(s) = status {
            query.push_str(" WHERE status = ?");
            params_vec.push(s.to_string());
        }

        let mut stmt = conn.prepare(&query).map_err(|e| AppError::Db {
            code: "ERR_DB_003".to_string(),
            message: format!("Failed to prepare list customers query: {}", e),
        })?;

        let rows = stmt
            .query_map(rusqlite::params_from_iter(params_vec.iter()), |row| {
                Ok(CustomerRow {
                    id: Some(row.get(0)?),
                    customer_code: row.get(1)?,
                    report_name: row.get(2)?,
                    tally_customer_name: row.get(3)?,
                    gstin: row.get(4)?,
                    state_code: row.get(5)?,
                    address: row.get(6)?,
                    status: row.get(7)?,
                })
            })
            .map_err(|e| AppError::Db {
                code: "ERR_DB_003".to_string(),
                message: format!("Failed to query customers: {}", e),
            })?;

        let mut list = Vec::new();
        for r in rows {
            list.push(r.map_err(|e| AppError::Db {
                code: "ERR_DB_003".to_string(),
                message: format!("Failed to read customer row: {}", e),
            })?);
        }
        Ok(list)
    }

    // Suppliers
    fn insert_supplier(&self, conn: &mut Connection, row: &SupplierRow) -> Result<(), AppError> {
        conn.execute(
            "INSERT INTO suppliers (supplier_code, supplier_name, gstin, state_code, address, status)
             VALUES (?, ?, ?, ?, ?, ?)",
            params![row.supplier_code, row.supplier_name, row.gstin, row.state_code, row.address, row.status],
        )
        .map_err(|e| AppError::Db {
            code: "ERR_DB_003".to_string(),
            message: format!("Failed to insert supplier: {}", e),
        })?;
        Ok(())
    }

    fn update_supplier(&self, conn: &mut Connection, row: &SupplierRow) -> Result<(), AppError> {
        conn.execute(
            "UPDATE suppliers SET supplier_name = ?, gstin = ?, state_code = ?, address = ?, status = ?
             WHERE supplier_code = ?",
            params![row.supplier_name, row.gstin, row.state_code, row.address, row.status, row.supplier_code],
        )
        .map_err(|e| AppError::Db {
            code: "ERR_DB_003".to_string(),
            message: format!("Failed to update supplier: {}", e),
        })?;
        Ok(())
    }

    fn find_supplier(
        &self,
        conn: &Connection,
        code: &str,
    ) -> Result<Option<SupplierRow>, AppError> {
        conn.query_row(
            "SELECT id, supplier_code, supplier_name, gstin, state_code, address, status 
             FROM suppliers WHERE supplier_code = ?",
            [code],
            |row| {
                Ok(SupplierRow {
                    id: Some(row.get(0)?),
                    supplier_code: row.get(1)?,
                    supplier_name: row.get(2)?,
                    gstin: row.get(3)?,
                    state_code: row.get(4)?,
                    address: row.get(5)?,
                    status: row.get(6)?,
                })
            },
        )
        .optional()
        .map_err(|e| AppError::Db {
            code: "ERR_DB_003".to_string(),
            message: format!("Failed to find supplier: {}", e),
        })
    }

    fn list_suppliers(
        &self,
        conn: &Connection,
        status: Option<&str>,
    ) -> Result<Vec<SupplierRow>, AppError> {
        let mut query = "SELECT id, supplier_code, supplier_name, gstin, state_code, address, status FROM suppliers".to_string();
        let mut params_vec: Vec<String> = Vec::new();
        if let Some(s) = status {
            query.push_str(" WHERE status = ?");
            params_vec.push(s.to_string());
        }

        let mut stmt = conn.prepare(&query).map_err(|e| AppError::Db {
            code: "ERR_DB_003".to_string(),
            message: format!("Failed to prepare list suppliers query: {}", e),
        })?;

        let rows = stmt
            .query_map(rusqlite::params_from_iter(params_vec.iter()), |row| {
                Ok(SupplierRow {
                    id: Some(row.get(0)?),
                    supplier_code: row.get(1)?,
                    supplier_name: row.get(2)?,
                    gstin: row.get(3)?,
                    state_code: row.get(4)?,
                    address: row.get(5)?,
                    status: row.get(6)?,
                })
            })
            .map_err(|e| AppError::Db {
                code: "ERR_DB_003".to_string(),
                message: format!("Failed to query suppliers: {}", e),
            })?;

        let mut list = Vec::new();
        for r in rows {
            list.push(r.map_err(|e| AppError::Db {
                code: "ERR_DB_003".to_string(),
                message: format!("Failed to read supplier row: {}", e),
            })?);
        }
        Ok(list)
    }

    // Items
    fn insert_item(&self, conn: &mut Connection, row: &ItemRow) -> Result<(), AppError> {
        conn.execute(
            "INSERT INTO items (part_code, part_name, hsn_code, uom_code, default_gst_rate, supplier_id, status)
             VALUES (?, ?, ?, ?, ?, ?, ?)",
            params![row.part_code, row.part_name, row.hsn_code, row.uom_code, row.default_gst_rate, row.supplier_id, row.status],
        )
        .map_err(|e| AppError::Db {
            code: "ERR_DB_003".to_string(),
            message: format!("Failed to insert item: {}", e),
        })?;
        Ok(())
    }

    fn update_item(&self, conn: &mut Connection, row: &ItemRow) -> Result<(), AppError> {
        conn.execute(
            "UPDATE items SET part_name = ?, hsn_code = ?, uom_code = ?, default_gst_rate = ?, supplier_id = ?, status = ?
             WHERE part_code = ?",
            params![row.part_name, row.hsn_code, row.uom_code, row.default_gst_rate, row.supplier_id, row.status, row.part_code],
        )
        .map_err(|e| AppError::Db {
            code: "ERR_DB_003".to_string(),
            message: format!("Failed to update item: {}", e),
        })?;
        Ok(())
    }

    fn find_item(&self, conn: &Connection, code: &str) -> Result<Option<ItemRow>, AppError> {
        conn.query_row(
            "SELECT part_code, part_name, hsn_code, uom_code, default_gst_rate, supplier_id, status 
             FROM items WHERE part_code = ?",
            [code],
            |row| {
                Ok(ItemRow {
                    part_code: row.get(0)?,
                    part_name: row.get(1)?,
                    hsn_code: row.get(2)?,
                    uom_code: row.get(3)?,
                    default_gst_rate: row.get(4)?,
                    supplier_id: row.get(5)?,
                    status: row.get(6)?,
                })
            },
        )
        .optional()
        .map_err(|e| AppError::Db {
            code: "ERR_DB_003".to_string(),
            message: format!("Failed to find item: {}", e),
        })
    }

    fn list_items(
        &self,
        conn: &Connection,
        status: Option<&str>,
    ) -> Result<Vec<ItemRow>, AppError> {
        let mut query = "SELECT part_code, part_name, hsn_code, uom_code, default_gst_rate, supplier_id, status FROM items".to_string();
        let mut params_vec: Vec<String> = Vec::new();
        if let Some(s) = status {
            query.push_str(" WHERE status = ?");
            params_vec.push(s.to_string());
        }

        let mut stmt = conn.prepare(&query).map_err(|e| AppError::Db {
            code: "ERR_DB_003".to_string(),
            message: format!("Failed to prepare list items query: {}", e),
        })?;

        let rows = stmt
            .query_map(rusqlite::params_from_iter(params_vec.iter()), |row| {
                Ok(ItemRow {
                    part_code: row.get(0)?,
                    part_name: row.get(1)?,
                    hsn_code: row.get(2)?,
                    uom_code: row.get(3)?,
                    default_gst_rate: row.get(4)?,
                    supplier_id: row.get(5)?,
                    status: row.get(6)?,
                })
            })
            .map_err(|e| AppError::Db {
                code: "ERR_DB_003".to_string(),
                message: format!("Failed to query items: {}", e),
            })?;

        let mut list = Vec::new();
        for r in rows {
            list.push(r.map_err(|e| AppError::Db {
                code: "ERR_DB_003".to_string(),
                message: format!("Failed to read item row: {}", e),
            })?);
        }
        Ok(list)
    }

    // Financial Years
    fn insert_fy(&self, conn: &mut Connection, row: &FinancialYearRow) -> Result<i64, AppError> {
        conn.execute(
            "INSERT INTO financial_years (label, start_date, end_date, is_active, is_locked, closed_at)
             VALUES (?, ?, ?, ?, ?, ?)",
            params![row.label, row.start_date, row.end_date, row.is_active, row.is_locked, row.closed_at],
        )
        .map_err(|e| AppError::Db {
            code: "ERR_DB_003".to_string(),
            message: format!("Failed to insert financial year: {}", e),
        })?;
        Ok(conn.last_insert_rowid())
    }

    fn lock_fy(&self, conn: &mut Connection, id: i64) -> Result<(), AppError> {
        conn.execute(
            "UPDATE financial_years SET is_locked = 1, closed_at = datetime('now') WHERE id = ?",
            params![id],
        )
        .map_err(|e| AppError::Db {
            code: "ERR_DB_003".to_string(),
            message: format!("Failed to lock financial year: {}", e),
        })?;
        Ok(())
    }

    fn get_active_fy(&self, conn: &Connection) -> Result<Option<FinancialYearRow>, AppError> {
        conn.query_row(
            "SELECT id, label, start_date, end_date, is_active, is_locked, closed_at 
             FROM financial_years WHERE is_active = 1",
            [],
            |row| {
                Ok(FinancialYearRow {
                    id: Some(row.get(0)?),
                    label: row.get(1)?,
                    start_date: row.get(2)?,
                    end_date: row.get(3)?,
                    is_active: row.get(4)?,
                    is_locked: row.get(5)?,
                    closed_at: row.get(6)?,
                })
            },
        )
        .optional()
        .map_err(|e| AppError::Db {
            code: "ERR_DB_003".to_string(),
            message: format!("Failed to query active financial year: {}", e),
        })
    }
}
