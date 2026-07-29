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
    <div className="fixed inset-0 z-50 bg-slate-950/70 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-slate-900 border border-slate-800 text-slate-100 rounded-xl shadow-2xl p-6 max-w-md w-full space-y-4">
        <div className="flex justify-between items-center border-b border-slate-800 pb-3">
          <h3 className="text-lg font-bold text-white">⚠️ Confirm Soft Deletion</h3>
          <button onClick={onClose} className="text-slate-400 hover:text-white">✕</button>
        </div>

        <div className="space-y-2 text-sm text-slate-300">
          <p>
            You are about to soft-delete the Credit Note <span className="font-mono font-bold text-red-400">{creditNoteNumber}</span>.
          </p>
          <p className="text-xs text-slate-400 bg-slate-950/50 p-2.5 rounded border border-slate-800">
            <strong>Impact:</strong> Reverts the associated invoice status back to <span className="font-bold text-yellow-500">Cancelled</span>. This action is auditable and can be restored later.
          </p>
        </div>

        {errorMsg && (
          <div className="p-3 bg-red-950/50 border border-red-800 text-red-300 text-xs rounded-lg">
            {errorMsg}
          </div>
        )}

        <div className="space-y-1.5">
          <label className="text-xs text-slate-300 font-bold uppercase tracking-wider">
            Type <span className="font-mono text-white select-all">{creditNoteNumber}</span> to confirm:
          </label>
          <input
            type="text"
            value={confirmInput}
            onChange={(e) => setConfirmInput(e.target.value)}
            className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-red-600"
            placeholder="CN-XXXXXX"
          />
        </div>

        <div className="flex justify-end gap-3 pt-2">
          <button
            onClick={onClose}
            className="px-4 py-2 border border-slate-700 hover:bg-slate-800 text-slate-300 rounded-lg text-sm transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleDelete}
            disabled={deleting || confirmInput !== creditNoteNumber}
            className="px-5 py-2 bg-red-600 hover:bg-red-700 disabled:bg-slate-800 disabled:text-slate-500 text-white rounded-lg font-bold text-sm shadow-md transition-all active:scale-[0.98]"
          >
            {deleting ? "Deleting..." : "Soft Delete"}
          </button>
        </div>
      </div>
    </div>
  );
};
