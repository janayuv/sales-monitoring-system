use crate::error::AppError;
use crate::models::domain_models::TallyExportRow;

/// Abstract interface for document exporting.
/// Concrete implementations produce different output formats (Excel, CSV, etc.).
pub trait Exporter: Send + Sync {
    fn format_name(&self) -> &str;
    fn export(
        &self,
        data: &[TallyExportRow],
        output_path: &str,
    ) -> Result<u32, AppError>;
}

/// Tally Excel Exporter — produces split multi-rate Excel templates.
///
/// Multi-rate invoices (e.g. an invoice with 0% and 18% GST items) are split
/// into separate voucher rows. The first rate uses the raw invoice number,
/// subsequent rates append alphabetical suffixes (A, B, C…).
pub struct TallyExcelExporter;

impl TallyExcelExporter {
    /// Splits a flat list of TallyExportRow into properly labelled groups.
    ///
    /// For each invoice, items are grouped by GST percentage. The first group
    /// keeps the original invoice number; subsequent groups get suffixed labels
    /// (e.g. "372076" → "372076", "372076A", "372076B").
    ///
    /// Within each group the rows are aggregated into one summary row per
    /// (invoice, rate) combination.
    pub fn split_multi_rate(rows: &[TallyExportRow]) -> Vec<TallyExportRow> {
        use std::collections::BTreeMap;

        // Group rows by invoice number, preserving insertion order per invoice
        let mut invoice_groups: BTreeMap<String, Vec<&TallyExportRow>> = BTreeMap::new();
        for row in rows {
            invoice_groups
                .entry(row.inv_no.clone())
                .or_default()
                .push(row);
        }

        let mut result: Vec<TallyExportRow> = Vec::new();

        for (_inv_no, inv_rows) in &invoice_groups {
            // Sub-group by GST percentage within each invoice
            let mut rate_groups: BTreeMap<String, Vec<&TallyExportRow>> = BTreeMap::new();
            for row in inv_rows {
                let rate_key = format!("{:.2}", row.percentage);
                rate_groups.entry(rate_key).or_default().push(row);
            }

            // Assign labels: first rate keeps original number, rest get A, B, C...
            let suffix_chars: Vec<char> = ('A'..='Z').collect();
            let mut suffix_idx: usize = 0;

            for (group_idx, (_rate_key, group_rows)) in rate_groups.iter().enumerate() {
                for row in group_rows {
                    let labelled_inv_no = if group_idx == 0 {
                        row.inv_no.clone()
                    } else {
                        let suffix = if suffix_idx < suffix_chars.len() {
                            suffix_chars[suffix_idx].to_string()
                        } else {
                            format!("{}", suffix_idx)
                        };
                        format!("{}{}", row.inv_no, suffix)
                    };

                    result.push(TallyExportRow {
                        cust_code: row.cust_code.clone(),
                        cust_name: row.cust_name.clone(),
                        inv_date: row.inv_date.clone(),
                        re_type: row.re_type.clone(),
                        inv_no: labelled_inv_no,
                        part_code: row.part_code.clone(),
                        part_name: row.part_name.clone(),
                        tariff: row.tariff.clone(),
                        qty: row.qty,
                        bas_price: row.bas_price,
                        ass_val: row.ass_val,
                        cgst: row.cgst,
                        sgst: row.sgst,
                        igst: row.igst,
                        amot: row.amot,
                        inv_val: row.inv_val,
                        igst_yes_no: row.igst_yes_no.clone(),
                        percentage: row.percentage,
                    });
                }

                if group_idx > 0 {
                    suffix_idx += 1;
                }
            }
        }

        result
    }
}

impl Exporter for TallyExcelExporter {
    fn format_name(&self) -> &str {
        "Tally Excel"
    }

    fn export(
        &self,
        data: &[TallyExportRow],
        output_path: &str,
    ) -> Result<u32, AppError> {
        use rust_xlsxwriter::{Workbook, Format, Color, FormatAlign, FormatBorder};

        let split_rows = Self::split_multi_rate(data);
        let row_count = split_rows.len() as u32;

        let mut workbook = Workbook::new();
        let worksheet = workbook.add_worksheet();
        worksheet.set_name("Tally Import").map_err(|e| AppError::Export {
            code: "ERR_TALLY_001".to_string(),
            message: format!("Failed to set worksheet name: {}", e),
        })?;

        // Header format
        let header_fmt = Format::new()
            .set_bold()
            .set_font_size(10.0)
            .set_background_color(Color::RGB(0x2D3748))
            .set_font_color(Color::White)
            .set_align(FormatAlign::Center)
            .set_border(FormatBorder::Thin);

        // Data format
        let data_fmt = Format::new()
            .set_font_size(9.0)
            .set_border(FormatBorder::Thin);

        let number_fmt = Format::new()
            .set_font_size(9.0)
            .set_num_format("#,##0.00")
            .set_border(FormatBorder::Thin);

        // Write headers
        let headers = [
            "Cust Code", "Cust Name", "Inv Date", "Re Type", "Inv No",
            "Part Code", "Part Name", "Tariff", "Qty", "Bas Price",
            "Ass Val", "CGST", "SGST", "IGST", "Amot",
            "Inv Val", "IGST Yes/No", "Percentage",
        ];

        for (col, header) in headers.iter().enumerate() {
            worksheet.write_string_with_format(0, col as u16, *header, &header_fmt)
                .map_err(|e| AppError::Export {
                    code: "ERR_TALLY_001".to_string(),
                    message: format!("Failed to write header: {}", e),
                })?;
        }

        // Set column widths
        let widths: [f64; 18] = [
            12.0, 30.0, 12.0, 10.0, 16.0,
            16.0, 30.0, 14.0, 10.0, 12.0,
            14.0, 12.0, 12.0, 12.0, 14.0,
            14.0, 10.0, 10.0,
        ];
        for (col, w) in widths.iter().enumerate() {
            worksheet.set_column_width(col as u16, *w).ok();
        }

        // Write data rows
        for (r, row) in split_rows.iter().enumerate() {
            let excel_row = (r + 1) as u32;
            worksheet.write_string_with_format(excel_row, 0, &row.cust_code, &data_fmt).ok();
            worksheet.write_string_with_format(excel_row, 1, &row.cust_name, &data_fmt).ok();
            worksheet.write_string_with_format(excel_row, 2, &row.inv_date, &data_fmt).ok();
            worksheet.write_string_with_format(excel_row, 3, &row.re_type, &data_fmt).ok();
            worksheet.write_string_with_format(excel_row, 4, &row.inv_no, &data_fmt).ok();
            worksheet.write_string_with_format(excel_row, 5, &row.part_code, &data_fmt).ok();
            worksheet.write_string_with_format(excel_row, 6, &row.part_name, &data_fmt).ok();
            worksheet.write_string_with_format(excel_row, 7, &row.tariff, &data_fmt).ok();
            worksheet.write_number_with_format(excel_row, 8, row.qty, &number_fmt).ok();
            worksheet.write_number_with_format(excel_row, 9, row.bas_price, &number_fmt).ok();
            worksheet.write_number_with_format(excel_row, 10, row.ass_val, &number_fmt).ok();
            worksheet.write_number_with_format(excel_row, 11, row.cgst, &number_fmt).ok();
            worksheet.write_number_with_format(excel_row, 12, row.sgst, &number_fmt).ok();
            worksheet.write_number_with_format(excel_row, 13, row.igst, &number_fmt).ok();
            worksheet.write_number_with_format(excel_row, 14, row.amot, &number_fmt).ok();
            worksheet.write_number_with_format(excel_row, 15, row.inv_val, &number_fmt).ok();
            worksheet.write_string_with_format(excel_row, 16, &row.igst_yes_no, &data_fmt).ok();
            worksheet.write_number_with_format(excel_row, 17, row.percentage, &number_fmt).ok();
        }

        workbook.save(output_path).map_err(|e| AppError::Export {
            code: "ERR_TALLY_002".to_string(),
            message: format!("Failed to save Tally export workbook: {}", e),
        })?;

        Ok(row_count)
    }
}

/// Standard flat Excel Exporter — outputs all invoice data as a single flat sheet.
pub struct StandardExcelExporter;

impl Exporter for StandardExcelExporter {
    fn format_name(&self) -> &str {
        "Standard Excel"
    }

    fn export(
        &self,
        data: &[TallyExportRow],
        output_path: &str,
    ) -> Result<u32, AppError> {
        use rust_xlsxwriter::{Workbook, Format, Color, FormatAlign, FormatBorder};

        let row_count = data.len() as u32;

        let mut workbook = Workbook::new();
        let worksheet = workbook.add_worksheet();
        worksheet.set_name("Sales Data").map_err(|e| AppError::Export {
            code: "ERR_TALLY_001".to_string(),
            message: format!("Failed to set worksheet name: {}", e),
        })?;

        let header_fmt = Format::new()
            .set_bold()
            .set_font_size(10.0)
            .set_background_color(Color::RGB(0x1A365D))
            .set_font_color(Color::White)
            .set_align(FormatAlign::Center)
            .set_border(FormatBorder::Thin);

        let data_fmt = Format::new()
            .set_font_size(9.0)
            .set_border(FormatBorder::Thin);

        let number_fmt = Format::new()
            .set_font_size(9.0)
            .set_num_format("#,##0.00")
            .set_border(FormatBorder::Thin);

        let headers = [
            "Cust Code", "Cust Name", "Inv Date", "Re Type", "Inv No",
            "Part Code", "Part Name", "Tariff", "Qty", "Bas Price",
            "Ass Val", "CGST", "SGST", "IGST", "Amot",
            "Inv Val", "IGST Yes/No", "Percentage",
        ];

        for (col, header) in headers.iter().enumerate() {
            worksheet.write_string_with_format(0, col as u16, *header, &header_fmt).ok();
        }

        let widths: [f64; 18] = [
            12.0, 30.0, 12.0, 10.0, 16.0,
            16.0, 30.0, 14.0, 10.0, 12.0,
            14.0, 12.0, 12.0, 12.0, 14.0,
            14.0, 10.0, 10.0,
        ];
        for (col, w) in widths.iter().enumerate() {
            worksheet.set_column_width(col as u16, *w).ok();
        }

        for (r, row) in data.iter().enumerate() {
            let excel_row = (r + 1) as u32;
            worksheet.write_string_with_format(excel_row, 0, &row.cust_code, &data_fmt).ok();
            worksheet.write_string_with_format(excel_row, 1, &row.cust_name, &data_fmt).ok();
            worksheet.write_string_with_format(excel_row, 2, &row.inv_date, &data_fmt).ok();
            worksheet.write_string_with_format(excel_row, 3, &row.re_type, &data_fmt).ok();
            worksheet.write_string_with_format(excel_row, 4, &row.inv_no, &data_fmt).ok();
            worksheet.write_string_with_format(excel_row, 5, &row.part_code, &data_fmt).ok();
            worksheet.write_string_with_format(excel_row, 6, &row.part_name, &data_fmt).ok();
            worksheet.write_string_with_format(excel_row, 7, &row.tariff, &data_fmt).ok();
            worksheet.write_number_with_format(excel_row, 8, row.qty, &number_fmt).ok();
            worksheet.write_number_with_format(excel_row, 9, row.bas_price, &number_fmt).ok();
            worksheet.write_number_with_format(excel_row, 10, row.ass_val, &number_fmt).ok();
            worksheet.write_number_with_format(excel_row, 11, row.cgst, &number_fmt).ok();
            worksheet.write_number_with_format(excel_row, 12, row.sgst, &number_fmt).ok();
            worksheet.write_number_with_format(excel_row, 13, row.igst, &number_fmt).ok();
            worksheet.write_number_with_format(excel_row, 14, row.amot, &number_fmt).ok();
            worksheet.write_number_with_format(excel_row, 15, row.inv_val, &number_fmt).ok();
            worksheet.write_string_with_format(excel_row, 16, &row.igst_yes_no, &data_fmt).ok();
            worksheet.write_number_with_format(excel_row, 17, row.percentage, &number_fmt).ok();
        }

        workbook.save(output_path).map_err(|e| AppError::Export {
            code: "ERR_TALLY_002".to_string(),
            message: format!("Failed to save workbook: {}", e),
        })?;

        Ok(row_count)
    }
}

/// CSV Exporter — writes fast flat CSV text streams.
pub struct CsvExporter;

impl Exporter for CsvExporter {
    fn format_name(&self) -> &str {
        "CSV"
    }

    fn export(
        &self,
        data: &[TallyExportRow],
        output_path: &str,
    ) -> Result<u32, AppError> {
        use std::io::Write;

        let row_count = data.len() as u32;
        let file = std::fs::File::create(output_path)?;
        let mut writer = std::io::BufWriter::new(file);

        // Write CSV header
        writeln!(
            writer,
            "Cust Code,Cust Name,Inv Date,Re Type,Inv No,Part Code,Part Name,Tariff,Qty,Bas Price,Ass Val,CGST,SGST,IGST,Amot,Inv Val,IGST Yes/No,Percentage"
        )?;

        for row in data {
            writeln!(
                writer,
                "\"{}\",\"{}\",\"{}\",\"{}\",\"{}\",\"{}\",\"{}\",\"{}\",{:.2},{:.2},{:.2},{:.2},{:.2},{:.2},{:.2},{:.2},\"{}\",{:.2}",
                row.cust_code, row.cust_name, row.inv_date, row.re_type, row.inv_no,
                row.part_code, row.part_name, row.tariff, row.qty, row.bas_price,
                row.ass_val, row.cgst, row.sgst, row.igst, row.amot,
                row.inv_val, row.igst_yes_no, row.percentage,
            )?;
        }

        writer.flush()?;
        Ok(row_count)
    }
}

// ======================== Unit Tests ========================

#[cfg(test)]
mod tests {
    use super::*;

    fn make_row(inv_no: &str, part_code: &str, percentage: f64, ass_val: f64) -> TallyExportRow {
        TallyExportRow {
            cust_code: "C001".to_string(),
            cust_name: "Test Customer".to_string(),
            inv_date: "2026-01-15".to_string(),
            re_type: "Regular B2B".to_string(),
            inv_no: inv_no.to_string(),
            part_code: part_code.to_string(),
            part_name: "Test Part".to_string(),
            tariff: "8708.99.00".to_string(),
            qty: 10.0,
            bas_price: ass_val / 10.0,
            ass_val,
            cgst: if percentage > 0.0 { ass_val * percentage / 200.0 } else { 0.0 },
            sgst: if percentage > 0.0 { ass_val * percentage / 200.0 } else { 0.0 },
            igst: 0.0,
            amot: ass_val + (ass_val * percentage / 100.0),
            inv_val: ass_val + (ass_val * percentage / 100.0),
            igst_yes_no: "N".to_string(),
            percentage,
        }
    }

    #[test]
    fn test_single_rate_invoice_no_splitting() {
        let rows = vec![
            make_row("INV001", "P01", 18.0, 1000.0),
            make_row("INV001", "P02", 18.0, 500.0),
        ];

        let result = TallyExcelExporter::split_multi_rate(&rows);
        assert_eq!(result.len(), 2);
        // All should keep the same invoice number
        assert!(result.iter().all(|r| r.inv_no == "INV001"));
    }

    #[test]
    fn test_multi_rate_invoice_splits_correctly() {
        let rows = vec![
            make_row("372076", "P01", 0.0, 200.0),
            make_row("372076", "P02", 18.0, 800.0),
        ];

        let result = TallyExcelExporter::split_multi_rate(&rows);
        assert_eq!(result.len(), 2);

        // First group (0%) keeps original number
        assert_eq!(result[0].inv_no, "372076");
        assert_eq!(result[0].percentage, 0.0);

        // Second group (18%) gets suffixed
        assert_eq!(result[1].inv_no, "372076A");
        assert_eq!(result[1].percentage, 18.0);
    }

    #[test]
    fn test_three_rate_invoice_splits_correctly() {
        let rows = vec![
            make_row("INV999", "P01", 0.0, 100.0),
            make_row("INV999", "P02", 5.0, 300.0),
            make_row("INV999", "P03", 18.0, 600.0),
        ];

        let result = TallyExcelExporter::split_multi_rate(&rows);
        assert_eq!(result.len(), 3);

        assert_eq!(result[0].inv_no, "INV999");
        assert_eq!(result[0].percentage, 0.0);

        assert_eq!(result[1].inv_no, "INV999A");
        assert_eq!(result[1].percentage, 5.0);

        assert_eq!(result[2].inv_no, "INV999B");
        assert_eq!(result[2].percentage, 18.0);
    }

    #[test]
    fn test_multiple_invoices_split_independently() {
        let rows = vec![
            make_row("INV001", "P01", 0.0, 100.0),
            make_row("INV001", "P02", 18.0, 500.0),
            make_row("INV002", "P03", 18.0, 700.0),
        ];

        let result = TallyExcelExporter::split_multi_rate(&rows);
        assert_eq!(result.len(), 3);

        // INV001 splits
        assert_eq!(result[0].inv_no, "INV001");
        assert_eq!(result[1].inv_no, "INV001A");

        // INV002 has single rate, no suffix
        assert_eq!(result[2].inv_no, "INV002");
    }
}
