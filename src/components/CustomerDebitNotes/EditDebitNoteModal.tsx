import React, { useState, useMemo } from "react";
import {
  X,
  Trash2,
  RotateCcw,
  AlertTriangle,
  RefreshCw,
  FileText,
  DollarSign,
  Package,
  Layers,
  Save,
  Search,
} from "lucide-react";
import { ApiService } from "../../services/api";

interface EditDebitNoteModalProps {
  debitNote: any;
  items: any[];
  onClose: () => void;
  onSaved?: (updatedDebitNote: any) => void;
  onNotify?: (message: string, type: "success" | "error" | "info") => void;
  userName?: string;
}

export const EditDebitNoteModal: React.FC<EditDebitNoteModalProps> = ({
  debitNote,
  items = [],
  onClose,
  onSaved,
  onNotify,
  userName = "Admin User",
}) => {
  if (!debitNote) return null;

  // Track removed item IDs locally (by mapping record id)
  const [excludedIds, setExcludedIds] = useState<Set<number>>(new Set());
  const [remarks, setRemarks] = useState<string>(debitNote.remarks || "");
  const [filterText, setFilterText] = useState<string>("");
  const [saving, setSaving] = useState<boolean>(false);

  // Check if status permits editing (Created, Draft, Verified, Approved)
  const isEditable = useMemo(() => {
    const st = (debitNote.status || "").toLowerCase();
    return ["created", "draft", "verified", "approved"].includes(st);
  }, [debitNote.status]);

  // Filter items based on user search query
  const displayedItems = useMemo(() => {
    if (!filterText.trim()) return items;
    const q = filterText.toLowerCase();
    return items.filter(
      (it) =>
        (it.invoice_number || "").toLowerCase().includes(q) ||
        (it.part_code || "").toLowerCase().includes(q) ||
        (it.frozen_part_description || "").toLowerCase().includes(q)
    );
  }, [items, filterText]);

  // Retained active items
  const activeItems = useMemo(() => {
    return items.filter((it) => !excludedIds.has(Number(it.id)) && it.status !== "Cancelled");
  }, [items, excludedIds]);

  // Original Totals (Calculated from initial non-cancelled items or header)
  const originalTotals = useMemo(() => {
    const nonCancelled = items.filter((it) => it.status !== "Cancelled");
    const invCount = new Set(nonCancelled.map((it) => it.invoice_number)).size;
    const totalQty = nonCancelled.reduce(
      (acc, it) => acc + (Number(it.recovered_qty) || Number(it.quantity) || 0),
      0
    );
    const taxable = debitNote.total_taxable ?? nonCancelled.reduce((acc, it) => acc + (Number(it.assessable_difference) || 0), 0);
    const cgst = debitNote.total_cgst ?? nonCancelled.reduce((acc, it) => acc + (Number(it.cgst_amount) || 0), 0);
    const sgst = debitNote.total_sgst ?? nonCancelled.reduce((acc, it) => acc + (Number(it.sgst_amount) || 0), 0);
    const igst = debitNote.total_igst ?? nonCancelled.reduce((acc, it) => acc + (Number(it.igst_amount) || 0), 0);
    const totalGst = cgst + sgst + igst;
    const grandTotal = debitNote.total_value ?? nonCancelled.reduce((acc, it) => acc + (Number(it.total_difference) || 0), 0);

    return { invCount, totalQty, taxable, cgst, sgst, igst, totalGst, grandTotal };
  }, [debitNote, items]);

  // Revised Totals (Calculated dynamically from retained active items)
  const revisedTotals = useMemo(() => {
    const invCount = new Set(activeItems.map((it) => it.invoice_number)).size;
    const totalQty = activeItems.reduce(
      (acc, it) => acc + (Number(it.recovered_qty) || Number(it.quantity) || 0),
      0
    );
    const taxable = activeItems.reduce((acc, it) => acc + (Number(it.assessable_difference) || 0), 0);
    const cgst = activeItems.reduce((acc, it) => acc + (Number(it.cgst_amount) || 0), 0);
    const sgst = activeItems.reduce((acc, it) => acc + (Number(it.sgst_amount) || 0), 0);
    const igst = activeItems.reduce((acc, it) => acc + (Number(it.igst_amount) || 0), 0);
    const totalGst = cgst + sgst + igst;
    const grandTotal = activeItems.reduce((acc, it) => acc + (Number(it.total_difference) || 0), 0);

    return { invCount, totalQty, taxable, cgst, sgst, igst, totalGst, grandTotal };
  }, [activeItems]);

  const handleToggleExclude = (id: number) => {
    if (!isEditable) return;
    setExcludedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const handleRestoreAll = () => {
    setExcludedIds(new Set());
  };

  const handleSave = async () => {
    if (!isEditable) return;

    if (activeItems.length === 0) {
      onNotify?.(
        "Cannot remove all invoice lines. A Debit Note must contain at least one active invoice line. Use Cancel Debit Note instead.",
        "error"
      );
      return;
    }

    const remainingMapIds = activeItems.map((it) => Number(it.id));
    setSaving(true);

    try {
      const updated = await ApiService.updateCustomerDebitNoteLines(
        Number(debitNote.id),
        remainingMapIds,
        remarks.trim() || null,
        userName
      );

      onNotify?.(
        `Debit Note ${debitNote.debit_note_no} updated successfully (${remainingMapIds.length} lines retained).`,
        "success"
      );
      onSaved?.(updated);
      onClose();
    } catch (err: any) {
      console.error("Failed to update debit note lines:", err);
      const msg = typeof err === "string" ? err : err?.message || "Failed to update Debit Note lines.";
      onNotify?.(msg, "error");
    } finally {
      setSaving(false);
    }
  };

  const hasChanges = excludedIds.size > 0 || remarks !== (debitNote.remarks || "");

  return (
    <div className="fixed inset-0 z-50 bg-slate-950/85 backdrop-blur-md overflow-y-auto p-4 sm:p-6 flex justify-center items-start pt-6 sm:pt-10">
      {/* Outer Modal Container */}
      <div className="relative bg-[var(--ember-surface)] text-[var(--ember-text-primary)] w-full max-w-6xl p-6 sm:p-8 rounded-2xl shadow-2xl font-sans text-sm my-auto border border-[var(--ember-border)] space-y-6">
        {/* Header */}
        <div className="flex flex-wrap justify-between items-start pb-5 border-b border-[var(--ember-border)] gap-4">
          <div>
            <div className="flex items-center gap-2.5">
              <div className="p-2 rounded-xl bg-[var(--ember-primary)]/10 text-[var(--ember-primary)] border border-[var(--ember-primary)]/20">
                <FileText className="w-5 h-5" />
              </div>
              <div>
                <h2 className="text-xl font-bold font-serif text-[var(--ember-text-primary)] flex items-center gap-2">
                  Edit Debit Note Lines
                </h2>
                <p className="text-xs text-[var(--ember-text-muted)] mt-0.5 flex items-center gap-2 flex-wrap font-mono">
                  <span className="font-bold text-[var(--ember-primary)]">{debitNote.debit_note_no}</span>
                  <span>•</span>
                  <span>Annexure: {debitNote.annexure_no || `${debitNote.debit_note_no}-A`}</span>
                  <span>•</span>
                  <span>Customer: <strong className="text-[var(--ember-text-secondary)] font-sans">{debitNote.frozen_customer_name || debitNote.customer_name}</strong></span>
                </p>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <span
              className={`px-3 py-1 rounded-full text-xs font-bold ${
                debitNote.status === "Cancelled"
                  ? "bg-rose-500/10 text-rose-600 dark:text-rose-400 border border-rose-500/20"
                  : debitNote.status === "Approved"
                  ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20"
                  : debitNote.status === "Posted" || debitNote.status === "Locked"
                  ? "bg-purple-500/10 text-purple-600 dark:text-purple-400 border border-purple-500/20"
                  : "bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 border border-indigo-500/20"
              }`}
            >
              Status: {debitNote.status}
            </span>
            <button
              onClick={onClose}
              disabled={saving}
              className="p-1.5 rounded-lg text-[var(--ember-text-muted)] hover:text-[var(--ember-text-primary)] hover:bg-[var(--ember-surface-raised)] transition-colors cursor-pointer"
              title="Close modal"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Status Warning if Non-Editable */}
        {!isEditable && (
          <div className="p-4 rounded-xl bg-rose-500/10 border border-rose-500/30 text-xs text-rose-700 dark:text-rose-300 flex items-start gap-2.5">
            <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5 text-rose-600 dark:text-rose-400" />
            <div>
              <strong>Editing Blocked:</strong> This Debit Note is in <strong>{debitNote.status}</strong> status and cannot be modified.
              {debitNote.status === "Posted" || debitNote.status === "Locked"
                ? " Posted or Locked records are finalized in financial accounts. Please use formal Cancellation or Credit Note."
                : " Cancelled records cannot be edited."}
            </div>
          </div>
        )}

        {/* Summary Comparison KPI Cards */}
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3.5">
          <div className="ember-card p-3.5 bg-[var(--ember-bg)] border border-[var(--ember-border)]">
            <div className="text-[10px] uppercase font-bold text-[var(--ember-text-muted)] flex items-center gap-1">
              <Layers className="w-3 h-3" /> Invoices
            </div>
            <div className="text-lg font-bold font-serif text-[var(--ember-text-primary)] mt-1">
              {revisedTotals.invCount}
              {excludedIds.size > 0 && (
                <span className="text-xs font-normal text-[var(--ember-text-muted)] ml-1.5 font-sans line-through">
                  ({originalTotals.invCount})
                </span>
              )}
            </div>
          </div>

          <div className="ember-card p-3.5 bg-[var(--ember-bg)] border border-[var(--ember-border)]">
            <div className="text-[10px] uppercase font-bold text-[var(--ember-text-muted)] flex items-center gap-1">
              <Package className="w-3 h-3" /> Total Qty
            </div>
            <div className="text-lg font-bold font-serif text-[var(--ember-text-primary)] mt-1">
              {revisedTotals.totalQty.toLocaleString()}
              {excludedIds.size > 0 && (
                <span className="text-xs font-normal text-[var(--ember-text-muted)] ml-1.5 font-sans line-through">
                  ({originalTotals.totalQty.toLocaleString()})
                </span>
              )}
            </div>
          </div>

          <div className="ember-card p-3.5 bg-[var(--ember-bg)] border border-[var(--ember-border)]">
            <div className="text-[10px] uppercase font-bold text-[var(--ember-text-muted)] flex items-center gap-1">
              <DollarSign className="w-3 h-3 text-emerald-600" /> Taxable Value
            </div>
            <div className="text-lg font-bold font-serif text-emerald-600 dark:text-emerald-400 mt-1">
              ₹{revisedTotals.taxable.toFixed(2)}
              {excludedIds.size > 0 && (
                <span className="text-xs font-normal text-[var(--ember-text-muted)] ml-1.5 font-sans line-through">
                  ₹{originalTotals.taxable.toFixed(2)}
                </span>
              )}
            </div>
          </div>

          <div className="ember-card p-3.5 bg-[var(--ember-bg)] border border-[var(--ember-border)]">
            <div className="text-[10px] uppercase font-bold text-[var(--ember-text-muted)] flex items-center gap-1">
              <DollarSign className="w-3 h-3 text-[var(--ember-primary)]" /> Total GST
            </div>
            <div className="text-lg font-bold font-serif text-[var(--ember-primary)] mt-1">
              ₹{revisedTotals.totalGst.toFixed(2)}
              {excludedIds.size > 0 && (
                <span className="text-xs font-normal text-[var(--ember-text-muted)] ml-1.5 font-sans line-through">
                  ₹{originalTotals.totalGst.toFixed(2)}
                </span>
              )}
            </div>
          </div>

          <div className="ember-card p-3.5 bg-[var(--ember-bg)] border border-[var(--ember-border)]">
            <div className="text-[10px] uppercase font-bold text-[var(--ember-text-muted)] flex items-center gap-1">
              <DollarSign className="w-3 h-3 text-amber-600" /> Grand Total
            </div>
            <div className="text-lg font-bold font-serif text-amber-600 dark:text-amber-500 mt-1">
              ₹{revisedTotals.grandTotal.toFixed(2)}
              {excludedIds.size > 0 && (
                <span className="text-xs font-normal text-[var(--ember-text-muted)] ml-1.5 font-sans line-through">
                  ₹{originalTotals.grandTotal.toFixed(2)}
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Search & Actions Toolbar */}
        <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
          <div className="relative w-full max-w-xs">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-[var(--ember-text-muted)]" />
            <input
              type="text"
              placeholder="Search by Inv # or Part #..."
              value={filterText}
              onChange={(e) => setFilterText(e.target.value)}
              className="w-full ember-input pl-9 pr-3 py-1.5 text-xs rounded-lg"
            />
          </div>

          <div className="flex items-center gap-2">
            {excludedIds.size > 0 && (
              <button
                onClick={handleRestoreAll}
                disabled={!isEditable || saving}
                className="px-3 py-1.5 bg-[var(--ember-surface-raised)] hover:bg-[var(--ember-border-subtle)] text-xs font-semibold text-[var(--ember-text-primary)] rounded-lg flex items-center gap-1.5 border border-[var(--ember-border)] transition-colors cursor-pointer"
              >
                <RotateCcw className="w-3.5 h-3.5 text-[var(--ember-primary)]" /> Restore All ({excludedIds.size})
              </button>
            )}
            <span className="text-xs text-[var(--ember-text-muted)]">
              Showing <strong className="text-[var(--ember-text-secondary)]">{displayedItems.length}</strong> of {items.length} line(s)
            </span>
          </div>
        </div>

        {/* Invoice Lines Table */}
        <div className="overflow-x-auto border border-[var(--ember-border)] rounded-xl max-h-80 bg-[var(--ember-bg)]">
          <table className="w-full text-left text-xs text-[var(--ember-text-secondary)]">
            <thead className="bg-[var(--ember-surface-raised)] text-[var(--ember-text-secondary)] uppercase sticky top-0 border-b border-[var(--ember-border)] font-semibold z-10">
              <tr>
                <th className="p-2.5 text-center">#</th>
                <th className="p-2.5">Inv No</th>
                <th className="p-2.5">Inv Date</th>
                <th className="p-2.5">Part Code</th>
                <th className="p-2.5 text-right">Qty</th>
                <th className="p-2.5 text-right">Old Rate (₹)</th>
                <th className="p-2.5 text-right">New Rate (₹)</th>
                <th className="p-2.5 text-right">Diff (₹)</th>
                <th className="p-2.5 text-right">Taxable (₹)</th>
                <th className="p-2.5 text-right">Line Total (₹)</th>
                <th className="p-2.5 text-center">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--ember-border)] font-mono">
              {displayedItems.map((line: any, idx: number) => {
                const isExcluded = excludedIds.has(Number(line.id));
                const isAlreadyCancelled = line.status === "Cancelled";

                return (
                  <tr
                    key={line.id || idx}
                    className={`transition-colors ${
                      isExcluded || isAlreadyCancelled
                        ? "bg-rose-500/5 text-[var(--ember-text-muted)] opacity-60"
                        : "hover:bg-[var(--ember-surface-raised)]/45"
                    }`}
                  >
                    <td className="p-2.5 text-center font-sans text-[var(--ember-text-muted)]">
                      {idx + 1}
                    </td>
                    <td className="p-2.5 font-bold text-[var(--ember-text-primary)]">
                      <span className={isExcluded ? "line-through" : ""}>{line.invoice_number}</span>
                      {isAlreadyCancelled && (
                        <span className="ml-2 px-1.5 py-0.2 text-[9px] rounded font-sans bg-rose-500/10 text-rose-600 border border-rose-500/20">
                          Cancelled
                        </span>
                      )}
                      {isExcluded && !isAlreadyCancelled && (
                        <span className="ml-2 px-1.5 py-0.2 text-[9px] rounded font-sans bg-amber-500/10 text-amber-600 border border-amber-500/20">
                          To Remove
                        </span>
                      )}
                    </td>
                    <td className="p-2.5 text-[var(--ember-text-muted)] font-sans">{line.invoice_date}</td>
                    <td className="p-2.5 font-bold text-[var(--ember-primary)]">
                      <span className={isExcluded ? "line-through" : ""}>{line.part_code}</span>
                    </td>
                    <td className="p-2.5 text-right text-[var(--ember-text-primary)]">
                      {Number(line.recovered_qty || line.quantity).toLocaleString()}
                    </td>
                    <td className="p-2.5 text-right text-[var(--ember-text-muted)]">
                      ₹{Number(line.rate_pre_unit).toFixed(2)}
                    </td>
                    <td className="p-2.5 text-right text-emerald-600 dark:text-emerald-400 font-bold">
                      ₹{Number(line.new_price).toFixed(2)}
                    </td>
                    <td className="p-2.5 text-right text-[var(--ember-primary)] font-semibold">
                      ₹{Number(line.difference).toFixed(2)}
                    </td>
                    <td className="p-2.5 text-right">
                      ₹{Number(line.assessable_difference).toFixed(2)}
                    </td>
                    <td className="p-2.5 text-right font-bold text-amber-600 dark:text-amber-500">
                      ₹{Number(line.total_difference).toFixed(2)}
                    </td>
                    <td className="p-2.5 text-center font-sans">
                      {isAlreadyCancelled ? (
                        <span className="text-[11px] text-[var(--ember-text-muted)] italic">Inactive</span>
                      ) : isExcluded ? (
                        <button
                          type="button"
                          onClick={() => handleToggleExclude(Number(line.id))}
                          disabled={!isEditable || saving}
                          className="px-2 py-1 bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-600 dark:text-emerald-400 rounded text-xs font-semibold flex items-center gap-1 mx-auto border border-emerald-500/20 cursor-pointer"
                          title="Restore this invoice line"
                        >
                          <RotateCcw className="w-3 h-3" /> Restore
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={() => handleToggleExclude(Number(line.id))}
                          disabled={!isEditable || saving}
                          className="px-2 py-1 bg-rose-500/10 hover:bg-rose-500/20 text-rose-600 dark:text-rose-400 rounded text-xs font-semibold flex items-center gap-1 mx-auto border border-rose-500/20 cursor-pointer"
                          title="Exclude this invoice from Debit Note"
                        >
                          <Trash2 className="w-3 h-3" /> Remove
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* Audit Remarks Input */}
        <div>
          <label className="block text-xs font-semibold text-[var(--ember-text-secondary)] mb-1.5">
            Audit Remarks / Reason for Modification (Optional)
          </label>
          <input
            type="text"
            value={remarks}
            onChange={(e) => setRemarks(e.target.value)}
            disabled={!isEditable || saving}
            placeholder="e.g. Removed invoice lines per customer audit verification on price revision letter."
            className="w-full ember-input px-3.5 py-2.5 text-xs rounded-xl"
          />
        </div>

        {/* Footer Actions */}
        <div className="flex flex-wrap items-center justify-between pt-4 border-t border-[var(--ember-border)] gap-3 font-sans">
          <div className="text-xs text-[var(--ember-text-muted)]">
            <span className="font-semibold text-[var(--ember-text-primary)]">{activeItems.length}</span> line(s) retained
            {excludedIds.size > 0 && (
              <span className="text-amber-600 dark:text-amber-400 font-semibold ml-1.5">
                ({excludedIds.size} excluded from Debit Note)
              </span>
            )}
          </div>

          <div className="flex items-center gap-2.5">
            <button
              onClick={onClose}
              disabled={saving}
              className="ember-btn-secondary px-4 py-2 text-xs font-bold rounded-xl cursor-pointer"
            >
              Cancel
            </button>
            <button
              onClick={handleSave}
              disabled={!isEditable || !hasChanges || activeItems.length === 0 || saving}
              className="px-5 py-2 bg-[var(--ember-primary)] hover:bg-[var(--ember-primary-hover)] disabled:opacity-40 text-white text-xs font-bold rounded-xl shadow-sm flex items-center gap-1.5 transition-all cursor-pointer"
            >
              {saving ? (
                <>
                  <RefreshCw className="w-3.5 h-3.5 animate-spin" /> Saving Changes...
                </>
              ) : (
                <>
                  <Save className="w-3.5 h-3.5" /> Save & Recalculate Totals
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
