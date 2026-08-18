import { save } from "@tauri-apps/plugin-dialog";
import { writeTextFile } from "@tauri-apps/plugin-fs";
import { ReportMetadata } from "../types/bindings/ReportMetadata";

export interface ExportColumn<T> {
  header: string;
  accessor: (row: T) => any;
  format?: (value: any) => string;
  align?: "left" | "center" | "right";
}

export class ReportExportService {
  /**
   * Generates formatted CSV string with metadata header block
   */
  static buildCsvContent<T>(
    title: string,
    metadata: ReportMetadata | null,
    columns: ExportColumn<T>[],
    data: T[],
    companyName: string = "Sales Monitoring System"
  ): string {
    const lines: string[] = [];

    // Header Meta Banner
    lines.push(`"${title.toUpperCase()}"`);
    lines.push(`"Company: ${companyName}"`);
    if (metadata) {
      lines.push(`"Report Version: v${metadata.report_version}"`);
      lines.push(`"Generated At: ${metadata.generated_at}"`);
      lines.push(`"Total Records: ${metadata.total_records}"`);
      lines.push(`"Execution Time: ${metadata.execution_time_ms} ms"`);
    }
    lines.push(""); // Spacer row

    // Table Column Headers
    const headers = columns.map((col) => `"${col.header.replace(/"/g, '""')}"`);
    lines.push(headers.join(","));

    // Table Data Rows
    for (const row of data) {
      const rowCells = columns.map((col) => {
        const val = col.accessor(row);
        const formatted = col.format ? col.format(val) : String(val ?? "");
        return `"${formatted.replace(/"/g, '""')}"`;
      });
      lines.push(rowCells.join(","));
    }

    return lines.join("\n");
  }

  /**
   * Export report data to CSV file with save file dialog
   */
  static async exportToCsv<T>(
    title: string,
    metadata: ReportMetadata | null,
    columns: ExportColumn<T>[],
    data: T[],
    filenamePrefix: string
  ): Promise<boolean> {
    try {
      const csvData = this.buildCsvContent(title, metadata, columns, data);
      const savePath = await save({
        defaultPath: `${filenamePrefix}_${new Date().toISOString().split("T")[0]}.csv`,
        filters: [{ name: "CSV Files", extensions: ["csv"] }],
      });

      if (!savePath) return false;

      await writeTextFile(savePath, csvData);
      return true;
    } catch (err) {
      console.error("Failed to export CSV:", err);
      alert(`Export failed: ${err instanceof Error ? err.message : String(err)}`);
      return false;
    }
  }

  /**
   * Formats a raw UOM string to standard GSTR-1 Table 12 UQC code (e.g. NOS-NUMBERS, KGS-KILOGRAMS, KLR-KILOLITRE)
   */
  static formatGstr1Uqc(rawUom?: string | null): string {
    if (!rawUom || !rawUom.trim()) return "OTH-OTHERS";
    const upper = rawUom.trim().toUpperCase();
    if (upper.includes("-")) return upper;

    const uqcMap: Record<string, string> = {
      NOS: "NOS-NUMBERS",
      NO: "NOS-NUMBERS",
      NUM: "NOS-NUMBERS",
      PCS: "PCS-PIECES",
      PC: "PCS-PIECES",
      PIECE: "PCS-PIECES",
      PIECES: "PCS-PIECES",
      KGS: "KGS-KILOGRAMS",
      KG: "KGS-KILOGRAMS",
      KILOGRAM: "KGS-KILOGRAMS",
      KILOGRAMS: "KGS-KILOGRAMS",
      KLR: "KLR-KILOLITRE",
      KL: "KLR-KILOLITRE",
      KILOLITRE: "KLR-KILOLITRE",
      LTR: "LTR-LITRES",
      LT: "LTR-LITRES",
      LITRE: "LTR-LITRES",
      LITRES: "LTR-LITRES",
      MTR: "MTR-METRES",
      MT: "MTR-METRES",
      M: "MTR-METRES",
      METRE: "MTR-METRES",
      METRES: "MTR-METRES",
      SET: "SET-SETS",
      SETS: "SET-SETS",
      BOX: "BOX-BOX",
      BTL: "BTL-BOTTLES",
      CAN: "CAN-CANS",
      DRM: "DRM-DRUMS",
      BAG: "BAG-BAGS",
      GMS: "GMS-GRAMMES",
      GM: "GMS-GRAMMES",
      QTL: "QTL-QUINTAL",
      TON: "TON-TONNES",
      SQM: "SQM-SQUARE METRES",
      SQF: "SQF-SQUARE FEET",
      OTH: "OTH-OTHERS",
    };

    return uqcMap[upper] || `${upper}-OTHERS`;
  }

  /**
   * Export GSTR-1 Table 12 HSN Summary CSV (Direct Government Format)
   */
  static async exportGstr1Table12Csv(
    rows: Array<{
      hsn_code: string;
      description?: string | null;
      uom_code?: string | null;
      total_quantity: number;
      total_value: number;
      total_taxable: number;
      total_igst: number;
      total_cgst: number;
      total_sgst: number;
    }>,
    filenamePrefix: string = "GSTR1_Table12_HSN_Summary"
  ): Promise<boolean> {
    try {
      const lines: string[] = [];
      // GSTR-1 Table 12 Header
      lines.push('"HSN","Description","UQC","Total Quantity","Total Value","Taxable Value","Integrated Tax Amount","Central Tax Amount","State/UT Tax Amount","Cess Amount"');

      for (const r of rows) {
        const hsn = (r.hsn_code || "").replace(/"/g, '""');
        const desc = (r.description || "").replace(/"/g, '""');
        const uqc = this.formatGstr1Uqc(r.uom_code).replace(/"/g, '""');
        const qty = r.total_quantity || 0;
        const totalVal = (r.total_value || 0).toFixed(2);
        const taxableVal = (r.total_taxable || 0).toFixed(2);
        const igst = (r.total_igst || 0).toFixed(2);
        const cgst = (r.total_cgst || 0).toFixed(2);
        const sgst = (r.total_sgst || 0).toFixed(2);
        const cess = "0.00";

        lines.push(`"${hsn}","${desc}","${uqc}",${qty},${totalVal},${taxableVal},${igst},${cgst},${sgst},${cess}`);
      }

      const csvData = lines.join("\n");
      const savePath = await save({
        defaultPath: `${filenamePrefix}_${new Date().toISOString().split("T")[0]}.csv`,
        filters: [{ name: "CSV Files", extensions: ["csv"] }],
      });

      if (!savePath) return false;

      await writeTextFile(savePath, csvData);
      return true;
    } catch (err) {
      console.error("Failed to export GSTR-1 Table 12 CSV:", err);
      alert(`Export failed: ${err instanceof Error ? err.message : String(err)}`);
      return false;
    }
  }


  /**
   * Copy formatted tab-delimited text to system clipboard
   */
  static async copyToClipboard<T>(
    title: string,
    columns: ExportColumn<T>[],
    data: T[]
  ): Promise<boolean> {
    try {
      const lines: string[] = [];
      lines.push(title.toUpperCase());
      lines.push(columns.map((c) => c.header).join("\t"));

      for (const row of data) {
        const rowCells = columns.map((col) => {
          const val = col.accessor(row);
          return col.format ? col.format(val) : String(val ?? "");
        });
        lines.push(rowCells.join("\t"));
      }

      await navigator.clipboard.writeText(lines.join("\n"));
      return true;
    } catch (err) {
      console.error("Failed to copy to clipboard:", err);
      return false;
    }
  }

  /**
   * Trigger print window with styled HTML table layout
   */
  static printReport<T>(
    title: string,
    metadata: ReportMetadata | null,
    columns: ExportColumn<T>[],
    data: T[],
    companyName: string = "Sales Monitoring System"
  ): void {
    const printWin = window.open("", "_blank");
    if (!printWin) {
      alert("Pop-up blocked. Please allow pop-ups to print reports.");
      return;
    }

    const colHeaders = columns.map((c) => `<th style="border:1px solid #ccc; padding:8px; text-align:${c.align || 'left'};">${c.header}</th>`).join("");
    const dataRows = data
      .map(
        (row) =>
          `<tr>${columns
            .map((c) => {
              const val = c.accessor(row);
              const formatted = c.format ? c.format(val) : String(val ?? "");
              return `<td style="border:1px solid #ddd; padding:6px 8px; text-align:${c.align || 'left'};">${formatted}</td>`;
            })
            .join("")}</tr>`
      )
      .join("");

    const html = `
      <!DOCTYPE html>
      <html>
        <head>
          <title>${title}</title>
          <style>
            body { font-family: sans-serif; font-size: 12px; margin: 20px; color: #111; }
            h2 { margin-bottom: 4px; color: #1e3a8a; }
            .meta { font-size: 11px; color: #555; margin-bottom: 16px; line-height: 1.5; }
            table { width: 100%; border-collapse: collapse; margin-top: 12px; }
            th { background-color: #f3f4f6; font-weight: bold; }
            tr:nth-child(even) { background-color: #f9fafb; }
          </style>
        </head>
        <body>
          <h2>${title}</h2>
          <div class="meta">
            <div><strong>Company:</strong> ${companyName}</div>
            ${metadata ? `<div><strong>Report Version:</strong> v${metadata.report_version} | <strong>Generated At:</strong> ${metadata.generated_at}</div>` : ""}
            ${metadata ? `<div><strong>Total Records:</strong> ${metadata.total_records} | <strong>Execution Time:</strong> ${metadata.execution_time_ms} ms</div>` : ""}
          </div>
          <table>
            <thead><tr>${colHeaders}</tr></thead>
            <tbody>${dataRows}</tbody>
          </table>
          <script>
            window.onload = () => { window.print(); window.close(); };
          </script>
        </body>
      </html>
    `;

    printWin.document.open();
    printWin.document.write(html);
    printWin.document.close();
  }
}
