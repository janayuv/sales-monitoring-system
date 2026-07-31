import { InvoiceSummary } from "../../../types";

export function generateExcelXML(
  invoices: InvoiceSummary[]
): string {
  const nowStr = new Date().toLocaleString("en-IN");
  
  const totalTaxable = invoices.reduce((acc, i) => acc + i.total_taxable, 0);
  const totalTax = invoices.reduce((acc, i) => acc + i.total_tax, 0);
  const totalVal = invoices.reduce((acc, i) => acc + i.total_value, 0);

  const rowsXml = invoices.map(inv => `
    <Row>
      <Cell><Data ss:Type="String">${inv.invoice_number}</Data></Cell>
      <Cell><Data ss:Type="String">${inv.invoice_date}</Data></Cell>
      <Cell><Data ss:Type="String">${inv.customer_code}</Data></Cell>
      <Cell><Data ss:Type="String">${escapeXml(inv.customer_name)}</Data></Cell>
      <Cell><Data ss:Type="Number">${inv.total_taxable}</Data></Cell>
      <Cell><Data ss:Type="Number">${inv.total_tax}</Data></Cell>
      <Cell><Data ss:Type="Number">${inv.total_value}</Data></Cell>
      <Cell><Data ss:Type="String">${inv.status}</Data></Cell>
    </Row>
  `).join("");

  return `<?xml version="1.0"?>
<?mso-application progid="Excel.Sheet"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"
 xmlns:o="urn:schemas-microsoft-com:office:office"
 xmlns:x="urn:schemas-microsoft-com:office:excel"
 xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">
 <Worksheet ss:Name="Outward Register">
  <Table>
   <Row>
    <Cell><Data ss:Type="String">Sales Invoice Register Report</Data></Cell>
   </Row>
   <Row>
    <Cell><Data ss:Type="String">Generated At: ${nowStr}</Data></Cell>
   </Row>
   <Row>
    <Cell><Data ss:Type="String">Total Records: ${invoices.length}</Data></Cell>
   </Row>
   <Row></Row>
   <Row>
    <Cell><Data ss:Type="String">Invoice No</Data></Cell>
    <Cell><Data ss:Type="String">Invoice Date</Data></Cell>
    <Cell><Data ss:Type="String">Customer Code</Data></Cell>
    <Cell><Data ss:Type="String">Customer Name</Data></Cell>
    <Cell><Data ss:Type="String">Taxable (INR)</Data></Cell>
    <Cell><Data ss:Type="String">Tax Amount (INR)</Data></Cell>
    <Cell><Data ss:Type="String">Total Value (INR)</Data></Cell>
    <Cell><Data ss:Type="String">Status</Data></Cell>
   </Row>
   ${rowsXml}
   <Row>
    <Cell><Data ss:Type="String">TOTAL (${invoices.length})</Data></Cell>
    <Cell><Data ss:Type="String"></Data></Cell>
    <Cell><Data ss:Type="String"></Data></Cell>
    <Cell><Data ss:Type="String"></Data></Cell>
    <Cell><Data ss:Type="Number">${totalTaxable}</Data></Cell>
    <Cell><Data ss:Type="Number">${totalTax}</Data></Cell>
    <Cell><Data ss:Type="Number">${totalVal}</Data></Cell>
    <Cell><Data ss:Type="String"></Data></Cell>
   </Row>
  </Table>
 </Worksheet>
</Workbook>`;
}

function escapeXml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

export function downloadExcel(filename: string, xmlContent: string) {
  const blob = new Blob([xmlContent], { type: "application/vnd.ms-excel" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.setAttribute("href", url);
  link.setAttribute("download", filename);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}
