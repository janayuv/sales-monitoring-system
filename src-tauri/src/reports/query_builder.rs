use rusqlite::types::ToSql;
use crate::reports::common::ReportFilterCommon;

#[derive(Default)]
pub struct ReportQueryBuilder {
    where_conditions: Vec<String>,
    params: Vec<Box<dyn ToSql>>,
    order_by_clause: Option<String>,
    limit_clause: Option<String>,
}

impl ReportQueryBuilder {
    pub fn new() -> Self {
        Self::default()
    }

    /// Add a custom raw WHERE condition with optional parameter
    pub fn where_clause(&mut self, sql_condition: impl Into<String>, param: Option<Box<dyn ToSql>>) -> &mut Self {
        self.where_conditions.push(sql_condition.into());
        if let Some(p) = param {
            self.params.push(p);
        }
        self
    }

    /// Apply standard date range and status filters from ReportFilterCommon
    pub fn apply_common_filters(&mut self, common: &ReportFilterCommon, date_column: &str, status_column: &str) -> &mut Self {
        if let Some(ref date_from) = common.date_from {
            if !date_from.trim().is_empty() {
                self.where_conditions.push(format!("{} >= ?", date_column));
                self.params.push(Box::new(date_from.clone()));
            }
        }

        if let Some(ref date_to) = common.date_to {
            if !date_to.trim().is_empty() {
                self.where_conditions.push(format!("{} <= ?", date_column));
                self.params.push(Box::new(date_to.clone()));
            }
        }

        if let Some(fy_id) = common.financial_year_id {
            if fy_id > 0 {
                self.where_conditions.push("i.financial_year_id = ?".to_string());
                self.params.push(Box::new(fy_id));
            }
        }

        let include_cancelled = common.include_cancelled.unwrap_or(false);
        if !include_cancelled {
            if let Some(ref statuses) = common.invoice_statuses {
                if !statuses.is_empty() {
                    let placeholders = vec!["?"; statuses.len()].join(", ");
                    self.where_conditions.push(format!("{} IN ({})", status_column, placeholders));
                    for s in statuses {
                        self.params.push(Box::new(s.clone()));
                    }
                } else {
                    self.where_conditions.push(format!("{} NOT IN ('Cancelled', 'Draft')", status_column));
                }
            } else {
                self.where_conditions.push(format!("{} NOT IN ('Cancelled', 'Draft')", status_column));
            }
        }

        self
    }

    pub fn order_by(&mut self, order_sql: impl Into<String>) -> &mut Self {
        self.order_by_clause = Some(order_sql.into());
        self
    }

    pub fn paginate(&mut self, page: Option<u32>, page_size: Option<u32>) -> &mut Self {
        let page_size = page_size.unwrap_or(100).min(10000);
        let page = page.unwrap_or(1).max(1);
        let offset = (page - 1) * page_size;
        self.limit_clause = Some(format!("LIMIT {} OFFSET {}", page_size, offset));
        self
    }

    pub fn build_where_sql(&self) -> String {
        if self.where_conditions.is_empty() {
            String::new()
        } else {
            format!(" WHERE {}", self.where_conditions.join(" AND "))
        }
    }

    pub fn build_order_sql(&self) -> String {
        match &self.order_by_clause {
            Some(clause) => format!(" ORDER BY {}", clause),
            None => String::new(),
        }
    }

    pub fn build_limit_sql(&self) -> String {
        match &self.limit_clause {
            Some(clause) => format!(" {}", clause),
            None => String::new(),
        }
    }

    pub fn params_as_refs(&self) -> Vec<&dyn ToSql> {
        self.params.iter().map(|p| p.as_ref()).collect()
    }
}
