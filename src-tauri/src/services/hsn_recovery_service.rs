use std::collections::HashMap;
use std::path::Path;
use calamine::{open_workbook_auto, Data, Reader};
use rusqlite::Connection;
use serde::{Deserialize, Serialize};
use ts_rs::TS;
use crate::error::AppError;

/// Result summary of the historical HSN recovery process.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../src/types/bindings/HsnRecoveryReport.ts")]
pub struct HsnRecoveryReport {
    pub total_candidates: usize,
    pub matched: usize,
    pub unmatched: usize,
    pub ambiguous: usize,
    pub repaired: usize,
    pub details: Vec<String>,
}

/// Represents a parsed invoice line from source sales export/upload files.
#[derive(Debug, Clone)]
pub struct SourceHsnRow {
    pub invoice_no: String,
    pub prod_cde: String,
    pub prod_cust_no: String,
    pub quantity: f64,
    pub assessable_value: f64,
    pub hsn_code: String,
    pub gst_rate: f64,
}

fn cell_to_str(cell: &Data) -> String {
    match cell {
        Data::String(s) => s.trim().to_string(),
        Data::Float(f) => {
            let val = *f as i64;
            if (val as f64 - *f).abs() < 0.00001 {
                val.to_string()
            } else {
                f.to_string()
            }
        }
        Data::Int(i) => i.to_string(),
        _ => String::new(),
    }
}

fn cell_to_f64(cell: &Data) -> f64 {
    match cell {
        Data::Float(f) => *f,
        Data::Int(i) => *i as f64,
        Data::String(s) => s.trim().replace(',', "").parse::<f64>().unwrap_or(0.0),
        _ => 0.0,
    }
}

pub struct HsnRecoveryService;

impl HsnRecoveryService {
    /// Parses source Excel files (.xls, .xlsx) and extracts all valid transaction lines with their HSN codes.
    pub fn parse_source_files<P: AsRef<Path>>(paths: &[P]) -> Result<Vec<SourceHsnRow>, AppError> {
        let mut source_lines = Vec::new();

        for path_ref in paths {
            let path = path_ref.as_ref();
            if !path.exists() {
                continue;
            }

            let mut wb = match open_workbook_auto(path) {
                Ok(w) => w,
                Err(_) => continue,
            };

            for sheet in wb.sheet_names().to_vec() {
                if let Ok(range) = wb.worksheet_range(&sheet) {
                    if range.height() < 2 {
                        continue;
                    }

                    let header: Vec<String> = range
                        .rows()
                        .next()
                        .unwrap()
                        .iter()
                        .map(|c| {
                            c.to_string()
                                .to_lowercase()
                                .replace(' ', "")
                                .replace('_', "")
                                .replace('.', "")
                        })
                        .collect();

                    let mut inv_col = None;
                    let mut prod_cde_col = None;
                    let mut prod_cust_no_col = None;
                    let mut qty_col = None;
                    let mut val_col = None;
                    let mut hsn_col = None;
                    let mut cgst_col = None;
                    let mut igst_col = None;

                    for (idx, h) in header.iter().enumerate() {
                        if h == "invno" {
                            inv_col = Some(idx);
                        } else if (h == "invoiceno" || h == "inv no" || h == "invoicenumber")
                            && inv_col.is_none()
                        {
                            inv_col = Some(idx);
                        } else if h == "prodcde" || h == "partcode" || h == "partno" {
                            prod_cde_col = Some(idx);
                        } else if h == "prodcustno" || h == "itemcode" || h == "customercode" {
                            prod_cust_no_col = Some(idx);
                        } else if (h == "ioqty" || h == "qty" || h == "quantity")
                            && qty_col.is_none()
                        {
                            qty_col = Some(idx);
                        } else if (h == "assessablevalue"
                            || h == "taxablevalue"
                            || h == "taxableamt")
                            && val_col.is_none()
                        {
                            val_col = Some(idx);
                        } else if (h == "tariffcode"
                            || h == "tariff"
                            || h == "hsncode"
                            || h == "hsn")
                            && hsn_col.is_none()
                        {
                            hsn_col = Some(idx);
                        } else if (h == "cgstrate" || h == "cgst%") && cgst_col.is_none() {
                            cgst_col = Some(idx);
                        } else if (h == "igstrate" || h == "igst%") && igst_col.is_none() {
                            igst_col = Some(idx);
                        }
                    }

                    if let (Some(i_c), Some(q_c), Some(v_c), Some(h_c)) =
                        (inv_col, qty_col, val_col, hsn_col)
                    {
                        for row in range.rows().skip(1) {
                            let inv = cell_to_str(&row[i_c]);
                            let prod_cde = prod_cde_col
                                .map(|c| cell_to_str(&row[c]))
                                .unwrap_or_default();
                            let prod_cust_no = prod_cust_no_col
                                .map(|c| cell_to_str(&row[c]))
                                .unwrap_or_default();
                            let hsn = cell_to_str(&row[h_c]);
                            let qty = cell_to_f64(&row[q_c]);
                            let val = cell_to_f64(&row[v_c]);

                            let mut rate = 18.0;
                            if let Some(c_c) = cgst_col {
                                let r = cell_to_f64(&row[c_c]);
                                if r > 0.0 {
                                    rate = r * 2.0;
                                }
                            }
                            if let Some(ig_c) = igst_col {
                                let r = cell_to_f64(&row[ig_c]);
                                if r > 0.0 {
                                    rate = r;
                                }
                            }

                            if !inv.is_empty()
                                && (!prod_cde.is_empty() || !prod_cust_no.is_empty())
                                && !hsn.is_empty()
                            {
                                source_lines.push(SourceHsnRow {
                                    invoice_no: inv,
                                    prod_cde,
                                    prod_cust_no,
                                    quantity: qty,
                                    assessable_value: val,
                                    hsn_code: hsn,
                                    gst_rate: rate,
                                });
                            }
                        }
                    }
                }
            }
        }

        Ok(source_lines)
    }

    /// Recovers `invoice_items.hsn_code` deterministically using parsed source rows.
    ///
    /// Requirements:
    /// - Only modifies `invoice_items.hsn_code`.
    /// - Preserves all quantities, rates, assessable values, taxes, and totals.
    /// - Inserts missing `hsn_master` records with the line's GST rate if absent.
    /// - Transactional and idempotent.
    /// - Never applies hardcoded fallbacks.
    pub fn recover_from_source_rows(
        conn: &mut Connection,
        source_rows: &[SourceHsnRow],
    ) -> Result<HsnRecoveryReport, AppError> {
        #[derive(Debug)]
        struct CandidateLine {
            id: i64,
            invoice_number: String,
            part_code: String,
            quantity: f64,
            assessable_value: f64,
        }

        // 1. Fetch all candidate lines needing HSN backfill
        let candidates: Vec<CandidateLine> = {
            let mut stmt = conn
                .prepare(
                    "SELECT id, invoice_number, part_code, quantity, assessable_value
                     FROM invoice_items
                     WHERE (hsn_code IS NULL OR TRIM(hsn_code) = '')
                     ORDER BY id ASC",
                )
                .map_err(|e| AppError::Db {
                    code: "ERR_DB_002".to_string(),
                    message: format!("Failed to prepare candidate query: {}", e),
                })?;

            let rows = stmt
                .query_map([], |r| {
                    Ok(CandidateLine {
                        id: r.get(0)?,
                        invoice_number: r.get(1)?,
                        part_code: r.get(2)?,
                        quantity: r.get(3)?,
                        assessable_value: r.get(4)?,
                    })
                })
                .map_err(|e| AppError::Db {
                    code: "ERR_DB_003".to_string(),
                    message: format!("Failed to read candidate rows: {}", e),
                })?;

            rows.filter_map(Result::ok).collect()
        };

        let total_candidates = candidates.len();
        if total_candidates == 0 {
            return Ok(HsnRecoveryReport {
                total_candidates: 0,
                matched: 0,
                unmatched: 0,
                ambiguous: 0,
                repaired: 0,
                details: vec!["No unassigned or NULL invoice lines found to recover.".to_string()],
            });
        }

        // 2. Index source rows by invoice_number
        let mut src_inv_map: HashMap<String, Vec<&SourceHsnRow>> = HashMap::new();
        for s in source_rows {
            src_inv_map.entry(s.invoice_no.clone()).or_default().push(s);
        }

        // 3. Index DB candidates by invoice_number
        let mut db_inv_map: HashMap<String, Vec<&CandidateLine>> = HashMap::new();
        for d in &candidates {
            db_inv_map
                .entry(d.invoice_number.clone())
                .or_default()
                .push(d);
        }

        let mut matched = 0;
        let mut unmatched = 0;
        let mut ambiguous = 0;
        let mut proposed_updates: Vec<(i64, String, f64)> = Vec::new();

        for (inv, db_group) in &db_inv_map {
            if let Some(src_group) = src_inv_map.get(inv) {
                let mut used_src = vec![false; src_group.len()];

                for d in db_group {
                    // Tier 1: Exact match on part_code (prod_cde OR prod_cust_no) AND (quantity, assessable_value)
                    let mut found_idx = None;
                    for (s_idx, s) in src_group.iter().enumerate() {
                        if !used_src[s_idx]
                            && (d.part_code == s.prod_cde || d.part_code == s.prod_cust_no)
                            && (d.quantity - s.quantity).abs() < 0.001
                            && (d.assessable_value - s.assessable_value).abs() < 0.02
                        {
                            found_idx = Some(s_idx);
                            break;
                        }
                    }

                    // Tier 2: Match on part_code only (when unique or all candidates share identical HSN)
                    if found_idx.is_none() {
                        let candidate_indices: Vec<usize> = src_group
                            .iter()
                            .enumerate()
                            .filter(|(idx, s)| {
                                !used_src[*idx]
                                    && (d.part_code == s.prod_cde || d.part_code == s.prod_cust_no)
                            })
                            .map(|(idx, _)| idx)
                            .collect();

                        if candidate_indices.len() == 1 {
                            found_idx = Some(candidate_indices[0]);
                        } else if candidate_indices.len() > 1 {
                            let first_hsn = &src_group[candidate_indices[0]].hsn_code;
                            let all_same_hsn = candidate_indices
                                .iter()
                                .all(|&idx| src_group[idx].hsn_code == *first_hsn);
                            if all_same_hsn {
                                found_idx = Some(candidate_indices[0]);
                            }
                        }
                    }

                    // Tier 3: Match on (quantity, assessable_value) within invoice (when unique or unanimous HSN)
                    if found_idx.is_none() {
                        let candidate_indices: Vec<usize> = src_group
                            .iter()
                            .enumerate()
                            .filter(|(idx, s)| {
                                !used_src[*idx]
                                    && (d.quantity - s.quantity).abs() < 0.001
                                    && (d.assessable_value - s.assessable_value).abs() < 0.02
                            })
                            .map(|(idx, _)| idx)
                            .collect();

                        if candidate_indices.len() == 1 {
                            found_idx = Some(candidate_indices[0]);
                        } else if candidate_indices.len() > 1 {
                            let first_hsn = &src_group[candidate_indices[0]].hsn_code;
                            let all_same_hsn = candidate_indices
                                .iter()
                                .all(|&idx| src_group[idx].hsn_code == *first_hsn);
                            if all_same_hsn {
                                found_idx = Some(candidate_indices[0]);
                            }
                        }
                    }

                    if let Some(idx) = found_idx {
                        used_src[idx] = true;
                        matched += 1;
                        proposed_updates.push((
                            d.id,
                            src_group[idx].hsn_code.clone(),
                            src_group[idx].gst_rate,
                        ));
                    } else {
                        // Check if any unused items exist for this invoice with conflicting HSNs
                        let unused_candidates: Vec<usize> = (0..src_group.len())
                            .filter(|&idx| !used_src[idx])
                            .collect();
                        if !unused_candidates.is_empty() {
                            ambiguous += 1;
                        } else {
                            unmatched += 1;
                        }
                    }
                }
            } else {
                unmatched += db_group.len();
            }
        }

        // 4. Perform Transactional and Idempotent Updates
        let tx = conn.transaction().map_err(|e| AppError::Db {
            code: "ERR_DB_002".to_string(),
            message: format!("Failed to begin recovery transaction: {}", e),
        })?;

        let mut repaired = 0;
        for (id, hsn, gst_rate) in &proposed_updates {
            // Ensure HSN exists in hsn_master
            tx.execute(
                "INSERT OR IGNORE INTO hsn_master (hsn_code, description, gst_rate) VALUES (?, 'Imported HSN', ?)",
                rusqlite::params![hsn, gst_rate],
            ).map_err(|e| AppError::Db {
                code: "ERR_DB_003".to_string(),
                message: format!("Failed to ensure hsn_master entry for {}: {}", hsn, e),
            })?;

            // Update only invoice_items.hsn_code
            let count = tx.execute(
                "UPDATE invoice_items SET hsn_code = ? WHERE id = ? AND (hsn_code IS NULL OR TRIM(hsn_code) = '')",
                rusqlite::params![hsn, id],
            ).map_err(|e| AppError::Db {
                code: "ERR_DB_003".to_string(),
                message: format!("Failed to update invoice_item line {}: {}", id, e),
            })?;

            repaired += count;
        }

        tx.commit().map_err(|e| AppError::Db {
            code: "ERR_DB_002".to_string(),
            message: format!("Failed to commit recovery transaction: {}", e),
        })?;

        let details = vec![
            format!("Candidates evaluated: {}", total_candidates),
            format!("Deterministically matched: {}", matched),
            format!("Repaired invoice_items.hsn_code: {}", repaired),
            format!("Unmatched lines remaining NULL: {}", unmatched),
            format!("Ambiguous lines remaining NULL: {}", ambiguous),
        ];

        Ok(HsnRecoveryReport {
            total_candidates,
            matched,
            unmatched,
            ambiguous,
            repaired,
            details,
        })
    }

    /// Convenience helper to recover HSNs directly from file paths on disk.
    pub fn recover_from_source_files<P: AsRef<Path>>(
        conn: &mut Connection,
        paths: &[P],
    ) -> Result<HsnRecoveryReport, AppError> {
        let source_rows = Self::parse_source_files(paths)?;
        Self::recover_from_source_rows(conn, &source_rows)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn setup_test_db() -> Connection {
        let mut conn = Connection::open_in_memory().unwrap();
        crate::database::migrate::run_migrations(&mut conn).unwrap();
        conn
    }

    #[test]
    fn test_deterministic_matching_and_multi_hsn_separation() {
        let mut conn = setup_test_db();

        // 1. Create invoices and base catalog item
        conn.execute(
            "INSERT INTO customers (id, customer_code, report_name) VALUES (1, 'C01', 'Test Customer')",
            [],
        ).unwrap();
        conn.execute(
            "INSERT INTO invoices (invoice_number, invoice_date, customer_id, financial_year_id, total_taxable, total_cgst, total_sgst, total_igst, total_value, status)
             VALUES ('INV-001', '2026-07-05', 1, 1, 1000.0, 90.0, 90.0, 0.0, 1180.0, 'Posted')",
            [],
        ).unwrap();
        conn.execute(
            "INSERT INTO invoices (invoice_number, invoice_date, customer_id, financial_year_id, total_taxable, total_cgst, total_sgst, total_igst, total_value, status)
             VALUES ('INV-002', '2026-07-12', 1, 1, 2000.0, 180.0, 180.0, 0.0, 2360.0, 'Posted')",
            [],
        ).unwrap();

        conn.execute(
            "INSERT OR IGNORE INTO hsn_master (hsn_code, description, gst_rate) VALUES ('8708.99.00', 'Default Item HSN', 18.0)",
            [],
        ).unwrap();
        conn.execute(
            "INSERT INTO items (part_code, part_name, hsn_code, uom_code, default_gst_rate)
             VALUES ('PART-A', 'Shared Dual-Tariff Component', '8708.99.00', 'PCS', 18.0)",
            [],
        ).unwrap();

        // Insert historical lines with NULL hsn_code
        conn.execute(
            "INSERT INTO invoice_items (invoice_number, part_code, quantity, rate_pre_unit, assessable_value, cgst_rate, cgst_amount, sgst_rate, sgst_amount, igst_rate, igst_amount, total_value, hsn_code)
             VALUES ('INV-001', 'PART-A', 10.0, 100.0, 1000.0, 9.0, 90.0, 9.0, 90.0, 0.0, 0.0, 1180.0, NULL)",
            [],
        ).unwrap();
        conn.execute(
            "INSERT INTO invoice_items (invoice_number, part_code, quantity, rate_pre_unit, assessable_value, cgst_rate, cgst_amount, sgst_rate, sgst_amount, igst_rate, igst_amount, total_value, hsn_code)
             VALUES ('INV-002', 'PART-A', 20.0, 100.0, 2000.0, 9.0, 180.0, 9.0, 180.0, 0.0, 0.0, 2360.0, NULL)",
            [],
        ).unwrap();

        // 2. Define source lines where SAME PART-A has different HSNs across invoices
        let source_rows = vec![
            SourceHsnRow {
                invoice_no: "INV-001".to_string(),
                prod_cde: "PART-A".to_string(),
                prod_cust_no: "CUST-PART-A".to_string(),
                quantity: 10.0,
                assessable_value: 1000.0,
                hsn_code: "8409.91.99".to_string(),
                gst_rate: 18.0,
            },
            SourceHsnRow {
                invoice_no: "INV-002".to_string(),
                prod_cde: "PART-A".to_string(),
                prod_cust_no: "CUST-PART-A".to_string(),
                quantity: 20.0,
                assessable_value: 2000.0,
                hsn_code: "3902.10.00".to_string(),
                gst_rate: 18.0,
            },
        ];

        // 3. Execute recovery
        let report = HsnRecoveryService::recover_from_source_rows(&mut conn, &source_rows).unwrap();
        assert_eq!(report.total_candidates, 2);
        assert_eq!(report.matched, 2);
        assert_eq!(report.repaired, 2);
        assert_eq!(report.unmatched, 0);
        assert_eq!(report.ambiguous, 0);

        // 4. Verify lines in DB
        let hsn1: String = conn.query_row(
            "SELECT hsn_code FROM invoice_items WHERE invoice_number = 'INV-001'",
            [],
            |r| r.get(0),
        ).unwrap();
        assert_eq!(hsn1, "8409.91.99");

        let hsn2: String = conn.query_row(
            "SELECT hsn_code FROM invoice_items WHERE invoice_number = 'INV-002'",
            [],
            |r| r.get(0),
        ).unwrap();
        assert_eq!(hsn2, "3902.10.00");

        // 5. Verify hsn_master was auto-populated with new HSNs
        let exists_3902: bool = conn.query_row(
            "SELECT EXISTS(SELECT 1 FROM hsn_master WHERE hsn_code = '3902.10.00')",
            [],
            |r| r.get(0),
        ).unwrap();
        assert!(exists_3902);

        // 6. Verify financials remain identical
        let (qty, val): (f64, f64) = conn.query_row(
            "SELECT SUM(quantity), SUM(assessable_value) FROM invoice_items",
            [],
            |r| Ok((r.get(0)?, r.get(1)?)),
        ).unwrap();
        assert_eq!(qty, 30.0);
        assert_eq!(val, 3000.0);

        // 7. Verify Idempotency: Running recovery again produces 0 candidate updates
        let report_rerun = HsnRecoveryService::recover_from_source_rows(&mut conn, &source_rows).unwrap();
        assert_eq!(report_rerun.total_candidates, 0);
        assert_eq!(report_rerun.repaired, 0);
    }

    #[test]
    fn test_unmatched_lines_remain_null_and_never_fallback_to_8708() {
        let mut conn = setup_test_db();

        conn.execute(
            "INSERT INTO customers (id, customer_code, report_name) VALUES (1, 'C01', 'Test Customer')",
            [],
        ).unwrap();
        conn.execute(
            "INSERT INTO invoices (invoice_number, invoice_date, customer_id, financial_year_id, total_taxable, total_value, status)
             VALUES ('INV-999', '2026-07-20', 1, 1, 500.0, 590.0, 'Posted')",
            [],
        ).unwrap();
        conn.execute(
            "INSERT OR IGNORE INTO hsn_master (hsn_code, description, gst_rate) VALUES ('8708.99.00', 'Motor parts', 18.0)",
            [],
        ).unwrap();
        conn.execute(
            "INSERT INTO items (part_code, part_name, hsn_code, uom_code, default_gst_rate)
             VALUES ('PART-UNKNOWN', 'Unknown Part', '8708.99.00', 'PCS', 18.0)",
            [],
        ).unwrap();
        conn.execute(
            "INSERT INTO invoice_items (invoice_number, part_code, quantity, rate_pre_unit, assessable_value, total_value, hsn_code)
             VALUES ('INV-999', 'PART-UNKNOWN', 5.0, 100.0, 500.0, 590.0, NULL)",
            [],
        ).unwrap();

        // Source rows have no match for INV-999
        let source_rows = vec![
            SourceHsnRow {
                invoice_no: "INV-OTHER".to_string(),
                prod_cde: "PART-OTHER".to_string(),
                prod_cust_no: "CUST-OTHER".to_string(),
                quantity: 10.0,
                assessable_value: 1000.0,
                hsn_code: "8409.91.99".to_string(),
                gst_rate: 18.0,
            }
        ];

        let report = HsnRecoveryService::recover_from_source_rows(&mut conn, &source_rows).unwrap();
        assert_eq!(report.total_candidates, 1);
        assert_eq!(report.matched, 0);
        assert_eq!(report.unmatched, 1);
        assert_eq!(report.repaired, 0);

        // Line MUST remain NULL in invoice_items
        let hsn: Option<String> = conn.query_row(
            "SELECT hsn_code FROM invoice_items WHERE invoice_number = 'INV-999'",
            [],
            |r| r.get(0),
        ).unwrap();
        assert_eq!(hsn, None);
    }

    #[test]
    fn test_recover_demo_db_and_reconcile_if_present() {
        let db_path = "C:\\Users\\Yogeswari\\AppData\\Roaming\\com.salesmonitor.app\\databases\\company_DEMO.db";
        if !Path::new(db_path).exists() {
            return;
        }

        let mut conn = Connection::open(db_path).unwrap();
        conn.pragma_update(None, "key", "demo1234").unwrap();

        let source_files = [
            "D:\\Sales report\\Sales report.xls",
            "D:\\Sales upload\\ICI Sales 01 july to 15 july -24.xls",
            "D:\\Sales upload\\Sales 16.07.24 to 29.07.24.xls",
        ];

        let report = HsnRecoveryService::recover_from_source_files(&mut conn, &source_files).unwrap();
        println!("Demo DB recovery report: {:?}", report);

        // Verify that after recovery, all 3,416 July lines in company_DEMO.db have valid non-null HSNs
        let unassigned_count: i64 = conn.query_row(
            "SELECT COUNT(*) FROM invoice_items ii
             JOIN invoices i ON ii.invoice_number = i.invoice_number
             WHERE i.invoice_date >= '2026-07-01' AND i.invoice_date <= '2026-07-31'
               AND (ii.hsn_code IS NULL OR TRIM(ii.hsn_code) = '')",
            [],
            |r| r.get(0),
        ).unwrap();

        assert_eq!(unassigned_count, 0, "All July lines must be successfully repaired");
    }
}

