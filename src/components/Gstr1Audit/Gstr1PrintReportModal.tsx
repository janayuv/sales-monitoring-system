import React from "react";
import { X, Printer } from "lucide-react";
import { AuditReconItem, AuditSummaryMetrics } from "../../types/gstr1AuditTypes";
import { formatAmount, formatCurrency, formatDate } from "../../utils/formatters";

interface Props {
  metrics: AuditSummaryMetrics;
  items: AuditReconItem[];
  companyName: string;
  companyGstin?: string;
  onClose: () => void;
}

export const Gstr1PrintReportModal: React.FC<Props> = ({
  metrics,
  items,
  companyName,
  companyGstin = "33AAAAA0000A1Z5",
  onClose,
}) => {
  const handlePrint = () => {
    window.print();
  };

  const discrepancyItems = items.filter((i) => i.status !== "MATCHED");

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-xs">
      {/* Container - hide non-print elements during window.print() */}
      <div className="ember-card w-full max-w-5xl max-h-[92vh] flex flex-col shadow-2xl border border-[var(--ember-border)] overflow-hidden bg-white text-slate-900 dark:bg-slate-900 dark:text-slate-100 print:max-w-none print:m-0 print:border-0 print:shadow-none print:h-auto print:max-h-none print:overflow-visible">
        {/* Top Action Bar (Hidden during print) */}
        <div className="p-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between bg-slate-50 dark:bg-slate-800/80 print:hidden">
          <div className="flex items-center gap-2">
            <Printer className="w-5 h-5 text-[var(--ember-primary)]" />
            <h3 className="text-sm font-bold font-serif text-[var(--ember-text-primary)]">
              Formal GSTR-1 Reconciliation Audit Certificate (Print Preview)
            </h3>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={handlePrint}
              className="px-4 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-xs font-semibold flex items-center gap-1.5 cursor-pointer shadow-sm transition-colors"
            >
              <Printer className="w-4 h-4" />
              Print / Save as PDF
            </button>
            <button
              onClick={onClose}
              className="p-1.5 rounded-lg text-slate-500 hover:text-slate-900 dark:hover:text-slate-100 hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Print Document Content */}
        <div className="p-8 overflow-y-auto space-y-6 text-xs print:p-0 print:overflow-visible font-sans">
          {/* Header Block */}
          <div className="border-b-2 border-slate-800 pb-4 flex justify-between items-start">
            <div>
              <span className="text-[10px] font-mono tracking-wider font-bold text-slate-500 uppercase">
                Statutory GST Reconciliation Workpaper
              </span>
              <h1 className="text-xl font-bold font-serif uppercase tracking-wide text-slate-900 dark:text-slate-100 mt-0.5">
                {companyName || "Sales Monitoring System"}
              </h1>
              <div className="mt-1 space-y-0.5 text-slate-600 dark:text-slate-300 font-mono text-[11px]">
                <p><strong>GSTIN:</strong> {companyGstin}</p>
                <p><strong>Document:</strong> GSTR-1 Outward Supply Return vs Books Sales Register</p>
              </div>
            </div>

            <div className="text-right text-[11px] font-mono text-slate-600 dark:text-slate-300">
              <p><strong>Date of Audit:</strong> {new Date().toLocaleDateString("en-IN")}</p>
              <p><strong>Time:</strong> {new Date().toLocaleTimeString("en-IN")}</p>
              <div className="mt-2 inline-block px-3 py-1 bg-slate-100 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded font-bold">
                Health Score: {metrics.matched_percent}%
              </div>
            </div>
          </div>

          {/* Section A: Executive Reconciliation Summary Table */}
          <div className="space-y-2">
            <h3 className="font-bold text-xs uppercase tracking-wider text-slate-800 dark:text-slate-200 border-b border-slate-300 dark:border-slate-700 pb-1">
              Section A: Outward Tax Liability Reconciliation
            </h3>
            <table className="w-full text-left border-collapse border border-slate-300 dark:border-slate-700 text-[11px]">
              <thead className="bg-slate-100 dark:bg-slate-800 font-bold">
                <tr>
                  <th className="p-2 border border-slate-300 dark:border-slate-700">Audit Head</th>
                  <th className="p-2 border border-slate-300 dark:border-slate-700 text-right">Internal Books (₹)</th>
                  <th className="p-2 border border-slate-300 dark:border-slate-700 text-right">GSTR-1 Portal Return (₹)</th>
                  <th className="p-2 border border-slate-300 dark:border-slate-700 text-right">Variance (Books - Portal)</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td className="p-2 border border-slate-300 dark:border-slate-700 font-semibold">Total Taxable Turnover</td>
                  <td className="p-2 border border-slate-300 dark:border-slate-700 text-right font-mono">{formatCurrency(metrics.books_total_taxable)}</td>
                  <td className="p-2 border border-slate-300 dark:border-slate-700 text-right font-mono">{formatCurrency(metrics.gstr1_total_taxable)}</td>
                  <td className="p-2 border border-slate-300 dark:border-slate-700 text-right font-mono font-bold">
                    {metrics.net_diff_taxable > 0 ? "+" : ""}{formatCurrency(metrics.net_diff_taxable)}
                  </td>
                </tr>
                <tr>
                  <td className="p-2 border border-slate-300 dark:border-slate-700 font-semibold">Total GST Tax Liability</td>
                  <td className="p-2 border border-slate-300 dark:border-slate-700 text-right font-mono">{formatCurrency(metrics.books_total_tax)}</td>
                  <td className="p-2 border border-slate-300 dark:border-slate-700 text-right font-mono">{formatCurrency(metrics.gstr1_total_tax)}</td>
                  <td className="p-2 border border-slate-300 dark:border-slate-700 text-right font-mono font-bold">
                    {metrics.net_diff_tax > 0 ? "+" : ""}{formatCurrency(metrics.net_diff_tax)}
                  </td>
                </tr>
                <tr className="bg-slate-50 dark:bg-slate-800/50 font-bold">
                  <td className="p-2 border border-slate-300 dark:border-slate-700">Gross Invoice Turnover</td>
                  <td className="p-2 border border-slate-300 dark:border-slate-700 text-right font-mono">{formatCurrency(metrics.books_total_value)}</td>
                  <td className="p-2 border border-slate-300 dark:border-slate-700 text-right font-mono">{formatCurrency(metrics.gstr1_total_value)}</td>
                  <td className="p-2 border border-slate-300 dark:border-slate-700 text-right font-mono font-bold">
                    {metrics.net_diff_total > 0 ? "+" : ""}{formatCurrency(metrics.net_diff_total)}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          {/* Section B: Classification Breakdown */}
          <div className="space-y-2">
            <h3 className="font-bold text-xs uppercase tracking-wider text-slate-800 dark:text-slate-200 border-b border-slate-300 dark:border-slate-700 pb-1">
              Section B: Verification Classification Summary
            </h3>
            <div className="grid grid-cols-3 gap-3">
              <div className="border border-slate-200 dark:border-slate-700 p-2.5 rounded bg-slate-50 dark:bg-slate-800/40">
                <span className="text-[10px] uppercase text-slate-500 font-bold block">Matched Invoices</span>
                <span className="font-mono text-base font-bold text-emerald-700 dark:text-emerald-400">
                  {metrics.matched_count} / {metrics.total_records}
                </span>
                <p className="text-[10px] text-slate-500 mt-0.5">Turnover fully reconciled</p>
              </div>

              <div className="border border-slate-200 dark:border-slate-700 p-2.5 rounded bg-slate-50 dark:bg-slate-800/40">
                <span className="text-[10px] uppercase text-slate-500 font-bold block">Taxable & Tax Variances</span>
                <span className="font-mono text-base font-bold text-amber-700 dark:text-amber-400">
                  {metrics.value_mismatch_count + metrics.gst_mismatch_count} Invoices
                </span>
                <p className="text-[10px] text-slate-500 mt-0.5">Requires Table 9A amendment</p>
              </div>

              <div className="border border-slate-200 dark:border-slate-700 p-2.5 rounded bg-slate-50 dark:bg-slate-800/40">
                <span className="text-[10px] uppercase text-slate-500 font-bold block">Missing & Void Discrepancies</span>
                <span className="font-mono text-base font-bold text-rose-700 dark:text-rose-400">
                  {metrics.books_only_count + metrics.gstr1_only_count + metrics.cancelled_mismatch_count} Invoices
                </span>
                <p className="text-[10px] text-slate-500 mt-0.5">Critical compliance attention</p>
              </div>
            </div>
          </div>

          {/* Section C: Itemized Discrepancy Schedule */}
          <div className="space-y-2">
            <h3 className="font-bold text-xs uppercase tracking-wider text-slate-800 dark:text-slate-200 border-b border-slate-300 dark:border-slate-700 pb-1">
              Section C: Itemized Variance & Exception Schedule
            </h3>

            {discrepancyItems.length === 0 ? (
              <p className="text-center py-4 text-slate-500 italic">No discrepancies noted. Books and GSTR-1 are in 100% agreement.</p>
            ) : (
              <table className="w-full text-left border-collapse border border-slate-300 dark:border-slate-700 text-[10px]">
                <thead className="bg-slate-100 dark:bg-slate-800 font-bold">
                  <tr>
                    <th className="p-1.5 border border-slate-300 dark:border-slate-700">Invoice No</th>
                    <th className="p-1.5 border border-slate-300 dark:border-slate-700">Date</th>
                    <th className="p-1.5 border border-slate-300 dark:border-slate-700">Customer Name</th>
                    <th className="p-1.5 border border-slate-300 dark:border-slate-700 text-right">Books (₹)</th>
                    <th className="p-1.5 border border-slate-300 dark:border-slate-700 text-right">GSTR-1 (₹)</th>
                    <th className="p-1.5 border border-slate-300 dark:border-slate-700 text-right">Tax Diff (₹)</th>
                    <th className="p-1.5 border border-slate-300 dark:border-slate-700">Classification</th>
                    <th className="p-1.5 border border-slate-300 dark:border-slate-700">Auditor Action</th>
                  </tr>
                </thead>
                <tbody>
                  {discrepancyItems.map((itm) => (
                    <tr key={itm.key} className="border-b border-slate-300 dark:border-slate-700">
                      <td className="p-1.5 border border-slate-300 dark:border-slate-700 font-mono font-bold">
                        {itm.books?.invoice_number || itm.gstr1?.invoice_number}
                      </td>
                      <td className="p-1.5 border border-slate-300 dark:border-slate-700 font-mono whitespace-nowrap">
                        {formatDate(itm.books?.invoice_date || itm.gstr1?.invoice_date)}
                      </td>
                      <td className="p-1.5 border border-slate-300 dark:border-slate-700 max-w-[130px] truncate">
                        {itm.books?.customer_name || itm.gstr1?.customer_name || "-"}
                      </td>
                      <td className="p-1.5 border border-slate-300 dark:border-slate-700 text-right font-mono">
                        {itm.books ? formatAmount(itm.books.total_value) : "-"}
                      </td>
                      <td className="p-1.5 border border-slate-300 dark:border-slate-700 text-right font-mono">
                        {itm.gstr1 ? formatAmount(itm.gstr1.total_value) : "-"}
                      </td>
                      <td className="p-1.5 border border-slate-300 dark:border-slate-700 text-right font-mono font-bold text-rose-600 dark:text-rose-400">
                        {itm.diff_tax > 0 ? "+" : ""}{formatAmount(itm.diff_tax)}
                      </td>
                      <td className="p-1.5 border border-slate-300 dark:border-slate-700 font-semibold">
                        {itm.status_label}
                      </td>
                      <td className="p-1.5 border border-slate-300 dark:border-slate-700 text-[9px] leading-tight">
                        {itm.recommended_action}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          {/* Section D: Auditor Certificate Sign-Off */}
          <div className="pt-6 border-t border-slate-400 mt-6 grid grid-cols-2 gap-8 text-[11px]">
            <div>
              <p className="font-bold text-slate-900 dark:text-slate-100 mb-1">AUDIT CERTIFICATION STATEMENT:</p>
              <p className="text-slate-600 dark:text-slate-300 leading-relaxed text-[10px]">
                I/We have examined the outward supplies register of the taxpayer against the official GSTR-1 return. 
                Based on our verification, the variances identified above are accurate as of the audit execution timestamp. 
                The taxpayer has been advised on statutory amendments required under the GST Act.
              </p>
            </div>

            <div className="text-right space-y-8">
              <div>
                <p className="font-bold text-slate-800 dark:text-slate-200">Authorized Signatory / GST Auditor</p>
                <p className="text-[10px] text-slate-500">Chartered Accountant / Tax Consultant</p>
              </div>
              <div className="border-t border-dashed border-slate-400 inline-block pt-1 w-48 text-center text-[10px] text-slate-500">
                Signature & Official Stamp
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
