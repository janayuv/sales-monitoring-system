import React, { useState, useEffect, useMemo } from "react";
import {
  FolderTree,
  Download,
  Printer,
  Copy,
  RefreshCw,
  Search,
  ChevronRight,
  ArrowLeft,
  Info,
  TrendingUp,
  Building,
  Layers,
  AlertCircle
} from "lucide-react";
import { ApiService } from "../../services/api";
import { CategoryReportFilter } from "../../types/bindings/CategoryReportFilter";
import { CategorySalesRow } from "../../types/bindings/CategorySalesRow";
import { CategoryCustomerBreakdownRow } from "../../types/bindings/CategoryCustomerBreakdownRow";
import { CategoryGrandTotals } from "../../types/bindings/CategoryGrandTotals";
import { ReportResult } from "../../types/bindings/ReportResult";
import { InvoiceSummary } from "../../types/bindings/InvoiceSummary";
import { formatAmount, formatNumber, formatPercent, formatDate } from "../../utils/formatters";
import { ReportExportService, ExportColumn } from "../../services/reportExportService";

interface Props {
  dateFrom: string;
  dateTo: string;
  onInspectInvoice?: (invoiceNumber: string) => void;
}

type DrillDownLevel =
  | { level: 1 }
  | { level: 2; categoryId: number | null; categoryName: string }
  | { level: 3; categoryId: number | null; categoryName: string; customerId: number | null; customerCode: string; customerName: string };

export const CategoryWiseReportTab: React.FC<Props> = ({ dateFrom, dateTo, onInspectInvoice }) => {
  // Navigation stack state
  const [navStack, setNavStack] = useState<DrillDownLevel[]>([{ level: 1 }]);
  const currentNav = navStack[navStack.length - 1];

  // Filters state
  const [filterFrom, setFilterFrom] = useState(dateFrom);
  const [filterTo, setFilterTo] = useState(dateTo);
  const [includeCancelled, setIncludeCancelled] = useState(false);
  const [showEmpty, setShowEmpty] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");

  // Level 1 Data state & cache
  const [reportResult, setReportResult] = useState<ReportResult<CategorySalesRow, CategoryGrandTotals, CategoryReportFilter> | null>(null);
  const [loadingReport, setLoadingReport] = useState(false);

  // Level 2 Customer Breakdown state
  const [customerBreakdown, setCustomerBreakdown] = useState<CategoryCustomerBreakdownRow[]>([]);
  const [loadingCustomerBreakdown, setLoadingCustomerBreakdown] = useState(false);

  // Level 3 Invoice List state
  const [customerInvoices, setCustomerInvoices] = useState<InvoiceSummary[]>([]);
  const [loadingCustomerInvoices, setLoadingCustomerInvoices] = useState(false);

  // Sorting state for Level 1
  const [sortField, setSortField] = useState<keyof CategorySalesRow>("total_value");
  const [sortAsc, setSortAsc] = useState(false);

  // Load Level 1 Report
  const loadCategoryReport = async () => {
    setLoadingReport(true);
    try {
      const payload: CategoryReportFilter = {
        date_from: filterFrom || null,
        date_to: filterTo || null,
        include_cancelled: includeCancelled,
        search_term: searchTerm || null,
        show_empty_categories: showEmpty,
        category_ids: null,
        financial_year_id: null,
        invoice_statuses: null,
        page: null,
        page_size: null,
      };

      const res = await ApiService.getCategoryReport(payload);
      setReportResult(res);
    } catch (err) {
      console.error("Failed to fetch category report:", err);
      alert(`Error loading category report: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setLoadingReport(false);
    }
  };

  useEffect(() => {
    loadCategoryReport();
  }, [filterFrom, filterTo, includeCancelled, showEmpty]);

  // Load Level 2 Customer Breakdown
  const handleSelectCategory = async (catId: number | bigint | null, catName: string) => {
    const numId = catId !== null ? Number(catId) : null;
    setNavStack((prev) => [...prev, { level: 2, categoryId: numId, categoryName: catName }]);
    setLoadingCustomerBreakdown(true);
    try {
      const payload: CategoryReportFilter = {
        date_from: filterFrom || null,
        date_to: filterTo || null,
        include_cancelled: includeCancelled,
        category_ids: null,
        financial_year_id: null,
        invoice_statuses: null,
        search_term: null,
        show_empty_categories: null,
        page: null,
        page_size: null,
      };
      const rows = await ApiService.getCategoryCustomerBreakdown(payload, numId, catName);
      setCustomerBreakdown(rows);
    } catch (err) {
      console.error("Failed to load customer breakdown:", err);
    } finally {
      setLoadingCustomerBreakdown(false);
    }
  };

  // Load Level 3 Customer Invoices
  const handleSelectCustomer = async (catId: number | null, catName: string, custId: number | bigint | null, custCode: string, custName: string) => {
    const numCustId = custId !== null ? Number(custId) : null;
    setNavStack((prev) => [
      ...prev,
      { level: 3, categoryId: catId, categoryName: catName, customerId: numCustId, customerCode: custCode, customerName: custName },
    ]);
    setLoadingCustomerInvoices(true);
    try {
      const invoices = await ApiService.listInvoices(null, null, 1000);
      const filtered = invoices.filter(
        (inv) =>
          inv.customer_code === custCode ||
          (inv.customer_name && inv.customer_name.toLowerCase() === custName.toLowerCase())
      );
      setCustomerInvoices(filtered);
    } catch (err) {
      console.error("Failed to load customer invoices:", err);
    } finally {
      setLoadingCustomerInvoices(false);
    }
  };

  const handlePopNav = () => {
    if (navStack.length > 1) {
      setNavStack((prev) => prev.slice(0, -1));
    }
  };

  // Filtered & Sorted Level 1 Rows
  const processedRows = useMemo(() => {
    if (!reportResult?.rows) return [];
    let rows = [...reportResult.rows];

    if (searchTerm.trim()) {
      const term = searchTerm.toLowerCase();
      rows = rows.filter((r) => r.category_name.toLowerCase().includes(term));
    }

    rows.sort((a, b) => {
      const valA = a[sortField] ?? 0;
      const valB = b[sortField] ?? 0;
      if (typeof valA === "string" && typeof valB === "string") {
        return sortAsc ? valA.localeCompare(valB) : valB.localeCompare(valA);
      }
      return sortAsc ? (Number(valA) - Number(valB)) : (Number(valB) - Number(valA));
    });

    return rows;
  }, [reportResult, searchTerm, sortField, sortAsc]);

  // Dynamic Sticky Footer Totals of Visible Rows
  const visibleTotals = useMemo(() => {
    let customer_count = 0;
    let invoice_count = 0;
    let total_taxable = 0;
    let total_cgst = 0;
    let total_sgst = 0;
    let total_igst = 0;
    let total_value = 0;

    for (const r of processedRows) {
      customer_count += Number(r.customer_count);
      invoice_count += Number(r.invoice_count);
      total_taxable += r.total_taxable;
      total_cgst += r.total_cgst;
      total_sgst += r.total_sgst;
      total_igst += r.total_igst;
      total_value += r.total_value;
    }

    return {
      category_count: processedRows.length,
      customer_count,
      invoice_count,
      total_taxable,
      total_cgst,
      total_sgst,
      total_igst,
      total_value,
    };
  }, [processedRows]);

  // Grand Total for share calculation
  const grandTotalValue = reportResult?.grand_totals.grand_total_value || visibleTotals.total_value || 1;

  // Level 1 Column Definitions for Exports
  const level1ExportColumns: ExportColumn<CategorySalesRow>[] = [
    { header: "Category Name", accessor: (r) => r.category_name, align: "left" },
    { header: "Billed Customers", accessor: (r) => r.customer_count, format: formatNumber, align: "right" },
    { header: "Invoices Billed", accessor: (r) => r.invoice_count, format: formatNumber, align: "right" },
    { header: "Taxable Value", accessor: (r) => r.total_taxable, format: formatAmount, align: "right" },
    { header: "CGST", accessor: (r) => r.total_cgst, format: formatAmount, align: "right" },
    { header: "SGST", accessor: (r) => r.total_sgst, format: formatAmount, align: "right" },
    { header: "IGST", accessor: (r) => r.total_igst, format: formatAmount, align: "right" },
    { header: "Gross Total Revenue", accessor: (r) => r.total_value, format: formatAmount, align: "right" },
    {
      header: "Revenue Share %",
      accessor: (r) => (r.total_value / grandTotalValue) * 100,
      format: (val) => formatPercent(val),
      align: "right",
    },
  ];

  // Level 2 Export Columns
  const level2ExportColumns: ExportColumn<CategoryCustomerBreakdownRow>[] = [
    { header: "Customer Code", accessor: (r) => r.customer_code, align: "left" },
    { header: "Customer Name", accessor: (r) => r.report_name, align: "left" },
    { header: "Invoices", accessor: (r) => r.invoice_count, format: formatNumber, align: "right" },
    { header: "Last Invoice Date", accessor: (r) => r.last_invoice_date, format: formatDate, align: "center" },
    { header: "Taxable Value", accessor: (r) => r.total_taxable, format: formatAmount, align: "right" },
    { header: "Total GST", accessor: (r) => r.total_gst, format: formatAmount, align: "right" },
    { header: "Grand Total Revenue", accessor: (r) => r.total_value, format: formatAmount, align: "right" },
  ];

  const handleExportCsv = async () => {
    if (currentNav.level === 1) {
      await ReportExportService.exportToCsv(
        "Category Wise Sales & Revenue Report",
        reportResult?.metadata || null,
        level1ExportColumns,
        processedRows,
        "category_sales_report"
      );
    } else if (currentNav.level === 2 && "categoryName" in currentNav) {
      await ReportExportService.exportToCsv(
        `Category Customer Breakdown - ${currentNav.categoryName}`,
        reportResult?.metadata || null,
        level2ExportColumns,
        customerBreakdown,
        `category_${currentNav.categoryName}_customers`
      );
    }
  };

  const handleCopyClipboard = async () => {
    if (currentNav.level === 1) {
      const ok = await ReportExportService.copyToClipboard("Category Wise Sales & Revenue Report", level1ExportColumns, processedRows);
      if (ok) alert("Category summary report copied to clipboard!");
    } else if (currentNav.level === 2 && "categoryName" in currentNav) {
      const ok = await ReportExportService.copyToClipboard(`Category Breakdown - ${currentNav.categoryName}`, level2ExportColumns, customerBreakdown);
      if (ok) alert("Customer breakdown copied to clipboard!");
    }
  };

  const handlePrint = () => {
    if (currentNav.level === 1) {
      ReportExportService.printReport("Category Wise Sales & Revenue Report", reportResult?.metadata || null, level1ExportColumns, processedRows);
    } else if (currentNav.level === 2 && "categoryName" in currentNav) {
      ReportExportService.printReport(`Category Breakdown - ${currentNav.categoryName}`, reportResult?.metadata || null, level2ExportColumns, customerBreakdown);
    }
  };

  return (
    <div className="space-y-6 text-xs">
      {/* Policy Inclusion Banner */}
      <div className="bg-[var(--ember-surface-raised)] border border-[var(--ember-border)] rounded-xl p-3.5 flex items-center justify-between">
        <div className="flex items-center gap-2 text-[var(--ember-text-secondary)]">
          <Info className="w-4 h-4 text-[var(--ember-primary)] flex-shrink-0" />
          <span>
            <strong>Report Policy:</strong> Aggregates active sales invoices (Imported, Verified, Posted, Credit Note Generated, Debit Note Generated, Closed). Draft and Cancelled invoices are excluded by default.
          </span>
        </div>
        {reportResult?.metadata && (
          <div className="text-[10px] font-mono text-[var(--ember-text-muted)] flex items-center gap-3">
            <span>Version: v{reportResult.metadata.report_version}</span>
            <span>Query: {reportResult.metadata.execution_time_ms} ms</span>
          </div>
        )}
      </div>

      {/* Analytical KPI Header Cards */}
      <div className="grid grid-cols-4 gap-4">
        <div className="ember-card p-4 flex items-center justify-between">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-wider text-[var(--ember-text-muted)]">Total Revenue</p>
            <h4 className="text-base font-bold font-mono text-[var(--ember-primary)] mt-1">
              {formatAmount(reportResult?.grand_totals.grand_total_value || 0)}
            </h4>
            <p className="text-[10px] text-[var(--ember-text-secondary)] mt-0.5">
              Across {formatNumber(reportResult?.grand_totals.total_invoices || 0)} invoices
            </p>
          </div>
          <div className="p-3 bg-[var(--ember-primary-light)] rounded-xl text-[var(--ember-primary)]">
            <TrendingUp className="w-5 h-5" />
          </div>
        </div>

        <div className="ember-card p-4 flex items-center justify-between">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-wider text-[var(--ember-text-muted)]">Categories Billed</p>
            <h4 className="text-base font-bold font-mono text-[var(--ember-text-primary)] mt-1">
              {formatNumber(reportResult?.grand_totals.total_categories || 0)}
            </h4>
            <p className="text-[10px] text-[var(--ember-text-secondary)] mt-0.5">Active categories</p>
          </div>
          <div className="p-3 bg-blue-500/10 rounded-xl text-blue-600 dark:text-blue-400">
            <Layers className="w-5 h-5" />
          </div>
        </div>

        <div className="ember-card p-4 flex items-center justify-between">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-wider text-[var(--ember-text-muted)]">Top Performing Category</p>
            <h4 className="text-sm font-bold text-[var(--ember-text-primary)] truncate max-w-[150px] mt-1">
              {reportResult?.grand_totals.largest_category_name || "N/A"}
            </h4>
            <p className="text-[10px] text-emerald-700 dark:text-emerald-400 font-semibold mt-0.5">
              {formatPercent(reportResult?.grand_totals.largest_category_share || 0)} share of revenue
            </p>
          </div>
          <div className="p-3 bg-emerald-500/10 rounded-xl text-emerald-600 dark:text-emerald-400">
            <FolderTree className="w-5 h-5" />
          </div>
        </div>

        <div className="ember-card p-4 flex items-center justify-between">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-wider text-[var(--ember-text-muted)]">Avg Revenue / Category</p>
            <h4 className="text-base font-bold font-mono text-[var(--ember-text-primary)] mt-1">
              {formatAmount(
                (reportResult?.grand_totals.grand_total_value || 0) /
                  (reportResult?.grand_totals.total_categories || 1)
              )}
            </h4>
            <p className="text-[10px] text-[var(--ember-text-secondary)] mt-0.5">Category mean</p>
          </div>
          <div className="p-3 bg-purple-500/10 rounded-xl text-purple-600 dark:text-purple-400">
            <Building className="w-5 h-5" />
          </div>
        </div>
      </div>

      {/* Filter Bar & Toolbar */}
      <div className="ember-card p-4 flex items-center justify-between gap-4">
        {/* Navigation Breadcrumb Bar */}
        <div className="flex items-center gap-2">
          {navStack.length > 1 && (
            <button
              onClick={handlePopNav}
              className="ember-btn-secondary px-2.5 py-1.5 text-xs flex items-center gap-1.5 cursor-pointer"
            >
              <ArrowLeft className="w-3.5 h-3.5" /> Back
            </button>
          )}

          <div className="flex items-center gap-1 text-xs font-semibold text-[var(--ember-text-secondary)]">
            <span
              onClick={() => setNavStack([{ level: 1 }])}
              className="hover:text-[var(--ember-primary)] cursor-pointer"
            >
              Category Summary
            </span>

            {currentNav.level >= 2 && "categoryName" in currentNav && (
              <>
                <ChevronRight className="w-3.5 h-3.5 text-[var(--ember-text-muted)]" />
                <span className="text-[var(--ember-primary)]">{currentNav.categoryName}</span>
              </>
            )}

            {currentNav.level === 3 && "customerName" in currentNav && (
              <>
                <ChevronRight className="w-3.5 h-3.5 text-[var(--ember-text-muted)]" />
                <span className="text-[var(--ember-primary)]">{currentNav.customerName}</span>
              </>
            )}
          </div>
        </div>

        {/* Filter Controls & Search */}
        <div className="flex items-center gap-3">
          {currentNav.level === 1 && (
            <div className="relative">
              <Search className="w-3.5 h-3.5 absolute left-3 top-2.5 text-[var(--ember-text-muted)]" />
              <input
                type="text"
                placeholder="Search category name..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="ember-input pl-8 pr-3 py-1.5 text-xs w-48 font-mono"
              />
            </div>
          )}

          <div className="flex items-center gap-2">
            <input
              type="date"
              value={filterFrom}
              onChange={(e) => setFilterFrom(e.target.value)}
              className="ember-input px-2.5 py-1.5 text-xs font-mono"
            />
            <span className="text-[var(--ember-text-muted)]">to</span>
            <input
              type="date"
              value={filterTo}
              onChange={(e) => setFilterTo(e.target.value)}
              className="ember-input px-2.5 py-1.5 text-xs font-mono"
            />
          </div>

          <label className="flex items-center gap-1.5 text-xs cursor-pointer select-none text-[var(--ember-text-secondary)]">
            <input
              type="checkbox"
              checked={showEmpty}
              onChange={(e) => setShowEmpty(e.target.checked)}
              className="rounded"
            />
            Show Empty
          </label>

          <label className="flex items-center gap-1.5 text-xs cursor-pointer select-none text-[var(--ember-text-secondary)]">
            <input
              type="checkbox"
              checked={includeCancelled}
              onChange={(e) => setIncludeCancelled(e.target.checked)}
              className="rounded"
            />
            Include Cancelled
          </label>

          <button
            onClick={loadCategoryReport}
            disabled={loadingReport}
            className="ember-btn-secondary px-3 py-1.5 text-xs flex items-center gap-1.5 cursor-pointer"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loadingReport ? "animate-spin" : ""}`} />
            Refresh
          </button>

          {/* Action Export Buttons */}
          <div className="flex items-center gap-1 border-l border-[var(--ember-border)] pl-3">
            <button
              onClick={handleExportCsv}
              title="Export CSV"
              className="ember-btn-secondary px-2.5 py-1.5 text-xs flex items-center gap-1 cursor-pointer"
            >
              <Download className="w-3.5 h-3.5" /> CSV
            </button>
            <button
              onClick={handleCopyClipboard}
              title="Copy to Clipboard"
              className="ember-btn-secondary px-2.5 py-1.5 text-xs flex items-center gap-1 cursor-pointer"
            >
              <Copy className="w-3.5 h-3.5" /> Copy
            </button>
            <button
              onClick={handlePrint}
              title="Print Report"
              className="ember-btn-secondary px-2.5 py-1.5 text-xs flex items-center gap-1 cursor-pointer"
            >
              <Printer className="w-3.5 h-3.5" /> Print
            </button>
          </div>
        </div>
      </div>

      {/* Main Table Views */}
      {currentNav.level === 1 && (
        <div className="ember-card overflow-hidden">
          {loadingReport ? (
            <div className="p-12 text-center text-[var(--ember-text-muted)] flex justify-center items-center gap-2">
              <RefreshCw className="w-4 h-4 animate-spin text-[var(--ember-primary)]" />
              Loading category wise sales analysis...
            </div>
          ) : processedRows.length === 0 ? (
            /* Empty State */
            <div className="p-12 text-center space-y-3">
              <AlertCircle className="w-8 h-8 text-[var(--ember-text-muted)] mx-auto" />
              <h4 className="font-bold text-sm text-[var(--ember-text-primary)]">No Sales Found for Selected Filters</h4>
              <p className="text-xs text-[var(--ember-text-secondary)] max-w-md mx-auto">
                No active sales invoices match the date range or category criteria. Try adjusting the date range or toggling "Include Cancelled".
              </p>
              <button
                onClick={() => {
                  setFilterFrom("");
                  setFilterTo("");
                  setSearchTerm("");
                  setShowEmpty(false);
                }}
                className="ember-btn-secondary px-4 py-2 text-xs cursor-pointer mt-2 inline-flex items-center gap-2"
              >
                Reset Filters
              </button>
            </div>
          ) : (
            <div className="overflow-x-auto max-h-[600px] overflow-y-auto">
              <table className="w-full text-left border-collapse">
                <thead className="sticky top-0 bg-[var(--ember-surface)] border-b border-[var(--ember-border)] z-10">
                  <tr className="text-[var(--ember-text-secondary)] font-bold">
                    <th
                      className="p-3 cursor-pointer hover:text-[var(--ember-primary)]"
                      onClick={() => {
                        setSortField("category_name");
                        setSortAsc(!sortAsc);
                      }}
                    >
                      Category Name {sortField === "category_name" && (sortAsc ? "↑" : "↓")}
                    </th>
                    <th className="p-3 text-right">Customers</th>
                    <th className="p-3 text-right">Invoices</th>
                    <th className="p-3 text-right">Taxable Value</th>
                    <th className="p-3 text-right">CGST</th>
                    <th className="p-3 text-right">SGST</th>
                    <th className="p-3 text-right">IGST</th>
                    <th
                      className="p-3 text-right cursor-pointer hover:text-[var(--ember-primary)]"
                      onClick={() => {
                        setSortField("total_value");
                        setSortAsc(!sortAsc);
                      }}
                    >
                      Gross Total {sortField === "total_value" && (sortAsc ? "↑" : "↓")}
                    </th>
                    <th className="p-3 text-right w-48">Revenue Share (%)</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--ember-border-subtle)]">
                  {processedRows.map((row, idx) => {
                    const sharePct = grandTotalValue > 0 ? (row.total_value / grandTotalValue) * 100 : 0;
                    return (
                      <tr
                        key={idx}
                        onClick={() => handleSelectCategory(row.category_id, row.category_name)}
                        className="hover:bg-[var(--ember-surface-raised)] cursor-pointer text-[var(--ember-text-secondary)] transition-colors group"
                      >
                        <td className="p-3 font-semibold text-[var(--ember-text-primary)] flex items-center justify-between">
                          <span className="group-hover:text-[var(--ember-primary)] transition-colors">
                            {row.category_name}
                          </span>
                          <ChevronRight className="w-3.5 h-3.5 opacity-0 group-hover:opacity-100 text-[var(--ember-primary)] transition-opacity" />
                        </td>
                        <td className="p-3 text-right font-mono text-[var(--ember-text-muted)]">
                          {formatNumber(row.customer_count)}
                        </td>
                        <td className="p-3 text-right font-mono text-[var(--ember-text-muted)]">
                          {formatNumber(row.invoice_count)}
                        </td>
                        <td className="p-3 text-right font-mono text-[var(--ember-text-primary)]">
                          {formatAmount(row.total_taxable)}
                        </td>
                        <td className="p-3 text-right font-mono text-emerald-700 dark:text-emerald-400">
                          {formatAmount(row.total_cgst)}
                        </td>
                        <td className="p-3 text-right font-mono text-emerald-700 dark:text-emerald-400">
                          {formatAmount(row.total_sgst)}
                        </td>
                        <td className="p-3 text-right font-mono text-blue-700 dark:text-blue-400">
                          {formatAmount(row.total_igst)}
                        </td>
                        <td className="p-3 text-right font-mono font-bold text-[var(--ember-primary)]">
                          {formatAmount(row.total_value)}
                        </td>
                        <td className="p-3 text-right">
                          <div className="flex items-center justify-end gap-2">
                            {/* Accessible visual share progress bar */}
                            <div
                              tabIndex={0}
                              role="progressbar"
                              aria-valuenow={sharePct}
                              aria-valuemin={0}
                              aria-valuemax={100}
                              aria-label={`Share percentage for ${row.category_name}: ${formatPercent(sharePct)}`}
                              className="w-20 bg-[var(--ember-surface)] h-2 rounded-full overflow-hidden border border-[var(--ember-border)] hidden sm:block"
                            >
                              <div
                                className="bg-[var(--ember-primary)] h-full transition-all duration-300"
                                style={{ width: `${Math.min(100, Math.max(0, sharePct))}%` }}
                              />
                            </div>
                            <span className="font-mono text-xs text-[var(--ember-text-primary)] font-semibold min-w-[50px]">
                              {formatPercent(sharePct)}
                            </span>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
                {/* Sticky Dynamic Footer Totals */}
                <tfoot className="sticky bottom-0 bg-[var(--ember-surface-raised)] border-t-2 border-[var(--ember-border)] font-bold font-mono text-xs z-10">
                  <tr className="text-[var(--ember-text-primary)]">
                    <td className="p-3">
                      Total ({formatNumber(visibleTotals.category_count)} Categories)
                    </td>
                    <td className="p-3 text-right">{formatNumber(visibleTotals.customer_count)}</td>
                    <td className="p-3 text-right">{formatNumber(visibleTotals.invoice_count)}</td>
                    <td className="p-3 text-right">{formatAmount(visibleTotals.total_taxable)}</td>
                    <td className="p-3 text-right text-emerald-700 dark:text-emerald-400">
                      {formatAmount(visibleTotals.total_cgst)}
                    </td>
                    <td className="p-3 text-right text-emerald-700 dark:text-emerald-400">
                      {formatAmount(visibleTotals.total_sgst)}
                    </td>
                    <td className="p-3 text-right text-blue-700 dark:text-blue-400">
                      {formatAmount(visibleTotals.total_igst)}
                    </td>
                    <td className="p-3 text-right text-[var(--ember-primary)] font-extrabold text-sm">
                      {formatAmount(visibleTotals.total_value)}
                    </td>
                    <td className="p-3 text-right">100.00%</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Level 2 View: Customer Breakdown under Category */}
      {currentNav.level === 2 && "categoryName" in currentNav && (
        <div className="ember-card p-6 space-y-4">
          <div className="flex items-center justify-between border-b border-[var(--ember-border)] pb-3">
            <div>
              <h3 className="text-sm font-bold font-serif text-[var(--ember-primary)] uppercase tracking-wider">
                Category Breakdown: {currentNav.categoryName}
              </h3>
              <p className="text-xs text-[var(--ember-text-secondary)] mt-0.5">
                List of customers under {currentNav.categoryName} with individual revenue contributions.
              </p>
            </div>
            <span className="text-xs font-mono text-[var(--ember-text-muted)]">
              {customerBreakdown.length} Customers
            </span>
          </div>

          {loadingCustomerBreakdown ? (
            <div className="p-8 text-center text-[var(--ember-text-muted)] flex justify-center items-center gap-2">
              <RefreshCw className="w-4 h-4 animate-spin text-[var(--ember-primary)]" />
              Loading customer details...
            </div>
          ) : (
            <div className="border border-[var(--ember-border)] rounded-lg overflow-hidden bg-[var(--ember-surface-raised)]">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-[var(--ember-surface)] text-[var(--ember-text-secondary)] font-bold border-b border-[var(--ember-border)]">
                    <th className="p-3">Customer Code</th>
                    <th className="p-3">Customer Name</th>
                    <th className="p-3 text-right">Invoices</th>
                    <th className="p-3 text-center">Last Invoice Date</th>
                    <th className="p-3 text-right">Taxable Value</th>
                    <th className="p-3 text-right">GST Amount</th>
                    <th className="p-3 text-right">Gross Total</th>
                    <th className="p-3 text-right">Contribution %</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--ember-border-subtle)]">
                  {customerBreakdown.map((row, idx) => {
                    const categoryTotal = customerBreakdown.reduce((acc, c) => acc + c.total_value, 0) || 1;
                    const contrib = (row.total_value / categoryTotal) * 100;
                    return (
                      <tr
                        key={idx}
                        onDoubleClick={() =>
                          handleSelectCustomer(
                            currentNav.categoryId,
                            currentNav.categoryName,
                            row.customer_id,
                            row.customer_code,
                            row.report_name
                          )
                        }
                        className="hover:bg-[var(--ember-surface)] cursor-pointer text-[var(--ember-text-secondary)] transition-colors"
                        title="Double click to view invoices for customer"
                      >
                        <td className="p-3 font-mono font-semibold text-[var(--ember-text-primary)]">
                          {row.customer_code}
                        </td>
                        <td className="p-3 font-medium text-[var(--ember-text-primary)]">
                          {row.report_name}
                        </td>
                        <td className="p-3 text-right font-mono text-[var(--ember-text-muted)]">
                          {formatNumber(row.invoice_count)}
                        </td>
                        <td className="p-3 text-center font-mono text-[var(--ember-text-muted)]">
                          {formatDate(row.last_invoice_date)}
                        </td>
                        <td className="p-3 text-right font-mono text-[var(--ember-text-primary)]">
                          {formatAmount(row.total_taxable)}
                        </td>
                        <td className="p-3 text-right font-mono text-emerald-700 dark:text-emerald-400">
                          {formatAmount(row.total_gst)}
                        </td>
                        <td className="p-3 text-right font-mono font-bold text-[var(--ember-primary)]">
                          {formatAmount(row.total_value)}
                        </td>
                        <td className="p-3 text-right font-mono font-semibold text-[var(--ember-text-primary)]">
                          {formatPercent(contrib)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Level 3 View: Invoices for Selected Customer */}
      {currentNav.level === 3 && "customerName" in currentNav && (
        <div className="ember-card p-6 space-y-4">
          <div className="flex items-center justify-between border-b border-[var(--ember-border)] pb-3">
            <div>
              <h3 className="text-sm font-bold font-serif text-[var(--ember-primary)] uppercase tracking-wider">
                Invoices: {currentNav.customerName} ({currentNav.customerCode})
              </h3>
              <p className="text-xs text-[var(--ember-text-secondary)] mt-0.5">
                Double click an invoice line to inspect or edit details.
              </p>
            </div>
            <span className="text-xs font-mono text-[var(--ember-text-muted)]">
              {customerInvoices.length} Invoices Found
            </span>
          </div>

          {loadingCustomerInvoices ? (
            <div className="p-8 text-center text-[var(--ember-text-muted)] flex justify-center items-center gap-2">
              <RefreshCw className="w-4 h-4 animate-spin text-[var(--ember-primary)]" />
              Loading invoice list...
            </div>
          ) : (
            <div className="border border-[var(--ember-border)] rounded-lg overflow-hidden bg-[var(--ember-surface-raised)]">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-[var(--ember-surface)] text-[var(--ember-text-secondary)] font-bold border-b border-[var(--ember-border)]">
                    <th className="p-3">Invoice No</th>
                    <th className="p-3">Date</th>
                    <th className="p-3">Status</th>
                    <th className="p-3 text-right">Taxable Value</th>
                    <th className="p-3 text-right">GST Amount</th>
                    <th className="p-3 text-right">Gross Total</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--ember-border-subtle)]">
                  {customerInvoices.map((inv) => (
                    <tr
                      key={inv.invoice_number}
                      onDoubleClick={() => onInspectInvoice && onInspectInvoice(inv.invoice_number)}
                      className="hover:bg-[var(--ember-surface)] cursor-pointer text-[var(--ember-text-secondary)] transition-colors"
                    >
                      <td className="p-3 font-mono font-bold text-[var(--ember-primary)]">
                        {inv.invoice_number}
                      </td>
                      <td className="p-3 font-mono">{formatDate(inv.invoice_date)}</td>
                      <td className="p-3">
                        <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-[var(--ember-surface)] text-[var(--ember-text-primary)] border border-[var(--ember-border)]">
                          {inv.status}
                        </span>
                      </td>
                      <td className="p-3 text-right font-mono">{formatAmount(inv.total_taxable)}</td>
                      <td className="p-3 text-right font-mono text-emerald-700 dark:text-emerald-400">
                        {formatAmount(inv.total_tax)}
                      </td>
                      <td className="p-3 text-right font-mono font-bold text-[var(--ember-primary)]">
                        {formatAmount(inv.total_value)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default CategoryWiseReportTab;
