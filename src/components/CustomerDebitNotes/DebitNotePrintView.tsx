import React from "react";

interface DebitNotePrintViewProps {
  header: any;
  items: any[];
  onClose: () => void;
}

export const DebitNotePrintView: React.FC<DebitNotePrintViewProps> = ({ header, items, onClose }) => {
  return (
    <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-sm overflow-y-auto p-4 flex justify-center">
      <div className="bg-white text-slate-900 w-full max-w-4xl p-8 rounded-lg shadow-2xl font-serif text-sm print:p-0 print:shadow-none">
        {/* Action bar */}
        <div className="flex justify-between items-center pb-6 mb-6 border-b border-slate-200 print:hidden font-sans">
          <h2 className="text-lg font-bold text-slate-800">Print Preview (Debit Note & Annexure CDN-A)</h2>
          <div className="flex gap-2">
            <button
              onClick={() => window.print()}
              className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg font-bold text-sm"
            >
              Print Document
            </button>
            <button
              onClick={onClose}
              className="px-4 py-2 bg-slate-200 hover:bg-slate-300 text-slate-800 rounded-lg text-sm"
            >
              Close
            </button>
          </div>
        </div>

        {/* Voucher Document */}
        <div className="space-y-6">
          <div className="text-center border-b pb-4">
            <h1 className="text-2xl font-bold uppercase tracking-wider text-slate-900">DEBIT NOTE</h1>
            <p className="text-xs text-slate-500 font-sans mt-1">
              (Issued under Retrospective Price Revision Regulations / GST Rules)
            </p>
          </div>

          <div className="grid grid-cols-2 gap-4 text-xs font-sans">
            <div className="border p-3 rounded space-y-1">
              <div className="font-bold text-slate-700 uppercase">Customer Details:</div>
              <div className="font-bold text-sm text-slate-900">{header.frozen_customer_name}</div>
              <div>GSTIN: {header.frozen_customer_gstin || "N/A"}</div>
              <div>Address: {header.frozen_customer_address || "N/A"}</div>
              <div>State: {header.frozen_customer_state || "N/A"}</div>
            </div>

            <div className="border p-3 rounded space-y-1 text-right">
              <div><span className="font-bold">Debit Note No:</span> {header.debit_note_no}</div>
              <div><span className="font-bold">Annexure No:</span> {header.annexure_no}</div>
              <div><span className="font-bold">Date:</span> {header.debit_note_date}</div>
              <div><span className="font-bold">Ref PO/Letter:</span> {header.reference || "N/A"}</div>
              <div><span className="font-bold">Currency:</span> {header.currency} ({header.exchange_rate})</div>
            </div>
          </div>

          {/* Line items summary */}
          <table className="w-full text-left text-xs border border-collapse">
            <thead>
              <tr className="bg-slate-100 uppercase text-slate-700">
                <th className="border p-2">#</th>
                <th className="border p-2">Particulars / Part Code</th>
                <th className="border p-2 text-right">Recovered Qty</th>
                <th className="border p-2 text-right">Price Diff (₹)</th>
                <th className="border p-2 text-right">Taxable Diff (₹)</th>
              </tr>
            </thead>
            <tbody>
              {items.map((line, idx) => (
                <tr key={idx}>
                  <td className="border p-2">{idx + 1}</td>
                  <td className="border p-2 font-mono font-bold">{line.part_code} - {line.frozen_part_description}</td>
                  <td className="border p-2 text-right">{line.recovered_qty}</td>
                  <td className="border p-2 text-right">₹{line.difference.toFixed(2)}</td>
                  <td className="border p-2 text-right font-bold">₹{line.assessable_difference.toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table>

          {/* Tax Breakdown */}
          <div className="flex justify-end font-sans">
            <div className="w-64 border rounded p-3 text-xs space-y-1.5">
              <div className="flex justify-between"><span>Taxable Amount:</span> <span>₹{header.total_taxable.toFixed(2)}</span></div>
              <div className="flex justify-between"><span>CGST:</span> <span>₹{header.total_cgst.toFixed(2)}</span></div>
              <div className="flex justify-between"><span>SGST:</span> <span>₹{header.total_sgst.toFixed(2)}</span></div>
              <div className="flex justify-between"><span>IGST:</span> <span>₹{header.total_igst.toFixed(2)}</span></div>
              <div className="flex justify-between font-bold border-t pt-1.5 text-sm text-indigo-900">
                <span>Grand Total:</span> <span>₹{header.total_value.toFixed(2)}</span>
              </div>
            </div>
          </div>

          <div className="pt-12 flex justify-between text-xs font-sans border-t">
            <div>Receiver's Signature</div>
            <div>Authorised Signatory</div>
          </div>
        </div>
      </div>
    </div>
  );
};
