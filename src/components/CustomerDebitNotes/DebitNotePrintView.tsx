import React from "react";
import { Printer, X, FileText } from "lucide-react";

interface DebitNotePrintViewProps {
  header: any;
  items: any[];
  onClose: () => void;
  userName?: string;
}

export const DebitNotePrintView: React.FC<DebitNotePrintViewProps> = ({
  header,
  items,
  onClose,
  userName = "System User",
}) => {
  if (!header) return null;

  const handlePrint = () => {
    window.print();
  };

  // Determine watermark text based on debit note status
  let watermarkText = "";
  const status = (header.status || "DRAFT").toUpperCase();
  if (status === "CANCELLED") {
    watermarkText = "CANCELLED";
  } else if (status === "DRAFT") {
    watermarkText = "DRAFT";
  } else if (status === "APPROVED" || status === "LOCKED") {
    watermarkText = "APPROVED";
  } else if (status === "POSTED" || status === "VERIFIED") {
    watermarkText = status;
  }

  const currentDate = new Date().toLocaleString();

  // Calculate totals if missing from header
  const totalTaxable = header.total_taxable ?? (items || []).reduce((acc, item) => acc + (item.assessable_difference || item.total_difference || item.difference || 0), 0);
  const totalCgst = header.total_cgst ?? 0;
  const totalSgst = header.total_sgst ?? 0;
  const totalIgst = header.total_igst ?? 0;
  const totalValue = header.total_value ?? (totalTaxable + totalCgst + totalSgst + totalIgst);

  return (
    <div className="fixed inset-0 z-50 bg-slate-950/85 backdrop-blur-md overflow-y-auto p-4 sm:p-6 flex justify-center items-start pt-6 sm:pt-10 print:p-0 print:bg-white print:backdrop-blur-none print:static print:inset-auto">
      {/* Outer Card Container */}
      <div className="relative bg-[var(--ember-surface)] text-[var(--ember-text-primary)] w-full max-w-4xl p-6 sm:p-10 rounded-2xl shadow-2xl font-sans text-sm print:p-0 print:shadow-none print:rounded-none my-auto border border-[var(--ember-border)] print:border-none print:bg-white print:text-black">
        
        {/* Watermark styling */}
        {watermarkText && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none select-none opacity-[0.05] overflow-hidden print:opacity-[0.08]">
            <div className="text-[100px] sm:text-[120px] font-sans font-black tracking-widest uppercase rotate-[-30deg] text-[var(--ember-primary)] whitespace-nowrap">
              {watermarkText}
            </div>
          </div>
        )}

        {/* Action bar (hidden when printing) */}
        <div className="flex flex-wrap justify-between items-center pb-5 mb-6 border-b border-[var(--ember-border)] print:hidden font-sans gap-4">
          <div className="flex items-center gap-3">
            <div className="p-2.5 bg-[var(--ember-primary-light)] text-[var(--ember-primary)] rounded-xl">
              <FileText className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-lg font-bold font-serif text-[var(--ember-text-primary)] flex items-center gap-2">
                Debit Note & Annexure Voucher
              </h2>
              <p className="text-xs text-[var(--ember-text-muted)] font-sans">
                Ref: <span className="font-mono font-semibold text-[var(--ember-primary)]">{header.debit_note_no || "N/A"}</span> | Status:{" "}
                <span className={`font-bold uppercase px-2 py-0.5 rounded text-[10px] ${
                  status === "APPROVED" || status === "LOCKED" ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border border-emerald-500/30" :
                  status === "CANCELLED" ? "bg-rose-500/15 text-rose-700 dark:text-rose-300 border border-rose-500/30" : "bg-amber-500/15 text-amber-700 dark:text-amber-300 border border-amber-500/30"
                }`}>
                  {status}
                </span>
              </p>
            </div>
          </div>
          
          <div className="flex items-center gap-2">
            <button
              onClick={handlePrint}
              className="px-4 py-2 bg-[var(--ember-primary)] hover:bg-[var(--ember-primary-hover)] text-white rounded-xl font-bold text-xs shadow-md transition-all active:scale-[0.98] flex items-center gap-1.5 cursor-pointer"
            >
              <Printer className="w-4 h-4" /> Print / Save PDF
            </button>
            <button
              onClick={onClose}
              className="p-2 bg-[var(--ember-surface-raised)] hover:bg-[var(--ember-border-subtle)] text-[var(--ember-text-secondary)] hover:text-[var(--ember-text-primary)] rounded-xl text-xs transition-all cursor-pointer border border-[var(--ember-border)]"
              title="Close modal"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Document Header Section */}
        <div className="space-y-6">
          <div className="flex justify-between items-start border-b border-[var(--ember-border)] pb-5 print:border-slate-300">
            <div className="space-y-1">
              <h1 className="text-xl font-bold uppercase tracking-wider text-[var(--ember-text-primary)] font-serif print:text-black">
                {header.frozen_company_name || "ISSUING COMPANY"}
              </h1>
              <p className="text-xs text-[var(--ember-text-muted)] font-sans leading-relaxed max-w-md print:text-slate-600">
                {header.frozen_company_address || "Retrospective Price Revision Recovery System"}
              </p>
              {(header.frozen_company_gstin || header.frozen_company_pan) && (
                <div className="text-xs text-[var(--ember-text-secondary)] font-sans space-y-0.5 pt-1 print:text-slate-700">
                  {header.frozen_company_gstin && <div><span className="font-bold">GSTIN:</span> {header.frozen_company_gstin}</div>}
                  {header.frozen_company_pan && <div><span className="font-bold">PAN:</span> {header.frozen_company_pan}</div>}
                </div>
              )}
            </div>

            <div className="text-right space-y-1 font-sans">
              <div className="text-2xl font-black uppercase tracking-widest text-[var(--ember-primary)] font-serif print:text-black">DEBIT NOTE</div>
              <p className="text-[11px] text-[var(--ember-text-muted)] italic print:text-slate-500">
                (Issued under Price Revision / GST Regulations)
              </p>
              <div className="text-xs text-[var(--ember-text-primary)] space-y-1 pt-3 print:text-black">
                <div><span className="font-bold text-[var(--ember-text-secondary)]">Debit Note No:</span> <span className="font-mono font-bold text-[var(--ember-primary)]">{header.debit_note_no}</span></div>
                <div><span className="font-bold text-[var(--ember-text-secondary)]">Annexure No:</span> <span className="font-mono">{header.annexure_no}</span></div>
                <div><span className="font-bold text-[var(--ember-text-secondary)]">Date:</span> {header.debit_note_date}</div>
              </div>
            </div>
          </div>

          {/* Customer & Document Details Grid */}
          <div className="grid grid-cols-2 gap-4 text-xs font-sans">
            <div className="border border-[var(--ember-border)] bg-[var(--ember-bg)] p-4 rounded-xl space-y-1 print:border-slate-300 print:bg-slate-50">
              <div className="font-bold uppercase tracking-wider text-[11px] mb-1 text-[var(--ember-primary)] font-serif">Billed To (Customer):</div>
              <div className="font-bold text-sm text-[var(--ember-text-primary)] print:text-black">{header.frozen_customer_name}</div>
              <div className="text-[var(--ember-text-secondary)] print:text-slate-600"><span className="font-semibold text-[var(--ember-text-primary)]">GSTIN:</span> {header.frozen_customer_gstin || "N/A"}</div>
              <div className="text-[var(--ember-text-secondary)] print:text-slate-600"><span className="font-semibold text-[var(--ember-text-primary)]">Address:</span> {header.frozen_customer_address || "N/A"}</div>
              <div className="text-[var(--ember-text-secondary)] print:text-slate-600"><span className="font-semibold text-[var(--ember-text-primary)]">State:</span> {header.frozen_customer_state || "N/A"}</div>
            </div>

            <div className="border border-[var(--ember-border)] bg-[var(--ember-bg)] p-4 rounded-xl space-y-1 text-right font-sans print:border-slate-300 print:bg-slate-50">
              <div className="font-bold uppercase tracking-wider text-[11px] mb-1 text-[var(--ember-primary)] text-left font-serif">Voucher Details:</div>
              <div><span className="font-semibold text-[var(--ember-text-secondary)]">Ref PO/Letter:</span> {header.reference || "N/A"}</div>
              <div><span className="font-semibold text-[var(--ember-text-secondary)]">Currency:</span> {header.currency || "INR"} ({header.exchange_rate ?? 1.0})</div>
              <div><span className="font-semibold text-[var(--ember-text-secondary)]">Total Items:</span> {items?.length || 0}</div>
              <div><span className="font-semibold text-[var(--ember-text-secondary)]">Status:</span> <span className="font-bold text-[var(--ember-primary)]">{status}</span></div>
            </div>
          </div>

          {/* Line Items Table */}
          <div className="overflow-x-auto border border-[var(--ember-border)] rounded-xl bg-[var(--ember-bg)] print:border-slate-300 print:bg-transparent">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="bg-[var(--ember-surface-raised)] uppercase text-[var(--ember-text-secondary)] font-sans border-b border-[var(--ember-border)] print:bg-slate-100 print:border-slate-300 print:text-slate-700">
                  <th className="p-2.5 text-center w-10">#</th>
                  <th className="p-2.5">Particulars / Part Code</th>
                  <th className="p-2.5 text-right">Recovered Qty</th>
                  <th className="p-2.5 text-right">Price Diff (₹)</th>
                  <th className="p-2.5 text-right font-bold">Taxable Diff (₹)</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--ember-border-subtle)] print:divide-slate-200">
                {items && items.length > 0 ? (
                  items.map((line, idx) => (
                    <tr key={idx} className="hover:bg-[var(--ember-surface-raised)]/40 font-sans transition-colors">
                      <td className="p-2 text-center text-[var(--ember-text-muted)] font-mono">{idx + 1}</td>
                      <td className="p-2 font-mono">
                        <span className="font-bold text-[var(--ember-primary)] print:text-black">{line.part_code}</span>
                        {line.frozen_part_description && (
                          <span className="text-[var(--ember-text-muted)] font-sans ml-2 print:text-slate-600">- {line.frozen_part_description}</span>
                        )}
                        {line.invoice_number && (
                          <div className="text-[10px] text-[var(--ember-text-muted)] font-mono mt-0.5">Inv #: {line.invoice_number}</div>
                        )}
                      </td>
                      <td className="p-2 text-right font-mono font-semibold text-[var(--ember-text-primary)] print:text-black">
                        {line.recovered_qty ?? line.quantity ?? 0}
                      </td>
                      <td className="p-2 text-right font-mono text-[var(--ember-text-secondary)] print:text-slate-700">
                        ₹{(line.difference ?? line.total_difference ?? 0).toFixed(2)}
                      </td>
                      <td className="p-2 text-right font-mono font-bold text-emerald-600 dark:text-emerald-400 print:text-black">
                        ₹{(line.assessable_difference ?? line.total_difference ?? line.difference ?? 0).toFixed(2)}
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={5} className="p-6 text-center text-[var(--ember-text-muted)] italic">
                      No line items attached to this debit note.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {/* Tax Breakdown & Totals */}
          <div className="flex justify-end font-sans pt-2">
            <div className="w-80 bg-[var(--ember-bg)] border border-[var(--ember-border)] rounded-xl p-4 text-xs space-y-2 print:border-slate-300 print:bg-slate-50">
              <div className="flex justify-between text-[var(--ember-text-secondary)]">
                <span>Taxable Assessable Amount:</span>
                <span className="font-mono font-semibold text-[var(--ember-text-primary)]">₹{Number(totalTaxable).toFixed(2)}</span>
              </div>
              {totalCgst > 0 && (
                <div className="flex justify-between text-[var(--ember-text-muted)]">
                  <span>CGST:</span>
                  <span className="font-mono">₹{Number(totalCgst).toFixed(2)}</span>
                </div>
              )}
              {totalSgst > 0 && (
                <div className="flex justify-between text-[var(--ember-text-muted)]">
                  <span>SGST:</span>
                  <span className="font-mono">₹{Number(totalSgst).toFixed(2)}</span>
                </div>
              )}
              {totalIgst > 0 && (
                <div className="flex justify-between text-[var(--ember-text-muted)]">
                  <span>IGST:</span>
                  <span className="font-mono">₹{Number(totalIgst).toFixed(2)}</span>
                </div>
              )}
              <div className="flex justify-between font-bold border-t border-[var(--ember-border)] pt-2 text-sm text-[var(--ember-primary)] print:border-slate-300 print:text-black">
                <span>Grand Total Recoverable:</span>
                <span className="font-mono font-black text-emerald-600 dark:text-emerald-400 print:text-black">₹{Number(totalValue).toFixed(2)}</span>
              </div>
            </div>
          </div>

          {/* Footer Signatures */}
          <div className="pt-10 border-t border-[var(--ember-border)] font-sans print:border-slate-300">
            <div className="flex justify-between items-center text-[11px] text-[var(--ember-text-muted)] mb-10">
              <div>
                Generated by Sales Monitoring System | User: <span className="font-medium text-[var(--ember-text-primary)]">{userName}</span>
              </div>
              <div>
                Printed: {currentDate}
              </div>
            </div>

            <div className="flex justify-between text-xs font-semibold text-[var(--ember-text-primary)] print:text-black">
              <div className="border-t border-[var(--ember-border)] w-48 text-center pt-2 print:border-slate-400">
                Receiver's Signature
              </div>
              <div className="border-t border-[var(--ember-border)] w-48 text-center pt-2 print:border-slate-400">
                Authorised Signatory
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

