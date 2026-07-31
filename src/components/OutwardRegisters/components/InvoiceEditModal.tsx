import React, { useState, useEffect, useCallback } from "react";
import { Lock, AlertCircle, Plus, Trash2, Save, X, RefreshCw, Calculator, ShieldAlert, Maximize2 } from "lucide-react";
import { ApiService } from "../../../services/api";
import { InvoiceRow } from "../../../types/bindings/InvoiceRow";
import { CustomerRow } from "../../../types/bindings/CustomerRow";
import { InvoiceUpdatePayload } from "../../../types/bindings/InvoiceUpdatePayload";
import { InvoiceItemUpdatePayload } from "../../../types/bindings/InvoiceItemUpdatePayload";

interface InvoiceEditModalProps {
  invoiceNumber: string;
  userName?: string;
  onClose: () => void;
  onSaved: () => void;
}

export const InvoiceEditModal: React.FC<InvoiceEditModalProps> = ({
  invoiceNumber,
  userName = "System User",
  onClose,
  onSaved,
}) => {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [isDirty, setIsDirty] = useState(false);
  const [showUnsavedPrompt, setShowUnsavedPrompt] = useState(false);
  const [windowSize, setWindowSize] = useState<"1x" | "2x" | "full">("2x");

  // Master lists
  const [customers, setCustomers] = useState<CustomerRow[]>([]);

  // Original Header data
  const [header, setHeader] = useState<InvoiceRow | null>(null);

  // Form State Header
  const [customerId, setCustomerId] = useState<number>(0);
  const [placeOfSupply, setPlaceOfSupply] = useState<string>("");
  const [reverseCharge, setReverseCharge] = useState<string>("N");
  const [invoiceType, setInvoiceType] = useState<string>("Regular B2B");
  const [irn, setIrn] = useState<string>("");
  const [irnDate, setIrnDate] = useState<string>("");
  const [status, setStatus] = useState<string>("Imported");
  const [editReason, setEditReason] = useState<string>("");

  // Form State Line Items
  const [items, setItems] = useState<InvoiceItemUpdatePayload[]>([]);

  useEffect(() => {
    loadInvoiceAndMasters();
  }, [invoiceNumber]);

  const loadInvoiceAndMasters = async () => {
    try {
      setLoading(true);
      setErrorMsg(null);
      const [custList, [invHeader, invItems]] = await Promise.all([
        ApiService.getCustomers(),
        ApiService.getInvoiceDetails(invoiceNumber),
      ]);

      setCustomers(custList);
      setHeader(invHeader);
      setCustomerId(Number(invHeader.customer_id));
      setPlaceOfSupply(invHeader.place_of_supply || "");
      setReverseCharge(invHeader.reverse_charge || "N");
      setInvoiceType(invHeader.invoice_type || "Regular B2B");
      setIrn(invHeader.irn || "");
      setIrnDate(invHeader.irn_date || "");
      setStatus(invHeader.status);

      const mappedItems: InvoiceItemUpdatePayload[] = invItems.map((i) => ({
        id: i.id ? Number(i.id) : null,
        part_code: i.part_code,
        description: i.description || "",
        quantity: i.quantity,
        rate_pre_unit: i.rate_pre_unit,
        cgst_rate: i.cgst_rate,
        sgst_rate: i.sgst_rate,
        igst_rate: i.igst_rate,
      }));

      setItems(mappedItems);
      setIsDirty(false);
    } catch (err: any) {
      setErrorMsg(err.message || "Failed to load invoice details");
    } finally {
      setLoading(false);
    }
  };

  const handleFieldChange = () => {
    if (!isDirty) setIsDirty(true);
  };

  // Line item manipulation
  const handleItemChange = (
    index: number,
    field: keyof InvoiceItemUpdatePayload,
    value: any
  ) => {
    handleFieldChange();
    setItems((prev) => {
      const next = [...prev];
      next[index] = { ...next[index], [field]: value };
      return next;
    });
  };

  const handleAddItem = () => {
    handleFieldChange();
    setItems((prev) => [
      ...prev,
      {
        id: null,
        part_code: "",
        description: "",
        quantity: 1,
        rate_pre_unit: 0,
        cgst_rate: 9,
        sgst_rate: 9,
        igst_rate: 0,
      },
    ]);
  };

  const handleRemoveItem = (index: number) => {
    handleFieldChange();
    setItems((prev) => prev.filter((_, idx) => idx !== index));
  };

  // Recalculate Row Values
  const getRowTotals = (item: InvoiceItemUpdatePayload) => {
    const qty = Math.max(0, item.quantity || 0);
    const rate = Math.max(0, item.rate_pre_unit || 0);
    const assessable = Math.round(qty * rate * 100) / 100;
    const cgst = Math.round((assessable * (item.cgst_rate || 0) / 100) * 100) / 100;
    const sgst = Math.round((assessable * (item.sgst_rate || 0) / 100) * 100) / 100;
    const igst = Math.round((assessable * (item.igst_rate || 0) / 100) * 100) / 100;
    const total = assessable + cgst + sgst + igst;
    const hasTaxConflict = (item.cgst_rate > 0 || item.sgst_rate > 0) && item.igst_rate > 0;

    return { assessable, cgst, sgst, igst, total, hasTaxConflict };
  };

  // Grand Totals Calculation
  const calculateGrandTotals = () => {
    let totalTaxable = 0;
    let totalCgst = 0;
    let totalSgst = 0;
    let totalIgst = 0;
    let totalValue = 0;
    let totalQty = 0;
    let hasAnyTaxConflict = false;

    items.forEach((item) => {
      const row = getRowTotals(item);
      totalTaxable += row.assessable;
      totalCgst += row.cgst;
      totalSgst += row.sgst;
      totalIgst += row.igst;
      totalValue += row.total;
      totalQty += Math.max(0, item.quantity || 0);
      if (row.hasTaxConflict) hasAnyTaxConflict = true;
    });

    return {
      totalTaxable,
      totalCgst,
      totalSgst,
      totalIgst,
      totalValue,
      totalQty,
      itemCount: items.length,
      hasAnyTaxConflict,
    };
  };

  const grandTotals = calculateGrandTotals();

  // Validate form before save
  const validate = (): string | null => {
    if (!editReason.trim()) {
      return "Please enter a mandatory Reason / Justification for modification.";
    }
    if (items.length === 0) {
      return "Invoice must contain at least one line item.";
    }
    if (grandTotals.hasAnyTaxConflict) {
      return "Tax configuration error: Line items cannot have both CGST/SGST and IGST applied.";
    }
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (!item.part_code.trim()) {
        return `Line item #${i + 1}: Part code is required.`;
      }
      if (item.quantity <= 0) {
        return `Line item #${i + 1} (${item.part_code}): Quantity must be greater than 0.`;
      }
      if (item.rate_pre_unit < 0) {
        return `Line item #${i + 1} (${item.part_code}): Rate per unit cannot be negative.`;
      }
    }
    return null;
  };

  const handleSave = async () => {
    const valErr = validate();
    if (valErr) {
      setErrorMsg(valErr);
      return;
    }

    try {
      setSaving(true);
      setErrorMsg(null);

      const payload: InvoiceUpdatePayload = {
        invoice_number: invoiceNumber,
        expected_version: header?.version || 1,
        customer_id: customerId,
        place_of_supply: placeOfSupply.trim() || null,
        reverse_charge: reverseCharge,
        invoice_type: invoiceType,
        irn: irn.trim() || null,
        irn_date: irnDate.trim() || null,
        status,
        edit_reason: editReason.trim(),
        items,
      };

      await ApiService.updateInvoiceRecord(payload, userName);
      onSaved();
    } catch (err: any) {
      setErrorMsg(err.message || "Failed to update invoice record");
    } finally {
      setSaving(false);
    }
  };

  const handleAttemptClose = useCallback(() => {
    if (isDirty) {
      setShowUnsavedPrompt(true);
    } else {
      onClose();
    }
  }, [isDirty, onClose]);

  // Keyboard Shortcuts (Ctrl+S / Ctrl+Enter / Esc)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && (e.key.toLowerCase() === "s" || e.key === "Enter")) {
        e.preventDefault();
        handleSave();
      } else if (e.key === "Escape") {
        e.preventDefault();
        handleAttemptClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleSave, handleAttemptClose]);

  if (loading) {
    return (
      <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
        <div className="ember-card bg-[var(--ember-surface)] border border-[var(--ember-border)] p-8 text-center space-y-3 rounded-2xl shadow-2xl">
          <RefreshCw className="w-8 h-8 animate-spin text-[var(--ember-primary)] mx-auto" />
          <p className="text-xs font-semibold text-[var(--ember-text-primary)]">Loading Invoice #{invoiceNumber} for editing...</p>
        </div>
      </div>
    );
  }

  const modalSizeClass =
    windowSize === "1x"
      ? "max-w-7xl max-h-[95vh]"
      : windowSize === "2x"
      ? "w-[90vw] max-w-[90vw] max-h-[95vh]"
      : "w-[98vw] max-w-none h-[96vh] max-h-[96vh]";

  return (
    <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex justify-center items-center p-2 sm:p-4 overflow-y-auto">
      <div className={`bg-[var(--ember-surface)] border border-[var(--ember-border)] w-full rounded-2xl shadow-2xl overflow-hidden flex flex-col transition-all duration-200 text-xs font-sans ${modalSizeClass}`}>
        
        {/* Modal Header */}
        <div className="px-6 py-3.5 border-b border-[var(--ember-border)] flex justify-between items-center bg-[var(--ember-surface-raised)] select-none">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-[var(--ember-primary-light)] text-[var(--ember-primary)] rounded-lg">
              <Calculator className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-base font-bold font-serif text-[var(--ember-text-primary)]">
                  Edit Sales Invoice
                </h2>
                <span className="px-2 py-0.5 rounded bg-[var(--ember-surface)] border border-[var(--ember-border)] font-mono text-[10px] text-[var(--ember-primary)]">
                  v{header?.version || 1}
                </span>
              </div>
              <p className="text-[11px] text-[var(--ember-text-muted)] font-mono mt-0.5">
                Invoice No: <span className="font-bold text-[var(--ember-text-primary)]">{invoiceNumber}</span> | Date: {header?.invoice_date}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            {/* 1x | 2x | Full Size Switcher Segmented Control */}
            <div className="flex items-center gap-1 bg-[var(--ember-surface)] p-1 rounded-xl border border-[var(--ember-border)] select-none">
              <button
                type="button"
                onClick={() => setWindowSize("1x")}
                className={`px-2.5 py-1 rounded-lg text-[11px] font-mono font-bold transition-all cursor-pointer ${
                  windowSize === "1x"
                    ? "bg-[var(--ember-primary)] text-white shadow-xs"
                    : "text-[var(--ember-text-muted)] hover:text-[var(--ember-text-primary)] hover:bg-[var(--ember-surface-raised)]"
                }`}
                title="Standard Compact Mode (1x)"
              >
                1x
              </button>

              <button
                type="button"
                onClick={() => setWindowSize("2x")}
                className={`px-2.5 py-1 rounded-lg text-[11px] font-mono font-bold transition-all cursor-pointer ${
                  windowSize === "2x"
                    ? "bg-[var(--ember-primary)] text-white shadow-xs"
                    : "text-[var(--ember-text-muted)] hover:text-[var(--ember-text-primary)] hover:bg-[var(--ember-surface-raised)]"
                }`}
                title="Large Widescreen Mode (2x)"
              >
                2x
              </button>

              <button
                type="button"
                onClick={() => setWindowSize("full")}
                className={`px-2.5 py-1 rounded-lg text-[11px] font-mono font-bold transition-all cursor-pointer flex items-center gap-1 ${
                  windowSize === "full"
                    ? "bg-[var(--ember-primary)] text-white shadow-xs"
                    : "text-[var(--ember-text-muted)] hover:text-[var(--ember-text-primary)] hover:bg-[var(--ember-surface-raised)]"
                }`}
                title="Fullscreen Mode"
              >
                <Maximize2 className="w-3 h-3" /> Full
              </button>
            </div>

            <button
              onClick={handleAttemptClose}
              disabled={saving}
              className="p-1.5 text-[var(--ember-text-muted)] hover:text-[var(--ember-text-primary)] rounded-lg hover:bg-[var(--ember-surface)] transition-colors cursor-pointer disabled:opacity-50"
              title="Close (Esc)"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Modal Body */}
        <div className="p-6 space-y-6 flex-1 overflow-y-auto">
          {errorMsg && (
            <div className="p-3.5 bg-rose-500/10 border border-rose-500/30 text-rose-600 dark:text-rose-400 rounded-xl flex items-start gap-2.5">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              <div className="text-xs font-medium">{errorMsg}</div>
            </div>
          )}

          {/* 1. Header Fields Grid */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4 p-4 rounded-xl bg-[var(--ember-surface-raised)] border border-[var(--ember-border)]">
            
            {/* Locked Invoice Number */}
            <div className="space-y-1">
              <label className="text-[10px] text-[var(--ember-text-secondary)] font-bold uppercase tracking-wider flex items-center gap-1">
                <Lock className="w-3 h-3 text-amber-500" /> Invoice No (Locked)
              </label>
              <input
                type="text"
                disabled
                value={invoiceNumber}
                className="w-full px-3 py-1.5 rounded-lg bg-[var(--ember-surface)]/60 border border-[var(--ember-border)] font-mono font-bold text-[var(--ember-primary)] cursor-not-allowed opacity-80 text-xs"
                title="Invoice Number is strictly immutable"
              />
            </div>

            {/* Locked Invoice Date */}
            <div className="space-y-1">
              <label className="text-[10px] text-[var(--ember-text-secondary)] font-bold uppercase tracking-wider flex items-center gap-1">
                <Lock className="w-3 h-3 text-amber-500" /> Invoice Date (Locked)
              </label>
              <input
                type="text"
                disabled
                value={header?.invoice_date || ""}
                className="w-full px-3 py-1.5 rounded-lg bg-[var(--ember-surface)]/60 border border-[var(--ember-border)] font-mono font-medium text-[var(--ember-text-secondary)] cursor-not-allowed opacity-80 text-xs"
                title="Invoice Date is strictly immutable"
              />
            </div>

            {/* Customer Dropdown */}
            <div className="space-y-1 md:col-span-2">
              <label className="text-[10px] text-[var(--ember-text-secondary)] font-bold uppercase tracking-wider block">
                Customer Master Reference
              </label>
              <select
                value={customerId}
                disabled={saving}
                onChange={(e) => {
                  setCustomerId(Number(e.target.value));
                  handleFieldChange();
                }}
                className="w-full ember-input px-3 py-1.5 text-xs text-[var(--ember-text-primary)] font-semibold"
              >
                {customers.map((c) => (
                  <option key={c.id ? Number(c.id) : 0} value={c.id ? Number(c.id) : 0}>
                    {c.report_name} ({c.customer_code}) {c.gstin ? `[GSTIN: ${c.gstin}]` : ""}
                  </option>
                ))}
              </select>
            </div>

            {/* Place of Supply */}
            <div className="space-y-1">
              <label className="text-[10px] text-[var(--ember-text-secondary)] font-bold uppercase tracking-wider block">
                Place of Supply
              </label>
              <input
                type="text"
                value={placeOfSupply}
                disabled={saving}
                onChange={(e) => {
                  setPlaceOfSupply(e.target.value);
                  handleFieldChange();
                }}
                placeholder="e.g. 33 (Tamil Nadu)"
                className="w-full ember-input px-3 py-1.5 text-xs font-mono"
              />
            </div>

            {/* Reverse Charge */}
            <div className="space-y-1">
              <label className="text-[10px] text-[var(--ember-text-secondary)] font-bold uppercase tracking-wider block">
                Reverse Charge
              </label>
              <select
                value={reverseCharge}
                disabled={saving}
                onChange={(e) => {
                  setReverseCharge(e.target.value);
                  handleFieldChange();
                }}
                className="w-full ember-input px-3 py-1.5 text-xs font-medium"
              >
                <option value="N">N (No)</option>
                <option value="Y">Y (Yes)</option>
              </select>
            </div>

            {/* Invoice Type */}
            <div className="space-y-1">
              <label className="text-[10px] text-[var(--ember-text-secondary)] font-bold uppercase tracking-wider block">
                Invoice Category
              </label>
              <select
                value={invoiceType}
                disabled={saving}
                onChange={(e) => {
                  setInvoiceType(e.target.value);
                  handleFieldChange();
                }}
                className="w-full ember-input px-3 py-1.5 text-xs font-medium"
              >
                <option value="Regular B2B">Regular B2B</option>
                <option value="SEZ Supplies with Payment">SEZ Supplies with Payment</option>
                <option value="SEZ Supplies without Payment">SEZ Supplies without Payment</option>
                <option value="Deemed Export">Deemed Export</option>
              </select>
            </div>

            {/* Invoice Status */}
            <div className="space-y-1">
              <label className="text-[10px] text-[var(--ember-text-secondary)] font-bold uppercase tracking-wider block">
                Workflow Status
              </label>
              <select
                value={status}
                disabled={saving}
                onChange={(e) => {
                  setStatus(e.target.value);
                  handleFieldChange();
                }}
                className="w-full ember-input px-3 py-1.5 text-xs font-bold text-[var(--ember-primary)]"
              >
                <option value="Imported">Imported</option>
                <option value="Verified">Verified</option>
                <option value="Draft">Draft</option>
                <option value="Cancelled">Cancelled</option>
              </select>
            </div>

            {/* IRN */}
            <div className="space-y-1 md:col-span-2">
              <label className="text-[10px] text-[var(--ember-text-secondary)] font-bold uppercase tracking-wider block">
                E-Invoice IRN
              </label>
              <input
                type="text"
                value={irn}
                disabled={saving}
                onChange={(e) => {
                  setIrn(e.target.value);
                  handleFieldChange();
                }}
                placeholder="64-character IRN Hash (Optional)"
                className="w-full ember-input px-3 py-1.5 text-xs font-mono"
              />
            </div>

            {/* IRN Date */}
            <div className="space-y-1 md:col-span-2">
              <label className="text-[10px] text-[var(--ember-text-secondary)] font-bold uppercase tracking-wider block">
                IRN Date
              </label>
              <input
                type="text"
                value={irnDate}
                disabled={saving}
                onChange={(e) => {
                  setIrnDate(e.target.value);
                  handleFieldChange();
                }}
                placeholder="YYYY-MM-DD (Optional)"
                className="w-full ember-input px-3 py-1.5 text-xs font-mono"
              />
            </div>
          </div>

          {/* Mandatory Edit Reason Input */}
          <div className="space-y-1.5 bg-amber-500/5 border border-amber-500/20 p-4 rounded-xl">
            <label className="text-xs text-[var(--ember-text-primary)] font-bold uppercase tracking-wider flex items-center gap-1.5">
              <ShieldAlert className="w-4 h-4 text-amber-500" /> Mandatory Modification Reason / Justification
            </label>
            <input
              type="text"
              value={editReason}
              disabled={saving}
              onChange={(e) => {
                setEditReason(e.target.value);
                handleFieldChange();
              }}
              placeholder="Explain why this invoice is being edited (e.g. Corrected part rate mismatch per PO revision)..."
              className={`w-full ember-input px-3 py-2 text-xs text-[var(--ember-text-primary)] ${
                !editReason.trim() ? "border-amber-500/60 focus:ring-amber-500/30" : ""
              }`}
            />
          </div>

          {/* 2. Line Items Table */}
          <div className="space-y-3">
            <div className="flex justify-between items-center">
              <h3 className="text-xs font-bold font-serif text-[var(--ember-text-primary)] uppercase tracking-wider flex items-center gap-2">
                Line Items Breakdown ({items.length})
              </h3>
              <button
                type="button"
                onClick={handleAddItem}
                disabled={saving}
                className="ember-btn-secondary px-3 py-1.5 text-xs flex items-center gap-1 cursor-pointer"
              >
                <Plus className="w-3.5 h-3.5" /> Add Line Item
              </button>
            </div>

            <div className="border border-[var(--ember-border)] rounded-xl overflow-hidden bg-[var(--ember-bg)] shadow-xs">
              <table className="w-full text-left text-xs border-collapse">
                <thead>
                  <tr className="bg-[var(--ember-surface-raised)] text-[var(--ember-text-secondary)] font-bold border-b border-[var(--ember-border)] uppercase tracking-wider text-[10px]">
                    <th className="p-2.5 w-8 text-center">#</th>
                    <th className="p-2.5 w-36">Part Code</th>
                    <th className="p-2.5">Item Description</th>
                    <th className="p-2.5 text-right w-24">Qty</th>
                    <th className="p-2.5 text-right w-28">Rate (₹)</th>
                    <th className="p-2.5 text-right w-20">CGST %</th>
                    <th className="p-2.5 text-right w-20">SGST %</th>
                    <th className="p-2.5 text-right w-20">IGST %</th>
                    <th className="p-2.5 text-right w-28">Taxable (₹)</th>
                    <th className="p-2.5 text-right w-32">Total Value (₹)</th>
                    <th className="p-2.5 text-center w-12">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--ember-border-subtle)] font-sans">
                  {items.length === 0 ? (
                    <tr>
                      <td colSpan={11} className="p-8 text-center text-[var(--ember-text-muted)] italic">
                        No line items added. Click "Add Line Item" above.
                      </td>
                    </tr>
                  ) : (
                    items.map((item, idx) => {
                      const row = getRowTotals(item);
                      const isQtyErr = item.quantity <= 0;
                      const isRateErr = item.rate_pre_unit < 0;

                      return (
                        <tr
                          key={idx}
                          className={`transition-colors ${
                            row.hasTaxConflict || isQtyErr || isRateErr
                              ? "bg-rose-950/20"
                              : "hover:bg-[var(--ember-surface-raised)]/50"
                          }`}
                        >
                          <td className="p-2.5 font-mono text-[var(--ember-text-muted)] text-[11px] text-center">
                            {idx + 1}
                          </td>
                          
                          {/* Part Code */}
                          <td className="p-2 w-36">
                            <input
                              type="text"
                              value={item.part_code}
                              disabled={saving}
                              onChange={(e) => handleItemChange(idx, "part_code", e.target.value)}
                              placeholder="PART-CODE"
                              className="w-full ember-input px-2 py-1 text-xs font-mono font-bold text-[var(--ember-primary)]"
                            />
                          </td>

                          {/* Item Description */}
                          <td className="p-2">
                            <input
                              type="text"
                              value={item.description || ""}
                              disabled={saving}
                              onChange={(e) => handleItemChange(idx, "description", e.target.value)}
                              placeholder="Part / Item Description"
                              className="w-full ember-input px-2 py-1 text-xs text-[var(--ember-text-primary)] font-medium"
                            />
                          </td>

                          {/* Quantity */}
                          <td className="p-2 text-right">
                            <input
                              type="number"
                              step="any"
                              value={item.quantity}
                              disabled={saving}
                              onChange={(e) => handleItemChange(idx, "quantity", parseFloat(e.target.value) || 0)}
                              className={`w-full ember-input px-2 py-1 text-right text-xs font-mono ${
                                isQtyErr ? "border-rose-500 text-rose-500" : ""
                              }`}
                            />
                          </td>

                          {/* Rate */}
                          <td className="p-2 text-right">
                            <input
                              type="number"
                              step="0.01"
                              value={item.rate_pre_unit}
                              disabled={saving}
                              onChange={(e) => handleItemChange(idx, "rate_pre_unit", parseFloat(e.target.value) || 0)}
                              className={`w-full ember-input px-2 py-1 text-right text-xs font-mono ${
                                isRateErr ? "border-rose-500 text-rose-500" : ""
                              }`}
                            />
                          </td>

                          {/* CGST Rate */}
                          <td className="p-2 text-right">
                            <input
                              type="number"
                              step="0.1"
                              value={item.cgst_rate}
                              disabled={saving}
                              onChange={(e) => handleItemChange(idx, "cgst_rate", parseFloat(e.target.value) || 0)}
                              className={`w-full ember-input px-2 py-1 text-right text-xs font-mono ${
                                row.hasTaxConflict ? "border-rose-500" : ""
                              }`}
                            />
                          </td>

                          {/* SGST Rate */}
                          <td className="p-2 text-right">
                            <input
                              type="number"
                              step="0.1"
                              value={item.sgst_rate}
                              disabled={saving}
                              onChange={(e) => handleItemChange(idx, "sgst_rate", parseFloat(e.target.value) || 0)}
                              className={`w-full ember-input px-2 py-1 text-right text-xs font-mono ${
                                row.hasTaxConflict ? "border-rose-500" : ""
                              }`}
                            />
                          </td>

                          {/* IGST Rate */}
                          <td className="p-2 text-right">
                            <input
                              type="number"
                              step="0.1"
                              value={item.igst_rate}
                              disabled={saving}
                              onChange={(e) => handleItemChange(idx, "igst_rate", parseFloat(e.target.value) || 0)}
                              className={`w-full ember-input px-2 py-1 text-right text-xs font-mono ${
                                row.hasTaxConflict ? "border-rose-500" : ""
                              }`}
                            />
                          </td>

                          {/* Assessable Value */}
                          <td className="p-2.5 text-right font-mono font-medium text-[var(--ember-text-primary)]">
                            ₹{row.assessable.toFixed(2)}
                          </td>

                          {/* Line Total */}
                          <td className="p-2.5 text-right font-mono font-bold text-[var(--ember-primary)]">
                            ₹{row.total.toFixed(2)}
                          </td>

                          {/* Action */}
                          <td className="p-2.5 text-center">
                            <button
                              type="button"
                              onClick={() => handleRemoveItem(idx)}
                              disabled={saving}
                              className="p-1 text-rose-500 hover:text-rose-400 hover:bg-rose-500/10 rounded transition-colors cursor-pointer disabled:opacity-30"
                              title="Delete line item"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* 3. Live Reconciliation Totals Panel */}
          <div className="bg-[var(--ember-surface-raised)] border border-[var(--ember-border)] rounded-xl p-4 flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
            <div className="space-y-1 text-[11px] text-[var(--ember-text-muted)] font-mono">
              <div>Total Items: <span className="font-bold text-[var(--ember-text-primary)]">{grandTotals.itemCount}</span></div>
              <div>Total Quantity: <span className="font-bold text-[var(--ember-text-primary)]">{grandTotals.totalQty}</span></div>
            </div>

            <div className="grid grid-cols-2 md:grid-cols-5 gap-3 text-right text-xs w-full md:w-auto">
              <div className="bg-[var(--ember-surface)] p-2.5 rounded-lg border border-[var(--ember-border)]">
                <span className="text-[10px] text-[var(--ember-text-muted)] block uppercase font-bold">Taxable</span>
                <span className="font-mono font-bold text-[var(--ember-text-primary)]">₹{grandTotals.totalTaxable.toFixed(2)}</span>
              </div>
              <div className="bg-[var(--ember-surface)] p-2.5 rounded-lg border border-[var(--ember-border)]">
                <span className="text-[10px] text-[var(--ember-text-muted)] block uppercase">CGST</span>
                <span className="font-mono text-[var(--ember-text-secondary)]">₹{grandTotals.totalCgst.toFixed(2)}</span>
              </div>
              <div className="bg-[var(--ember-surface)] p-2.5 rounded-lg border border-[var(--ember-border)]">
                <span className="text-[10px] text-[var(--ember-text-muted)] block uppercase">SGST</span>
                <span className="font-mono text-[var(--ember-text-secondary)]">₹{grandTotals.totalSgst.toFixed(2)}</span>
              </div>
              <div className="bg-[var(--ember-surface)] p-2.5 rounded-lg border border-[var(--ember-border)]">
                <span className="text-[10px] text-[var(--ember-text-muted)] block uppercase">IGST</span>
                <span className="font-mono text-[var(--ember-text-secondary)]">₹{grandTotals.totalIgst.toFixed(2)}</span>
              </div>
              <div className="bg-[var(--ember-surface)] p-2.5 rounded-lg border border-[var(--ember-primary)]/40 bg-[var(--ember-primary-light)]/20">
                <span className="text-[10px] text-[var(--ember-primary)] block uppercase font-bold">Grand Total</span>
                <span className="font-mono font-black text-emerald-600 dark:text-emerald-400 text-sm">
                  ₹{grandTotals.totalValue.toFixed(2)}
                </span>
              </div>
            </div>
          </div>

        </div>

        {/* Modal Footer */}
        <div className="px-6 py-4 border-t border-[var(--ember-border)] bg-[var(--ember-surface-raised)] flex justify-between items-center">
          <span className="text-[11px] text-[var(--ember-text-muted)] font-mono hidden sm:inline">
            Shortcuts: <kbd className="px-1.5 py-0.5 bg-[var(--ember-surface)] border border-[var(--ember-border)] rounded text-[10px]">Ctrl+S</kbd> Save | <kbd className="px-1.5 py-0.5 bg-[var(--ember-surface)] border border-[var(--ember-border)] rounded text-[10px]">Esc</kbd> Cancel
          </span>
          <div className="flex gap-3 ml-auto">
            <button
              type="button"
              onClick={handleAttemptClose}
              disabled={saving}
              className="ember-btn-secondary px-4 py-2 text-xs cursor-pointer disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleSave}
              disabled={saving}
              className="ember-btn-primary px-5 py-2 text-xs cursor-pointer flex items-center gap-2 disabled:opacity-50"
            >
              {saving ? (
                <>
                  <RefreshCw className="w-4 h-4 animate-spin" /> Saving Changes...
                </>
              ) : (
                <>
                  <Save className="w-4 h-4" /> Save Invoice Changes
                </>
              )}
            </button>
          </div>
        </div>

        {/* Unsaved Changes Confirmation Dialog */}
        {showUnsavedPrompt && (
          <div className="fixed inset-0 z-60 bg-black/80 flex items-center justify-center p-4">
            <div className="bg-[var(--ember-surface)] border border-[var(--ember-border)] rounded-xl p-6 max-w-md w-full shadow-2xl space-y-4 text-center">
              <AlertCircle className="w-10 h-10 text-amber-500 mx-auto" />
              <h4 className="text-sm font-bold font-serif text-[var(--ember-text-primary)]">
                Unsaved Changes Detected
              </h4>
              <p className="text-xs text-[var(--ember-text-muted)]">
                You have modified invoice fields. Are you sure you want to discard your changes?
              </p>
              <div className="flex justify-center gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setShowUnsavedPrompt(false)}
                  className="ember-btn-secondary px-4 py-2 text-xs cursor-pointer"
                >
                  Continue Editing
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setShowUnsavedPrompt(false);
                    onClose();
                  }}
                  className="bg-rose-500/15 text-rose-500 border border-rose-500/30 hover:bg-rose-500/25 px-4 py-2 text-xs font-semibold rounded-lg cursor-pointer"
                >
                  Discard Changes
                </button>
              </div>
            </div>
          </div>
        )}

      </div>
    </div>
  );
};
