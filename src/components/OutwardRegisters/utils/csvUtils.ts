import { InvoiceSummary } from "../../../types";
import { TableFilters } from "../types/register";

export function generateCSVContent(
  invoices: InvoiceSummary[],
  filters?: TableFilters
): string {
  const headers = [
    "Invoice No",
    "Invoice Date",
    "Customer Code",
    "Customer Name",
    "Taxable Value (INR)",
    "Tax Amount (INR)",
    "Total Value (INR)",
    "Status",
  ];

  const metaRows: string[] = [];
  metaRows.push(`"SALES INVOICE REGISTER REPORT"`);
  metaRows.push(`"Generated At:","${new Date().toLocaleString("en-IN")}"`);

  if (filters) {
    metaRows.push(`"Status Filter:","${filters.statusFilter}"`);
    if (filters.searchQuery) metaRows.push(`"Search Query:","${filters.searchQuery.replace(/"/g, '""')}"`);
    if (filters.dateRange.preset !== "all") {
      metaRows.push(`"Date Range:","${filters.dateRange.from} to ${filters.dateRange.to}"`);
    }
  }

  metaRows.push(`""`); // Empty line separator

  const dataRows = invoices.map((inv) => [
    `"${inv.invoice_number}"`,
    `"${inv.invoice_date}"`,
    `"${inv.customer_code}"`,
    `"${inv.customer_name.replace(/"/g, '""')}"`,
    `"${inv.total_taxable}"`,
    `"${inv.total_tax}"`,
    `"${inv.total_value}"`,
    `"${inv.status}"`,
  ]);

  // Total summary footer
  const totalTaxable = invoices.reduce((acc, i) => acc + i.total_taxable, 0);
  const totalTax = invoices.reduce((acc, i) => acc + i.total_tax, 0);
  const totalVal = invoices.reduce((acc, i) => acc + i.total_value, 0);

  const summaryRow = [
    `"TOTAL (${invoices.length} Invoices)"`,
    `""`,
    `""`,
    `""`,
    `"${totalTaxable}"`,
    `"${totalTax}"`,
    `"${totalVal}"`,
    `""`,
  ];

  const csvLines = [
    ...metaRows,
    headers.join(","),
    ...dataRows.map((r) => r.join(",")),
    summaryRow.join(","),
  ];

  return csvLines.join("\n");
}

export function downloadCSV(filename: string, content: string) {
  const blob = new Blob([content], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.setAttribute("href", url);
  link.setAttribute("download", filename);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}
