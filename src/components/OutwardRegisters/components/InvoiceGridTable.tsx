import React from "react";
import { InvoiceSummary } from "../../../types";
import { SortConfig, TableDensity } from "../types/register";
import { REGISTER_COLUMNS } from "../constants/columns";
import { STATUS_STYLES } from "../constants/statusColors";
import { formatINR } from "../utils/formatCurrency";
import { ArrowUp, ArrowDown, ArrowUpDown, Eye } from "lucide-react";

interface Props {
  invoices: InvoiceSummary[];
  loading: boolean;
  visibleColumns: string[];
  density: TableDensity;
  sortConfig: SortConfig;
  onSort: (col: keyof InvoiceSummary) => void;
  onOpenDetails: (invoiceNumber: string) => void;
  onContextMenu: (e: React.MouseEvent, invoice: InvoiceSummary) => void;
}

export const InvoiceGridTable: React.FC<Props> = ({
  invoices,
  loading,
  visibleColumns,
  density,
  sortConfig,
  onSort,
  onOpenDetails,
  onContextMenu,
}) => {
  const isColVisible = (id: string) => visibleColumns.includes(id);

  const rowPaddingClass = density === "compact" ? "py-2 px-3" : "py-3.5 px-4";

  return (
    <div className="ember-card overflow-hidden relative flex-1 flex flex-col">
      <div className="overflow-x-auto max-h-[600px] overflow-y-auto relative">
        <table className="w-full text-left border-collapse text-xs">
          {/* Sticky Table Header */}
          <thead className="sticky top-0 z-10 bg-[var(--ember-surface-raised)] border-b border-[var(--ember-border)] shadow-sm">
            <tr className="text-[var(--ember-text-secondary)] font-bold select-none uppercase tracking-wider text-[11px]">
              {REGISTER_COLUMNS.map((col) => {
                if (!isColVisible(col.id)) return null;

                const isSortedColumn = sortConfig.column === col.id;
                const isSortable = col.sortable;

                return (
                  <th
                    key={col.id}
                    onClick={() => {
                      if (isSortable && col.id !== "actions") {
                        onSort(col.id as keyof InvoiceSummary);
                      }
                    }}
                    className={`${rowPaddingClass} ${
                      col.align === "right"
                        ? "text-right"
                        : col.align === "center"
                        ? "text-center"
                        : "text-left"
                    } ${
                      isSortable ? "cursor-pointer hover:bg-[var(--ember-surface)] transition-colors" : ""
                    } ${col.pinned ? "sticky left-0 bg-[var(--ember-surface-raised)] z-20" : ""}`}
                  >
                    <div
                      className={`inline-flex items-center gap-1.5 ${
                        col.align === "right" ? "justify-end" : col.align === "center" ? "justify-center" : "justify-start"
                      }`}
                    >
                      <span>{col.label}</span>
                      {isSortable && (
                        <span className="text-[var(--ember-primary)]">
                          {isSortedColumn ? (
                            sortConfig.direction === "asc" ? (
                              <ArrowUp className="w-3.5 h-3.5" />
                            ) : (
                              <ArrowDown className="w-3.5 h-3.5" />
                            )
                          ) : (
                            <ArrowUpDown className="w-3 h-3 text-[var(--ember-text-muted)] opacity-60 hover:opacity-100" />
                          )}
                        </span>
                      )}
                    </div>
                  </th>
                );
              })}
            </tr>
          </thead>

          <tbody className="divide-y divide-[var(--ember-border-subtle)] font-sans">
            {loading ? (
              // Skeleton Loading Shimmer Rows
              Array.from({ length: 8 }).map((_, i) => (
                <tr key={i} className="animate-pulse">
                  {REGISTER_COLUMNS.map((col) => {
                    if (!isColVisible(col.id)) return null;
                    return (
                      <td key={col.id} className={rowPaddingClass}>
                        <div className="h-4 bg-[var(--ember-surface-raised)] rounded w-3/4 animate-pulse" />
                      </td>
                    );
                  })}
                </tr>
              ))
            ) : invoices.length === 0 ? (
              <tr>
                <td
                  colSpan={visibleColumns.length}
                  className="p-16 text-center text-[var(--ember-text-muted)]"
                >
                  <div className="max-w-xs mx-auto">
                    <p className="text-sm font-semibold text-[var(--ember-text-secondary)] mb-1">
                      No matching sales invoices found
                    </p>
                    <p className="text-xs">
                      Try adjusting your search criteria, clearing active filters, or selecting a different date range.
                    </p>
                  </div>
                </td>
              </tr>
            ) : (
              invoices.map((inv) => {
                const statusStyle = STATUS_STYLES[inv.status as keyof typeof STATUS_STYLES] || STATUS_STYLES.ALL;

                return (
                  <tr
                    key={inv.invoice_number}
                    onDoubleClick={() => onOpenDetails(inv.invoice_number)}
                    onContextMenu={(e) => onContextMenu(e, inv)}
                    className="hover:bg-[var(--ember-surface-raised)]/80 transition-colors cursor-pointer select-none group"
                  >
                    {/* Invoice Number */}
                    {isColVisible("invoice_number") && (
                      <td className={`${rowPaddingClass} font-mono font-bold text-[var(--ember-primary)]`}>
                        {inv.invoice_number}
                      </td>
                    )}

                    {/* Invoice Date */}
                    {isColVisible("invoice_date") && (
                      <td className={`${rowPaddingClass} font-medium text-[var(--ember-text-secondary)] font-mono`}>
                        {inv.invoice_date}
                      </td>
                    )}

                    {/* Customer Details */}
                    {isColVisible("customer_name") && (
                      <td className={rowPaddingClass}>
                        <div className="font-semibold text-[var(--ember-text-primary)] group-hover:text-[var(--ember-primary)] transition-colors">
                          {inv.customer_name}
                        </div>
                        <div className="text-[10px] text-[var(--ember-text-muted)] mt-0.5 font-mono">
                          {inv.customer_code}
                        </div>
                      </td>
                    )}

                    {/* Taxable Amount */}
                    {isColVisible("total_taxable") && (
                      <td className={`${rowPaddingClass} text-right font-mono font-medium text-[var(--ember-text-primary)]`}>
                        {formatINR(inv.total_taxable)}
                      </td>
                    )}

                    {/* Tax Amount */}
                    {isColVisible("total_tax") && (
                      <td className={`${rowPaddingClass} text-right font-mono text-[var(--ember-text-secondary)]`}>
                        {formatINR(inv.total_tax)}
                      </td>
                    )}

                    {/* Total Value */}
                    {isColVisible("total_value") && (
                      <td className={`${rowPaddingClass} text-right font-mono font-bold text-[var(--ember-primary)]`}>
                        {formatINR(inv.total_value)}
                      </td>
                    )}

                    {/* Status Badge */}
                    {isColVisible("status") && (
                      <td className={`${rowPaddingClass} text-center`}>
                        <span className={`px-2.5 py-1 rounded-full text-[11px] font-semibold inline-flex items-center gap-1.5 ${statusStyle.badgeClass}`}>
                          <span className={`w-1.5 h-1.5 rounded-full ${statusStyle.dotColor}`} />
                          {inv.status}
                        </span>
                      </td>
                    )}

                    {/* Actions Button */}
                    {isColVisible("actions") && (
                      <td className={`${rowPaddingClass} text-center`}>
                        <button
                          onClick={() => onOpenDetails(inv.invoice_number)}
                          className="px-2 py-1 hover:bg-[var(--ember-surface)] text-[var(--ember-text-secondary)] hover:text-[var(--ember-primary)] rounded-md transition-colors inline-flex items-center gap-1 font-medium text-[11px] border border-transparent hover:border-[var(--ember-border)]"
                          title="Inspect Invoice Details"
                        >
                          <Eye className="w-3.5 h-3.5" /> inspect
                        </button>
                      </td>
                    )}
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};
