import { ColumnDefinition } from "../types";
import { TableTelemetry } from "./tableTelemetry";

export interface ExportOptions<T> {
  filename: string;
  columns: ColumnDefinition<T>[];
  data: T[];
  onProgress?: (percentage: number) => void;
  signal?: AbortSignal;
}

export class TableExportService {
  static async exportCSV<T>(options: ExportOptions<T>): Promise<boolean> {
    const { filename, columns, data, onProgress, signal } = options;
    const exportableCols = columns.filter((c) => c.exportable !== false);

    const headers = exportableCols.map((c) => `"${c.title.replace(/"/g, '""')}"`).join(",");
    const rows: string[] = [headers];

    const chunkSize = 200;
    for (let i = 0; i < data.length; i += chunkSize) {
      if (signal?.aborted) {
        TableTelemetry.log("export", "csv_export_cancelled", { filename });
        return false;
      }

      const chunk = data.slice(i, i + chunkSize);
      for (const row of chunk) {
        const line = exportableCols
          .map((c) => {
            const rawVal = c.exportFormatter
              ? c.exportFormatter(row)
              : c.sortAccessor
              ? c.sortAccessor(row)
              : (row as any)[c.id];
            const strVal = rawVal == null ? "" : String(rawVal);
            return `"${strVal.replace(/"/g, '""')}"`;
          })
          .join(",");
        rows.push(line);
      }

      if (onProgress) {
        onProgress(Math.min(100, Math.round(((i + chunkSize) / data.length) * 100)));
      }

      // Allow event loop to breathe
      await new Promise((resolve) => setTimeout(resolve, 0));
    }

    const csvContent = "\uFEFF" + rows.join("\n");
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `${filename}.csv`;
    link.click();
    URL.revokeObjectURL(link.href);

    TableTelemetry.log("export", "csv_export_success", { filename, rowCount: data.length });
    return true;
  }

  static async exportClipboard<T>(options: Omit<ExportOptions<T>, "onProgress" | "signal">): Promise<boolean> {
    const { columns, data } = options;
    const exportableCols = columns.filter((c) => c.exportable !== false);

    const headers = exportableCols.map((c) => c.title).join("\t");
    const rows = data.map((row) =>
      exportableCols
        .map((c) => {
          const rawVal = c.exportFormatter
            ? c.exportFormatter(row)
            : c.sortAccessor
            ? c.sortAccessor(row)
            : (row as any)[c.id];
          return rawVal == null ? "" : String(rawVal).replace(/\t|\n/g, " ");
        })
        .join("\t")
    );

    const text = [headers, ...rows].join("\n");
    await navigator.clipboard.writeText(text);
    TableTelemetry.log("export", "clipboard_export_success", { rowCount: data.length });
    return true;
  }

  static printView<T>(options: Omit<ExportOptions<T>, "onProgress" | "signal">): void {
    const { filename, columns, data } = options;
    const exportableCols = columns.filter((c) => c.exportable !== false);

    const printWin = window.open("", "_blank");
    if (!printWin) return;

    const html = `
      <!DOCTYPE html>
      <html>
        <head>
          <title>${filename}</title>
          <style>
            body { font-family: sans-serif; font-size: 12px; margin: 20px; }
            h2 { margin-bottom: 10px; font-family: serif; }
            table { width: 100%; border-collapse: collapse; margin-top: 10px; }
            th, td { border: 1px solid #ccc; padding: 6px 10px; text-align: left; }
            th { background-color: #f3f4f6; font-weight: bold; }
          </style>
        </head>
        <body>
          <h2>${filename}</h2>
          <p>Generated on ${new Date().toLocaleString()} - Total Records: ${data.length}</p>
          <table>
            <thead>
              <tr>
                ${exportableCols.map((c) => `<th>${c.title}</th>`).join("")}
              </tr>
            </thead>
            <tbody>
              ${data
                .map(
                  (row) => `
                <tr>
                  ${exportableCols
                    .map((c) => {
                      const val = c.exportFormatter
                        ? c.exportFormatter(row)
                        : (row as any)[c.id] ?? "";
                      return `<td>${val}</td>`;
                    })
                    .join("")}
                </tr>
              `
                )
                .join("")}
            </tbody>
          </table>
        </body>
      </html>
    `;

    printWin.document.write(html);
    printWin.document.close();
    printWin.focus();
    printWin.print();
    TableTelemetry.log("export", "print_export_success", { filename, rowCount: data.length });
  }
}
