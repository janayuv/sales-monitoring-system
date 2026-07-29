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
  onSaved: () => void;
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
        setItems(res.items);
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
          
          // Re-calculate this line's assessable and tax values locally
          const assess = updated.quantity * updated.rate_pre_unit;
          const cgst = Math.round(assess * updated.cgst_rate) / 100;
          const sgst = Math.round(assess * updated.sgst_rate) / 100;
          const igst = Math.round(assess * updated.igst_rate) / 100;
          
          updated.assessable_value = assess;
          updated.cgst_amount = cgst;
          updated.sgst_amount = sgst;
          updated.igst_amount = igst;
          updated.total_value = assess + cgst + sgst + igst;
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

    if (!date.match(/^\d{4}-\d{2}-\d{2}$/)) {
      errors.date = "Date must be in YYYY-MM-DD format";
    }
    if (!reason.trim()) {
      errors.reason = "Reason for issuance is required";
    }
    if (reason.length > 500) {
      errors.reason = "Reason must be 500 characters or less";
    }
    if (remarks.length > 1000) {
      errors.remarks = "Remarks must be 1000 characters or less";
    }

    // Line validations
    for (const item of items) {
      if (item.quantity > item.original_quantity) {
        errors[`qty_${item.invoice_item_id}`] = `Qty cannot exceed invoiced qty (${item.original_quantity})`;
      }
      
      const orig_assess = item.original_quantity * item.original_rate_pre_unit;
      const orig_cgst = Math.round(orig_assess * item.cgst_rate) / 100;
      const orig_sgst = Math.round(orig_assess * item.sgst_rate) / 100;
      const orig_igst = Math.round(orig_assess * item.igst_rate) / 100;
      const orig_total = orig_assess + orig_cgst + orig_sgst + orig_igst;

      if (item.total_value > orig_total) {
        errors[`total_${item.invoice_item_id}`] = `Total (₹${item.total_value.toFixed(2)}) cannot exceed invoiced line total (₹${orig_total.toFixed(2)})`;
      }
    }

    setFieldErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const handleSave = async () => {
    if (!validateForm() || !header) return;

    try {
      setSaving(true);
      setErrorMsg(null);

      const payload: CreditNoteUpdatePayload = {
        credit_note_number: header.credit_note_number,
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
      onSaved();
    } catch (e: any) {
      console.error(e);
      setErrorMsg(e.message || "Failed to update Credit Note");
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="fixed inset-0 z-50 bg-slate-900/60 flex items-center justify-center p-4">
        <div className="bg-slate-900 border border-slate-800 text-white rounded-xl p-8 text-center space-y-4 max-w-sm w-full">
          <div className="animate-spin text-3xl">🌀</div>
          <p>Loading Credit Note details...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 bg-slate-950/70 backdrop-blur-sm overflow-y-auto p-4 flex justify-center items-start pt-10">
      <div className="bg-slate-900 border border-slate-800 text-slate-100 w-full max-w-4xl rounded-xl shadow-2xl overflow-hidden flex flex-col my-4">
        
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-800 flex justify-between items-center bg-slate-950/40">
          <div>
            <h2 className="text-lg font-bold text-white">✏️ Edit Credit Note: {creditNoteNumber}</h2>
            <p className="text-xs text-slate-400 mt-1">Controlled Edit Mode (Locked to original Invoice bounds)</p>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-white transition-colors">✕</button>
        </div>

        {/* Content */}
        <div className="p-6 space-y-6 flex-1 overflow-y-auto max-h-[70vh]">
          {errorMsg && (
            <div className="p-3 bg-red-950/50 border border-red-800 text-red-300 text-xs rounded-lg">
              ⚠️ {errorMsg}
            </div>
          )}

          {/* Date, Reason, Remarks */}
          <div className="grid grid-cols-3 gap-4">
            <div className="space-y-1.5">
              <label className="text-xs text-slate-300 font-bold uppercase tracking-wider">Date (YYYY-MM-DD)</label>
              <input
                type="text"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                className={`w-full bg-slate-950 border ${
                  fieldErrors.date ? "border-red-600" : "border-slate-800"
                } rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-indigo-500`}
                placeholder="2026-07-29"
              />
              {fieldErrors.date && <p className="text-red-500 text-[10px]">{fieldErrors.date}</p>}
            </div>

            <div className="space-y-1.5 col-span-2">
              <label className="text-xs text-slate-300 font-bold uppercase tracking-wider">Reason for Issuance</label>
              <input
                type="text"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                className={`w-full bg-slate-950 border ${
                  fieldErrors.reason ? "border-red-600" : "border-slate-800"
                } rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-indigo-500`}
                placeholder="Negotiated price difference / commercial settlement..."
              />
              {fieldErrors.reason && <p className="text-red-500 text-[10px]">{fieldErrors.reason}</p>}
            </div>
          </div>

          <div className="space-y-1.5">
            <label className="text-xs text-slate-300 font-bold uppercase tracking-wider">Remarks</label>
            <textarea
              value={remarks}
              onChange={(e) => setRemarks(e.target.value)}
              rows={2}
              className={`w-full bg-slate-950 border ${
                fieldErrors.remarks ? "border-red-600" : "border-slate-800"
              } rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-indigo-500`}
              placeholder="Internal accounting remarks..."
            />
            {fieldErrors.remarks && <p className="text-red-500 text-[10px]">{fieldErrors.remarks}</p>}
          </div>

          {/* Items Table */}
          <div className="border border-slate-800 rounded-lg overflow-hidden">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="bg-slate-950/60 text-slate-300 border-b border-slate-800">
                  <th className="p-3">Part Code</th>
                  <th className="p-3 text-right">Invoiced Qty</th>
                  <th className="p-3 text-right w-28">Credit Qty</th>
                  <th className="p-3 text-right">Invoiced Rate</th>
                  <th className="p-3 text-right w-28">Credit Rate (₹)</th>
                  <th className="p-3 text-right w-36">Total Credit (₹)</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800">
                {items.map((item) => {
                  const qtyErr = fieldErrors[`qty_${item.invoice_item_id}`];
                  const totalErr = fieldErrors[`total_${item.invoice_item_id}`];
                  
                  return (
                    <tr key={item.invoice_item_id} className="hover:bg-slate-950/20">
                      <td className="p-3 font-mono font-bold text-white">{item.part_code}</td>
                      <td className="p-3 text-right text-slate-400">{item.original_quantity}</td>
                      <td className="p-3 text-right">
                        <input
                          type="number"
                          step="any"
                          value={item.quantity}
                          onChange={(e) => handleItemChange(item.invoice_item_id, "quantity", parseFloat(e.target.value) || 0)}
                          className={`w-20 bg-slate-950 border ${
                            qtyErr ? "border-red-600" : "border-slate-800"
                          } rounded px-2 py-1 text-right text-white`}
                        />
                        {qtyErr && <p className="text-red-500 text-[9px] mt-0.5">{qtyErr}</p>}
                      </td>
                      <td className="p-3 text-right text-slate-400">₹{item.original_rate_pre_unit.toFixed(2)}</td>
                      <td className="p-3 text-right">
                        <input
                          type="number"
                          step="0.01"
                          value={item.rate_pre_unit}
                          onChange={(e) => handleItemChange(item.invoice_item_id, "rate_pre_unit", parseFloat(e.target.value) || 0)}
                          className="w-20 bg-slate-950 border border-slate-800 rounded px-2 py-1 text-right text-white"
                        />
                      </td>
                      <td className="p-3 text-right font-mono font-bold text-white">
                        ₹{item.total_value.toFixed(2)}
                        {totalErr && <p className="text-red-500 text-[9px] font-normal">{totalErr}</p>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Summary Recap */}
          <div className="flex justify-end pt-2">
            <div className="w-72 bg-slate-950/40 border border-slate-800 rounded-lg p-4 space-y-2 text-xs">
              <div className="flex justify-between text-slate-400">
                <span>Taxable Credit Amount:</span>
                <span className="font-mono text-white">₹{totals.total_taxable.toFixed(2)}</span>
              </div>
              <div className="flex justify-between text-slate-400">
                <span>Total Tax (CGST+SGST+IGST):</span>
                <span className="font-mono text-white">₹{(totals.total_cgst + totals.total_sgst + totals.total_igst).toFixed(2)}</span>
              </div>
              <div className="flex justify-between font-bold border-t border-slate-800 pt-2 text-sm text-indigo-400">
                <span>Grand Total:</span>
                <span className="font-mono">₹{totals.total_value.toFixed(2)}</span>
              </div>
            </div>
          </div>
        </div>

        {/* Footer Actions */}
        <div className="px-6 py-4 border-t border-slate-800 bg-slate-950/40 flex justify-end gap-3">
          <button
            onClick={onClose}
            className="px-4 py-2 border border-slate-700 hover:bg-slate-800 text-slate-300 rounded-lg text-sm transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="px-5 py-2 bg-indigo-600 hover:bg-indigo-700 disabled:bg-slate-800 text-white rounded-lg font-bold text-sm shadow-md transition-all flex items-center gap-2"
          >
            {saving ? "Saving..." : "Save Changes"}
          </button>
        </div>

      </div>
    </div>
  );
};
