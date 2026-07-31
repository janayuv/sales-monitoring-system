import React from "react";
import { ContextMenuState } from "../types/register";
import { Eye, Edit2, Copy, Building, FileDown, CheckCircle2 } from "lucide-react";
import { downloadCSV, generateCSVContent } from "../utils/csvUtils";

interface Props {
  contextMenu: ContextMenuState;
  onClose: () => void;
  onInspect: (invoiceNumber: string) => void;
  onEdit?: (invoiceNumber: string) => void;
  onQuickVerify?: (invoiceNumber: string) => void;
}

export const RowContextMenu: React.FC<Props> = ({
  contextMenu,
  onClose,
  onInspect,
  onEdit,
  onQuickVerify,
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

  const isVerifiable = inv.status === "Imported" || inv.status === "Draft";

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
          {onEdit && (
            <button
              onClick={() => {
                onEdit(inv.invoice_number);
                onClose();
              }}
              className="w-full text-left px-2.5 py-2 rounded-lg hover:bg-[var(--ember-surface-raised)] flex items-center gap-2 text-[var(--ember-primary)] font-medium cursor-pointer"
            >
              <Edit2 className="w-4 h-4 text-[var(--ember-primary)]" />
              <span>Edit Invoice Fields</span>
            </button>
          )}

          <button
            onClick={() => {
              onInspect(inv.invoice_number);
              onClose();
            }}
            className="w-full text-left px-2.5 py-2 rounded-lg hover:bg-[var(--ember-surface-raised)] flex items-center gap-2 text-[var(--ember-text-primary)] font-medium cursor-pointer"
          >
            <Eye className="w-4 h-4 text-emerald-500" />
            <span>Inspect Invoice Details</span>
          </button>

          {isVerifiable && onQuickVerify && (
            <button
              onClick={() => {
                onQuickVerify(inv.invoice_number);
                onClose();
              }}
              className="w-full text-left px-2.5 py-2 rounded-lg hover:bg-[var(--ember-surface-raised)] flex items-center gap-2 text-emerald-400 font-medium cursor-pointer"
            >
              <CheckCircle2 className="w-4 h-4 text-emerald-400" />
              <span>Mark as Verified</span>
            </button>
          )}

          <button
            onClick={handleCopyInvoiceNumber}
            className="w-full text-left px-2.5 py-2 rounded-lg hover:bg-[var(--ember-surface-raised)] flex items-center gap-2 text-[var(--ember-text-primary)] font-medium cursor-pointer"
          >
            <Copy className="w-4 h-4 text-sky-500" />
            <span>Copy Invoice Number</span>
          </button>

          <button
            onClick={handleCopyCustomer}
            className="w-full text-left px-2.5 py-2 rounded-lg hover:bg-[var(--ember-surface-raised)] flex items-center gap-2 text-[var(--ember-text-primary)] font-medium cursor-pointer"
          >
            <Building className="w-4 h-4 text-amber-500" />
            <span>Copy Customer Details</span>
          </button>

          <button
            onClick={handleExportRow}
            className="w-full text-left px-2.5 py-2 rounded-lg hover:bg-[var(--ember-surface-raised)] flex items-center gap-2 text-[var(--ember-text-primary)] font-medium cursor-pointer"
          >
            <FileDown className="w-4 h-4 text-purple-500" />
            <span>Export Selected Row</span>
          </button>
        </div>
      </div>
    </>
  );
};
