import React from "react";
import { InvoiceSummary } from "../../types";
import { useRegisterTable } from "./hooks/useRegisterTable";
import { RegisterKpiCards } from "./components/RegisterKpiCards";
import { RegisterFilterBar } from "./components/RegisterFilterBar";
import { RegisterSummaryBar } from "./components/RegisterSummaryBar";
import { InvoiceGridTable } from "./components/InvoiceGridTable";
import { PaginationBar } from "./components/PaginationBar";
import { RowContextMenu } from "./components/RowContextMenu";
import { SHORTCUTS } from "./constants/shortcuts";
import { Command } from "lucide-react";

interface Props {
  invoices: InvoiceSummary[];
  loading: boolean;
  companyCode: string;
  onOpenDetails: (invoiceNumber: string) => void;
}

export const OutwardRegisterTable: React.FC<Props> = ({
  invoices,
  loading,
  companyCode,
  onOpenDetails,
}) => {
  const tableState = useRegisterTable(invoices, companyCode);

  return (
    <div className="space-y-4 flex flex-col flex-1">
      {/* 1. Quick Status KPI Cards */}
      <RegisterKpiCards
        metrics={tableState.kpiMetrics}
        activeStatus={tableState.filters.statusFilter}
        onSelectStatus={tableState.setStatusFilter}
      />

      {/* 2. Filter Bar & Controls */}
      <RegisterFilterBar
        filters={tableState.filters}
        searchInputRef={tableState.searchInputRef}
        uniqueCustomers={tableState.uniqueCustomers}
        visibleColumns={tableState.visibleColumns}
        density={tableState.density}
        setSearchQuery={tableState.setSearchQuery}
        setStatusFilter={tableState.setStatusFilter}
        setCustomerFilter={tableState.setCustomerFilter}
        setDateRange={tableState.setDateRange}
        setMinMaxValue={tableState.setMinMaxValue}
        resetFilters={tableState.resetFilters}
        applyPresetViewFilters={tableState.applyPresetViewFilters}
        onChangeVisibleColumns={tableState.setVisibleColumns}
        onChangeDensity={tableState.setDensity}
        onExportCsv={tableState.handleExportCsv}
        onExportExcel={tableState.handleExportExcel}
        onExportClipboard={tableState.handleExportClipboard}
        onExportPrint={tableState.handleExportPrint}
      />

      {/* 3. Main Data Table Container with Sticky Top Summary */}
      <div className="ember-card overflow-hidden flex-1 flex flex-col">
        {/* Sticky Top Totals Bar */}
        <RegisterSummaryBar summary={tableState.filteredSummary} isTopSticky />

        {/* Data Grid Table */}
        <InvoiceGridTable
          invoices={tableState.paginatedInvoices}
          loading={loading}
          visibleColumns={tableState.visibleColumns}
          density={tableState.density}
          sortConfig={tableState.sortConfig}
          onSort={tableState.handleSort}
          onOpenDetails={onOpenDetails}
          onContextMenu={tableState.openContextMenu}
        />

        {/* Bottom Totals & Pagination Footer */}
        <PaginationBar
          totalItems={tableState.sortedInvoices.length}
          pageSize={tableState.pageSize}
          currentPageIndex={tableState.currentPageIndex}
          totalPages={tableState.totalPages}
          onPrevPage={tableState.handlePrevPage}
          onNextPage={tableState.handleNextPage}
          onPageSizeChange={tableState.onPageSizeChange}
        />
      </div>

      {/* 4. Keyboard Shortcuts Footer Bar */}
      <div className="flex items-center justify-between gap-4 text-[11px] text-[var(--ember-text-muted)] px-2 font-mono select-none">
        <div className="flex items-center gap-4 flex-wrap">
          <span className="flex items-center gap-1 font-semibold text-[var(--ember-text-secondary)] font-sans">
            <Command className="w-3 h-3 text-[var(--ember-primary)]" /> Shortcuts:
          </span>
          {SHORTCUTS.map((s) => (
            <span key={s.keyCombo} className="inline-flex items-center gap-1">
              <kbd className="px-1.5 py-0.5 rounded bg-[var(--ember-surface-raised)] border border-[var(--ember-border)] font-mono text-[10px] text-[var(--ember-text-primary)]">
                {s.keyCombo}
              </kbd>
              <span>{s.description}</span>
            </span>
          ))}
        </div>
      </div>

      {/* 5. Right Click Context Menu */}
      <RowContextMenu
        contextMenu={tableState.contextMenu}
        onClose={tableState.closeContextMenu}
        onInspect={onOpenDetails}
      />
    </div>
  );
};
