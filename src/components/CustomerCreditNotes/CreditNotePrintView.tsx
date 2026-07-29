import React from "react";
import { CreditNoteHeader } from "../../types/bindings/CreditNoteHeader";
import { CreditNoteItemRow } from "../../types/bindings/CreditNoteItemRow";
import { CreditNoteTaxSummary } from "../../types/bindings/CreditNoteTaxSummary";
import { ApiService } from "../../services/api";

interface CreditNotePrintViewProps {
  header: CreditNoteHeader;
  items: CreditNoteItemRow[];
  taxSummary: CreditNoteTaxSummary;
  userName: string;
  onClose: () => void;
  onRefresh?: () => void;
}

export const CreditNotePrintView: React.FC<CreditNotePrintViewProps> = ({
  header,
  items,
  taxSummary,
  userName,
  onClose,
  onRefresh,
}) => {
  React.useEffect(() => {
    // Log preview opened
    ApiService.logCreditNotePrint(header.credit_note_number, userName, "PreviewOpened").catch(console.error);
  }, [header.credit_note_number, userName]);

  const handlePrint = async () => {
    try {
      await ApiService.logCreditNotePrint(header.credit_note_number, userName, "PrintDialogInvoked");
      if (onRefresh) onRefresh();
    } catch (e) {
      console.error("Failed to log print count", e);
    }
    window.print();
  };

  // Determine watermark overlay text
  let watermarkText = "";
  if (header.is_deleted) {
    watermarkText = "DELETED";
  } else if (header.status === "Draft") {
    watermarkText = "DRAFT";
  } else if (header.status === "Review") {
    watermarkText = "UNDER REVIEW";
  } else if (header.print_count === 0) {
    watermarkText = "ORIGINAL";
  } else {
    watermarkText = `REPRINT #${header.print_count}`;
  }

  const currentDate = new Date().toLocaleString();

  return (
    <div className="fixed inset-0 z-50 bg-slate-950/85 backdrop-blur-md overflow-y-auto p-4 sm:p-6 flex justify-center items-start pt-6 sm:pt-10 print:p-0 print:bg-white print:backdrop-blur-none print:static print:inset-auto">
      {/* Container */}
      <div className="relative bg-[var(--ember-surface)] text-[var(--ember-text-primary)] w-full max-w-4xl p-6 sm:p-10 rounded-2xl shadow-2xl font-sans text-sm print:p-0 print:shadow-none print:rounded-none my-auto border border-[var(--ember-border)] print:border-none print:bg-white print:text-black">
        
        {/* Watermark styling */}
        {watermarkText && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none select-none opacity-[0.05] overflow-hidden print:opacity-[0.08]">
            <div className="text-[100px] sm:text-[120px] font-sans font-black tracking-widest uppercase rotate-[-30deg] text-[var(--ember-primary)] whitespace-nowrap">
              {watermarkText}
            </div>
          </div>
        )}

        {/* Action bar (hidden in print) */}
        <div className="flex justify-between items-center pb-5 mb-6 border-b border-[var(--ember-border)] print:hidden font-sans gap-4">
          <div className="space-y-1">
            <h2 className="text-xl font-bold font-serif text-[var(--ember-text-primary)] flex items-center gap-2">
              🖨️ Credit Note Print Preview
            </h2>
            <p className="text-xs text-[var(--ember-text-muted)]">
              Revision: #{header.revision_no} | Status: <span className="font-bold uppercase text-[var(--ember-primary)]">{header.status}</span>
            </p>
          </div>
          <div className="flex gap-3">
            <button
              onClick={handlePrint}
              className="px-5 py-2.5 bg-[var(--ember-primary)] hover:bg-[var(--ember-primary-hover)] text-white rounded-xl font-bold text-xs shadow-md transition-all active:scale-[0.98] cursor-pointer"
            >
              Print / Save PDF
            </button>
            <button
              onClick={onClose}
              className="px-5 py-2.5 bg-[var(--ember-surface-raised)] hover:bg-[var(--ember-border-subtle)] text-[var(--ember-text-secondary)] hover:text-[var(--ember-text-primary)] rounded-xl text-xs transition-all border border-[var(--ember-border)] cursor-pointer"
            >
              Close
            </button>
          </div>
        </div>

        {/* Header Metadata */}
        <div className="border border-[var(--ember-border)] bg-[var(--ember-bg)] rounded-xl p-5 mb-6 space-y-4 print:border-none print:p-0 print:bg-transparent">
          
          {/* Logo & Company details */}
          <div className="flex justify-between border-b border-[var(--ember-border)] pb-4 mb-4 print:border-slate-300">
            <div className="space-y-1">
              <h1 className="text-lg font-bold tracking-tight text-[var(--ember-text-primary)] uppercase font-serif print:text-black">
                {header.frozen_company_name || "ISSUING COMPANY"}
              </h1>
              <p className="text-xs text-[var(--ember-text-muted)] leading-relaxed max-w-sm print:text-slate-600">
                {header.frozen_company_address || "Company Address Details"}
              </p>
              <div className="text-xs space-y-0.5 mt-2 text-[var(--ember-text-secondary)] print:text-slate-700">
                <div><span className="font-bold">GSTIN:</span> {header.frozen_company_gstin || "N/A"}</div>
                <div><span className="font-bold">PAN:</span> {header.frozen_company_pan || "N/A"}</div>
              </div>
            </div>
            <div className="text-right space-y-1">
              <div className="text-2xl font-bold text-[var(--ember-primary)] uppercase tracking-widest font-serif print:text-black">CREDIT NOTE</div>
              <div className="text-xs text-[var(--ember-text-muted)] font-sans print:text-slate-500">
                Snapshot v{header.snapshot_version} | Revision #{header.revision_no}
              </div>
              <div className="text-xs text-[var(--ember-text-primary)] space-y-1 mt-4 print:text-black">
                <div><span className="font-bold text-[var(--ember-text-secondary)]">Credit Note No:</span> <span className="font-mono font-bold text-[var(--ember-primary)]">{header.credit_note_number}</span></div>
                <div><span className="font-bold text-[var(--ember-text-secondary)]">Date:</span> {header.credit_note_date}</div>
                <div><span className="font-bold text-[var(--ember-text-secondary)]">Invoice Ref:</span> <span className="font-mono">{header.invoice_number}</span></div>
              </div>
            </div>
          </div>

          {/* Customer & Place of Supply */}
          <div className="grid grid-cols-2 gap-6 text-xs leading-relaxed">
            <div className="border-r border-[var(--ember-border)] pr-6 print:border-r-0">
              <h3 className="font-serif font-bold text-[var(--ember-primary)] uppercase tracking-wider mb-2">Billed To (Customer):</h3>
              <div className="font-bold text-sm text-[var(--ember-text-primary)] mb-1 print:text-black">{header.frozen_customer_name}</div>
              <p className="text-[var(--ember-text-secondary)] mb-2 print:text-slate-600">{header.frozen_customer_address}</p>
              <div className="text-[var(--ember-text-secondary)]"><span className="font-bold text-[var(--ember-text-primary)]">GSTIN:</span> {header.frozen_customer_gstin || "N/A"}</div>
              <div className="text-[var(--ember-text-secondary)]"><span className="font-bold text-[var(--ember-text-primary)]">PAN:</span> {header.frozen_customer_pan || "N/A"}</div>
              <div className="text-[var(--ember-text-secondary)]"><span className="font-bold text-[var(--ember-text-primary)]">State / Pin:</span> {header.frozen_customer_state || "N/A"} - {header.frozen_customer_pincode || "N/A"}</div>
            </div>
            <div className="space-y-2">
              <h3 className="font-serif font-bold text-[var(--ember-primary)] uppercase tracking-wider mb-2">Supply Details:</h3>
              <div className="text-[var(--ember-text-secondary)]"><span className="font-bold text-[var(--ember-text-primary)]">Place of Supply:</span> {header.frozen_place_of_supply || "N/A"}</div>
              <div className="text-[var(--ember-text-secondary)]"><span className="font-bold text-[var(--ember-text-primary)]">Currency:</span> {header.frozen_currency}</div>
              {header.reason && (
                <div className="mt-4 border-t border-[var(--ember-border)] pt-2 print:border-slate-300">
                  <span className="font-bold text-[var(--ember-text-primary)]">Reason for Issuance:</span>
                  <p className="italic text-[var(--ember-text-secondary)] mt-1 font-serif">{header.reason}</p>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Line Items Table */}
        <div className="mb-6 border border-[var(--ember-border)] rounded-xl overflow-hidden bg-[var(--ember-bg)] print:border-slate-300 print:bg-transparent">
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="bg-[var(--ember-surface-raised)] uppercase text-[var(--ember-text-secondary)] font-sans border-b border-[var(--ember-border)] print:bg-slate-100 print:border-slate-300 print:text-slate-700">
                <th className="p-2.5 w-8 text-center">#</th>
                <th className="p-2.5">Item Code / Description</th>
                <th className="p-2.5 text-right w-16">UOM</th>
                <th className="p-2.5 text-right w-16">Credited Qty</th>
                <th className="p-2.5 text-right w-24">Rate (₹)</th>
                <th className="p-2.5 text-right w-16">GST %</th>
                <th className="p-2.5 text-right w-28 font-bold">Total Credited (₹)</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--ember-border-subtle)] print:divide-slate-200">
              {items.map((line, idx) => (
                <tr key={idx} className="hover:bg-[var(--ember-surface-raised)]/40 font-sans transition-colors">
                  <td className="p-2 text-center text-[var(--ember-text-muted)] font-mono">{idx + 1}</td>
                  <td className="p-2">
                    <div className="font-mono font-bold text-[var(--ember-primary)] print:text-black">{line.part_code}</div>
                  </td>
                  <td className="p-2 text-right text-[var(--ember-text-muted)]">
                    {line.frozen_unit_of_measure || "PCS"}
                  </td>
                  <td className="p-2 text-right font-mono font-semibold text-[var(--ember-text-primary)] print:text-black">
                    {line.quantity}
                  </td>
                  <td className="p-2 text-right font-mono text-[var(--ember-text-secondary)]">
                    ₹{line.rate_pre_unit.toFixed(2)}
                  </td>
                  <td className="p-2 text-right font-mono text-[var(--ember-text-muted)]">
                    {(line.cgst_rate + line.sgst_rate + line.igst_rate).toFixed(1)}%
                  </td>
                  <td className="p-2 text-right font-mono font-bold text-emerald-600 dark:text-emerald-400 print:text-black">
                    ₹{line.total_value.toFixed(2)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Dynamic Totals Recap */}
        <div className="flex justify-end mb-8 font-sans">
          <div className="w-80 bg-[var(--ember-bg)] border border-[var(--ember-border)] rounded-xl p-4 text-xs space-y-2 print:border-slate-300 print:bg-slate-50">
            <div className="flex justify-between text-[var(--ember-text-secondary)]">
              <span>Taxable Assessable Value:</span>
              <span className="font-mono font-semibold text-[var(--ember-text-primary)]">₹{taxSummary.total_taxable.toFixed(2)}</span>
            </div>
            {taxSummary.total_cgst > 0 && (
              <div className="flex justify-between text-[var(--ember-text-muted)]">
                <span>CGST:</span>
                <span className="font-mono">₹{taxSummary.total_cgst.toFixed(2)}</span>
              </div>
            )}
            {taxSummary.total_sgst > 0 && (
              <div className="flex justify-between text-[var(--ember-text-muted)]">
                <span>SGST:</span>
                <span className="font-mono">₹{taxSummary.total_sgst.toFixed(2)}</span>
              </div>
            )}
            {taxSummary.total_igst > 0 && (
              <div className="flex justify-between text-[var(--ember-text-muted)]">
                <span>IGST:</span>
                <span className="font-mono">₹{taxSummary.total_igst.toFixed(2)}</span>
              </div>
            )}
            <div className="flex justify-between font-bold border-t border-[var(--ember-border)] pt-2 text-sm text-[var(--ember-primary)] print:border-slate-300 print:text-black">
              <span>Grand Total Credit:</span>
              <span className="font-mono font-black text-emerald-600 dark:text-emerald-400 print:text-black">₹{taxSummary.total_value.toFixed(2)}</span>
            </div>
          </div>
        </div>

        {/* Footer Audit Details & Signatures */}
        <div className="border-t border-[var(--ember-border)] pt-8 mt-12 font-sans print:border-slate-300">
          <div className="flex justify-between items-center text-xs text-[var(--ember-text-muted)] mb-12">
            <div>
              Generated by Sales Monitoring System | Printed By: <span className="font-semibold text-[var(--ember-text-primary)]">{userName}</span>
            </div>
            <div className="text-right">
              Printed On: {currentDate}
            </div>
          </div>

          <div className="flex justify-between text-xs font-semibold text-[var(--ember-text-primary)] print:text-black">
            <div className="border-t border-[var(--ember-border)] w-48 text-center pt-2 print:border-slate-400">
              Customer Acceptance / Sign
            </div>
            <div className="border-t border-[var(--ember-border)] w-48 text-center pt-2 print:border-slate-400">
              For {header.frozen_company_name || "ISSUING COMPANY"}
              <div className="text-[10px] text-[var(--ember-text-muted)] mt-1 font-normal">(Authorised Signature)</div>
            </div>
          </div>
        </div>

      </div>
    </div>
  );
};
