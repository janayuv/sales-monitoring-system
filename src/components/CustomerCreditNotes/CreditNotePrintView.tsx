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
    <div className="fixed inset-0 z-50 bg-slate-950/85 backdrop-blur-md overflow-y-auto p-6 flex justify-center print:p-0 print:bg-white print:backdrop-blur-none">
      {/* Container */}
      <div className="relative bg-white text-slate-900 w-full max-w-4xl p-10 rounded-xl shadow-2xl font-serif text-sm print:p-0 print:shadow-none print:rounded-none">
        
        {/* Watermark styling */}
        {watermarkText && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none select-none opacity-[0.06] overflow-hidden">
            <div className="text-[120px] font-sans font-black tracking-widest uppercase rotate-[-30deg] text-red-700 whitespace-nowrap">
              {watermarkText}
            </div>
          </div>
        )}

        {/* Action bar (hidden in print) */}
        <div className="flex justify-between items-center pb-6 mb-8 border-b border-slate-200 print:hidden font-sans">
          <div className="space-y-1">
            <h2 className="text-xl font-bold text-slate-800 flex items-center gap-2">
              🖨️ Credit Note Print Preview
            </h2>
            <p className="text-xs text-slate-500">
              Revision: #{header.revision_no} | Status: <span className="font-bold uppercase text-indigo-600">{header.status}</span>
            </p>
          </div>
          <div className="flex gap-3">
            <button
              onClick={handlePrint}
              className="px-5 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg font-bold text-sm shadow-md transition-all active:scale-[0.98]"
            >
              Print / Save PDF
            </button>
            <button
              onClick={onClose}
              className="px-5 py-2.5 bg-slate-200 hover:bg-slate-300 text-slate-800 rounded-lg text-sm transition-all"
            >
              Close
            </button>
          </div>
        </div>

        {/* Header Metadata */}
        <div className="border border-slate-300 rounded-lg p-5 mb-6 space-y-4 print:border-none print:p-0">
          
          {/* Logo & Company details */}
          <div className="flex justify-between border-b pb-4 mb-4">
            <div className="space-y-1">
              <h1 className="text-lg font-bold tracking-tight text-slate-800 uppercase">
                {header.frozen_company_name || "ISSUING COMPANY"}
              </h1>
              <p className="text-xs text-slate-500 leading-relaxed max-w-sm">
                {header.frozen_company_address || "Company Address Details"}
              </p>
              <div className="text-xs space-y-0.5 mt-2">
                <div><span className="font-bold text-slate-700">GSTIN:</span> {header.frozen_company_gstin || "N/A"}</div>
                <div><span className="font-bold text-slate-700">PAN:</span> {header.frozen_company_pan || "N/A"}</div>
              </div>
            </div>
            <div className="text-right space-y-1">
              <div className="text-2xl font-bold text-slate-900 uppercase tracking-widest">CREDIT NOTE</div>
              <div className="text-xs text-slate-500 font-sans">
                Snapshot v{header.snapshot_version} | Revision #{header.revision_no}
              </div>
              <div className="text-xs text-slate-900 space-y-1 mt-4">
                <div><span className="font-bold">Credit Note No:</span> <span className="font-mono font-bold text-indigo-700">{header.credit_note_number}</span></div>
                <div><span className="font-bold">Date:</span> {header.credit_note_date}</div>
                <div><span className="font-bold">Invoice Ref:</span> <span className="font-mono">{header.invoice_number}</span></div>
              </div>
            </div>
          </div>

          {/* Customer & Place of Supply */}
          <div className="grid grid-cols-2 gap-6 text-xs leading-relaxed">
            <div className="border-r pr-6 print:border-r-0">
              <h3 className="font-sans font-bold text-slate-700 uppercase tracking-wider mb-2">Billed To (Customer):</h3>
              <div className="font-bold text-sm text-slate-950 mb-1">{header.frozen_customer_name}</div>
              <p className="text-slate-600 mb-2">{header.frozen_customer_address}</p>
              <div><span className="font-bold text-slate-700">GSTIN:</span> {header.frozen_customer_gstin || "N/A"}</div>
              <div><span className="font-bold text-slate-700">PAN:</span> {header.frozen_customer_pan || "N/A"}</div>
              <div><span className="font-bold text-slate-700">State / Pin:</span> {header.frozen_customer_state || "N/A"} - {header.frozen_customer_pincode || "N/A"}</div>
            </div>
            <div className="space-y-2">
              <h3 className="font-sans font-bold text-slate-700 uppercase tracking-wider mb-2">Supply Details:</h3>
              <div><span className="font-bold text-slate-700">Place of Supply:</span> {header.frozen_place_of_supply || "N/A"}</div>
              <div><span className="font-bold text-slate-700">Currency:</span> {header.frozen_currency}</div>
              {header.reason && (
                <div className="mt-4 border-t pt-2">
                  <span className="font-bold text-slate-700">Reason for Issuance:</span>
                  <p className="italic text-slate-600 mt-1">{header.reason}</p>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Line Items Table */}
        <div className="mb-6">
          <table className="w-full text-left text-xs border border-collapse border-slate-300">
            <thead>
              <tr className="bg-slate-100 uppercase text-slate-700 font-sans border-b border-slate-300">
                <th className="border border-slate-300 p-2.5 w-8">#</th>
                <th className="border border-slate-300 p-2.5">Item Code / Description</th>
                <th className="border border-slate-300 p-2.5 text-right w-16">UOM</th>
                <th className="border border-slate-300 p-2.5 text-right w-16">Credited Qty</th>
                <th className="border border-slate-300 p-2.5 text-right w-24">Rate (₹)</th>
                <th className="border border-slate-300 p-2.5 text-right w-16">GST %</th>
                <th className="border border-slate-300 p-2.5 text-right w-28">Total Credited (₹)</th>
              </tr>
            </thead>
            <tbody>
              {items.map((line, idx) => (
                <tr key={idx} className="hover:bg-slate-50 font-sans">
                  <td className="border border-slate-300 p-2 text-center text-slate-500">{idx + 1}</td>
                  <td className="border border-slate-300 p-2">
                    <div className="font-mono font-bold text-slate-900">{line.part_code}</div>
                  </td>
                  <td className="border border-slate-300 p-2 text-right text-slate-600">
                    {line.frozen_unit_of_measure || "PCS"}
                  </td>
                  <td className="border border-slate-300 p-2 text-right font-mono font-semibold">
                    {line.quantity}
                  </td>
                  <td className="border border-slate-300 p-2 text-right font-mono">
                    ₹{line.rate_pre_unit.toFixed(2)}
                  </td>
                  <td className="border border-slate-300 p-2 text-right">
                    {(line.cgst_rate + line.sgst_rate + line.igst_rate).toFixed(1)}%
                  </td>
                  <td className="border border-slate-300 p-2 text-right font-mono font-bold text-slate-900">
                    ₹{line.total_value.toFixed(2)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Dynamic Totals Recap */}
        <div className="flex justify-end mb-8 font-sans">
          <div className="w-80 border border-slate-300 rounded-lg p-4 text-xs space-y-2">
            <div className="flex justify-between text-slate-600">
              <span>Taxable Assessable Value:</span>
              <span className="font-mono">₹{taxSummary.total_taxable.toFixed(2)}</span>
            </div>
            {taxSummary.total_cgst > 0 && (
              <div className="flex justify-between text-slate-600">
                <span>CGST:</span>
                <span className="font-mono">₹{taxSummary.total_cgst.toFixed(2)}</span>
              </div>
            )}
            {taxSummary.total_sgst > 0 && (
              <div className="flex justify-between text-slate-600">
                <span>SGST:</span>
                <span className="font-mono">₹{taxSummary.total_sgst.toFixed(2)}</span>
              </div>
            )}
            {taxSummary.total_igst > 0 && (
              <div className="flex justify-between text-slate-600">
                <span>IGST:</span>
                <span className="font-mono">₹{taxSummary.total_igst.toFixed(2)}</span>
              </div>
            )}
            <div className="flex justify-between font-bold border-t border-slate-200 pt-2 text-sm text-indigo-900">
              <span>Grand Total Credit:</span>
              <span className="font-mono">₹{taxSummary.total_value.toFixed(2)}</span>
            </div>
          </div>
        </div>

        {/* Footer Audit Details & Signatures */}
        <div className="border-t pt-8 mt-12 font-sans">
          <div className="flex justify-between items-center text-xs text-slate-500 mb-12">
            <div>
              Generated by Sales Monitoring System | Printed By: <span className="font-semibold">{userName}</span>
            </div>
            <div className="text-right">
              Printed On: {currentDate}
            </div>
          </div>

          <div className="flex justify-between text-xs font-semibold text-slate-800">
            <div className="border-t border-slate-400 w-48 text-center pt-2">
              Customer Acceptance / Sign
            </div>
            <div className="border-t border-slate-400 w-48 text-center pt-2">
              For {header.frozen_company_name || "ISSUING COMPANY"}
              <div className="text-[10px] text-slate-400 mt-1 font-normal">(Authorised Signature)</div>
            </div>
          </div>
        </div>

      </div>
    </div>
  );
};
