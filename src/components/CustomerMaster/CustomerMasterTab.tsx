import { useEffect, useState, useMemo } from "react";
import { ApiService, CustomerCategoryRow } from "../../services/api";
import { CustomerMasterRow } from "../../types/bindings/CustomerMasterRow";
import { useCustomerTable } from "./hooks/useCustomerTable";
import { CustomerKpiCards } from "./components/CustomerKpiCards";
import { CustomerFilterBar } from "./components/CustomerFilterBar";
import { DataGrid } from "../Table/DataGrid";
import { TablePagination } from "../Table/TablePagination";
import { TableSummaryBar } from "../Table/TableSummaryBar";
import { BulkActionBar } from "../Table/BulkActionBar";
import { ContextMenu } from "../Table/ContextMenu";
import { createCustomerRowActions } from "./metadata/customerActions";
import { TableExportService } from "../Table/services/tableExportService";
import CustomerDetailForm from "./CustomerDetailForm";
import CustomerImportPanel from "./CustomerImportPanel";

export default function CustomerMasterTab() {
  const [rows, setRows] = useState<CustomerMasterRow[]>([]);
  const [categories, setCategories] = useState<CustomerCategoryRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [editing, setEditing] = useState<CustomerMasterRow | null | undefined>(undefined); // undefined=closed, null=create
  const [showImport, setShowImport] = useState(false);
  const [contextMenuState, setContextMenuState] = useState<{
    mouseX: number;
    mouseY: number;
    row: CustomerMasterRow;
  } | null>(null);

  // Load dataset from backend API
  const load = async () => {
    setLoading(true);
    try {
      const [r, c] = await Promise.all([
        ApiService.getCustomerMaster(),
        ApiService.getCustomerCategories(),
      ]);
      setRows(r);
      setCategories(c);
    } catch (err) {
      console.error("Failed to load customer master database:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  // Initialize custom table orchestrator hook
  const table = useCustomerTable(rows);

  // Attach status badge formatter to match_status column
  const enrichedColumns = useMemo(() => {
    return table.columns.map((col) => {
      if (col.id === "match_status") {
        return {
          ...col,
          formatter: (row: CustomerMasterRow) => {
            const pillStyle =
              row.match_status === "Complete"
                ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border border-emerald-500/30"
                : row.match_status === "Incomplete"
                ? "bg-amber-500/15 text-amber-700 dark:text-amber-300 border border-amber-500/30"
                : "bg-rose-500/15 text-rose-700 dark:text-rose-300 border border-rose-500/30";
            return <span className={`px-2.5 py-1 ember-chip ${pillStyle}`}>{row.match_status}</span>;
          },
        };
      }
      if (col.id === "status") {
        return {
          ...col,
          formatter: (row: CustomerMasterRow) => {
            const isApproved = row.status === "Approved";
            return (
              <span
                className={`px-2 py-0.5 rounded text-[11px] font-semibold ${
                  isApproved
                    ? "bg-emerald-500/10 text-emerald-600 border border-emerald-500/20"
                    : "bg-amber-500/10 text-amber-600 border border-amber-500/20"
                }`}
              >
                {row.status}
              </span>
            );
          },
        };
      }
      return col;
    });
  }, [table.columns]);

  // Actions for Row Context Menu
  const rowActions = useMemo(
    () =>
      createCustomerRowActions({
        onEdit: (row) => setEditing(row),
        onCopyCode: (code) => navigator.clipboard.writeText(code),
        onCopyGstin: (gstin) => navigator.clipboard.writeText(gstin),
        onQuickApprove: async (row) => {
          try {
            await ApiService.updateCustomerMaster({
              id: Number(row.id),
              customer_code: row.customer_code,
              report_name: row.report_name,
              tally_name: row.tally_name,
              legal_name: row.legal_name,
              gstin: row.gstin,
              address1: row.address1,
              address2: row.address2,
              location: row.location,
              pincode: row.pincode,
              state_code: row.state_code,
              place_of_supply: row.place_of_supply,
              phone: row.phone,
              email: row.email,
              category_name: row.category_name,
              remarks: row.remarks,
              status: "Approved",
            });
            // Optimistic update in state + refresh
            setRows((prev) =>
              prev.map((item) => (item.id === row.id ? { ...item, status: "Approved" } : item))
            );
          } catch (err: any) {
            alert(`Failed to approve status: ${err.message || err}`);
          }
        },
      }),
    []
  );

  // Multi-Scope Export Handlers
  const handleExportCsv = (scope: "all" | "filtered") => {
    const exportData = scope === "all" ? table.rows : table.filteredRows;
    TableExportService.exportCSV({
      filename: `Customer_Master_${new Date().toISOString().slice(0, 10)}`,
      columns: enrichedColumns,
      data: exportData,
    });
  };

  const handleExportClipboard = (scope: "all" | "filtered") => {
    const exportData = scope === "all" ? table.rows : table.filteredRows;
    TableExportService.exportClipboard({
      filename: `Customer_Master`,
      columns: enrichedColumns,
      data: exportData,
    });
  };

  const handleExportPrint = (scope: "all" | "filtered") => {
    const exportData = scope === "all" ? table.rows : table.filteredRows;
    TableExportService.printView({
      filename: `Customer Master Database`,
      columns: enrichedColumns,
      data: exportData,
    });
  };

  // Bulk Export Handler
  const handleBulkExportSelected = () => {
    const selectedRows = table.rows.filter((r) =>
      table.selectionState.selectedIds.has(String(r.id))
    );
    TableExportService.exportCSV({
      filename: `Selected_Customers_${new Date().toISOString().slice(0, 10)}`,
      columns: enrichedColumns,
      data: selectedRows,
    });
  };

  return (
    <div className="space-y-4 flex flex-col flex-1">
      {/* 1. Quick Status KPI Cards */}
      <CustomerKpiCards
        metrics={table.kpiMetrics}
        activeMatchStatus={table.filterState.filters.matchStatus}
        onSelectMatchStatus={(status) =>
          table.filterState.setFilters((f) => ({ ...f, matchStatus: status }))
        }
      />

      {/* 2. Filter Bar & Controls */}
      <CustomerFilterBar
        filters={table.filterState.filters}
        categories={categories}
        locations={table.locations}
        columns={enrichedColumns}
        visibleColumns={table.columnState.visibleColumns}
        density={table.columnState.density}
        presets={table.presets}
        activePresetId={table.activePresetId}
        setFilters={table.filterState.setFilters}
        resetFilters={table.filterState.resetFilters}
        onChangeVisibleColumns={table.columnState.setVisibleColumns}
        onChangeDensity={table.columnState.setDensity}
        onSelectPreset={table.handleSelectPreset}
        onExportCsv={handleExportCsv}
        onExportClipboard={handleExportClipboard}
        onExportPrint={handleExportPrint}
        onOpenImport={() => setShowImport(true)}
        onOpenCreate={() => setEditing(null)}
      />

      {/* 3. Floating Selection Action Bar */}
      <BulkActionBar
        selectedCount={table.selectionState.selectedIds.size}
        onExportSelected={handleBulkExportSelected}
        onClearSelection={table.selectionState.clearSelection}
      />

      {/* 4. Data Grid Container with Sticky Summary & Pagination */}
      <div className="ember-card overflow-hidden flex flex-col flex-1">
        {/* Sticky Summary Bar */}
        <TableSummaryBar
          totalItems={table.rows.length}
          filteredItems={table.filteredRows.length}
          selectedCount={table.selectionState.selectedIds.size}
          activeFilterCount={table.filterState.activeFilterCount}
          hiddenColumnsCount={table.columns.length - table.columnState.visibleColumns.length}
          isTopSticky
        />

        {/* Data Grid Table */}
        <DataGrid
          data={table.paginatedRows}
          columns={enrichedColumns}
          visibleColumns={table.columnState.visibleColumns}
          rowKey={(r) => String(r.id)}
          loading={loading}
          density={table.columnState.density}
          sortConfig={table.sortConfig}
          selectionState={table.selectionState.selectionState}
          onSort={table.handleSort}
          onToggleSelectRow={(id) => table.selectionState.toggleSelectRow(id)}
          onToggleSelectPage={() => table.selectionState.toggleSelectPage(table.paginatedRows)}
          onRowDoubleClick={(row) => setEditing(row)}
          onRowContextMenu={(e, row) => {
            e.preventDefault();
            setContextMenuState({ mouseX: e.clientX, mouseY: e.clientY, row });
          }}
          emptyState={
            table.filterState.filters.searchQuery
              ? `No customer records match "${table.filterState.filters.searchQuery}".`
              : "No customer records found in database."
          }
        />

        {/* Pagination Bar */}
        <TablePagination
          totalItems={table.sortedRows.length}
          pageSize={table.paginationState.pageSize}
          pageIndex={table.paginationState.pageIndex}
          onPageChange={table.paginationState.setPageIndex}
          onPageSizeChange={table.paginationState.setPageSize}
        />
      </div>

      {/* 5. Right-Click Context Menu */}
      <ContextMenu
        contextMenu={contextMenuState}
        actions={rowActions}
        onClose={() => setContextMenuState(null)}
      />

      {/* 6. Edit/Create Modal */}
      {editing !== undefined && (
        <CustomerDetailForm
          initial={editing}
          categories={categories}
          onClose={() => setEditing(undefined)}
          onSaved={load}
        />
      )}

      {/* 7. Import Modal */}
      {showImport && (
        <CustomerImportPanel onClose={() => setShowImport(false)} onImported={load} />
      )}
    </div>
  );
}
