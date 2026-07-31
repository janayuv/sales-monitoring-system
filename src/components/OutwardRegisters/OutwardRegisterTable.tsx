import React, { useState } from "react";
import { InvoiceSummary } from "../../types";
import { useRegisterTable } from "./hooks/useRegisterTable";
import { RegisterKpiCards } from "./components/RegisterKpiCards";
import { RegisterFilterBar } from "./components/RegisterFilterBar";
import { RegisterSummaryBar } from "./components/RegisterSummaryBar";
import { InvoiceGridTable } from "./components/InvoiceGridTable";
import { PaginationBar } from "./components/PaginationBar";
import { RowContextMenu } from "./components/RowContextMenu";
import { BulkActionBar } from "./components/BulkActionBar";
import { BulkVerifyConfirmModal } from "./components/BulkVerifyConfirmModal";
import { InvoiceEditModal } from "./components/InvoiceEditModal";
import { SHORTCUTS } from "./constants/shortcuts";
import { Command } from "lucide-react";
import { ApiService } from "../../services/api";
import { BulkActionResult } from "./types/register";
import { ExportService } from "./services/exportService";

interface Props {
  invoices: InvoiceSummary[];
  loading: boolean;
  companyCode: string;
  onOpenDetails: (invoiceNumber: string) => void;
  onRefreshData?: () => void;
  onNotify?: (msg: string, type: "success" | "error" | "info") => void;
}

export const OutwardRegisterTable: React.FC<Props> = ({
  invoices,
  loading,
  companyCode,
  onOpenDetails,
  onRefreshData,
  onNotify,
}) => {
  const tableState = useRegisterTable(invoices, companyCode);
  const [isConfirmModalOpen, setIsConfirmModalOpen] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [editingInvoiceNumber, setEditingInvoiceNumber] = useState<string | null>(null);

  const handleStartEdit = async (invNo: string) => {
    try {
      await ApiService.validateInvoiceEditEligibility(invNo);
      setEditingInvoiceNumber(invNo);
    } catch (err: any) {
      const errorMsg = `Cannot edit invoice: ${err.message || err}`;
      if (onNotify) {
        onNotify(errorMsg, "error");
      } else {
        alert(errorMsg);
      }
    }
  };

  const handleSavedEdit = () => {
    setEditingInvoiceNumber(null);
    if (onNotify) {
      onNotify("Invoice updated successfully.", "success");
    }
    if (onRefreshData) {
      onRefreshData();
    }
  };

  const handleExecuteBulkVerify = async () => {
    setIsProcessing(true);
    try {
      const payload = tableState.getIpcSelectionPayload();
      const res: BulkActionResult = await ApiService.bulkVerifyInvoices(payload, "System User");
      setIsConfirmModalOpen(false);
      tableState.clearSelection();

      let notifyMsg = `Successfully verified ${res.updated} invoice(s) [Batch: ${res.batch_id.substring(0, 8)} in ${res.execution_time_ms}ms].`;
      if (res.skipped > 0) {
        notifyMsg += ` (${res.skipped} skipped)`;
      }
      if (res.failed > 0) {
        notifyMsg += ` (${res.failed} failed)`;
      }

      if (onNotify) {
        onNotify(notifyMsg, "success");
      } else {
        alert(notifyMsg);
      }

      if (onRefreshData) {
        onRefreshData();
      }
    } catch (err: any) {
      const errorMsg = `Bulk verification failed: ${err.message || err}`;
      if (onNotify) {
        onNotify(errorMsg, "error");
      } else {
        alert(errorMsg);
      }
    } finally {
      setIsProcessing(false);
    }
  };

  const handleQuickVerifySingle = async (invoiceNumber: string) => {
    try {
      await ApiService.updateInvoiceStatus(invoiceNumber, "Verified", "System User");
      if (onNotify) {
        onNotify(`Invoice #${invoiceNumber} marked as Verified.`, "success");
      }
      if (onRefreshData) {
        onRefreshData();
      }
    } catch (err: any) {
      const errorMsg = `Failed to verify invoice: ${err.message || err}`;
      if (onNotify) {
        onNotify(errorMsg, "error");
      } else {
        alert(errorMsg);
      }
    }
  };

  const handleExportSelectedCsv = () => {
    const selectedInvoices = invoices.filter((i) =>
      tableState.selectionState.type === "filtered"
        ? i.status === "Imported" || i.status === "Draft"
        : tableState.selectionState.type === "filtered_except"
        ? (i.status === "Imported" || i.status === "Draft") && !tableState.selectionState.excludedIds.has(i.invoice_number)
        : tableState.selectionState.selectedIds.has(i.invoice_number)
    );
    ExportService.exportCSV(selectedInvoices, tableState.filters);
  };

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

      {/* 3. Floating Selection Action Bar */}
      <BulkActionBar
        selectedCount={tableState.selectedSummary.count}
        selectedTaxable={tableState.selectedSummary.taxable}
        selectedTax={tableState.selectedSummary.tax}
        selectedTotal={tableState.selectedSummary.total}
        isProcessing={isProcessing}
        onOpenConfirmModal={() => setIsConfirmModalOpen(true)}
        onExportSelected={handleExportSelectedCsv}
        onClearSelection={tableState.clearSelection}
      />

      {/* 4. Main Data Table Container with Sticky Top Summary */}
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
          selectionState={tableState.selectionState}
          onSort={tableState.handleSort}
          onOpenDetails={onOpenDetails}
          onEditInvoice={handleStartEdit}
          onContextMenu={tableState.openContextMenu}
          onToggleSelectInvoice={tableState.toggleSelectInvoice}
          onToggleSelectPage={tableState.toggleSelectPage}
          onSelectFilteredUnverified={tableState.selectFilteredUnverified}
          onClearSelection={tableState.clearSelection}
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

      {/* 5. Keyboard Shortcuts Footer Bar */}
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

      {/* 6. Right Click Context Menu */}
      <RowContextMenu
        contextMenu={tableState.contextMenu}
        onClose={tableState.closeContextMenu}
        onInspect={onOpenDetails}
        onEdit={handleStartEdit}
        onQuickVerify={handleQuickVerifySingle}
      />

      {/* 7. Bulk Verification Confirmation Dialog Modal */}
      <BulkVerifyConfirmModal
        isOpen={isConfirmModalOpen}
        count={tableState.selectedSummary.count}
        taxable={tableState.selectedSummary.taxable}
        tax={tableState.selectedSummary.tax}
        total={tableState.selectedSummary.total}
        isProcessing={isProcessing}
        onConfirm={handleExecuteBulkVerify}
        onClose={() => setIsConfirmModalOpen(false)}
      />

      {/* 8. Invoice Edit Modal */}
      {editingInvoiceNumber && (
        <InvoiceEditModal
          invoiceNumber={editingInvoiceNumber}
          onClose={() => setEditingInvoiceNumber(null)}
          onSaved={handleSavedEdit}
        />
      )}
    </div>
  );
};
