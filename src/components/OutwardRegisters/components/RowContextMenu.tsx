import React from "react";
import { ContextMenuState } from "../types/register";
import { Eye, Copy, Building, FileDown } from "lucide-react";
import { downloadCSV, generateCSVContent } from "../utils/csvUtils";

interface Props {
  contextMenu: ContextMenuState;
  onClose: () => void;
  onInspect: (invoiceNumber: string) => void;
}

export const RowContextMenu: React.FC<Props> = ({
  contextMenu,
  onClose,
  onInspect,
}) => {
  if (!contextMenu.visible || !contextMenu.invoice) return null;

  const inv = contextMenu.invoice;

  const handleCopyInvoiceNumber = () => {
    navigator.clipboard.writeText(inv.invoice_number);
    onClose();
  };

  const handleCopyCustomer = () => {
    navigator.clipboard.writeText(`${inv.customer_name} (${inv.customer_code})`);
    onClose();
  };

  const handleExportRow = () => {
    const csvContent = generateCSVContent([inv]);
    downloadCSV(`Invoice_${inv.invoice_number}.csv`, csvContent);
    onClose();
  };

  return (
    <>
      <div className="fixed inset-0 z-40" onClick={onClose} onContextMenu={(e) => { e.preventDefault(); onClose(); }} />
      <div
        style={{ top: `${contextMenu.y}px`, left: `${contextMenu.x}px` }}
        className="fixed z-50 w-52 rounded-xl border border-[var(--ember-border)] bg-[var(--ember-surface)] shadow-2xl p-1.5 text-xs animate-in fade-in zoom-in-95 duration-100"
      >
        <div className="px-2.5 py-1.5 border-b border-[var(--ember-border-subtle)] font-mono font-bold text-[var(--ember-primary)] truncate">
          Invoice #{inv.invoice_number}
        </div>

        <div className="space-y-0.5 mt-1">
          <button
            onClick={() => {
              onInspect(inv.invoice_number);
              onClose();
            }}
            className="w-full text-left px-2.5 py-2 rounded-lg hover:bg-[var(--ember-surface-raised)] flex items-center gap-2 text-[var(--ember-text-primary)] font-medium"
          >
            <Eye className="w-4 h-4 text-emerald-500" />
            <span>Inspect Invoice Details</span>
          </button>

          <button
            onClick={handleCopyInvoiceNumber}
            className="w-full text-left px-2.5 py-2 rounded-lg hover:bg-[var(--ember-surface-raised)] flex items-center gap-2 text-[var(--ember-text-primary)] font-medium"
          >
            <Copy className="w-4 h-4 text-sky-500" />
            <span>Copy Invoice Number</span>
          </button>

          <button
            onClick={handleCopyCustomer}
            className="w-full text-left px-2.5 py-2 rounded-lg hover:bg-[var(--ember-surface-raised)] flex items-center gap-2 text-[var(--ember-text-primary)] font-medium"
          >
            <Building className="w-4 h-4 text-amber-500" />
            <span>Copy Customer Details</span>
          </button>

          <button
            onClick={handleExportRow}
            className="w-full text-left px-2.5 py-2 rounded-lg hover:bg-[var(--ember-surface-raised)] flex items-center gap-2 text-[var(--ember-text-primary)] font-medium"
          >
            <FileDown className="w-4 h-4 text-purple-500" />
            <span>Export Selected Row</span>
          </button>
        </div>
      </div>
    </>
  );
};
