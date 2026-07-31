import React from "react";
import { AlertTriangle, CheckCircle2, X, FileCheck, RefreshCw } from "lucide-react";
import { formatINR } from "../utils/formatCurrency";

interface Props {
  isOpen: boolean;
  count: number;
  taxable: number;
  tax: number;
  total: number;
  isProcessing: boolean;
  onConfirm: () => void;
  onClose: () => void;
}

export const BulkVerifyConfirmModal: React.FC<Props> = ({
  isOpen,
  count,
  taxable,
  tax,
  total,
  isProcessing,
  onConfirm,
  onClose,
}) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in duration-150">
      <div className="w-full max-w-md ember-card p-6 shadow-2xl relative border border-[var(--ember-border)] rounded-2xl space-y-5">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-[var(--ember-border-subtle)] pb-4">
          <div className="flex items-center gap-2.5 text-emerald-400 font-serif font-bold text-base">
            <FileCheck className="w-5 h-5 text-emerald-400" />
            <span>Confirm Bulk Verification</span>
          </div>
          {!isProcessing && (
            <button
              onClick={onClose}
              className="text-[var(--ember-text-muted)] hover:text-[var(--ember-text-primary)] transition-colors cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>

        {/* Content Body */}
        <div className="space-y-4 text-xs">
          <p className="text-[var(--ember-text-secondary)] leading-relaxed">
            You are about to mark <strong className="text-[var(--ember-text-primary)] font-semibold">{count}</strong> selected invoice{count > 1 ? "s" : ""} as <span className="text-emerald-400 font-semibold uppercase">Verified</span>.
          </p>

          {/* Financial Summary Box */}
          <div className="bg-[var(--ember-surface-raised)] border border-[var(--ember-border-subtle)] rounded-xl p-3.5 space-y-2 font-mono">
            <div className="flex justify-between items-center text-[var(--ember-text-muted)] text-[11px]">
              <span>Taxable Subtotal:</span>
              <span className="font-semibold text-[var(--ember-text-primary)]">{formatINR(taxable)}</span>
            </div>
            <div className="flex justify-between items-center text-[var(--ember-text-muted)] text-[11px]">
              <span>Total GST:</span>
              <span className="font-semibold text-[var(--ember-text-secondary)]">{formatINR(tax)}</span>
            </div>
            <div className="border-t border-[var(--ember-border-subtle)] pt-2 flex justify-between items-center text-xs font-bold">
              <span className="text-[var(--ember-text-primary)]">Total Value:</span>
              <span className="text-emerald-400">{formatINR(total)}</span>
            </div>
          </div>

          {/* Audit Trail Note */}
          <div className="bg-amber-500/10 border border-amber-500/20 rounded-xl p-3 flex items-start gap-2.5 text-[11px] text-amber-300">
            <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
            <div>
              <strong className="block font-semibold mb-0.5 text-amber-200">Audit Compliance Notice</strong>
              Every verified record will generate a parent batch transaction ID and individual auditable timestamps. Protected statuses (Cancelled / Credit Note Generated) will be skipped.
            </div>
          </div>

          {/* Progress Spinner for Processing State */}
          {isProcessing && (
            <div className="bg-emerald-950/40 border border-emerald-500/30 rounded-xl p-4 text-center space-y-2">
              <div className="flex items-center justify-center gap-2 text-emerald-300 font-semibold">
                <RefreshCw className="w-4 h-4 animate-spin text-emerald-400" />
                <span>Executing Atomic SQLite Transaction...</span>
              </div>
              <p className="text-[10px] text-[var(--ember-text-muted)]">
                Updating database records, writing audit logs, and recalculating summary metrics.
              </p>
            </div>
          )}
        </div>

        {/* Action Buttons */}
        <div className="flex items-center justify-end gap-3 pt-2">
          <button
            onClick={onClose}
            disabled={isProcessing}
            className="px-4 py-2 rounded-xl border border-[var(--ember-border)] hover:bg-[var(--ember-surface-raised)] text-[var(--ember-text-secondary)] text-xs font-semibold transition-colors disabled:opacity-50 cursor-pointer"
          >
            Cancel
          </button>

          <button
            onClick={onConfirm}
            disabled={isProcessing}
            className="px-5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold flex items-center gap-2 shadow-lg shadow-emerald-900/40 transition-all disabled:opacity-50 cursor-pointer"
          >
            {isProcessing ? (
              <>
                <RefreshCw className="w-3.5 h-3.5 animate-spin" /> Verifying...
              </>
            ) : (
              <>
                <CheckCircle2 className="w-4 h-4" /> Confirm & Verify
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
};
