use crate::error::AppError;
use rusqlite::{params, Connection};

pub struct Migration {
    pub version: i32,
    pub description: &'static str,
    pub sql: &'static str,
    /// When true, the migration is a full table rebuild: it runs with
    /// foreign_keys disabled and a foreign_key_check before commit, because
    /// SQLite cannot ALTER away a foreign key or CHECK constraint in place.
    pub rebuild: bool,
}

pub fn run_migrations(conn: &mut Connection) -> Result<(), AppError> {
    // 1. Create migrations tracking table if not present
    conn.execute(
        "CREATE TABLE IF NOT EXISTS schema_migrations (
            version INTEGER PRIMARY KEY,
            applied_at TEXT NOT NULL DEFAULT (datetime('now')),
            description TEXT
         )",
        [],
    )
    .map_err(|e| AppError::Db {
        code: "ERR_DB_003".to_string(),
        message: format!("Failed to create schema_migrations table: {}", e),
    })?;

    // 2. Fetch last applied migration version
    let current_version: i32 = conn
        .query_row(
            "SELECT COALESCE(MAX(version), 0) FROM schema_migrations",
            [],
            |row| row.get(0),
        )
        .map_err(|e| AppError::Db {
            code: "ERR_DB_003".to_string(),
            message: format!("Failed to fetch current schema version: {}", e),
        })?;

    // 3. Define migrations list
    let migrations = vec![
        Migration {
            version: 1,
            description: "Initial schema migrations containing all master and transactional tables",
            sql: include_str!("../migrations/0001_init.sql"),
            rebuild: false,
        },
        Migration {
            version: 2,
            description: "Add tally_customer_name column to customers table",
            sql: "ALTER TABLE customers ADD COLUMN tally_customer_name TEXT;",
            rebuild: false,
        },
        Migration {
            version: 3,
            description: "Add customer_categories table and category_name column to customers table",
            sql: "CREATE TABLE IF NOT EXISTS customer_categories (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL UNIQUE,
                description TEXT,
                created_at TEXT NOT NULL DEFAULT (datetime('now'))
            );
            ALTER TABLE customers ADD COLUMN category_name TEXT;",
            rebuild: false,
        },
        Migration {
            version: 4,
            description: "Rebuild customers into full customer master (rename customer_name->report_name, add master columns, drop state_code FK)",
            rebuild: true,
            sql: "
                CREATE TABLE customers_new (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    customer_code TEXT NOT NULL UNIQUE,
                    report_name TEXT NOT NULL,
                    tally_customer_name TEXT,
                    legal_name TEXT,
                    gstin TEXT,
                    address1 TEXT,
                    address2 TEXT,
                    location TEXT,
                    pincode TEXT,
                    state_code TEXT,
                    place_of_supply TEXT,
                    phone TEXT,
                    email TEXT,
                    category_name TEXT,
                    remarks TEXT,
                    status TEXT NOT NULL DEFAULT 'Approved' CHECK(status IN ('Approved', 'Pending_Review'))
                );
                INSERT INTO customers_new
                    (id, customer_code, report_name, tally_customer_name, legal_name, gstin,
                     address1, address2, location, pincode, state_code, place_of_supply,
                     phone, email, category_name, remarks, status)
                SELECT id, customer_code, customer_name, tally_customer_name, NULL, gstin,
                       address, NULL, NULL, NULL, state_code, NULL,
                       NULL, NULL, category_name, NULL, status
                FROM customers;
                DROP TABLE customers;
                ALTER TABLE customers_new RENAME TO customers;
                CREATE INDEX IF NOT EXISTS idx_customers_code ON customers(customer_code);
            ",
        },
    ];

    // 4. Apply migrations sequentially
    for migration in migrations {
        if migration.version > current_version {
            log::info!(
                "Applying migration v{}: {}",
                migration.version,
                migration.description
            );
            if migration.rebuild {
                apply_rebuild_migration(conn, &migration)?;
            } else {
                let tx = conn.transaction().map_err(|e| AppError::Db {
                    code: "ERR_DB_003".to_string(),
                    message: format!("Failed to begin transaction: {}", e),
                })?;
                tx.execute_batch(migration.sql).map_err(|e| AppError::Db {
                    code: "ERR_DB_003".to_string(),
                    message: format!("Failed to execute migration script: {}", e),
                })?;
                tx.execute(
                    "INSERT INTO schema_migrations (version, description) VALUES (?, ?)",
                    params![migration.version, migration.description],
                )
                .map_err(|e| AppError::Db {
                    code: "ERR_DB_003".to_string(),
                    message: format!("Failed to log migration status: {}", e),
                })?;
                tx.commit().map_err(|e| AppError::Db {
                    code: "ERR_DB_003".to_string(),
                    message: format!("Failed to commit migration transaction: {}", e),
                })?;
            }
        }
    }

    Ok(())
}

/// Applies a table-rebuild migration. `PRAGMA foreign_keys` is a no-op inside a
/// transaction, so it is toggled OFF outside, then a foreign_key_check runs
/// before commit; any violation rolls the whole rebuild back.
fn apply_rebuild_migration(conn: &mut Connection, migration: &Migration) -> Result<(), AppError> {
    conn.pragma_update(None, "foreign_keys", "OFF")
        .map_err(|e| AppError::Db {
            code: "ERR_DB_003".to_string(),
            message: format!("Failed to disable foreign_keys for rebuild: {}", e),
        })?;

    let result = (|| {
        let tx = conn.transaction().map_err(|e| AppError::Db {
            code: "ERR_DB_003".to_string(),
            message: format!("Failed to begin rebuild transaction: {}", e),
        })?;
        tx.execute_batch(migration.sql).map_err(|e| AppError::Db {
            code: "ERR_DB_003".to_string(),
            message: format!("Failed to execute rebuild script: {}", e),
        })?;
        tx.execute(
            "INSERT INTO schema_migrations (version, description) VALUES (?, ?)",
            params![migration.version, migration.description],
        )
        .map_err(|e| AppError::Db {
            code: "ERR_DB_003".to_string(),
            message: format!("Failed to log rebuild migration: {}", e),
        })?;
        let violations: i64 = tx
            .query_row("SELECT COUNT(*) FROM pragma_foreign_key_check", [], |r| {
                r.get(0)
            })
            .map_err(|e| AppError::Db {
                code: "ERR_DB_003".to_string(),
                message: format!("foreign_key_check read failed: {e}"),
            })?;
        if violations > 0 {
            return Err(AppError::Db {
                code: "ERR_DB_003".to_string(),
                message: format!(
                    "Rebuild v{} failed foreign_key_check ({violations} violations)",
                    migration.version
                ),
            });
        }
        tx.commit().map_err(|e| AppError::Db {
            code: "ERR_DB_003".to_string(),
            message: format!("Failed to commit rebuild transaction: {}", e),
        })?;
        Ok(())
    })();

    // Restore enforcement regardless of outcome.
    conn.pragma_update(None, "foreign_keys", "ON").ok();
    result
}

#[cfg(test)]
mod tests {
    use super::*;
    use rusqlite::Connection;

    fn columns(conn: &Connection, table: &str) -> Vec<String> {
        let mut stmt = conn
            .prepare(&format!("PRAGMA table_info({})", table))
            .unwrap();
        let cols = stmt
            .query_map([], |row| row.get::<_, String>(1))
            .unwrap()
            .map(|r| r.unwrap())
            .collect();
        cols
    }

    #[test]
    fn v4_customers_has_master_columns_and_free_text_state() {
        let mut conn = Connection::open_in_memory().unwrap();
        run_migrations(&mut conn).unwrap();

        let cols = columns(&conn, "customers");
        for expected in [
            "report_name",
            "legal_name",
            "address1",
            "address2",
            "location",
            "pincode",
            "place_of_supply",
            "phone",
            "email",
            "remarks",
        ] {
            assert!(
                cols.contains(&expected.to_string()),
                "missing column {expected}"
            );
        }
        assert!(
            !cols.contains(&"customer_name".to_string()),
            "customer_name must be renamed"
        );

        // Free-text GST state code accepted (no FK to states).
        conn.execute(
            "INSERT INTO customers (customer_code, report_name, state_code, place_of_supply, status)
             VALUES ('C1', 'Report Co', '33', '33', 'Approved')",
            [],
        )
        .unwrap();
        let state: String = conn
            .query_row(
                "SELECT state_code FROM customers WHERE customer_code='C1'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(state, "33");
    }

    #[test]
    fn v4_preserves_invoice_customer_fk_roundtrip() {
        let mut conn = Connection::open_in_memory().unwrap();
        run_migrations(&mut conn).unwrap();

        conn.execute(
            "INSERT INTO customers (id, customer_code, report_name, status) VALUES (7, 'C7', 'Seven', 'Approved')",
            [],
        )
        .unwrap();
        // financial_years id=1 is seeded by 0001. Invoice FK to customers(7) must resolve.
        conn.execute(
            "INSERT INTO invoices (invoice_number, invoice_date, customer_id, financial_year_id, total_taxable, total_value, status)
             VALUES ('INV7', '2025-05-01', 7, 1, 100.0, 118.0, 'Imported')",
            [],
        )
        .unwrap();
        let cnt: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM invoices WHERE customer_id = 7",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(cnt, 1);
    }

    #[test]
    fn rebuild_migration_rolls_back_and_restores_fk_enforcement_on_violation() {
        let mut conn = Connection::open_in_memory().unwrap();
        run_migrations(&mut conn).unwrap();

        // Set up a parent/child pair with a dangling FK reference. foreign_keys
        // enforcement is switched OFF first so the bad insert is allowed to land
        // (mirrors how a real rebuild leaves stray rows behind before the check
        // runs); pragma_foreign_key_check reports violations regardless of the
        // enforcement pragma's runtime state.
        conn.pragma_update(None, "foreign_keys", "OFF").unwrap();
        conn.execute_batch(
            "CREATE TABLE p (id INTEGER PRIMARY KEY);
             CREATE TABLE c (pid INTEGER REFERENCES p(id));
             INSERT INTO c (pid) VALUES (999);",
        )
        .unwrap();

        let bogus_migration = Migration {
            version: 9999,
            description: "test-only rebuild probe (no-op, unrelated to the FK violation)",
            sql: "CREATE TABLE IF NOT EXISTS _rebuild_probe (x INTEGER);",
            rebuild: true,
        };

        let result = apply_rebuild_migration(&mut conn, &bogus_migration);
        assert!(
            result.is_err(),
            "pre-existing dangling FK should abort the rebuild via foreign_key_check"
        );

        // Rolled back: the rebuild's own DDL must not have survived the abort.
        let probe_exists: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='_rebuild_probe'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(
            probe_exists, 0,
            "_rebuild_probe must not exist after rollback"
        );

        // schema_migrations must not record the failed rebuild either.
        let logged: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM schema_migrations WHERE version = 9999",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(logged, 0, "failed rebuild must not be logged as applied");

        // foreign_keys enforcement must be restored to ON afterward, regardless
        // of the failure.
        let fk_on: i64 = conn
            .query_row("PRAGMA foreign_keys", [], |r| r.get(0))
            .unwrap();
        assert_eq!(
            fk_on, 1,
            "foreign_keys must be restored to ON after a failed rebuild"
        );
    }
}
