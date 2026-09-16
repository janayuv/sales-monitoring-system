import React, { useState, useMemo } from "react";
import {
  Search,
  CheckCircle,
  AlertTriangle,
  AlertCircle,
  Eye,
  ArrowUpDown,
  SlidersHorizontal,
  ChevronLeft,
  ChevronRight,
  Info,
} from "lucide-react";
import {
  AuditFilterConfig,
  AuditReconItem,
  AuditStatus,
  AuditSummaryMetrics,
} from "../../types/gstr1AuditTypes";
import { formatAmount, formatDate } from "../../utils/formatters";

interface Props {
  items: AuditReconItem[];
  metrics: AuditSummaryMetrics;
  filterConfig: AuditFilterConfig;
  onFilterChange: (config: AuditFilterConfig) => void;
  onInspectItem: (item: AuditReconItem) => void;
}

export const Gstr1AuditTable: React.FC<Props> = ({
  items,
  metrics,
  filterConfig,
  onFilterChange,
  onInspectItem,
}) => {
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [sortField, setSortField] = useState<string>("status");
  const [sortAsc, setSortAsc] = useState(true);

  // Status Filter options with badge counts
  const filterTabs: Array<{ id: AuditStatus | "ALL"; label: string; count: number; color: string }> = [
    { id: "ALL", label: "All Items", count: metrics.total_records, color: "text-[var(--ember-text-primary)]" },
    { id: "MATCHED", label: "Matched", count: metrics.matched_count, color: "text-emerald-600 dark:text-emerald-400" },
    { id: "VALUE_MISMATCH", label: "Value Mismatch", count: metrics.value_mismatch_count, color: "text-amber-600 dark:text-amber-400" },
    { id: "GST_MISMATCH", label: "GST Tax Mismatch", count: metrics.gst_mismatch_count, color: "text-amber-600 dark:text-amber-400" },
    { id: "BOOKS_ONLY", label: "Books Only", count: metrics.books_only_count, color: "text-blue-600 dark:text-blue-400" },
    { id: "GSTR1_ONLY", label: "GSTR-1 Only", count: metrics.gstr1_only_count, color: "text-purple-600 dark:text-purple-400" },
    { id: "CANCELLED_MISMATCH", label: "Cancelled / Void", count: metrics.cancelled_mismatch_count, color: "text-rose-600 dark:text-rose-400" },
  ];

  // Sorting
  const sortedItems = useMemo(() => {
    return [...items].sort((a, b) => {
      let valA: any = "";
      let valB: any = "";

      if (sortField === "invoice_number") {
        valA = a.normalized_invoice_number;
        valB = b.normalized_invoice_number;
      } else if (sortField === "diff_taxable") {
        valA = Math.abs(a.diff_taxable);
        valB = Math.abs(b.diff_taxable);
      } else if (sortField === "diff_tax") {
        valA = Math.abs(a.diff_tax);
        valB = Math.abs(b.diff_tax);
      } else if (sortField === "date") {
        valA = a.books?.invoice_date || a.gstr1?.invoice_date || "";
        valB = b.books?.invoice_date || b.gstr1?.invoice_date || "";
      } else {
        valA = a.status;
        valB = b.status;
      }

      if (valA < valB) return sortAsc ? -1 : 1;
      if (valA > valB) return sortAsc ? 1 : -1;
      return 0;
    });
  }, [items, sortField, sortAsc]);

  // Pagination
  const totalPages = Math.max(1, Math.ceil(sortedItems.length / pageSize));
  const paginatedItems = useMemo(() => {
    const start = (currentPage - 1) * pageSize;
    return sortedItems.slice(start, start + pageSize);
  }, [sortedItems, currentPage, pageSize]);

  const handleSort = (field: string) => {
    if (sortField === field) {
      setSortAsc(!sortAsc);
    } else {
      setSortField(field);
      setSortAsc(true);
    }
  };

  return (
    <div className="ember-card overflow-hidden flex flex-col">
      {/* Top Filter & Control Bar */}
      <div className="p-4 border-b border-[var(--ember-border)] space-y-3 bg-[var(--ember-surface)]">
        {/* Status Pills */}
        <div className="flex flex-wrap gap-2 items-center">
          {filterTabs.map((tab) => {
            const isActive = filterConfig.selected_status === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => {
                  onFilterChange({ ...filterConfig, selected_status: tab.id });
                  setCurrentPage(1);
                }}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all flex items-center gap-1.5 cursor-pointer select-none ${
                  isActive
                    ? "bg-[var(--ember-primary)] text-white shadow-sm"
                    : "bg-[var(--ember-surface-raised)] hover:bg-[var(--ember-border)] text-[var(--ember-text-secondary)] border border-[var(--ember-border-subtle)]"
                }`}
              >
                <span>{tab.label}</span>
                <span
                  className={`text-[10px] px-1.5 py-0.2 rounded-full font-mono font-bold ${
                    isActive
                      ? "bg-white/20 text-white"
                      : "bg-[var(--ember-border)] text-[var(--ember-text-primary)]"
                  }`}
                >
                  {tab.count}
                </span>
              </button>
            );
          })}
        </div>

        {/* Secondary controls: Search, Tolerance, and options */}
        <div className="flex flex-col sm:flex-row items-center justify-between gap-3 pt-1">
          {/* Search */}
          <div className="relative w-full sm:w-80">
            <Search className="w-4 h-4 absolute left-3 top-2.5 text-[var(--ember-text-muted)]" />
            <input
              type="text"
              placeholder="Search invoice no, party, GSTIN..."
              value={filterConfig.search_query}
              onChange={(e) => {
                onFilterChange({ ...filterConfig, search_query: e.target.value });
                setCurrentPage(1);
              }}
              className="ember-input w-full pl-9 pr-3 py-1.5 text-xs"
            />
          </div>

          {/* Tolerance & Options */}
          <div className="flex items-center gap-3 w-full sm:w-auto justify-end text-xs">
            <div className="flex items-center gap-1.5">
              <SlidersHorizontal className="w-3.5 h-3.5 text-[var(--ember-text-muted)]" />
              <span className="text-[var(--ember-text-secondary)]">Rounding Tolerance:</span>
              <select
                value={filterConfig.tolerance_amount}
                onChange={(e) =>
                  onFilterChange({
                    ...filterConfig,
                    tolerance_amount: parseFloat(e.target.value),
                  })
                }
                className="ember-input px-2.5 py-1 text-xs font-semibold cursor-pointer"
              >
                <option value="0">₹0.00 (Exact)</option>
                <option value="1">± ₹1.00 (Standard)</option>
                <option value="2">± ₹2.00</option>
                <option value="5">± ₹5.00</option>
              </select>
            </div>

            <div className="flex items-center gap-1.5 border-l border-[var(--ember-border)] pl-3">
              <span className="text-[var(--ember-text-secondary)]">Rows:</span>
              <select
                value={pageSize}
                onChange={(e) => {
                  setPageSize(Number(e.target.value));
                  setCurrentPage(1);
                }}
                className="ember-input px-2 py-1 text-xs cursor-pointer"
              >
                <option value="10">10</option>
                <option value="25">25</option>
                <option value="50">50</option>
                <option value="100">100</option>
              </select>
            </div>
          </div>
        </div>
      </div>

      {/* Dual Comparative Audit Table */}
      <div className="overflow-x-auto">
        <table className="w-full text-left text-xs border-collapse min-w-[1100px]">
          <thead>
            {/* Top Multi-Header Band */}
            <tr className="border-b border-[var(--ember-border)] bg-[var(--ember-surface-raised)] text-[10px] uppercase tracking-wider font-bold text-[var(--ember-text-muted)]">
              <th colSpan={3} className="p-3 border-r border-[var(--ember-border)]">
                General Info
              </th>
              <th colSpan={4} className="p-3 border-r border-[var(--ember-border)] bg-blue-500/5 text-blue-700 dark:text-blue-300">
                📘 Internal Books (Outward Register)
              </th>
              <th colSpan={4} className="p-3 border-r border-[var(--ember-border)] bg-purple-500/5 text-purple-700 dark:text-purple-300">
                ⚖️ GSTR-1 Portal Return
              </th>
              <th colSpan={3} className="p-3 bg-amber-500/5 text-amber-700 dark:text-amber-300">
                🔍 Audit Variance & Analysis
              </th>
            </tr>

            {/* Column Headers */}
            <tr className="border-b border-[var(--ember-border)] bg-[var(--ember-surface)] text-[var(--ember-text-secondary)] font-semibold text-[11px]">
              {/* General */}
              <th className="p-3 cursor-pointer select-none" onClick={() => handleSort("status")}>
                <div className="flex items-center gap-1">
                  Status <ArrowUpDown className="w-3 h-3" />
                </div>
              </th>
              <th className="p-3 cursor-pointer select-none" onClick={() => handleSort("invoice_number")}>
                <div className="flex items-center gap-1">
                  Invoice No <ArrowUpDown className="w-3 h-3" />
                </div>
              </th>
              <th className="p-3 border-r border-[var(--ember-border)] cursor-pointer select-none" onClick={() => handleSort("date")}>
                <div className="flex items-center gap-1">
                  Date <ArrowUpDown className="w-3 h-3" />
                </div>
              </th>

              {/* Books */}
              <th className="p-3">Customer / GSTIN</th>
              <th className="p-3 text-right">Taxable (₹)</th>
              <th className="p-3 text-right">Tax (₹)</th>
              <th className="p-3 text-right border-r border-[var(--ember-border)]">Total (₹)</th>

              {/* GSTR-1 */}
              <th className="p-3">Reported Party / GSTIN</th>
              <th className="p-3 text-right">Taxable (₹)</th>
              <th className="p-3 text-right">Tax (₹)</th>
              <th className="p-3 text-right border-r border-[var(--ember-border)]">Total (₹)</th>

              {/* Variances */}
              <th className="p-3 text-right cursor-pointer select-none" onClick={() => handleSort("diff_taxable")}>
                <div className="flex items-center justify-end gap-1">
                  Δ Taxable <ArrowUpDown className="w-3 h-3" />
                </div>
              </th>
              <th className="p-3 text-right cursor-pointer select-none" onClick={() => handleSort("diff_tax")}>
                <div className="flex items-center justify-end gap-1">
                  Δ Tax <ArrowUpDown className="w-3 h-3" />
                </div>
              </th>
              <th className="p-3 text-center">Action</th>
            </tr>
          </thead>

          <tbody className="divide-y divide-[var(--ember-border-subtle)]">
            {paginatedItems.length === 0 ? (
              <tr>
                <td colSpan={14} className="p-12 text-center text-[var(--ember-text-muted)]">
                  <Info className="w-8 h-8 mx-auto mb-2 opacity-50" />
                  <p className="font-semibold text-sm">No reconciliation items found.</p>
                  <p className="text-xs mt-1">Try adjusting the filter tab or clearing your search term.</p>
                </td>
              </tr>
            ) : (
              paginatedItems.map((item) => {
                const isMatched = item.status === "MATCHED";
                const isWarning = item.status === "VALUE_MISMATCH" || item.status === "GST_MISMATCH";
                const isError = item.status === "CANCELLED_MISMATCH" || item.status === "DUPLICATE";
                const isPurple = item.status === "GSTR1_ONLY";
                const isBlue = item.status === "BOOKS_ONLY";

                return (
                  <tr
                    key={item.key}
                    onClick={() => onInspectItem(item)}
                    className={`hover:bg-[var(--ember-surface-raised)] transition-colors cursor-pointer select-none ${
                      isError
                        ? "bg-rose-500/5 hover:bg-rose-500/10"
                        : isWarning
                        ? "bg-amber-500/5 hover:bg-amber-500/10"
                        : isPurple
                        ? "bg-purple-500/5 hover:bg-purple-500/10"
                        : isBlue
                        ? "bg-blue-500/5 hover:bg-blue-500/10"
                        : ""
                    }`}
                  >
                    {/* Status Badge */}
                    <td className="p-3 whitespace-nowrap">
                      <span
                        className={`px-2 py-0.5 rounded-md text-[10px] font-bold inline-flex items-center gap-1 ${
                          isMatched
                            ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border border-emerald-500/30"
                            : isWarning
                            ? "bg-amber-500/15 text-amber-700 dark:text-amber-300 border border-amber-500/30"
                            : isError
                            ? "bg-rose-500/15 text-rose-700 dark:text-rose-300 border border-rose-500/30"
                            : isPurple
                            ? "bg-purple-500/15 text-purple-700 dark:text-purple-300 border border-purple-500/30"
                            : "bg-blue-500/15 text-blue-700 dark:text-blue-300 border border-blue-500/30"
                        }`}
                      >
                        {isMatched ? (
                          <CheckCircle className="w-3 h-3" />
                        ) : isError ? (
                          <AlertCircle className="w-3 h-3" />
                        ) : (
                          <AlertTriangle className="w-3 h-3" />
                        )}
                        {item.status_label}
                      </span>
                    </td>

                    {/* Invoice Number */}
                    <td className="p-3 font-mono font-bold text-[var(--ember-text-primary)]">
                      {item.books?.invoice_number || item.gstr1?.invoice_number}
                      {item.is_auto_populated && (
                        <span className="ml-1.5 px-1 py-0.2 bg-purple-500/20 text-purple-700 dark:text-purple-300 rounded text-[9px] font-sans font-semibold">
                          AUTO
                        </span>
                      )}
                      {item.is_deleted_in_books && (
                        <span className="ml-1.5 px-1 py-0.2 bg-rose-500/20 text-rose-700 dark:text-rose-300 rounded text-[9px] font-sans font-semibold">
                          VOID IN BOOKS
                        </span>
                      )}
                    </td>

                    {/* Date */}
                    <td className="p-3 font-mono text-[var(--ember-text-secondary)] border-r border-[var(--ember-border)] whitespace-nowrap">
                      {formatDate(item.books?.invoice_date || item.gstr1?.invoice_date)}
                    </td>

                    {/* Books Columns */}
                    <td className="p-3 max-w-[160px] truncate" title={item.books?.customer_name}>
                      {item.books ? (
                        <div>
                          <div className="font-semibold text-[var(--ember-text-primary)] truncate">
                            {item.books.customer_name || "-"}
                          </div>
                          <div className="font-mono text-[10px] text-[var(--ember-text-muted)]">
                            {item.books.customer_gstin || "Unregistered"}
                          </div>
                        </div>
                      ) : (
                        <span className="text-[var(--ember-text-muted)] italic">Not in Books</span>
                      )}
                    </td>
                    <td className="p-3 text-right font-mono text-[var(--ember-text-primary)]">
                      {item.books ? formatAmount(item.books.taxable_value) : "-"}
                    </td>
                    <td className="p-3 text-right font-mono text-[var(--ember-text-primary)]">
                      {item.books ? formatAmount(item.books.total_tax) : "-"}
                    </td>
                    <td className="p-3 text-right font-mono font-semibold text-[var(--ember-text-primary)] border-r border-[var(--ember-border)]">
                      {item.books ? formatAmount(item.books.total_value) : "-"}
                    </td>

                    {/* GSTR-1 Columns */}
                    <td className="p-3 max-w-[160px] truncate" title={item.gstr1?.customer_name}>
                      {item.gstr1 ? (
                        <div>
                          <div className="font-semibold text-[var(--ember-text-primary)] truncate">
                            {item.gstr1.customer_name || item.gstr1.customer_gstin || "-"}
                          </div>
                          <div className="font-mono text-[10px] text-[var(--ember-text-muted)]">
                            {item.gstr1.customer_gstin || "B2C / Cash"}
                          </div>
                        </div>
                      ) : (
                        <span className="text-amber-600 dark:text-amber-400 italic">Not in GSTR-1</span>
                      )}
                    </td>
                    <td className="p-3 text-right font-mono text-[var(--ember-text-primary)]">
                      {item.gstr1 ? formatAmount(item.gstr1.taxable_value) : "-"}
                    </td>
                    <td className="p-3 text-right font-mono text-[var(--ember-text-primary)]">
                      {item.gstr1 ? formatAmount(item.gstr1.total_tax) : "-"}
                    </td>
                    <td className="p-3 text-right font-mono font-semibold text-[var(--ember-text-primary)] border-r border-[var(--ember-border)]">
                      {item.gstr1 ? formatAmount(item.gstr1.total_value) : "-"}
                    </td>

                    {/* Variances */}
                    <td className="p-3 text-right font-mono">
                      <span
                        className={
                          item.diff_taxable === 0
                            ? "text-emerald-600 dark:text-emerald-400"
                            : "text-rose-600 dark:text-rose-400 font-bold"
                        }
                      >
                        {item.diff_taxable > 0 ? "+" : ""}
                        {formatAmount(item.diff_taxable)}
                      </span>
                    </td>
                    <td className="p-3 text-right font-mono">
                      <span
                        className={
                          item.diff_tax === 0
                            ? "text-emerald-600 dark:text-emerald-400"
                            : "text-rose-600 dark:text-rose-400 font-bold"
                        }
                      >
                        {item.diff_tax > 0 ? "+" : ""}
                        {formatAmount(item.diff_tax)}
                      </span>
                    </td>

                    {/* Action */}
                    <td className="p-3 text-center">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          onInspectItem(item);
                        }}
                        className="p-1 hover:bg-[var(--ember-border)] rounded text-[var(--ember-primary)] cursor-pointer transition-colors"
                        title="View Detailed Discrepancy Sheet"
                      >
                        <Eye className="w-4 h-4" />
                      </button>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination & Footer summary */}
      <div className="p-4 border-t border-[var(--ember-border)] flex flex-col sm:flex-row items-center justify-between gap-3 text-xs bg-[var(--ember-surface)]">
        <div className="text-[var(--ember-text-muted)] font-mono">
          Showing {paginatedItems.length > 0 ? (currentPage - 1) * pageSize + 1 : 0} to{" "}
          {Math.min(currentPage * pageSize, sortedItems.length)} of {sortedItems.length} records
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
            disabled={currentPage === 1}
            className="p-1.5 rounded border border-[var(--ember-border)] hover:bg-[var(--ember-surface-raised)] disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer transition-colors"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
          <span className="px-3 py-1 font-mono font-semibold text-[var(--ember-text-primary)]">
            Page {currentPage} of {totalPages}
          </span>
          <button
            onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
            disabled={currentPage === totalPages}
            className="p-1.5 rounded border border-[var(--ember-border)] hover:bg-[var(--ember-surface-raised)] disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer transition-colors"
          >
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
};
