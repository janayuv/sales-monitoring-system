import React, { useState, useEffect } from "react";
import { CreditNoteHeader } from "../../types/bindings/CreditNoteHeader";
import { CreditNoteItemRow } from "../../types/bindings/CreditNoteItemRow";
import { CreditNoteTaxSummary } from "../../types/bindings/CreditNoteTaxSummary";
import { CreditNoteUpdatePayload } from "../../types/bindings/CreditNoteUpdatePayload";
import { ApiService } from "../../services/api";

interface CreditNoteEditModalProps {
  creditNoteNumber: string;
  userName: string;
  onClose: () => void;
  onSaved: (newCnNo?: string) => void;
}

export const CreditNoteEditModal: React.FC<CreditNoteEditModalProps> = ({
  creditNoteNumber,
  userName,
  onClose,
  onSaved,
}) => {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [header, setHeader] = useState<CreditNoteHeader | null>(null);
  const [items, setItems] = useState<CreditNoteItemRow[]>([]);
  const [creditNoteNo, setCreditNoteNo] = useState("");
  const [remarks, setRemarks] = useState("");
  const [reason, setReason] = useState("");
  const [date, setDate] = useState("");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    loadDetails();
  }, [creditNoteNumber]);

  const loadDetails = async () => {
    try {
      setLoading(true);
      const res = await ApiService.getCreditNoteDetails(creditNoteNumber);
      if (res) {
        setHeader(res.header);
        const sanitizedItems = res.items.map((item) => {
          const rate_paise = Math.round(item.rate_pre_unit * 100);
          const assessable_paise = Math.round(item.quantity * rate_paise);
          const cgst_paise = Math.round((assessable_paise * item.cgst_rate) / 100);
          const sgst_paise = Math.round((assessable_paise * item.sgst_rate) / 100);
          const igst_paise = Math.round((assessable_paise * item.igst_rate) / 100);
          const total_paise = assessable_paise + cgst_paise + sgst_paise + igst_paise;

          return {
            ...item,
            assessable_value: assessable_paise / 100,
            cgst_amount: cgst_paise / 100,
            sgst_amount: sgst_paise / 100,
            igst_amount: igst_paise / 100,
            total_value: total_paise / 100,
          };
        });
        setItems(sanitizedItems);
        setCreditNoteNo(res.header.credit_note_number);
        setRemarks(res.header.remarks || "");
        setReason(res.header.reason || "");
        setDate(res.header.credit_note_date);
      }
      setErrorMsg(null);
    } catch (e: any) {
      console.error(e);
      setErrorMsg(e.message || "Failed to load credit note details");
    } finally {
      setLoading(false);
    }
  };

  const handleItemChange = (invoiceItemId: bigint, field: "quantity" | "rate_pre_unit", value: number) => {
    setItems((prev) =>
      prev.map((item) => {
        if (item.invoice_item_id === invoiceItemId) {
          const updated = { ...item, [field]: value };
          
          // Re-calculate this line's assessable and tax values locally using paise precision
          const rate_paise = Math.round(updated.rate_pre_unit * 100);
          const assessable_paise = Math.round(updated.quantity * rate_paise);
          const cgst_paise = Math.round((assessable_paise * updated.cgst_rate) / 100);
          const sgst_paise = Math.round((assessable_paise * updated.sgst_rate) / 100);
          const igst_paise = Math.round((assessable_paise * updated.igst_rate) / 100);
          const total_paise = assessable_paise + cgst_paise + sgst_paise + igst_paise;

          updated.assessable_value = assessable_paise / 100;
          updated.cgst_amount = cgst_paise / 100;
          updated.sgst_amount = sgst_paise / 100;
          updated.igst_amount = igst_paise / 100;
          updated.total_value = total_paise / 100;
          return updated;
        }
        return item;
      })
    );
  };

  // Calculate live Grand Totals
  const calculateTotals = (): CreditNoteTaxSummary => {
    let total_taxable = 0;
    let total_cgst = 0;
    let total_sgst = 0;
    let total_igst = 0;
    let total_value = 0;

    for (const item of items) {
      // Calculate using cents/paise locally to match backend math
      const rate_paise = Math.round(item.rate_pre_unit * 100);
      const assessable_paise = Math.round(item.quantity * rate_paise);
      const cgst_paise = Math.round(assessable_paise * item.cgst_rate / 100);
      const sgst_paise = Math.round(assessable_paise * item.sgst_rate / 100);
      const igst_paise = Math.round(assessable_paise * item.igst_rate / 100);
      const total_paise = assessable_paise + cgst_paise + sgst_paise + igst_paise;

      total_taxable += assessable_paise;
      total_cgst += cgst_paise;
      total_sgst += sgst_paise;
      total_igst += igst_paise;
      total_value += total_paise;
    }

    return {
      total_taxable: total_taxable / 100,
      total_cgst: total_cgst / 100,
      total_sgst: total_sgst / 100,
      total_igst: total_igst / 100,
      total_value: total_value / 100,
    };
  };

  const totals = calculateTotals();

  // Validate limits on submission
  const validateForm = (): boolean => {
    const errors: Record<string, string> = {};

    const trimmedCnNo = creditNoteNo.trim();
    if (!trimmedCnNo) {
      errors.creditNoteNo = "Credit Note number is required";
    } else if (trimmedCnNo.length > 50) {
      errors.creditNoteNo = "Credit Note number cannot exceed 50 characters";
    } else if (!/^(?=.*[A-Za-z0-9])[A-Za-z0-9/_-]+$/.test(trimmedCnNo)) {
      errors.creditNoteNo = "Must contain alphanumeric characters (hyphens, underscores, slashes allowed)";
    }

    if (!date.match(/^\d{4}-\d{2}-\d{2}$/)) {
      errors.date = "Date must be in YYYY-MM-DD format";
    }
    if (!reason.trim()) {
      errors.reason = "Reason for issuance is required";
    } else if (reason.trim().length > 500) {
      errors.reason = "Reason must be 500 characters or less";
    }
    if (remarks.length > 1000) {
      errors.remarks = "Remarks must be 1000 characters or less";
    }

    // Line validations
    for (const item of items) {
      if (item.quantity > item.original_quantity + 1e-6) {
        errors[`qty_${item.invoice_item_id}`] = `Qty cannot exceed invoiced qty (${item.original_quantity})`;
      }
      
      const orig_rate_paise = Math.round(item.original_rate_pre_unit * 100);
      const orig_assess_paise = Math.round(item.original_quantity * orig_rate_paise);
      const orig_cgst_paise = Math.round((orig_assess_paise * item.cgst_rate) / 100);
      const orig_sgst_paise = Math.round((orig_assess_paise * item.sgst_rate) / 100);
      const orig_igst_paise = Math.round((orig_assess_paise * item.igst_rate) / 100);
      const orig_total_paise = orig_assess_paise + orig_cgst_paise + orig_sgst_paise + orig_igst_paise;
      const orig_total = orig_total_paise / 100;

      if (item.total_value > orig_total + 0.01) {
        errors[`total_${item.invoice_item_id}`] = `Total (₹${item.total_value.toFixed(2)}) cannot exceed invoiced line total (₹${orig_total.toFixed(2)})`;
      }
    }

    setFieldErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const handleSave = async () => {
    if (saving || !validateForm() || !header) return;

    try {
      setSaving(true);
      setErrorMsg(null);

      const trimmedCnNo = creditNoteNo.trim();
      const payload: CreditNoteUpdatePayload = {
        credit_note_number: header.credit_note_number,
        new_credit_note_number: trimmedCnNo !== header.credit_note_number ? trimmedCnNo : null,
        credit_note_date: date,
        remarks: remarks.trim() || null,
        reason: reason.trim() || null,
        items: items.map((i) => ({
          invoice_item_id: i.invoice_item_id,
          quantity: i.quantity,
          rate_pre_unit: i.rate_pre_unit,
        })),
        expected_revision_no: header.revision_no,
      };

      await ApiService.updateCreditNoteRecord(payload, userName);
      onSaved(trimmedCnNo);
    } catch (e: any) {
      console.error(e);
      setErrorMsg(e.message || "Failed to update Credit Note");
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-md flex items-center justify-center p-4">
        <div className="ember-card bg-[var(--ember-surface)] border border-[var(--ember-border)] text-[var(--ember-text-primary)] rounded-2xl p-8 text-center space-y-4 max-w-sm w-full shadow-2xl">
          <div className="animate-spin text-3xl text-[var(--ember-primary)]">🌀</div>
          <p className="text-sm font-semibold font-sans">Loading Credit Note details...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-md overflow-y-auto p-4 sm:p-6 flex justify-center items-start pt-6 sm:pt-10">
      <div className="ember-card bg-[var(--ember-surface)] border border-[var(--ember-border)] text-[var(--ember-text-primary)] w-full max-w-4xl rounded-2xl shadow-2xl overflow-hidden flex flex-col my-auto">
        
        {/* Header */}
        <div className="px-6 py-4 border-b border-[var(--ember-border)] flex justify-between items-center bg-[var(--ember-surface-raised)]">
          <div>
            <h2 className="text-lg font-bold font-serif text-[var(--ember-text-primary)] tracking-wide flex items-center gap-2">
              ✏️ Edit Credit Note: <span className="font-mono text-[var(--ember-primary)]">{creditNoteNumber}</span>
            </h2>
            <p className="text-xs text-[var(--ember-text-muted)] font-sans mt-0.5">Controlled Edit Mode (Locked to original Invoice bounds)</p>
          </div>
          <button 
            onClick={onClose} 
            disabled={saving}
            className="p-1.5 text-[var(--ember-text-muted)] hover:text-[var(--ember-text-primary)] rounded-lg transition-colors cursor-pointer disabled:opacity-50"
          >
            ✕
          </button>
        </div>

        {/* Content */}
        <div className="p-6 space-y-6 flex-1 overflow-y-auto max-h-[70vh] font-sans">
          {errorMsg && (
            <div className="p-3 bg-rose-500/10 border border-rose-500/30 text-rose-600 dark:text-rose-400 text-xs rounded-xl">
              ⚠️ {errorMsg}
            </div>
          )}

          {/* Credit Note No, Date, Reason */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="space-y-1.5">
              <label className="text-xs text-[var(--ember-text-secondary)] font-bold uppercase tracking-wider block">Credit Note No</label>
              <input
                type="text"
                value={creditNoteNo}
                disabled={saving}
                onChange={(e) => setCreditNoteNo(e.target.value)}
                className={`w-full ember-input px-3 py-2 text-sm font-mono ${
                  fieldErrors.creditNoteNo ? "border-rose-500 focus:ring-rose-500" : ""
                }`}
                placeholder="CN-2026-0001"
              />
              {fieldErrors.creditNoteNo && <p className="text-rose-500 text-[10px]">{fieldErrors.creditNoteNo}</p>}
            </div>

            <div className="space-y-1.5">
              <label className="text-xs text-[var(--ember-text-secondary)] font-bold uppercase tracking-wider block">Date (YYYY-MM-DD)</label>
              <input
                type="text"
                value={date}
                disabled={saving}
                onChange={(e) => setDate(e.target.value)}
                className={`w-full ember-input px-3 py-2 text-sm font-mono ${
                  fieldErrors.date ? "border-rose-500 focus:ring-rose-500" : ""
                }`}
                placeholder="2026-07-29"
              />
              {fieldErrors.date && <p className="text-rose-500 text-[10px]">{fieldErrors.date}</p>}
            </div>

            <div className="space-y-1.5">
              <label className="text-xs text-[var(--ember-text-secondary)] font-bold uppercase tracking-wider block">Reason for Issuance</label>
              <input
                type="text"
                value={reason}
                disabled={saving}
                onChange={(e) => setReason(e.target.value)}
                className={`w-full ember-input px-3 py-2 text-sm ${
                  fieldErrors.reason ? "border-rose-500 focus:ring-rose-500" : ""
                }`}
                placeholder="Negotiated price difference / commercial settlement..."
              />
              {fieldErrors.reason && <p className="text-rose-500 text-[10px]">{fieldErrors.reason}</p>}
            </div>
          </div>

          <div className="space-y-1.5">
            <label className="text-xs text-[var(--ember-text-secondary)] font-bold uppercase tracking-wider block">Remarks</label>
            <textarea
              value={remarks}
              disabled={saving}
              onChange={(e) => setRemarks(e.target.value)}
              rows={2}
              className={`w-full ember-input px-3 py-2 text-sm ${
                fieldErrors.remarks ? "border-rose-500 focus:ring-rose-500" : ""
              }`}
              placeholder="Internal accounting remarks..."
            />
            {fieldErrors.remarks && <p className="text-rose-500 text-[10px]">{fieldErrors.remarks}</p>}
          </div>

          {/* Items Table */}
          <div className="border border-[var(--ember-border)] rounded-xl overflow-hidden bg-[var(--ember-bg)] shadow-xs">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="bg-[var(--ember-surface-raised)] text-[var(--ember-text-secondary)] font-bold border-b border-[var(--ember-border)] uppercase tracking-wider text-[11px]">
                  <th className="p-3">Part Code</th>
                  <th className="p-3 text-right">Invoiced Qty</th>
                  <th className="p-3 text-right w-28">Credit Qty</th>
                  <th className="p-3 text-right">Invoiced Rate</th>
                  <th className="p-3 text-right w-28">Credit Rate (₹)</th>
                  <th className="p-3 text-right w-36">Total Credit (₹)</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--ember-border-subtle)] text-[var(--ember-text-secondary)]">
                {items.map((item) => {
                  const qtyErr = fieldErrors[`qty_${item.invoice_item_id}`];
                  const totalErr = fieldErrors[`total_${item.invoice_item_id}`];
                  
                  return (
                    <tr key={item.invoice_item_id} className="hover:bg-[var(--ember-surface-raised)]/40 transition-colors">
                      <td className="p-3 font-mono font-bold text-[var(--ember-primary)]">{item.part_code}</td>
                      <td className="p-3 text-right font-mono text-[var(--ember-text-muted)]">{item.original_quantity}</td>
                      <td className="p-3 text-right">
                        <input
                          type="number"
                          step="any"
                          disabled={saving}
                          value={item.quantity}
                          onChange={(e) => handleItemChange(item.invoice_item_id, "quantity", parseFloat(e.target.value) || 0)}
                          className={`w-20 ember-input px-2 py-1 text-right text-xs font-mono ${
                            qtyErr ? "border-rose-500" : ""
                          }`}
                        />
                        {qtyErr && <p className="text-rose-500 text-[9px] mt-0.5">{qtyErr}</p>}
                      </td>
                      <td className="p-3 text-right font-mono text-[var(--ember-text-muted)]">₹{item.original_rate_pre_unit.toFixed(2)}</td>
                      <td className="p-3 text-right">
                        <input
                          type="number"
                          step="0.01"
                          disabled={saving}
                          value={item.rate_pre_unit}
                          onChange={(e) => handleItemChange(item.invoice_item_id, "rate_pre_unit", parseFloat(e.target.value) || 0)}
                          className="w-20 ember-input px-2 py-1 text-right text-xs font-mono"
                        />
                      </td>
                      <td className="p-3 text-right font-mono font-bold text-emerald-600 dark:text-emerald-400">
                        ₹{item.total_value.toFixed(2)}
                        {totalErr && <p className="text-rose-500 text-[9px] font-normal">{totalErr}</p>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Summary Recap */}
          <div className="flex justify-end pt-2">
            <div className="w-72 bg-[var(--ember-bg)] border border-[var(--ember-border)] rounded-xl p-4 space-y-2 text-xs font-sans shadow-xs">
              <div className="flex justify-between text-[var(--ember-text-secondary)]">
                <span>Taxable Credit Amount:</span>
                <span className="font-mono font-semibold text-[var(--ember-text-primary)]">₹{totals.total_taxable.toFixed(2)}</span>
              </div>
              <div className="flex justify-between text-[var(--ember-text-secondary)]">
                <span>Total Tax (CGST+SGST+IGST):</span>
                <span className="font-mono text-[var(--ember-text-secondary)]">₹{(totals.total_cgst + totals.total_sgst + totals.total_igst).toFixed(2)}</span>
              </div>
              <div className="flex justify-between font-bold border-t border-[var(--ember-border)] pt-2 text-sm text-[var(--ember-primary)]">
                <span>Grand Total:</span>
                <span className="font-mono font-black text-emerald-600 dark:text-emerald-400">₹{totals.total_value.toFixed(2)}</span>
              </div>
            </div>
          </div>
        </div>

        {/* Footer Actions */}
        <div className="px-6 py-4 border-t border-[var(--ember-border)] bg-[var(--ember-surface-raised)] flex justify-end gap-3">
          <button
            onClick={onClose}
            disabled={saving}
            className="ember-btn-secondary px-4 py-2 text-xs cursor-pointer disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="ember-btn-primary px-5 py-2 text-xs cursor-pointer flex items-center gap-2 disabled:opacity-50"
          >
            {saving ? (
              <>
                <span className="animate-spin">🌀</span> Saving...
              </>
            ) : (
              "Save Changes"
            )}
          </button>
        </div>

      </div>
    </div>
  );
};
