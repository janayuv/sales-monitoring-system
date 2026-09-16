import React, { useState } from "react";
import {
  X,
  ShieldAlert,
  ShieldCheck,
  AlertTriangle,
  FileCheck,
  Edit3,
} from "lucide-react";
import { AuditReconItem } from "../../types/gstr1AuditTypes";
import { formatCurrency, formatDate } from "../../utils/formatters";

interface Props {
  item: AuditReconItem | null;
  onClose: () => void;
  onSaveNotes?: (key: string, notes: string) => void;
}

export const Gstr1DiscrepancyModal: React.FC<Props> = ({ item, onClose, onSaveNotes }) => {
  if (!item) return null;

  const [notes, setNotes] = useState(item.user_notes || "");
  const [resolutionStatus, setResolutionStatus] = useState<"PENDING" | "ACCEPTED" | "AMENDMENT_FLAGGED">("PENDING");

  const isMatched = item.status === "MATCHED";
  const isError = item.status === "CANCELLED_MISMATCH" || item.status === "DUPLICATE";

  const diffRow = (
    label: string,
    bVal: any,
    gVal: any,
    diff: number | null,
    isCurrency: boolean = false
  ) => {
    const hasDiff = diff !== null && Math.abs(diff) > 0.001;
    const format = (v: any) => {
      if (v === null || v === undefined || v === "") return "-";
      if (isCurrency && typeof v === "number") return formatCurrency(v);
      return String(v);
    };

    return (
      <tr className={`border-b border-[var(--ember-border-subtle)] ${hasDiff ? "bg-rose-500/5" : ""}`}>
        <td className="p-3 font-semibold text-[var(--ember-text-secondary)]">{label}</td>
        <td className="p-3 font-mono text-[var(--ember-text-primary)]">{format(bVal)}</td>
        <td className="p-3 font-mono text-[var(--ember-text-primary)]">{format(gVal)}</td>
        <td className="p-3 font-mono text-right">
          {diff !== null ? (
            <span
              className={`font-bold ${
                diff === 0
                  ? "text-emerald-600 dark:text-emerald-400"
                  : "text-rose-600 dark:text-rose-400"
              }`}
            >
              {diff > 0 ? "+" : ""}
              {isCurrency ? formatCurrency(diff) : diff.toFixed(2)}
            </span>
          ) : (
            "-"
          )}
        </td>
        <td className="p-3 text-center">
          {hasDiff ? (
            <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-rose-500/15 text-rose-600 dark:text-rose-400 border border-rose-500/30">
              DISCREPANCY
            </span>
          ) : (
            <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border border-emerald-500/30">
              MATCHED
            </span>
          )}
        </td>
      </tr>
    );
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs animate-in fade-in duration-200">
      <div className="ember-card w-full max-w-4xl max-h-[90vh] flex flex-col shadow-2xl border border-[var(--ember-border)] overflow-hidden">
        {/* Modal Header */}
        <div className="p-5 border-b border-[var(--ember-border)] flex items-center justify-between bg-[var(--ember-surface-raised)]">
          <div className="flex items-center gap-3">
            <div
              className={`p-2.5 rounded-xl ${
                isMatched
                  ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400"
                  : isError
                  ? "bg-rose-500/15 text-rose-600 dark:text-rose-400"
                  : "bg-amber-500/15 text-amber-600 dark:text-amber-400"
              }`}
            >
              {isMatched ? <ShieldCheck className="w-6 h-6" /> : <ShieldAlert className="w-6 h-6" />}
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-base font-bold font-mono text-[var(--ember-text-primary)]">
                  {item.books?.invoice_number || item.gstr1?.invoice_number}
                </h3>
                <span
                  className={`px-2.5 py-0.5 rounded-full text-xs font-bold ${
                    isMatched
                      ? "bg-emerald-500/20 text-emerald-700 dark:text-emerald-300"
                      : isError
                      ? "bg-rose-500/20 text-rose-700 dark:text-rose-300"
                      : "bg-amber-500/20 text-amber-700 dark:text-amber-300"
                  }`}
                >
                  {item.status_label}
                </span>
                {item.is_auto_populated && (
                  <span className="px-2 py-0.5 rounded bg-purple-500/20 text-purple-700 dark:text-purple-300 text-[10px] font-bold">
                    AUTO-POPULATED
                  </span>
                )}
              </div>
              <p className="text-xs text-[var(--ember-text-muted)] mt-0.5">
                Audit Discrepancy Workpaper & Field-Level Reconciliation
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-[var(--ember-text-muted)] hover:text-[var(--ember-text-primary)] hover:bg-[var(--ember-surface)] transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Scrollable Body */}
        <div className="p-6 overflow-y-auto space-y-6 text-xs">
          {/* Diagnosis & Auditor Recommendation Cards */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="bg-[var(--ember-surface-raised)] border border-[var(--ember-border)] rounded-xl p-4 space-y-2">
              <div className="flex items-center gap-2 text-amber-600 dark:text-amber-400 font-bold uppercase tracking-wider text-[11px]">
                <AlertTriangle className="w-4 h-4" />
                Audit Finding & Diagnosis
              </div>
              <p className="text-[var(--ember-text-primary)] leading-relaxed font-medium">
                {item.audit_diagnosis}
              </p>
            </div>

            <div className="bg-[var(--ember-surface-raised)] border border-[var(--ember-border)] rounded-xl p-4 space-y-2">
              <div className="flex items-center gap-2 text-[var(--ember-primary)] font-bold uppercase tracking-wider text-[11px]">
                <FileCheck className="w-4 h-4" />
                Auditor Recommended Action
              </div>
              <p className="text-[var(--ember-text-primary)] leading-relaxed font-medium">
                {item.recommended_action}
              </p>
            </div>
          </div>

          {/* Side-by-Side Dual Column Field Comparison Table */}
          <div className="border border-[var(--ember-border)] rounded-xl overflow-hidden">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="bg-[var(--ember-surface-raised)] border-b border-[var(--ember-border)] text-[11px] font-bold text-[var(--ember-text-muted)] uppercase tracking-wider">
                  <th className="p-3 w-1/4">Field Attribute</th>
                  <th className="p-3 w-1/4 text-blue-700 dark:text-blue-300">Internal Books (ERP)</th>
                  <th className="p-3 w-1/4 text-purple-700 dark:text-purple-300">GSTR-1 Portal Return</th>
                  <th className="p-3 w-1/6 text-right">Variance (Δ)</th>
                  <th className="p-3 text-center">Audit Result</th>
                </tr>
              </thead>
              <tbody>
                {diffRow("Invoice Number", item.books?.invoice_number, item.gstr1?.invoice_number, null)}
                {diffRow(
                  "Invoice Date",
                  item.books?.invoice_date ? formatDate(item.books.invoice_date) : "-",
                  item.gstr1?.invoice_date ? formatDate(item.gstr1.invoice_date) : "-",
                  null
                )}
                {diffRow("Customer / Trade Name", item.books?.customer_name, item.gstr1?.customer_name, null)}
                {diffRow("Recipient GSTIN", item.books?.customer_gstin, item.gstr1?.customer_gstin, null)}
                {diffRow(
                  "Taxable Turnover",
                  item.books?.taxable_value,
                  item.gstr1?.taxable_value,
                  item.diff_taxable,
                  true
                )}
                {diffRow("CGST (Central Tax)", item.books?.cgst_value, item.gstr1?.cgst_value, item.diff_cgst, true)}
                {diffRow("SGST (State/UT Tax)", item.books?.sgst_value, item.gstr1?.sgst_value, item.diff_sgst, true)}
                {diffRow("IGST (Integrated Tax)", item.books?.igst_value, item.gstr1?.igst_value, item.diff_igst, true)}
                {diffRow("Cess Amount", item.books?.cess_value, item.gstr1?.cess_value, item.diff_cess, true)}
                {diffRow("Total GST Tax", item.books?.total_tax, item.gstr1?.total_tax, item.diff_tax, true)}
                {diffRow("Total Invoice Value", item.books?.total_value, item.gstr1?.total_value, item.diff_total, true)}
                {diffRow("Record Status", item.books?.status || "Active", item.gstr1?.is_deleted ? "DELETED" : "ACTIVE", null)}
              </tbody>
            </table>
          </div>

          {/* Audit Resolution & Notes Section */}
          <div className="bg-[var(--ember-surface-raised)] border border-[var(--ember-border)] rounded-xl p-4 space-y-3">
            <h4 className="font-bold text-[var(--ember-text-primary)] text-xs uppercase tracking-wider flex items-center gap-2">
              <Edit3 className="w-4 h-4 text-[var(--ember-primary)]" />
              Auditor Resolution & Working Paper Notes
            </h4>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Record audit reasoning, client clarification, or follow-up note (e.g. 'Client confirmed rounding tolerance of ₹0.40; approved without return amendment')..."
              rows={3}
              className="ember-input w-full p-2.5 text-xs"
            />
            <div className="flex items-center justify-between pt-1">
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setResolutionStatus("ACCEPTED")}
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold cursor-pointer transition-colors ${
                    resolutionStatus === "ACCEPTED"
                      ? "bg-emerald-600 text-white"
                      : "bg-[var(--ember-surface)] border border-[var(--ember-border)] text-[var(--ember-text-secondary)]"
                  }`}
                >
                  ✓ Accept Variance
                </button>
                <button
                  type="button"
                  onClick={() => setResolutionStatus("AMENDMENT_FLAGGED")}
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold cursor-pointer transition-colors ${
                    resolutionStatus === "AMENDMENT_FLAGGED"
                      ? "bg-amber-600 text-white"
                      : "bg-[var(--ember-surface)] border border-[var(--ember-border)] text-[var(--ember-text-secondary)]"
                  }`}
                >
                  ⚠ Flag for GSTR-1 Amendment
                </button>
              </div>

              {onSaveNotes && (
                <button
                  type="button"
                  onClick={() => {
                    onSaveNotes(item.key, notes);
                    alert("Auditor notes saved successfully!");
                  }}
                  className="ember-btn-primary px-4 py-1.5 text-xs cursor-pointer"
                >
                  Save Notes
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Modal Footer */}
        <div className="p-4 border-t border-[var(--ember-border)] flex items-center justify-end gap-3 bg-[var(--ember-surface)]">
          <button
            onClick={onClose}
            className="ember-btn-secondary px-5 py-2 text-xs font-semibold cursor-pointer"
          >
            Close Sheet
          </button>
        </div>
      </div>
    </div>
  );
};
