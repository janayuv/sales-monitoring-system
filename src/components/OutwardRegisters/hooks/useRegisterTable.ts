import { useRef, useState, useMemo, useEffect } from "react";
import { InvoiceSummary } from "../../../types";
import { useRegisterFilters } from "./useRegisterFilters";
import { useRegisterSorting } from "./useRegisterSorting";
import { useRegisterPagination } from "./useRegisterPagination";
import { useRegisterSummary } from "./useRegisterSummary";
import { useRegisterPreferences } from "./useRegisterPreferences";
import { useKeyboardShortcuts } from "./useKeyboardShortcuts";
import { ExportService } from "../services/exportService";
import { ContextMenuState, SelectionState } from "../types/register";

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

  // 6. Selection State Management (Gmail-style)
  const [selectionState, setSelectionState] = useState<SelectionState>({
    type: "none",
    selectedIds: new Set<string>(),
    excludedIds: new Set<string>(),
  });

  const toggleSelectInvoice = (invoiceNumber: string) => {
    setSelectionState((prev) => {
      if (prev.type === "filtered") {
        const newExcluded = new Set(prev.excludedIds);
        if (newExcluded.has(invoiceNumber)) {
          newExcluded.delete(invoiceNumber);
        } else {
          newExcluded.add(invoiceNumber);
        }
        return { ...prev, type: "filtered_except", excludedIds: newExcluded };
      }
      if (prev.type === "filtered_except") {
        const newExcluded = new Set(prev.excludedIds);
        if (newExcluded.has(invoiceNumber)) {
          newExcluded.delete(invoiceNumber);
        } else {
          newExcluded.add(invoiceNumber);
        }
        return { ...prev, excludedIds: newExcluded };
      }
      const newSelected = new Set(prev.selectedIds);
      if (newSelected.has(invoiceNumber)) {
        newSelected.delete(invoiceNumber);
      } else {
        newSelected.add(invoiceNumber);
      }
      return {
        type: newSelected.size === 0 ? "none" : "page",
        selectedIds: newSelected,
        excludedIds: new Set(),
      };
    });
  };

  const toggleSelectPage = (pageInvoices: InvoiceSummary[]) => {
    const pageIds = pageInvoices
      .filter((inv) => inv.status === "Imported" || inv.status === "Draft")
      .map((inv) => inv.invoice_number);
    if (pageIds.length === 0) return;

    setSelectionState((prev) => {
      const allSelected = pageIds.every((id) => prev.selectedIds.has(id));
      const newSelected = new Set(prev.selectedIds);
      if (allSelected) {
        pageIds.forEach((id) => newSelected.delete(id));
      } else {
        pageIds.forEach((id) => newSelected.add(id));
      }
      return {
        type: newSelected.size === 0 ? "none" : "page",
        selectedIds: newSelected,
        excludedIds: new Set(),
      };
    });
  };

  const selectFilteredUnverified = () => {
    setSelectionState({
      type: "filtered",
      selectedIds: new Set(),
      excludedIds: new Set(),
    });
  };

  const clearSelection = () => {
    setSelectionState({
      type: "none",
      selectedIds: new Set(),
      excludedIds: new Set(),
    });
  };

  // Reconcile selection if invoices change
  useEffect(() => {
    if (selectionState.type === "page") {
      const validIds = new Set(invoices.map((i) => i.invoice_number));
      const reconciled = new Set(
        Array.from(selectionState.selectedIds).filter((id) => validIds.has(id))
      );
      if (reconciled.size !== selectionState.selectedIds.size) {
        setSelectionState((prev) => ({
          ...prev,
          type: reconciled.size === 0 ? "none" : "page",
          selectedIds: reconciled,
        }));
      }
    }
  }, [invoices, filters]);

  // Aggregate selected monetary totals
  const selectedSummary = useMemo(() => {
    if (selectionState.type === "none") {
      return { count: 0, taxable: 0, tax: 0, total: 0 };
    }
    if (selectionState.type === "filtered") {
      const unverified = filteredInvoices.filter(
        (i) => i.status === "Imported" || i.status === "Draft"
      );
      return {
        count: unverified.length,
        taxable: unverified.reduce((acc, i) => acc + i.total_taxable, 0),
        tax: unverified.reduce((acc, i) => acc + i.total_tax, 0),
        total: unverified.reduce((acc, i) => acc + i.total_value, 0),
      };
    }
    if (selectionState.type === "filtered_except") {
      const unverified = filteredInvoices.filter(
        (i) =>
          (i.status === "Imported" || i.status === "Draft") &&
          !selectionState.excludedIds.has(i.invoice_number)
      );
      return {
        count: unverified.length,
        taxable: unverified.reduce((acc, i) => acc + i.total_taxable, 0),
        tax: unverified.reduce((acc, i) => acc + i.total_tax, 0),
        total: unverified.reduce((acc, i) => acc + i.total_value, 0),
      };
    }
    // "page" mode
    const selectedInvoices = invoices.filter((i) =>
      selectionState.selectedIds.has(i.invoice_number)
    );
    return {
      count: selectedInvoices.length,
      taxable: selectedInvoices.reduce((acc, i) => acc + i.total_taxable, 0),
      tax: selectedInvoices.reduce((acc, i) => acc + i.total_tax, 0),
      total: selectedInvoices.reduce((acc, i) => acc + i.total_value, 0),
    };
  }, [selectionState, filteredInvoices, invoices]);

  // Convert SelectionState to Rust IPC SelectionModeDTO
  const getIpcSelectionPayload = () => {
    const filterDto = {
      search_query: filters.searchQuery || null,
      status_filter: filters.statusFilter === "ALL" ? null : filters.statusFilter,
      customer_code: filters.customerFilter === "ALL" ? null : filters.customerFilter,
      date_from: filters.dateRange.from || null,
      date_to: filters.dateRange.to || null,
      min_value: filters.valueRange.min,
      max_value: filters.valueRange.max,
    };

    if (selectionState.type === "filtered") {
      return {
        type: "ServerResolved",
        payload: { filter: filterDto },
      };
    }
    if (selectionState.type === "filtered_except") {
      return {
        type: "ServerResolvedExcept",
        payload: {
          filter: filterDto,
          excluded_invoice_numbers: Array.from(selectionState.excludedIds),
        },
      };
    }
    return {
      type: "Direct",
      payload: {
        invoice_numbers: Array.from(selectionState.selectedIds),
      },
    };
  };

  // 7. Right-Click Context Menu State
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

  // 8. Export Handlers
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

  // 9. Keyboard Shortcuts
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

    // Selection & Totals
    selectionState,
    selectedSummary,
    toggleSelectInvoice,
    toggleSelectPage,
    selectFilteredUnverified,
    clearSelection,
    getIpcSelectionPayload,

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
