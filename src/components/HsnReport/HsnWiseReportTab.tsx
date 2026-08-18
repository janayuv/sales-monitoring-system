import React, { useState, useEffect, useMemo } from "react";
import {
  FileSpreadsheet,
  Download,
  Printer,
  Copy,
  RefreshCw,
  Search,
  ChevronRight,
  ArrowLeft,
  Info,
  TrendingUp,
  Boxes,
  Hash,
  AlertCircle,
  Receipt,
  FileCheck
} from "lucide-react";
import { ApiService } from "../../services/api";
import { HsnReportFilter } from "../../types/bindings/HsnReportFilter";
import { HsnSalesRow } from "../../types/bindings/HsnSalesRow";
import { HsnItemBreakdownRow } from "../../types/bindings/HsnItemBreakdownRow";
import { HsnInvoiceBreakdownRow } from "../../types/bindings/HsnInvoiceBreakdownRow";
import { HsnGrandTotals } from "../../types/bindings/HsnGrandTotals";
import { ReportResult } from "../../types/bindings/ReportResult";
import { formatAmount, formatNumber, formatPercent, formatDate } from "../../utils/formatters";
import { ReportExportService, ExportColumn } from "../../services/reportExportService";

interface Props {
  dateFrom: string;
  dateTo: string;
  onInspectInvoice?: (invoiceNumber: string) => void;
}

type DrillDownLevel =
  | { level: 1 }
  | { level: 2; hsnCode: string; description: string }
  | { level: 3; hsnCode: string; description: string; partCode: string; partName: string };

export const HsnWiseReportTab: React.FC<Props> = ({ dateFrom, dateTo, onInspectInvoice }) => {
  // Navigation stack state
  const [navStack, setNavStack] = useState<DrillDownLevel[]>([{ level: 1 }]);
  const currentNav = navStack[navStack.length - 1];

  // Filters state
  const [filterFrom, setFilterFrom] = useState(dateFrom);
  const [filterTo, setFilterTo] = useState(dateTo);
  const [includeCancelled, setIncludeCancelled] = useState(false);
  const [showEmpty, setShowEmpty] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");

  // Level 1 Data state
  const [reportResult, setReportResult] = useState<ReportResult<HsnSalesRow, HsnGrandTotals, HsnReportFilter> | null>(null);
  const [loadingReport, setLoadingReport] = useState(false);
  const [reportError, setReportError] = useState<string | null>(null);

  // Level 2 Item Breakdown state
  const [itemBreakdown, setItemBreakdown] = useState<HsnItemBreakdownRow[]>([]);
  const [loadingItemBreakdown, setLoadingItemBreakdown] = useState(false);

  // Level 3 Invoice List state
  const [invoiceBreakdown, setInvoiceBreakdown] = useState<HsnInvoiceBreakdownRow[]>([]);
  const [loadingInvoiceBreakdown, setLoadingInvoiceBreakdown] = useState(false);

  // Sorting state for Level 1
  const [sortField, setSortField] = useState<keyof HsnSalesRow>("total_value");
  const [sortAsc, setSortAsc] = useState(false);

  // Load Level 1 Report
  const loadHsnReport = async () => {
    setLoadingReport(true);
    setReportError(null);
    try {
      const payload: HsnReportFilter = {
        date_from: filterFrom || null,
        date_to: filterTo || null,
        include_cancelled: includeCancelled,
        search_term: searchTerm || null,
        show_empty_hsn: showEmpty,
        hsn_codes: null,
        financial_year_id: null,
        invoice_statuses: null,
        page: null,
        page_size: null,
      };

      const res = await ApiService.getHsnReport(payload);
      setReportResult(res);
    } catch (err) {
      console.error("Failed to fetch HSN report:", err);
      const msg = err instanceof Error ? err.message : String(err);
      setReportError(msg);
    } finally {
      setLoadingReport(false);
    }
  };

  useEffect(() => {
    setFilterFrom(dateFrom);
  }, [dateFrom]);

  useEffect(() => {
    setFilterTo(dateTo);
  }, [dateTo]);

  useEffect(() => {
    loadHsnReport();
  }, [filterFrom, filterTo, includeCancelled, showEmpty]);


  // Load Level 2 Item Breakdown
  const handleSelectHsn = async (hsnCode: string, description: string) => {
    setNavStack((prev) => [...prev, { level: 2, hsnCode, description }]);
    setLoadingItemBreakdown(true);
    try {
      const payload: HsnReportFilter = {
        date_from: filterFrom || null,
        date_to: filterTo || null,
        include_cancelled: includeCancelled,
        hsn_codes: null,
        financial_year_id: null,
        invoice_statuses: null,
        search_term: null,
        show_empty_hsn: null,
        page: null,
        page_size: null,
      };
      const rows = await ApiService.getHsnItemBreakdown(payload, hsnCode);
      setItemBreakdown(rows);
    } catch (err) {
      console.error("Failed to load HSN item breakdown:", err);
      alert(`Error loading items: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setLoadingItemBreakdown(false);
    }
  };

  // Load Level 3 Invoice Breakdown
  const handleSelectItem = async (
    hsnCode: string,
    description: string,
    partCode: string,
    partName: string
  ) => {
    setNavStack((prev) => [
      ...prev,
      { level: 3, hsnCode, description, partCode, partName },
    ]);
    setLoadingInvoiceBreakdown(true);
    try {
      const payload: HsnReportFilter = {
        date_from: filterFrom || null,
        date_to: filterTo || null,
        include_cancelled: includeCancelled,
        hsn_codes: null,
        financial_year_id: null,
        invoice_statuses: null,
        search_term: null,
        show_empty_hsn: null,
        page: null,
        page_size: null,
      };
      const rows = await ApiService.getHsnInvoiceBreakdown(payload, hsnCode, partCode);
      setInvoiceBreakdown(rows);
    } catch (err) {
      console.error("Failed to load HSN invoice breakdown:", err);
      alert(`Error loading invoices: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setLoadingInvoiceBreakdown(false);
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
      rows = rows.filter(
        (r) =>
          r.hsn_code.toLowerCase().includes(term) ||
          (r.description && r.description.toLowerCase().includes(term))
      );
    }

    rows.sort((a, b) => {
      const valA = a[sortField] ?? 0;
      const valB = b[sortField] ?? 0;
      if (typeof valA === "string" && typeof valB === "string") {
        return sortAsc ? valA.localeCompare(valB) : valB.localeCompare(valA);
      }
      return sortAsc ? Number(valA) - Number(valB) : Number(valB) - Number(valA);
    });

    return rows;
  }, [reportResult, searchTerm, sortField, sortAsc]);

  // Filtered Level 2 Rows
  const processedItemRows = useMemo(() => {
    if (!itemBreakdown) return [];
    if (!searchTerm.trim()) return itemBreakdown;
    const term = searchTerm.toLowerCase();
    return itemBreakdown.filter(
      (r) =>
        r.part_code.toLowerCase().includes(term) ||
        r.part_name.toLowerCase().includes(term)
    );
  }, [itemBreakdown, searchTerm]);

  // Filtered Level 3 Rows
  const processedInvoiceRows = useMemo(() => {
    if (!invoiceBreakdown) return [];
    if (!searchTerm.trim()) return invoiceBreakdown;
    const term = searchTerm.toLowerCase();
    return invoiceBreakdown.filter(
      (r) =>
        r.invoice_number.toLowerCase().includes(term) ||
        r.customer_name.toLowerCase().includes(term) ||
        r.customer_code.toLowerCase().includes(term)
    );
  }, [invoiceBreakdown, searchTerm]);


  // Dynamic Sticky Footer Totals of Visible Rows
  const visibleTotals = useMemo(() => {
    let total_quantity = 0;
    let total_taxable = 0;
    let total_cgst = 0;
    let total_sgst = 0;
    let total_igst = 0;
    let total_tax = 0;
    let total_value = 0;

    for (const r of processedRows) {
      total_quantity += r.total_quantity;
      total_taxable += r.total_taxable;
      total_cgst += r.total_cgst;
      total_sgst += r.total_sgst;
      total_igst += r.total_igst;
      total_tax += r.total_tax;
      total_value += r.total_value;
    }

    return {
      hsn_count: processedRows.length,
      total_quantity,
      total_taxable,
      total_cgst,
      total_sgst,
      total_igst,
      total_tax,
      total_value,
    };
  }, [processedRows]);

  // Grand Total for share calculation
  const grandTotalValue = reportResult?.grand_totals.grand_total_value || visibleTotals.total_value || 1;

  // Level 1 Column Definitions for Exports
  const level1ExportColumns: ExportColumn<HsnSalesRow>[] = [
    { header: "HSN Code", accessor: (r) => r.hsn_code, align: "left" },
    { header: "Description", accessor: (r) => r.description || "N/A", align: "left" },
    { header: "UOM", accessor: (r) => r.uom_code || "NOS", align: "center" },
    { header: "GST Rate (%)", accessor: (r) => r.gst_rate, format: (v) => `${v}%`, align: "right" },
    { header: "Total Quantity", accessor: (r) => r.total_quantity, format: formatNumber, align: "right" },
    { header: "Taxable Value (₹)", accessor: (r) => r.total_taxable, format: formatAmount, align: "right" },
    { header: "CGST (₹)", accessor: (r) => r.total_cgst, format: formatAmount, align: "right" },
    { header: "SGST (₹)", accessor: (r) => r.total_sgst, format: formatAmount, align: "right" },
    { header: "IGST (₹)", accessor: (r) => r.total_igst, format: formatAmount, align: "right" },
    { header: "Total GST (₹)", accessor: (r) => r.total_tax, format: formatAmount, align: "right" },
    { header: "Gross Total (₹)", accessor: (r) => r.total_value, format: formatAmount, align: "right" },
    {
      header: "Revenue Share %",
      accessor: (r) => (r.total_value / grandTotalValue) * 100,
      format: (val) => formatPercent(val),
      align: "right",
    },
  ];

  // Level 2 Export Columns
  const level2ExportColumns: ExportColumn<HsnItemBreakdownRow>[] = [
    { header: "HSN Code", accessor: (r) => r.hsn_code, align: "left" },
    { header: "Part Number", accessor: (r) => r.part_code, align: "left" },
    { header: "Part Description", accessor: (r) => r.part_name, align: "left" },
    { header: "UOM", accessor: (r) => r.uom_code, align: "center" },
    { header: "GST Rate (%)", accessor: (r) => r.default_gst_rate, format: (v) => `${v}%`, align: "right" },
    { header: "Quantity Sold", accessor: (r) => r.total_quantity, format: formatNumber, align: "right" },
    { header: "Avg Unit Rate (₹)", accessor: (r) => r.avg_rate, format: formatAmount, align: "right" },
    { header: "Taxable Value (₹)", accessor: (r) => r.total_taxable, format: formatAmount, align: "right" },
    { header: "CGST (₹)", accessor: (r) => r.total_cgst, format: formatAmount, align: "right" },
    { header: "SGST (₹)", accessor: (r) => r.total_sgst, format: formatAmount, align: "right" },
    { header: "IGST (₹)", accessor: (r) => r.total_igst, format: formatAmount, align: "right" },
    { header: "Total GST (₹)", accessor: (r) => r.total_tax, format: formatAmount, align: "right" },
    { header: "Total Value (₹)", accessor: (r) => r.total_value, format: formatAmount, align: "right" },
    { header: "Customers", accessor: (r) => r.customer_count, format: formatNumber, align: "right" },
    { header: "Invoices", accessor: (r) => r.invoice_count, format: formatNumber, align: "right" },
  ];

  // Level 3 Export Columns
  const level3ExportColumns: ExportColumn<HsnInvoiceBreakdownRow>[] = [
    { header: "Invoice No", accessor: (r) => r.invoice_number, align: "left" },
    { header: "Date", accessor: (r) => r.invoice_date, format: formatDate, align: "center" },
    { header: "Customer Code", accessor: (r) => r.customer_code, align: "left" },
    { header: "Customer Name", accessor: (r) => r.customer_name, align: "left" },
    { header: "Part Number", accessor: (r) => r.part_code, align: "left" },
    { header: "Part Name", accessor: (r) => r.part_name, align: "left" },
    { header: "Quantity", accessor: (r) => r.quantity, format: formatNumber, align: "right" },
    { header: "UOM", accessor: (r) => r.uom_code, align: "center" },
    { header: "Rate / Unit (₹)", accessor: (r) => r.rate_pre_unit, format: formatAmount, align: "right" },
    { header: "Assessable Value (₹)", accessor: (r) => r.assessable_value, format: formatAmount, align: "right" },
    { header: "CGST Rate (%)", accessor: (r) => r.cgst_rate, format: (v) => `${v}%`, align: "right" },
    { header: "CGST (₹)", accessor: (r) => r.cgst_amount, format: formatAmount, align: "right" },
    { header: "SGST Rate (%)", accessor: (r) => r.sgst_rate, format: (v) => `${v}%`, align: "right" },
    { header: "SGST (₹)", accessor: (r) => r.sgst_amount, format: formatAmount, align: "right" },
    { header: "IGST Rate (%)", accessor: (r) => r.igst_rate, format: (v) => `${v}%`, align: "right" },
    { header: "IGST (₹)", accessor: (r) => r.igst_amount, format: formatAmount, align: "right" },
    { header: "Total Value (₹)", accessor: (r) => r.total_value, format: formatAmount, align: "right" },
    { header: "Status", accessor: (r) => r.status, align: "center" },
  ];

  // Standard CSV Export
  const handleExportCsv = async () => {
    if (currentNav.level === 1) {
      await ReportExportService.exportToCsv(
        "HSN Wise Sales & GST Summary Report",
        reportResult?.metadata || null,
        level1ExportColumns,
        processedRows,
        "hsn_sales_summary"
      );
    } else if (currentNav.level === 2 && "hsnCode" in currentNav) {
      await ReportExportService.exportToCsv(
        `HSN Item Breakdown - HSN ${currentNav.hsnCode}`,
        reportResult?.metadata || null,
        level2ExportColumns,
        processedItemRows,
        `hsn_${currentNav.hsnCode}_items`
      );
    } else if (currentNav.level === 3 && "partCode" in currentNav) {
      await ReportExportService.exportToCsv(
        `HSN Invoices - HSN ${currentNav.hsnCode} Part ${currentNav.partCode}`,
        reportResult?.metadata || null,
        level3ExportColumns,
        processedInvoiceRows,
        `hsn_${currentNav.hsnCode}_${currentNav.partCode}_invoices`
      );
    }
  };

  // Dedicated GSTR-1 Table 12 CSV Export
  const handleExportGstr1Table12 = async () => {
    await ReportExportService.exportGstr1Table12Csv(
      processedRows.map((r) => ({
        hsn_code: r.hsn_code,
        description: r.description,
        uom_code: r.uom_code,
        total_quantity: r.total_quantity,
        total_value: r.total_value,
        total_taxable: r.total_taxable,
        total_igst: r.total_igst,
        total_cgst: r.total_cgst,
        total_sgst: r.total_sgst,
      }))
    );
  };

  // Copy to Clipboard
  const handleCopyClipboard = async () => {
    if (currentNav.level === 1) {
      const ok = await ReportExportService.copyToClipboard("HSN Wise Sales & GST Summary Report", level1ExportColumns, processedRows);
      if (ok) alert("HSN Summary report copied to clipboard!");
    } else if (currentNav.level === 2 && "hsnCode" in currentNav) {
      const ok = await ReportExportService.copyToClipboard(`HSN Item Breakdown - ${currentNav.hsnCode}`, level2ExportColumns, processedItemRows);
      if (ok) alert("HSN item breakdown copied to clipboard!");
    } else if (currentNav.level === 3 && "partCode" in currentNav) {
      const ok = await ReportExportService.copyToClipboard(`HSN Invoices - ${currentNav.hsnCode} (${currentNav.partCode})`, level3ExportColumns, processedInvoiceRows);
      if (ok) alert("Invoice line items copied to clipboard!");
    }
  };

  // Print Report
  const handlePrint = () => {
    if (currentNav.level === 1) {
      ReportExportService.printReport("HSN Wise Sales & GST Summary Report", reportResult?.metadata || null, level1ExportColumns, processedRows);
    } else if (currentNav.level === 2 && "hsnCode" in currentNav) {
      ReportExportService.printReport(`HSN Item Breakdown - HSN ${currentNav.hsnCode}`, reportResult?.metadata || null, level2ExportColumns, processedItemRows);
    } else if (currentNav.level === 3 && "partCode" in currentNav) {
      ReportExportService.printReport(`HSN Invoices - HSN ${currentNav.hsnCode} Part ${currentNav.partCode}`, reportResult?.metadata || null, level3ExportColumns, processedInvoiceRows);
    }
  };


  return (
    <div className="space-y-6 text-xs" data-testid="hsn-report-container">
      {/* Policy Inclusion Banner */}
      <div className="bg-[var(--ember-surface-raised)] border border-[var(--ember-border)] rounded-xl p-3.5 flex items-center justify-between">
        <div className="flex items-center gap-2 text-[var(--ember-text-secondary)]">
          <Info className="w-4 h-4 text-[var(--ember-primary)] flex-shrink-0" />
          <span>
            <strong>HSN / SAC Policy:</strong> Summarizes assessable values and GST liability grouped by HSN/SAC code per Indian GST / GSTR-1 Table 12 standards. Cancelled and Draft invoices are excluded by default.
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
      <div className="grid grid-cols-5 gap-3" data-testid="hsn-kpi-cards">
        {/* Card 1: Total Assessable / Turnover */}
        <div className="ember-card p-3.5 flex items-center justify-between">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-wider text-[var(--ember-text-muted)]">Turnover (Assessable)</p>
            <h4 className="text-sm font-bold font-mono text-[var(--ember-primary)] mt-1" data-testid="kpi-total-taxable">
              ₹{formatAmount(reportResult?.grand_totals.total_taxable || 0)}
            </h4>
            <p className="text-[10px] text-[var(--ember-text-secondary)] mt-0.5">
              Gross ₹{formatAmount(reportResult?.grand_totals.grand_total_value || 0)}
            </p>
          </div>
          <div className="p-2.5 bg-[var(--ember-primary-light)] rounded-xl text-[var(--ember-primary)]">
            <TrendingUp className="w-4 h-4" />
          </div>
        </div>

        {/* Card 2: Total GST Liability */}
        <div className="ember-card p-3.5 flex items-center justify-between">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-wider text-[var(--ember-text-muted)]">Total GST Liability</p>
            <h4 className="text-sm font-bold font-mono text-emerald-700 dark:text-emerald-400 mt-1" data-testid="kpi-total-gst">
              ₹{formatAmount(reportResult?.grand_totals.total_tax || 0)}
            </h4>
            <p className="text-[10px] text-[var(--ember-text-secondary)] mt-0.5">
              CGST+SGST+IGST
            </p>
          </div>
          <div className="p-2.5 bg-emerald-500/10 rounded-xl text-emerald-600 dark:text-emerald-400">
            <Receipt className="w-4 h-4" />
          </div>
        </div>

        {/* Card 3: Active HSN Codes */}
        <div className="ember-card p-3.5 flex items-center justify-between">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-wider text-[var(--ember-text-muted)]">Active HSN Codes</p>
            <h4 className="text-sm font-bold font-mono text-[var(--ember-text-primary)] mt-1" data-testid="kpi-hsn-count">
              {formatNumber(reportResult?.grand_totals.total_hsn_codes || 0)}
            </h4>
            <p className="text-[10px] text-[var(--ember-text-secondary)] mt-0.5">
              Avg ₹{formatAmount((reportResult?.grand_totals.grand_total_value || 0) / (reportResult?.grand_totals.total_hsn_codes || 1))} / HSN
            </p>
          </div>
          <div className="p-2.5 bg-blue-500/10 rounded-xl text-blue-600 dark:text-blue-400">
            <Hash className="w-4 h-4" />
          </div>
        </div>

        {/* Card 4: Top Performing HSN */}
        <div className="ember-card p-3.5 flex items-center justify-between">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-wider text-[var(--ember-text-muted)]">Top HSN Code</p>
            <h4 className="text-sm font-bold font-mono text-[var(--ember-text-primary)] truncate max-w-[130px] mt-1" data-testid="kpi-top-hsn">
              {reportResult?.grand_totals.top_hsn_code || "N/A"}
            </h4>
            <p className="text-[10px] text-emerald-700 dark:text-emerald-400 font-semibold mt-0.5">
              {formatPercent(reportResult?.grand_totals.top_hsn_share || 0)} revenue share
            </p>
          </div>
          <div className="p-2.5 bg-purple-500/10 rounded-xl text-purple-600 dark:text-purple-400">
            <Boxes className="w-4 h-4" />
          </div>
        </div>

        {/* Card 5: Total Units Sold */}
        <div className="ember-card p-3.5 flex items-center justify-between">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-wider text-[var(--ember-text-muted)]">Total Units Sold</p>
            <h4 className="text-sm font-bold font-mono text-[var(--ember-text-primary)] mt-1" data-testid="kpi-total-quantity">
              {formatNumber(reportResult?.grand_totals.total_quantity || 0)}
            </h4>
            <p className="text-[10px] text-[var(--ember-text-secondary)] mt-0.5">
              Across {formatNumber(reportResult?.grand_totals.total_invoices || 0)} invoices
            </p>
          </div>
          <div className="p-2.5 bg-amber-500/10 rounded-xl text-amber-600 dark:text-amber-400">
            <FileSpreadsheet className="w-4 h-4" />
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
              data-testid="hsn-back-btn"
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
              HSN Summary
            </span>

            {currentNav.level >= 2 && "hsnCode" in currentNav && (
              <>
                <ChevronRight className="w-3.5 h-3.5 text-[var(--ember-text-muted)]" />
                <span className="text-[var(--ember-primary)] font-mono">
                  HSN {currentNav.hsnCode}
                </span>
              </>
            )}

            {currentNav.level === 3 && "partCode" in currentNav && (
              <>
                <ChevronRight className="w-3.5 h-3.5 text-[var(--ember-text-muted)]" />
                <span className="text-[var(--ember-primary)] font-mono">{currentNav.partCode}</span>
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
                data-testid="hsn-search-input"
                placeholder="Search HSN code / description..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="ember-input pl-8 pr-3 py-1.5 text-xs w-52 font-mono"
              />
            </div>
          )}

          <div className="flex items-center gap-2">
            <input
              type="date"
              data-testid="hsn-date-from"
              value={filterFrom}
              onChange={(e) => setFilterFrom(e.target.value)}
              className="ember-input px-2.5 py-1.5 text-xs font-mono"
            />
            <span className="text-[var(--ember-text-muted)]">to</span>
            <input
              type="date"
              data-testid="hsn-date-to"
              value={filterTo}
              onChange={(e) => setFilterTo(e.target.value)}
              className="ember-input px-2.5 py-1.5 text-xs font-mono"
            />
          </div>

          <label className="flex items-center gap-1.5 text-xs cursor-pointer select-none text-[var(--ember-text-secondary)]">
            <input
              type="checkbox"
              data-testid="hsn-show-empty-chk"
              checked={showEmpty}
              onChange={(e) => setShowEmpty(e.target.checked)}
              className="rounded"
            />
            Show 0-Sales HSNs
          </label>

          <label className="flex items-center gap-1.5 text-xs cursor-pointer select-none text-[var(--ember-text-secondary)]">
            <input
              type="checkbox"
              data-testid="hsn-include-cancelled-chk"
              checked={includeCancelled}
              onChange={(e) => setIncludeCancelled(e.target.checked)}
              className="rounded"
            />
            Include Cancelled
          </label>

          <button
            onClick={loadHsnReport}
            disabled={loadingReport}
            data-testid="hsn-refresh-btn"
            className="ember-btn-secondary px-3 py-1.5 text-xs flex items-center gap-1.5 cursor-pointer"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loadingReport ? "animate-spin" : ""}`} />
            Refresh
          </button>

          {/* Action Export Buttons */}
          <div className="flex items-center gap-1 border-l border-[var(--ember-border)] pl-3">
            <button
              onClick={handleExportCsv}
              data-testid="hsn-export-csv-btn"
              title="Export Full Summary CSV"
              className="ember-btn-secondary px-2.5 py-1.5 text-xs flex items-center gap-1 cursor-pointer"
            >
              <Download className="w-3.5 h-3.5" /> CSV
            </button>
            {currentNav.level === 1 && (
              <button
                onClick={handleExportGstr1Table12}
                data-testid="hsn-export-gstr1-btn"
                title="Export GSTR-1 Table 12 Compliant CSV"
                className="ember-btn-primary px-2.5 py-1.5 text-xs flex items-center gap-1 cursor-pointer"
              >
                <FileCheck className="w-3.5 h-3.5" /> GSTR-1 Table 12
              </button>
            )}
            <button
              onClick={handleCopyClipboard}
              data-testid="hsn-copy-btn"
              title="Copy to Clipboard"
              className="ember-btn-secondary px-2.5 py-1.5 text-xs flex items-center gap-1 cursor-pointer"
            >
              <Copy className="w-3.5 h-3.5" /> Copy
            </button>
            <button
              onClick={handlePrint}
              data-testid="hsn-print-btn"
              title="Print Report"
              className="ember-btn-secondary px-2.5 py-1.5 text-xs flex items-center gap-1 cursor-pointer"
            >
              <Printer className="w-3.5 h-3.5" /> Print
            </button>
          </div>
        </div>
      </div>

      {/* Error state */}
      {reportError && (
        <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-4 text-red-600 dark:text-red-400 flex items-center gap-2">
          <AlertCircle className="w-4 h-4 flex-shrink-0" />
          <span>Error loading HSN report: {reportError}</span>
        </div>
      )}

      {/* Level 1: HSN Summary Matrix View */}
      {currentNav.level === 1 && (
        <div className="ember-card overflow-hidden">
          {loadingReport ? (
            <div className="p-12 text-center text-[var(--ember-text-muted)] flex justify-center items-center gap-2" data-testid="hsn-loading-state">
              <RefreshCw className="w-4 h-4 animate-spin text-[var(--ember-primary)]" />
              Loading HSN summary analysis...
            </div>
          ) : processedRows.length === 0 ? (
            /* Empty State */
            <div className="p-12 text-center space-y-3" data-testid="hsn-empty-state">
              <AlertCircle className="w-8 h-8 text-[var(--ember-text-muted)] mx-auto" />
              <h4 className="font-bold text-sm text-[var(--ember-text-primary)]">No HSN Sales Found for Selected Filters</h4>
              <p className="text-xs text-[var(--ember-text-secondary)] max-w-md mx-auto">
                No active sales invoices match the date range or HSN criteria. Try adjusting the date range or toggling "Show 0-Sales HSNs".
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
              <table className="w-full text-left border-collapse" data-testid="hsn-level1-table">
                <thead className="sticky top-0 bg-[var(--ember-surface)] border-b border-[var(--ember-border)] z-10">
                  <tr className="text-[var(--ember-text-secondary)] font-bold">
                    <th
                      className="p-3 cursor-pointer hover:text-[var(--ember-primary)]"
                      onClick={() => {
                        setSortField("hsn_code");
                        setSortAsc(!sortAsc);
                      }}
                    >
                      HSN Code {sortField === "hsn_code" && (sortAsc ? "↑" : "↓")}
                    </th>
                    <th className="p-3">Description</th>
                    <th className="p-3 text-center">UOM</th>
                    <th className="p-3 text-right">GST Rate</th>
                    <th
                      className="p-3 text-right cursor-pointer hover:text-[var(--ember-primary)]"
                      onClick={() => {
                        setSortField("total_quantity");
                        setSortAsc(!sortAsc);
                      }}
                    >
                      Quantity {sortField === "total_quantity" && (sortAsc ? "↑" : "↓")}
                    </th>
                    <th
                      className="p-3 text-right cursor-pointer hover:text-[var(--ember-primary)]"
                      onClick={() => {
                        setSortField("total_taxable");
                        setSortAsc(!sortAsc);
                      }}
                    >
                      Taxable Value {sortField === "total_taxable" && (sortAsc ? "↑" : "↓")}
                    </th>
                    <th className="p-3 text-right">CGST</th>
                    <th className="p-3 text-right">SGST</th>
                    <th className="p-3 text-right">IGST</th>
                    <th className="p-3 text-right">Total GST</th>
                    <th
                      className="p-3 text-right cursor-pointer hover:text-[var(--ember-primary)]"
                      onClick={() => {
                        setSortField("total_value");
                        setSortAsc(!sortAsc);
                      }}
                    >
                      Gross Total {sortField === "total_value" && (sortAsc ? "↑" : "↓")}
                    </th>
                    <th className="p-3 text-right w-36">Revenue Share</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--ember-border-subtle)]">
                  {processedRows.map((row, idx) => {
                    const sharePct = grandTotalValue > 0 ? (row.total_value / grandTotalValue) * 100 : 0;
                    return (
                      <tr
                        key={idx}
                        data-testid={`hsn-row-${row.hsn_code}`}
                        onClick={() => handleSelectHsn(row.hsn_code, row.description || "N/A")}
                        className="hover:bg-[var(--ember-surface-raised)] cursor-pointer text-[var(--ember-text-secondary)] transition-colors group"
                      >
                        <td className="p-3 font-mono font-bold text-[var(--ember-text-primary)] flex items-center justify-between">
                          <span className="group-hover:text-[var(--ember-primary)] transition-colors">
                            {row.hsn_code}
                          </span>
                          <ChevronRight className="w-3.5 h-3.5 opacity-0 group-hover:opacity-100 text-[var(--ember-primary)] transition-opacity" />
                        </td>
                        <td className="p-3 font-medium text-[var(--ember-text-primary)] max-w-xs truncate" title={row.description || "N/A"}>
                          {row.description || "N/A"}
                        </td>
                        <td className="p-3 text-center font-mono text-[var(--ember-text-muted)]">
                          {row.uom_code || "NOS"}
                        </td>
                        <td className="p-3 text-right font-mono text-[var(--ember-text-muted)]">
                          {row.gst_rate}%
                        </td>
                        <td className="p-3 text-right font-mono text-[var(--ember-text-muted)]">
                          {formatNumber(row.total_quantity)}
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
                        <td className="p-3 text-right font-mono text-emerald-700 dark:text-emerald-400 font-semibold">
                          {formatAmount(row.total_tax)}
                        </td>
                        <td className="p-3 text-right font-mono font-bold text-[var(--ember-primary)]">
                          {formatAmount(row.total_value)}
                        </td>
                        <td className="p-3 text-right">
                          <div className="flex items-center justify-end gap-2">
                            <div
                              tabIndex={0}
                              role="progressbar"
                              aria-valuenow={sharePct}
                              aria-valuemin={0}
                              aria-valuemax={100}
                              aria-label={`Share percentage for HSN ${row.hsn_code}: ${formatPercent(sharePct)}`}
                              className="w-16 bg-[var(--ember-surface)] h-2 rounded-full overflow-hidden border border-[var(--ember-border)] hidden sm:block"
                            >
                              <div
                                className="bg-[var(--ember-primary)] h-full transition-all duration-300"
                                style={{ width: `${Math.min(100, Math.max(0, sharePct))}%` }}
                              />
                            </div>
                            <span className="font-mono text-xs text-[var(--ember-text-primary)] font-semibold min-w-[45px]">
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
                    <td className="p-3" colSpan={2}>
                      Total ({formatNumber(visibleTotals.hsn_count)} HSN Codes)
                    </td>
                    <td className="p-3 text-center">-</td>
                    <td className="p-3 text-right">-</td>
                    <td className="p-3 text-right">{formatNumber(visibleTotals.total_quantity)}</td>
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
                    <td className="p-3 text-right text-emerald-700 dark:text-emerald-400">
                      {formatAmount(visibleTotals.total_tax)}
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

      {/* Level 2 View: Item Breakdown under HSN */}
      {currentNav.level === 2 && "hsnCode" in currentNav && (
        <div className="ember-card p-6 space-y-4" data-testid="hsn-level2-container">
          <div className="flex items-center justify-between border-b border-[var(--ember-border)] pb-3">
            <div>
              <h3 className="text-sm font-bold font-serif text-[var(--ember-primary)] uppercase tracking-wider">
                HSN Breakdown: {currentNav.hsnCode} - {currentNav.description}
              </h3>
              <p className="text-xs text-[var(--ember-text-secondary)] mt-0.5">
                List of part numbers mapped to HSN {currentNav.hsnCode}. Click any part to inspect invoice line items.
              </p>
            </div>
            <span className="text-xs font-mono text-[var(--ember-text-muted)]">
              {processedItemRows.length} Parts / Items
            </span>
          </div>

          {loadingItemBreakdown ? (
            <div className="p-8 text-center text-[var(--ember-text-muted)] flex justify-center items-center gap-2">
              <RefreshCw className="w-4 h-4 animate-spin text-[var(--ember-primary)]" />
              Loading item breakdown...
            </div>
          ) : (
            <div className="border border-[var(--ember-border)] rounded-lg overflow-hidden bg-[var(--ember-surface-raised)]">
              <table className="w-full text-left border-collapse" data-testid="hsn-level2-table">
                <thead>
                  <tr className="bg-[var(--ember-surface)] text-[var(--ember-text-secondary)] font-bold border-b border-[var(--ember-border)]">
                    <th className="p-3">Part Code</th>
                    <th className="p-3">Part Description</th>
                    <th className="p-3 text-center">UOM</th>
                    <th className="p-3 text-right">GST Rate</th>
                    <th className="p-3 text-right">Quantity</th>
                    <th className="p-3 text-right">Avg Rate</th>
                    <th className="p-3 text-right">Taxable Value</th>
                    <th className="p-3 text-right">Total GST</th>
                    <th className="p-3 text-right">Gross Total</th>
                    <th className="p-3 text-right">Customers</th>
                    <th className="p-3 text-right">Invoices</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--ember-border-subtle)]">
                  {processedItemRows.map((row, idx) => (
                    <tr
                      key={idx}
                      data-testid={`hsn-item-row-${row.part_code}`}
                      onClick={() =>
                        handleSelectItem(
                          currentNav.hsnCode,
                          currentNav.description,
                          row.part_code,
                          row.part_name
                        )
                      }
                      className="hover:bg-[var(--ember-surface)] cursor-pointer text-[var(--ember-text-secondary)] transition-colors"
                    >
                      <td className="p-3 font-mono font-semibold text-[var(--ember-text-primary)]">
                        {row.part_code}
                      </td>
                      <td className="p-3 font-medium text-[var(--ember-text-primary)]">
                        {row.part_name}
                      </td>
                      <td className="p-3 text-center font-mono text-[var(--ember-text-muted)]">
                        {row.uom_code}
                      </td>
                      <td className="p-3 text-right font-mono text-[var(--ember-text-muted)]">
                        {row.default_gst_rate}%
                      </td>
                      <td className="p-3 text-right font-mono text-[var(--ember-text-muted)]">
                        {formatNumber(row.total_quantity)}
                      </td>
                      <td className="p-3 text-right font-mono text-[var(--ember-text-primary)]">
                        {formatAmount(row.avg_rate)}
                      </td>
                      <td className="p-3 text-right font-mono text-[var(--ember-text-primary)]">
                        {formatAmount(row.total_taxable)}
                      </td>
                      <td className="p-3 text-right font-mono text-emerald-700 dark:text-emerald-400">
                        {formatAmount(row.total_tax)}
                      </td>
                      <td className="p-3 text-right font-mono font-bold text-[var(--ember-primary)]">
                        {formatAmount(row.total_value)}
                      </td>
                      <td className="p-3 text-right font-mono text-[var(--ember-text-muted)]">
                        {formatNumber(row.customer_count)}
                      </td>
                      <td className="p-3 text-right font-mono text-[var(--ember-text-muted)]">
                        {formatNumber(row.invoice_count)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Level 3 View: Invoices for Selected Item under HSN */}
      {currentNav.level === 3 && "partCode" in currentNav && (
        <div className="ember-card p-6 space-y-4" data-testid="hsn-level3-container">
          <div className="flex items-center justify-between border-b border-[var(--ember-border)] pb-3">
            <div>
              <h3 className="text-sm font-bold font-serif text-[var(--ember-primary)] uppercase tracking-wider">
                Invoices: {currentNav.partName} ({currentNav.partCode}) — HSN {currentNav.hsnCode}
              </h3>
              <p className="text-xs text-[var(--ember-text-secondary)] mt-0.5">
                Double-click an invoice row to inspect or edit details.
              </p>
            </div>
            <span className="text-xs font-mono text-[var(--ember-text-muted)]">
              {processedInvoiceRows.length} Invoices Found
            </span>
          </div>

          {loadingInvoiceBreakdown ? (
            <div className="p-8 text-center text-[var(--ember-text-muted)] flex justify-center items-center gap-2">
              <RefreshCw className="w-4 h-4 animate-spin text-[var(--ember-primary)]" />
              Loading invoice list...
            </div>
          ) : (
            <div className="border border-[var(--ember-border)] rounded-lg overflow-hidden bg-[var(--ember-surface-raised)]">
              <table className="w-full text-left border-collapse" data-testid="hsn-level3-table">
                <thead>
                  <tr className="bg-[var(--ember-surface)] text-[var(--ember-text-secondary)] font-bold border-b border-[var(--ember-border)]">
                    <th className="p-3">Invoice No</th>
                    <th className="p-3">Date</th>
                    <th className="p-3">Customer</th>
                    <th className="p-3 text-right">Quantity</th>
                    <th className="p-3 text-center">UOM</th>
                    <th className="p-3 text-right">Rate / Unit</th>
                    <th className="p-3 text-right">Assessable Value</th>
                    <th className="p-3 text-right">CGST</th>
                    <th className="p-3 text-right">SGST</th>
                    <th className="p-3 text-right">IGST</th>
                    <th className="p-3 text-right">Gross Total</th>
                    <th className="p-3 text-center">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--ember-border-subtle)]">
                  {processedInvoiceRows.map((inv, idx) => (

                    <tr
                      key={idx}
                      onDoubleClick={() => onInspectInvoice && onInspectInvoice(inv.invoice_number)}
                      className="hover:bg-[var(--ember-surface)] cursor-pointer text-[var(--ember-text-secondary)] transition-colors"
                      title="Double click to inspect invoice"
                    >
                      <td className="p-3 font-mono font-bold text-[var(--ember-primary)]">
                        {inv.invoice_number}
                      </td>
                      <td className="p-3 font-mono">{formatDate(inv.invoice_date)}</td>
                      <td className="p-3 font-medium text-[var(--ember-text-primary)]">
                        {inv.customer_name} ({inv.customer_code})
                      </td>
                      <td className="p-3 text-right font-mono text-[var(--ember-text-muted)]">
                        {formatNumber(inv.quantity)}
                      </td>
                      <td className="p-3 text-center font-mono text-[var(--ember-text-muted)]">
                        {inv.uom_code}
                      </td>
                      <td className="p-3 text-right font-mono text-[var(--ember-text-primary)]">
                        {formatAmount(inv.rate_pre_unit)}
                      </td>
                      <td className="p-3 text-right font-mono text-[var(--ember-text-primary)]">
                        {formatAmount(inv.assessable_value)}
                      </td>
                      <td className="p-3 text-right font-mono text-emerald-700 dark:text-emerald-400">
                        {formatAmount(inv.cgst_amount)}
                      </td>
                      <td className="p-3 text-right font-mono text-emerald-700 dark:text-emerald-400">
                        {formatAmount(inv.sgst_amount)}
                      </td>
                      <td className="p-3 text-right font-mono text-blue-700 dark:text-blue-400">
                        {formatAmount(inv.igst_amount)}
                      </td>
                      <td className="p-3 text-right font-mono font-bold text-[var(--ember-primary)]">
                        {formatAmount(inv.total_value)}
                      </td>
                      <td className="p-3 text-center">
                        <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-[var(--ember-surface)] text-[var(--ember-text-primary)] border border-[var(--ember-border)]">
                          {inv.status}
                        </span>
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

export default HsnWiseReportTab;
