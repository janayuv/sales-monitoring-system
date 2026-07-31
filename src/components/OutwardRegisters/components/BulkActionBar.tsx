import React from "react";
import { CheckCircle2, FileSpreadsheet, XCircle, ShieldCheck } from "lucide-react";
import { formatINR } from "../utils/formatCurrency";

interface Props {
  selectedCount: number;
  selectedTaxable: number;
  selectedTax: number;
  selectedTotal: number;
  isProcessing: boolean;
  onOpenConfirmModal: () => void;
  onExportSelected: () => void;
  onClearSelection: () => void;
}

export const BulkActionBar: React.FC<Props> = ({
  selectedCount,
  selectedTaxable,
  selectedTax,
  selectedTotal,
  isProcessing,
  onOpenConfirmModal,
  onExportSelected,
  onClearSelection,
}) => {
  if (selectedCount === 0) return null;

  return (
    <div className="bg-emerald-900/30 border border-emerald-500/30 rounded-xl p-3.5 backdrop-blur-md shadow-xl flex flex-wrap items-center justify-between gap-4 animate-in fade-in slide-in-from-top-2 duration-200">
      {/* Left: Financial Totals Breakdown */}
      <div className="flex items-center gap-6 flex-wrap text-xs">
        <div className="flex items-center gap-2 font-bold text-emerald-400">
          <ShieldCheck className="w-5 h-5 text-emerald-400 animate-pulse" />
          <span>
            {selectedCount} Invoice{selectedCount > 1 ? "s" : ""} Selected
          </span>
        </div>

        <div className="h-4 w-px bg-emerald-500/20 hidden sm:block" />

        <div className="flex items-center gap-4 text-[11px] font-mono">
          <div>
            <span className="text-[var(--ember-text-muted)] font-sans">Taxable:</span>{" "}
            <span className="font-semibold text-[var(--ember-text-primary)]">{formatINR(selectedTaxable)}</span>
          </div>
          <div>
            <span className="text-[var(--ember-text-muted)] font-sans">GST:</span>{" "}
            <span className="font-semibold text-[var(--ember-text-secondary)]">{formatINR(selectedTax)}</span>
          </div>
          <div>
            <span className="text-[var(--ember-text-muted)] font-sans">Total Value:</span>{" "}
            <span className="font-bold text-emerald-400">{formatINR(selectedTotal)}</span>
          </div>
        </div>
      </div>

      {/* Right: Action Buttons */}
      <div className="flex items-center gap-2.5">
        <button
          onClick={onExportSelected}
          disabled={isProcessing}
          className="px-3 py-1.5 rounded-lg border border-[var(--ember-border)] hover:bg-[var(--ember-surface-raised)] text-[var(--ember-text-secondary)] hover:text-[var(--ember-text-primary)] text-xs font-semibold flex items-center gap-1.5 transition-colors disabled:opacity-50 cursor-pointer"
          title="Export selected invoices to CSV"
        >
          <FileSpreadsheet className="w-3.5 h-3.5 text-sky-400" />
          Export
        </button>

        <button
          onClick={onOpenConfirmModal}
          disabled={isProcessing}
          className="px-4 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs flex items-center gap-1.5 shadow-md shadow-emerald-900/30 transition-all transform active:scale-95 disabled:opacity-50 cursor-pointer"
        >
          <CheckCircle2 className="w-4 h-4" />
          {isProcessing ? "Verifying..." : "Bulk Mark Verified"}
        </button>

        <button
          onClick={onClearSelection}
          disabled={isProcessing}
          className="p-1.5 text-[var(--ember-text-muted)] hover:text-rose-400 rounded-lg transition-colors cursor-pointer"
          title="Clear selection"
        >
          <XCircle className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
};
