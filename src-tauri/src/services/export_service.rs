use crate::error::AppError;
use crate::models::domain_models::TallyExportRow;

/// Abstract interface for document exporting.
/// Concrete implementations produce different output formats (Excel, CSV, etc.).
pub trait Exporter: Send + Sync {
    fn format_name(&self) -> &str;
    fn export(&self, data: &[TallyExportRow], output_path: &str) -> Result<u32, AppError>;
}

/// Tally Excel Exporter — produces split multi-rate Excel templates.
///
/// Multi-rate invoices (e.g. an invoice with 0% and 18% GST items) are split
/// into separate voucher rows. The first rate uses the raw invoice number,
/// subsequent rates append alphabetical suffixes (A, B, C…).
pub struct TallyExcelExporter;

impl TallyExcelExporter {
    /// Merges all items of an invoice number into ONE single row for Tally Export.
    ///
    /// Merges / sums values based on invoice:
    /// - Assessable Value (`ass_val`)
    /// - CGST (`cgst`)
    /// - SGST (`sgst`)
    /// - IGST (`igst`)
    /// - Amortization / Line Total (`amot`)
    /// - Total Invoice Value (`inv_val`)
    ///
    /// Keeps first row's descriptive fields for the invoice number:
    /// - `cust_code`, `cust_name`, `inv_date`, `re_type`, `inv_no`, `part_code`, `part_name`, `tariff`, `qty`, `bas_price`.
    pub fn split_multi_rate(rows: &[TallyExportRow]) -> Vec<TallyExportRow> {
        let mut invoice_order: Vec<String> = Vec::new();
        let mut invoice_map: std::collections::HashMap<String, Vec<&TallyExportRow>> =
            std::collections::HashMap::new();

        for row in rows {
            if !invoice_map.contains_key(&row.inv_no) {
                invoice_order.push(row.inv_no.clone());
            }
            invoice_map.entry(row.inv_no.clone()).or_default().push(row);
        }

        let mut result: Vec<TallyExportRow> = Vec::new();

        for inv_no in &invoice_order {
            if let Some(group_rows) = invoice_map.get(inv_no) {
                if group_rows.is_empty() {
                    continue;
                }

                let first = group_rows[0];

                let mut sum_ass_val = 0.0;
                let mut sum_cgst = 0.0;
                let mut sum_sgst = 0.0;
                let mut sum_igst = 0.0;
                let mut sum_amot = 0.0;
                let mut max_inv_val = first.inv_val;
                let mut has_igst = false;

                for row in group_rows {
                    sum_ass_val += row.ass_val;
                    sum_cgst += row.cgst;
                    sum_sgst += row.sgst;
                    sum_igst += row.igst;
                    sum_amot += row.amot;
                    if row.inv_val > max_inv_val {
                        max_inv_val = row.inv_val;
                    }
                    if row.igst_yes_no == "Y" || row.igst > 0.0 {
                        has_igst = true;
                    }
                }

                let calculated_inv_val = if max_inv_val > 0.0 {
                    max_inv_val
                } else {
                    sum_ass_val + sum_cgst + sum_sgst + sum_igst
                };

                result.push(TallyExportRow {
                    cust_code: first.cust_code.clone(),
                    cust_name: first.cust_name.clone(),
                    inv_date: first.inv_date.clone(),
                    re_type: first.re_type.clone(),
                    inv_no: first.inv_no.clone(),
                    part_code: first.part_code.clone(),
                    part_name: first.part_name.clone(),
                    tariff: first.tariff.clone(),
                    qty: first.qty,
                    bas_price: first.bas_price,
                    ass_val: sum_ass_val,
                    cgst: sum_cgst,
                    sgst: sum_sgst,
                    igst: sum_igst,
                    amot: sum_amot,
                    inv_val: calculated_inv_val,
                    igst_yes_no: if has_igst {
                        "Y".to_string()
                    } else {
                        "N".to_string()
                    },
                    percentage: first.percentage,
                });
            }
        }

        result
    }
}

impl Exporter for TallyExcelExporter {
    fn format_name(&self) -> &str {
        "Tally Excel"
    }

    fn export(&self, data: &[TallyExportRow], output_path: &str) -> Result<u32, AppError> {
        use rust_xlsxwriter::{Color, Format, FormatAlign, FormatBorder, Workbook};

        let split_rows = Self::split_multi_rate(data);
        let row_count = split_rows.len() as u32;

        let mut workbook = Workbook::new();
        let worksheet = workbook.add_worksheet();
        worksheet
            .set_name("Tally Import")
            .map_err(|e| AppError::Export {
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
            "Cust Code",
            "Cust Name",
            "Inv Date",
            "Re Type",
            "Inv No",
            "Part Code",
            "Part Name",
            "Tariff",
            "Qty",
            "Bas Price",
            "Ass Val",
            "CGST",
            "SGST",
            "IGST",
            "Amot",
            "Inv Val",
            "IGST Yes/No",
            "Percentage",
        ];

        for (col, header) in headers.iter().enumerate() {
            worksheet
                .write_string_with_format(0, col as u16, *header, &header_fmt)
                .map_err(|e| AppError::Export {
                    code: "ERR_TALLY_001".to_string(),
                    message: format!("Failed to write header: {}", e),
                })?;
        }

        // Set column widths
        let widths: [f64; 18] = [
            12.0, 30.0, 12.0, 10.0, 16.0, 16.0, 30.0, 14.0, 10.0, 12.0, 14.0, 12.0, 12.0, 12.0,
            14.0, 14.0, 10.0, 10.0,
        ];
        for (col, w) in widths.iter().enumerate() {
            worksheet.set_column_width(col as u16, *w).ok();
        }

        // Write data rows
        for (r, row) in split_rows.iter().enumerate() {
            let excel_row = (r + 1) as u32;
            worksheet
                .write_string_with_format(excel_row, 0, &row.cust_code, &data_fmt)
                .ok();
            worksheet
                .write_string_with_format(excel_row, 1, &row.cust_name, &data_fmt)
                .ok();
            worksheet
                .write_string_with_format(excel_row, 2, &row.inv_date, &data_fmt)
                .ok();
            worksheet
                .write_string_with_format(excel_row, 3, &row.re_type, &data_fmt)
                .ok();
            worksheet
                .write_string_with_format(excel_row, 4, &row.inv_no, &data_fmt)
                .ok();
            worksheet
                .write_string_with_format(excel_row, 5, &row.part_code, &data_fmt)
                .ok();
            worksheet
                .write_string_with_format(excel_row, 6, &row.part_name, &data_fmt)
                .ok();
            worksheet
                .write_string_with_format(excel_row, 7, &row.tariff, &data_fmt)
                .ok();
            worksheet
                .write_number_with_format(excel_row, 8, row.qty, &number_fmt)
                .ok();
            worksheet
                .write_number_with_format(excel_row, 9, row.bas_price, &number_fmt)
                .ok();
            worksheet
                .write_number_with_format(excel_row, 10, row.ass_val, &number_fmt)
                .ok();
            worksheet
                .write_number_with_format(excel_row, 11, row.cgst, &number_fmt)
                .ok();
            worksheet
                .write_number_with_format(excel_row, 12, row.sgst, &number_fmt)
                .ok();
            worksheet
                .write_number_with_format(excel_row, 13, row.igst, &number_fmt)
                .ok();
            worksheet
                .write_number_with_format(excel_row, 14, row.amot, &number_fmt)
                .ok();
            worksheet
                .write_number_with_format(excel_row, 15, row.inv_val, &number_fmt)
                .ok();
            worksheet
                .write_string_with_format(excel_row, 16, &row.igst_yes_no, &data_fmt)
                .ok();
            worksheet
                .write_number_with_format(excel_row, 17, row.percentage, &number_fmt)
                .ok();
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

    fn export(&self, data: &[TallyExportRow], output_path: &str) -> Result<u32, AppError> {
        use rust_xlsxwriter::{Color, Format, FormatAlign, FormatBorder, Workbook};

        let row_count = data.len() as u32;

        let mut workbook = Workbook::new();
        let worksheet = workbook.add_worksheet();
        worksheet
            .set_name("Sales Data")
            .map_err(|e| AppError::Export {
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
            "Cust Code",
            "Cust Name",
            "Inv Date",
            "Re Type",
            "Inv No",
            "Part Code",
            "Part Name",
            "Tariff",
            "Qty",
            "Bas Price",
            "Ass Val",
            "CGST",
            "SGST",
            "IGST",
            "Amot",
            "Inv Val",
            "IGST Yes/No",
            "Percentage",
        ];

        for (col, header) in headers.iter().enumerate() {
            worksheet
                .write_string_with_format(0, col as u16, *header, &header_fmt)
                .ok();
        }

        let widths: [f64; 18] = [
            12.0, 30.0, 12.0, 10.0, 16.0, 16.0, 30.0, 14.0, 10.0, 12.0, 14.0, 12.0, 12.0, 12.0,
            14.0, 14.0, 10.0, 10.0,
        ];
        for (col, w) in widths.iter().enumerate() {
            worksheet.set_column_width(col as u16, *w).ok();
        }

        for (r, row) in data.iter().enumerate() {
            let excel_row = (r + 1) as u32;
            worksheet
                .write_string_with_format(excel_row, 0, &row.cust_code, &data_fmt)
                .ok();
            worksheet
                .write_string_with_format(excel_row, 1, &row.cust_name, &data_fmt)
                .ok();
            worksheet
                .write_string_with_format(excel_row, 2, &row.inv_date, &data_fmt)
                .ok();
            worksheet
                .write_string_with_format(excel_row, 3, &row.re_type, &data_fmt)
                .ok();
            worksheet
                .write_string_with_format(excel_row, 4, &row.inv_no, &data_fmt)
                .ok();
            worksheet
                .write_string_with_format(excel_row, 5, &row.part_code, &data_fmt)
                .ok();
            worksheet
                .write_string_with_format(excel_row, 6, &row.part_name, &data_fmt)
                .ok();
            worksheet
                .write_string_with_format(excel_row, 7, &row.tariff, &data_fmt)
                .ok();
            worksheet
                .write_number_with_format(excel_row, 8, row.qty, &number_fmt)
                .ok();
            worksheet
                .write_number_with_format(excel_row, 9, row.bas_price, &number_fmt)
                .ok();
            worksheet
                .write_number_with_format(excel_row, 10, row.ass_val, &number_fmt)
                .ok();
            worksheet
                .write_number_with_format(excel_row, 11, row.cgst, &number_fmt)
                .ok();
            worksheet
                .write_number_with_format(excel_row, 12, row.sgst, &number_fmt)
                .ok();
            worksheet
                .write_number_with_format(excel_row, 13, row.igst, &number_fmt)
                .ok();
            worksheet
                .write_number_with_format(excel_row, 14, row.amot, &number_fmt)
                .ok();
            worksheet
                .write_number_with_format(excel_row, 15, row.inv_val, &number_fmt)
                .ok();
            worksheet
                .write_string_with_format(excel_row, 16, &row.igst_yes_no, &data_fmt)
                .ok();
            worksheet
                .write_number_with_format(excel_row, 17, row.percentage, &number_fmt)
                .ok();
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

    fn export(&self, data: &[TallyExportRow], output_path: &str) -> Result<u32, AppError> {
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

/// PDF Exporter — produces a print-layout PDF report of the export rows.
///
/// Unlike the Tally/Standard Excel/CSV exporters (full-fidelity data
/// interchange formats), this is a condensed human-readable report: it
/// keeps only the columns a reviewer reads on a printed page.
pub struct PdfExporter;

const PDF_ROWS_PER_PAGE: usize = 40;

impl PdfExporter {
    fn truncate(value: &str, max_chars: usize) -> String {
        if value.chars().count() <= max_chars {
            value.to_string()
        } else {
            let mut s: String = value.chars().take(max_chars.saturating_sub(1)).collect();
            s.push('…');
            s
        }
    }

    fn header_line() -> String {
        format!(
            "{:<12} {:<9} {:<11} {:<10} {:>8} {:>10} {:>9} {:>9} {:>9} {:>10} {:<4} {:>6}",
            "Inv No",
            "Cust Code",
            "Inv Date",
            "Part Code",
            "Qty",
            "BasPrice",
            "CGST",
            "SGST",
            "IGST",
            "InvVal",
            "IGST",
            "Rate%"
        )
    }

    fn format_row(row: &TallyExportRow) -> String {
        format!(
            "{:<12} {:<9} {:<11} {:<10} {:>8.2} {:>10.2} {:>9.2} {:>9.2} {:>9.2} {:>10.2} {:<4} {:>6.2}",
            Self::truncate(&row.inv_no, 12),
            Self::truncate(&row.cust_code, 9),
            row.inv_date,
            Self::truncate(&row.part_code, 10),
            row.qty,
            row.bas_price,
            row.cgst,
            row.sgst,
            row.igst,
            row.inv_val,
            row.igst_yes_no,
            row.percentage,
        )
    }

    fn build_page(
        rows: &[&TallyExportRow],
        page_num: usize,
        total_pages: usize,
    ) -> printpdf::PdfPage {
        use printpdf::*;

        let mut ops = vec![
            Op::StartTextSection,
            Op::SetTextCursor {
                pos: Point::new(Mm(10.0), Mm(195.0)),
            },
            Op::SetFillColor {
                col: Color::Rgb(Rgb {
                    r: 0.1,
                    g: 0.1,
                    b: 0.1,
                    icc_profile: None,
                }),
            },
            Op::SetFont {
                font: PdfFontHandle::Builtin(BuiltinFont::HelveticaBold),
                size: Pt(12.0),
            },
            Op::SetLineHeight { lh: Pt(16.0) },
            Op::ShowText {
                items: vec![TextItem::Text(format!(
                    "Sales Export Report — Page {} of {}",
                    page_num, total_pages
                ))],
            },
            Op::AddLineBreak,
            Op::SetFont {
                font: PdfFontHandle::Builtin(BuiltinFont::CourierBold),
                size: Pt(8.0),
            },
            Op::SetLineHeight { lh: Pt(11.0) },
            Op::ShowText {
                items: vec![TextItem::Text(Self::header_line())],
            },
            Op::AddLineBreak,
            Op::SetFont {
                font: PdfFontHandle::Builtin(BuiltinFont::Courier),
                size: Pt(8.0),
            },
        ];

        for row in rows {
            ops.push(Op::ShowText {
                items: vec![TextItem::Text(Self::format_row(row))],
            });
            ops.push(Op::AddLineBreak);
        }

        ops.push(Op::EndTextSection);
        PdfPage::new(Mm(297.0), Mm(210.0), ops)
    }
}

impl Exporter for PdfExporter {
    fn format_name(&self) -> &str {
        "PDF"
    }

    fn export(&self, data: &[TallyExportRow], output_path: &str) -> Result<u32, AppError> {
        use printpdf::{PdfDocument, PdfSaveOptions};

        let row_count = data.len() as u32;
        let row_refs: Vec<&TallyExportRow> = data.iter().collect();
        let total_pages = row_refs.chunks(PDF_ROWS_PER_PAGE).len().max(1);

        let pages: Vec<_> = if row_refs.is_empty() {
            vec![Self::build_page(&[], 1, 1)]
        } else {
            row_refs
                .chunks(PDF_ROWS_PER_PAGE)
                .enumerate()
                .map(|(idx, chunk)| Self::build_page(chunk, idx + 1, total_pages))
                .collect()
        };

        let mut doc = PdfDocument::new("Sales Export Report");
        let pdf_bytes = doc
            .with_pages(pages)
            .save(&PdfSaveOptions::default(), &mut Vec::new());

        std::fs::write(output_path, pdf_bytes).map_err(|e| AppError::Export {
            code: "ERR_TALLY_002".to_string(),
            message: format!("Failed to write PDF export file: {}", e),
        })?;

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
            cgst: if percentage > 0.0 {
                ass_val * percentage / 200.0
            } else {
                0.0
            },
            sgst: if percentage > 0.0 {
                ass_val * percentage / 200.0
            } else {
                0.0
            },
            igst: 0.0,
            amot: ass_val + (ass_val * percentage / 100.0),
            inv_val: ass_val + (ass_val * percentage / 100.0),
            igst_yes_no: "N".to_string(),
            percentage,
        }
    }

    #[test]
    fn test_single_row_per_invoice_merging() {
        let rows = vec![
            make_row("372076", "P01", 18.0, 1000.0),
            make_row("372076", "P02", 18.0, 500.0),
        ];

        let result = TallyExcelExporter::split_multi_rate(&rows);
        assert_eq!(result.len(), 1);
        assert_eq!(result[0].inv_no, "372076");
        assert_eq!(result[0].ass_val, 1500.0);
        assert_eq!(result[0].part_code, "P01"); // Kept first item's part code
    }

    #[test]
    fn test_multi_item_invoice_value_merging() {
        let rows = vec![
            make_row("372076", "P01", 0.0, 200.0),
            make_row("372076", "P02", 18.0, 800.0),
        ];

        let result = TallyExcelExporter::split_multi_rate(&rows);
        assert_eq!(result.len(), 1);

        assert_eq!(result[0].inv_no, "372076");
        assert_eq!(result[0].ass_val, 1000.0);
        assert_eq!(result[0].part_code, "P01");
    }

    #[test]
    fn test_multiple_invoices_independently_merged() {
        let rows = vec![
            make_row("INV001", "P01", 0.0, 100.0),
            make_row("INV001", "P02", 18.0, 500.0),
            make_row("INV002", "P03", 18.0, 700.0),
        ];

        let result = TallyExcelExporter::split_multi_rate(&rows);
        assert_eq!(result.len(), 2);

        assert_eq!(result[0].inv_no, "INV001");
        assert_eq!(result[0].ass_val, 600.0);

        assert_eq!(result[1].inv_no, "INV002");
        assert_eq!(result[1].ass_val, 700.0);
    }

    #[test]
    fn test_pdf_exporter_writes_file_with_all_rows() {
        let rows = vec![
            make_row("PDF001", "P01", 18.0, 1000.0),
            make_row("PDF002", "P02", 0.0, 500.0),
        ];
        let dir = std::env::temp_dir();
        let path = dir.join(format!("test_pdf_export_{}.pdf", std::process::id()));
        let path_str = path.to_str().unwrap();

        let exporter = PdfExporter;
        let row_count = exporter
            .export(&rows, path_str)
            .expect("PDF export should succeed");

        assert_eq!(row_count, 2);
        let metadata = std::fs::metadata(path_str).expect("PDF file should exist");
        assert!(metadata.len() > 0, "PDF file should not be empty");

        std::fs::remove_file(path_str).ok();
    }

    #[test]
    fn test_pdf_exporter_paginates_large_row_sets() {
        let rows: Vec<TallyExportRow> = (0..95)
            .map(|i| make_row(&format!("INV{:04}", i), "P01", 18.0, 100.0))
            .collect();
        let dir = std::env::temp_dir();
        let path = dir.join(format!("test_pdf_paginate_{}.pdf", std::process::id()));
        let path_str = path.to_str().unwrap();

        let exporter = PdfExporter;
        let row_count = exporter
            .export(&rows, path_str)
            .expect("PDF export should succeed");

        assert_eq!(row_count, 95);
        std::fs::remove_file(path_str).ok();
    }
}
