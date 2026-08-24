import React from "react";
import { CheckCircle2, RefreshCw, X, ShieldCheck, Database, FileSpreadsheet } from "lucide-react";
import { ImportPreview } from "../../types/bindings/ImportPreview";

export interface ReSyncConfirmModalProps {
  isOpen: boolean;
  previewData: ImportPreview | null;
  isImporting: boolean;
  onConfirm: () => void;
  onClose: () => void;
}

export const ReSyncConfirmModal: React.FC<ReSyncConfirmModalProps> = ({
  isOpen,
  previewData,
  isImporting,
  onConfirm,
  onClose,
}) => {
  if (!isOpen || !previewData) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="resync-modal-title"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs animate-in fade-in duration-200"
    >
      <div className="bg-[var(--ember-surface)] border border-[var(--ember-border)] text-[var(--ember-text-primary)] rounded-2xl shadow-2xl max-w-lg w-full overflow-hidden flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="p-6 border-b border-[var(--ember-border)] flex items-start justify-between bg-[var(--ember-surface-raised)]">
          <div className="flex items-center gap-3">
            <div className="p-2.5 bg-indigo-500/15 text-indigo-600 dark:text-indigo-400 rounded-xl border border-indigo-500/30">
              <RefreshCw className="w-6 h-6" />
            </div>
            <div>
              <h3 id="resync-modal-title" className="text-base font-bold font-serif text-[var(--ember-text-primary)]">
                Confirm Batch Re-Synchronization
              </h3>
              <p className="text-xs text-[var(--ember-text-muted)] mt-0.5">
                Update existing records in-place without data duplication
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            disabled={isImporting}
            className="p-1 text-[var(--ember-text-muted)] hover:text-[var(--ember-text-primary)] rounded-lg hover:bg-[var(--ember-surface)] transition-colors disabled:opacity-50 cursor-pointer"
            aria-label="Close"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body Content */}
        <div className="p-6 space-y-5 overflow-y-auto">
          {/* Target Batch Info Badge */}
          <div className="p-4 rounded-xl bg-indigo-500/10 border border-indigo-500/20 flex flex-col gap-2">
            <div className="flex items-center justify-between text-xs">
              <span className="font-semibold text-indigo-700 dark:text-indigo-300 flex items-center gap-1.5">
                <Database className="w-4 h-4" /> Target Batch
              </span>
              <span className="font-mono font-bold text-indigo-800 dark:text-indigo-200">
                Batch #{previewData.existing_batch_id ? previewData.existing_batch_id.toString() : "N/A"}
              </span>
            </div>
            <div className="flex items-center justify-between text-xs text-[var(--ember-text-secondary)]">
              <span className="flex items-center gap-1.5">
                <FileSpreadsheet className="w-4 h-4 text-[var(--ember-text-muted)]" /> File Name
              </span>
              <span className="font-mono truncate max-w-[220px]" title={previewData.file_name}>
                {previewData.file_name}
              </span>
            </div>
            {previewData.existing_batch_imported_at && (
              <div className="flex items-center justify-between text-[11px] text-[var(--ember-text-muted)] border-t border-indigo-500/15 pt-2 mt-1">
                <span>Originally Imported</span>
                <span>{previewData.existing_batch_imported_at}</span>
              </div>
            )}
          </div>

          {/* Planned Synchronizations Overview */}
          <div className="grid grid-cols-2 gap-3 text-center">
            <div className="p-3 bg-[var(--ember-surface-raised)] border border-[var(--ember-border)] rounded-xl">
              <p className="text-[11px] font-semibold text-[var(--ember-text-muted)]">Invoices to Update</p>
              <p className="text-xl font-bold font-mono text-indigo-600 dark:text-indigo-400 mt-1">
                {previewData.proposed_updates}
              </p>
            </div>
            <div className="p-3 bg-[var(--ember-surface-raised)] border border-[var(--ember-border)] rounded-xl">
              <p className="text-[11px] font-semibold text-[var(--ember-text-muted)]">New Invoices to Add</p>
              <p className="text-xl font-bold font-mono text-emerald-600 dark:text-emerald-400 mt-1">
                {previewData.proposed_inserts}
              </p>
            </div>
          </div>

          {/* Safety Guarantees List */}
          <div className="space-y-2.5">
            <h4 className="text-xs font-bold text-[var(--ember-text-secondary)] uppercase tracking-wider flex items-center gap-1.5">
              <ShieldCheck className="w-4 h-4 text-emerald-600 dark:text-emerald-400" /> ReSync Guarantees
            </h4>
            <ul className="text-xs text-[var(--ember-text-secondary)] space-y-2 bg-[var(--ember-surface-raised)] p-4 rounded-xl border border-[var(--ember-border)]">
              <li className="flex items-start gap-2">
                <CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0 mt-0.5" />
                <span>
                  <strong className="text-[var(--ember-text-primary)]">In-Place Updates:</strong> Line item IDs and existing records are preserved. Quantities, rates, and values are refreshed cleanly.
                </span>
              </li>
              <li className="flex items-start gap-2">
                <CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0 mt-0.5" />
                <span>
                  <strong className="text-[var(--ember-text-primary)]">Preserve Mappings:</strong> Customer debit note mappings, credit notes, and audit trails remain linked and valid.
                </span>
              </li>
              <li className="flex items-start gap-2">
                <CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0 mt-0.5" />
                <span>
                  <strong className="text-[var(--ember-text-primary)]">Authoritative HSN Sync:</strong> Valid transaction HSN codes and GST rates from this file update the line items.
                </span>
              </li>
              <li className="flex items-start gap-2">
                <CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0 mt-0.5" />
                <span>
                  <strong className="text-[var(--ember-text-primary)]">Zero Deletions:</strong> Any invoices previously in the database but absent from this spreadsheet are left completely intact.
                </span>
              </li>
            </ul>
          </div>
        </div>

        {/* Footer Actions */}
        <div className="p-6 border-t border-[var(--ember-border)] bg-[var(--ember-surface-raised)] flex items-center justify-end gap-3">
          <button
            onClick={onClose}
            disabled={isImporting}
            className="ember-btn-secondary px-4 py-2 text-xs font-semibold disabled:opacity-50 cursor-pointer"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            disabled={isImporting}
            className="px-5 py-2 rounded-lg text-xs font-bold bg-indigo-600 hover:bg-indigo-700 active:bg-indigo-800 text-white flex items-center gap-2 shadow-sm transition-all disabled:opacity-50 cursor-pointer"
          >
            {isImporting ? (
              <>
                <RefreshCw className="w-4 h-4 animate-spin" />
                <span>Re-synchronizing...</span>
              </>
            ) : (
              <>
                <RefreshCw className="w-4 h-4" />
                <span>Confirm & Re-sync Batch</span>
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
};
