import { InvoiceSummary } from "../../../types";
import { TableFilters } from "../types/register";
import { generateCSVContent, downloadCSV } from "../utils/csvUtils";
import { generateExcelXML, downloadExcel } from "../utils/excelUtils";
import { formatINR } from "../utils/formatCurrency";

export class ExportService {
  public static exportCSV(invoices: InvoiceSummary[], filters: TableFilters): void {
    const csvContent = generateCSVContent(invoices, filters);
    const dateStr = new Date().toISOString().split("T")[0];
    downloadCSV(`Sales_Invoice_Register_${dateStr}.csv`, csvContent);
  }

  public static exportExcel(invoices: InvoiceSummary[]): void {
    const excelXml = generateExcelXML(invoices);
    const dateStr = new Date().toISOString().split("T")[0];
    downloadExcel(`Sales_Invoice_Register_${dateStr}.xls`, excelXml);
  }

  public static exportClipboard(invoices: InvoiceSummary[]): Promise<void> {
    const headers = [
      "Invoice No",
      "Invoice Date",
      "Customer Code",
      "Customer Name",
      "Taxable Value",
      "Tax Amount",
      "Total Value",
      "Status",
    ].join("\t");

    const rows = invoices.map((inv) =>
      [
        inv.invoice_number,
        inv.invoice_date,
        inv.customer_code,
        inv.customer_name,
        inv.total_taxable,
        inv.total_tax,
        inv.total_value,
        inv.status,
      ].join("\t")
    );

    const fullText = [headers, ...rows].join("\n");
    return navigator.clipboard.writeText(fullText);
  }

  public static exportPrint(invoices: InvoiceSummary[], filters: TableFilters, companyCode: string): void {
    const printWindow = window.open("", "_blank");
    if (!printWindow) return;

    const totalTaxable = invoices.reduce((acc, i) => acc + i.total_taxable, 0);
    const totalTax = invoices.reduce((acc, i) => acc + i.total_tax, 0);
    const totalValue = invoices.reduce((acc, i) => acc + i.total_value, 0);
    const nowStr = new Date().toLocaleString("en-IN");

    const rowsHtml = invoices
      .map(
        (inv) => `
      <tr>
        <td style="padding: 6px; border-bottom: 1px solid #ddd; font-family: monospace; font-weight: bold;">${inv.invoice_number}</td>
        <td style="padding: 6px; border-bottom: 1px solid #ddd;">${inv.invoice_date}</td>
        <td style="padding: 6px; border-bottom: 1px solid #ddd;">
          <div><strong>${inv.customer_name}</strong></div>
          <div style="font-size: 10px; color: #666; font-family: monospace;">${inv.customer_code}</div>
        </td>
        <td style="padding: 6px; border-bottom: 1px solid #ddd; text-align: right; font-family: monospace;">₹${formatINR(inv.total_taxable)}</td>
        <td style="padding: 6px; border-bottom: 1px solid #ddd; text-align: right; font-family: monospace;">₹${formatINR(inv.total_tax)}</td>
        <td style="padding: 6px; border-bottom: 1px solid #ddd; text-align: right; font-family: monospace; font-weight: bold;">₹${formatINR(inv.total_value)}</td>
        <td style="padding: 6px; border-bottom: 1px solid #ddd; text-align: center;">${inv.status}</td>
      </tr>
    `
      )
      .join("");

    const htmlContent = `
      <!DOCTYPE html>
      <html>
        <head>
          <title>Sales Invoice Register - ${companyCode}</title>
          <style>
            body { font-family: system-ui, -apple-system, sans-serif; margin: 20px; color: #111; }
            h2 { margin: 0 0 4px 0; font-family: serif; }
            .meta { font-size: 11px; color: #555; margin-bottom: 16px; border-bottom: 2px solid #333; padding-bottom: 12px; }
            table { width: 100%; border-collapse: collapse; font-size: 12px; }
            th { background: #f3f4f6; text-align: left; padding: 8px 6px; border-bottom: 2px solid #ccc; font-weight: bold; }
            .tfoot-cell { font-weight: bold; border-top: 2px solid #333; border-bottom: 2px solid #333; padding: 8px 6px; background: #fafafa; }
            @media print {
              body { margin: 0; }
              @page { size: A4 landscape; margin: 12mm; }
            }
          </style>
        </head>
        <body>
          <h2>SALES INVOICE REGISTER REPORT</h2>
          <div class="meta">
            <div><strong>Company Profile:</strong> ${companyCode} | <strong>Generated At:</strong> ${nowStr}</div>
            <div><strong>Status Filter:</strong> ${filters.statusFilter} | <strong>Total Invoices:</strong> ${invoices.length}</div>
            ${filters.searchQuery ? `<div><strong>Search Query:</strong> "${filters.searchQuery}"</div>` : ""}
          </div>
          <table>
            <thead>
              <tr>
                <th>Invoice No</th>
                <th>Invoice Date</th>
                <th>Customer Details</th>
                <th style="text-align: right;">Taxable (₹)</th>
                <th style="text-align: right;">Tax (₹)</th>
                <th style="text-align: right;">Total Value (₹)</th>
                <th style="text-align: center;">Status</th>
              </tr>
            </thead>
            <tbody>
              ${rowsHtml}
            </tbody>
            <tfoot>
              <tr>
                <td colspan="3" class="tfoot-cell">GRAND TOTAL (${invoices.length} Invoices)</td>
                <td class="tfoot-cell" style="text-align: right; font-family: monospace;">₹${formatINR(totalTaxable)}</td>
                <td class="tfoot-cell" style="text-align: right; font-family: monospace;">₹${formatINR(totalTax)}</td>
                <td class="tfoot-cell" style="text-align: right; font-family: monospace;">₹${formatINR(totalValue)}</td>
                <td class="tfoot-cell"></td>
              </tr>
            </tfoot>
          </table>
          <script>
            window.onload = () => {
              window.print();
            };
          </script>
        </body>
      </html>
    `;

    printWindow.document.write(htmlContent);
    printWindow.document.close();
  }
}
