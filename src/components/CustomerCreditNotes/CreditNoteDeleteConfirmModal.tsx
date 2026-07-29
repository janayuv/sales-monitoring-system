import React, { useState } from "react";
import { ApiService } from "../../services/api";

interface CreditNoteDeleteConfirmModalProps {
  creditNoteNumber: string;
  userName: string;
  onClose: () => void;
  onDeleted: () => void;
}

export const CreditNoteDeleteConfirmModal: React.FC<CreditNoteDeleteConfirmModalProps> = ({
  creditNoteNumber,
  userName,
  onClose,
  onDeleted,
}) => {
  const [confirmInput, setConfirmInput] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const handleDelete = async () => {
    if (confirmInput !== creditNoteNumber) {
      setErrorMsg("Typed confirmation does not match the Credit Note number");
      return;
    }

    try {
      setDeleting(true);
      setErrorMsg(null);
      await ApiService.deleteCreditNoteRecord(creditNoteNumber, userName, confirmInput);
      onDeleted();
    } catch (e: any) {
      console.error(e);
      setErrorMsg(e.message || "Failed to soft delete credit note");
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-md flex items-center justify-center p-4">
      <div className="ember-card bg-[var(--ember-surface)] border border-[var(--ember-border)] text-[var(--ember-text-primary)] rounded-2xl shadow-2xl p-6 max-w-md w-full space-y-4">
        <div className="flex justify-between items-center border-b border-[var(--ember-border)] pb-3">
          <h3 className="text-lg font-bold font-serif text-[var(--ember-text-primary)]">⚠️ Confirm Soft Deletion</h3>
          <button onClick={onClose} className="p-1 text-[var(--ember-text-muted)] hover:text-[var(--ember-text-primary)] cursor-pointer">✕</button>
        </div>

        <div className="space-y-2 text-sm text-[var(--ember-text-secondary)]">
          <p>
            You are about to soft-delete the Credit Note <span className="font-mono font-bold text-rose-500">{creditNoteNumber}</span>.
          </p>
          <p className="text-xs text-[var(--ember-text-muted)] bg-[var(--ember-bg)] p-3 rounded-xl border border-[var(--ember-border)] font-sans">
            <strong>Impact:</strong> Reverts the associated invoice status back to <span className="font-bold text-amber-600 dark:text-amber-400">Cancelled</span>. This action is auditable and can be restored later.
          </p>
        </div>

        {errorMsg && (
          <div className="p-3 bg-rose-500/10 border border-rose-500/30 text-rose-600 dark:text-rose-400 text-xs rounded-xl">
            {errorMsg}
          </div>
        )}

        <div className="space-y-1.5 font-sans">
          <label className="text-xs text-[var(--ember-text-secondary)] font-bold uppercase tracking-wider block">
            Type <span className="font-mono text-[var(--ember-primary)] select-all">{creditNoteNumber}</span> to confirm:
          </label>
          <input
            type="text"
            value={confirmInput}
            onChange={(e) => setConfirmInput(e.target.value)}
            className="w-full ember-input px-3 py-2 text-sm font-mono"
            placeholder="CN-XXXXXX"
          />
        </div>

        <div className="flex justify-end gap-3 pt-2">
          <button
            onClick={onClose}
            className="ember-btn-secondary px-4 py-2 text-xs cursor-pointer"
          >
            Cancel
          </button>
          <button
            onClick={handleDelete}
            disabled={deleting || confirmInput !== creditNoteNumber}
            className="px-5 py-2 bg-rose-600 hover:bg-rose-700 disabled:opacity-40 text-white rounded-lg font-bold text-xs shadow-md transition-all cursor-pointer"
          >
            {deleting ? "Deleting..." : "Soft Delete"}
          </button>
        </div>
      </div>
    </div>
  );
};
