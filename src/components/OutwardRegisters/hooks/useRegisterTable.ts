import { useRef, useState } from "react";
import { InvoiceSummary } from "../../../types";
import { useRegisterFilters } from "./useRegisterFilters";
import { useRegisterSorting } from "./useRegisterSorting";
import { useRegisterPagination } from "./useRegisterPagination";
import { useRegisterSummary } from "./useRegisterSummary";
import { useRegisterPreferences } from "./useRegisterPreferences";
import { useKeyboardShortcuts } from "./useKeyboardShortcuts";
import { ExportService } from "../services/exportService";
import { ContextMenuState } from "../types/register";

export function useRegisterTable(
  invoices: InvoiceSummary[],
  companyCode: string
) {
  const searchInputRef = useRef<HTMLInputElement>(null);

  // 1. Preferences Hook
  const {
    preferences,
    setDensity,
    setPageSize: persistPageSize,
    setVisibleColumns,
    setSavedSortConfig,
  } = useRegisterPreferences();

  // 2. Filters Hook
  const {
    filters,
    filteredInvoices,
    uniqueCustomers,
    setSearchQuery,
    setStatusFilter,
    setCustomerFilter,
    setDateRange,
    setMinMaxValue,
    resetFilters,
    applyPresetViewFilters,
  } = useRegisterFilters(invoices);

  // 3. Sorting Hook
  const { sortConfig, sortedInvoices, handleSort, setSortConfig } =
    useRegisterSorting(filteredInvoices, preferences.sortConfig);

  // Update preference when sort changes
  const handleSortAndSave = (col: keyof InvoiceSummary) => {
    handleSort(col);
    setSavedSortConfig({
      column: col,
      direction:
        sortConfig.column === col && sortConfig.direction === "desc"
          ? "asc"
          : "desc",
    });
  };

  // 4. Pagination Hook
  const {
    pageSize,
    currentPageIndex,
    totalPages,
    paginatedItems,
    handlePrevPage,
    handleNextPage,
    handlePageSizeChange,
  } = useRegisterPagination(sortedInvoices, preferences.pageSize);

  const onPageSizeChange = (newSize: number) => {
    handlePageSizeChange(newSize);
    persistPageSize(newSize);
  };

  // 5. Accounting Summaries & KPI Metrics
  const { filteredSummary, kpiMetrics } = useRegisterSummary(
    invoices,
    filteredInvoices
  );

  // 6. Right-Click Context Menu State
  const [contextMenu, setContextMenu] = useState<ContextMenuState>({
    visible: false,
    x: 0,
    y: 0,
    invoice: null,
  });

  const openContextMenu = (
    e: React.MouseEvent,
    invoice: InvoiceSummary
  ) => {
    e.preventDefault();
    setContextMenu({
      visible: true,
      x: e.clientX,
      y: e.clientY,
      invoice,
    });
  };

  const closeContextMenu = () => {
    setContextMenu((prev) => ({ ...prev, visible: false }));
  };

  // 7. Export Handlers
  const handleExportCsv = () => {
    ExportService.exportCSV(sortedInvoices, filters);
  };

  const handleExportExcel = () => {
    ExportService.exportExcel(sortedInvoices);
  };

  const handleExportClipboard = () => {
    ExportService.exportClipboard(sortedInvoices);
  };

  const handleExportPrint = () => {
    ExportService.exportPrint(sortedInvoices, filters, companyCode);
  };

  // 8. Keyboard Shortcuts
  useKeyboardShortcuts({
    searchInputRef,
    onExportCsv: handleExportCsv,
    onResetFilters: resetFilters,
    onPrevPage: handlePrevPage,
    onNextPage: handleNextPage,
  });

  return {
    // Inputs & References
    searchInputRef,
    companyCode,

    // Data lists
    allInvoices: invoices,
    filteredInvoices,
    sortedInvoices,
    paginatedInvoices: paginatedItems,
    uniqueCustomers,

    // States & Preferences
    filters,
    sortConfig,
    pageSize,
    currentPageIndex,
    totalPages,
    density: preferences.density,
    visibleColumns: preferences.visibleColumns,
    contextMenu,

    // Totals & KPI Cards
    filteredSummary,
    kpiMetrics,

    // Actions
    setSearchQuery,
    setStatusFilter,
    setCustomerFilter,
    setDateRange,
    setMinMaxValue,
    resetFilters,
    applyPresetViewFilters,

    handleSort: handleSortAndSave,
    setSortConfig,
    handlePrevPage,
    handleNextPage,
    onPageSizeChange,
    setDensity,
    setVisibleColumns,

    // Context Menu
    openContextMenu,
    closeContextMenu,

    // Exports
    handleExportCsv,
    handleExportExcel,
    handleExportClipboard,
    handleExportPrint,
  };
}
