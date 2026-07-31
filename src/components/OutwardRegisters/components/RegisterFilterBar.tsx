import React, { useState, RefObject } from "react";
import { TableFilters, StatusType } from "../types/register";
import { ColumnVisibilityMenu } from "./ColumnVisibilityMenu";
import { TableDensityToggle } from "./TableDensityToggle";
import { SavedViewsMenu } from "./SavedViewsMenu";
import {
  Search,
  Filter,
  X,
  Calendar,
  Download,
  Printer,
  Copy,
  FileSpreadsheet,
  FileText,
  DollarSign,
  ChevronDown,
  RotateCcw,
} from "lucide-react";
import { TableDensity } from "../types/register";

interface Props {
  filters: TableFilters;
  searchInputRef: RefObject<HTMLInputElement | null>;
  uniqueCustomers: { code: string; name: string }[];
  visibleColumns: string[];
  density: TableDensity;
  setSearchQuery: (q: string) => void;
  setStatusFilter: (s: StatusType) => void;
  setCustomerFilter: (c: string) => void;
  setDateRange: (range: any) => void;
  setMinMaxValue: (min: number | null, max: number | null) => void;
  resetFilters: () => void;
  applyPresetViewFilters: (view: any) => void;
  onChangeVisibleColumns: (cols: string[]) => void;
  onChangeDensity: (density: TableDensity) => void;
  onExportCsv: () => void;
  onExportExcel: () => void;
  onExportClipboard: () => void;
  onExportPrint: () => void;
}

export const RegisterFilterBar: React.FC<Props> = ({
  filters,
  searchInputRef,
  uniqueCustomers,
  visibleColumns,
  density,
  setSearchQuery,
  setStatusFilter,
  setCustomerFilter,
  setDateRange,
  setMinMaxValue,
  resetFilters,
  applyPresetViewFilters,
  onChangeVisibleColumns,
  onChangeDensity,
  onExportCsv,
  onExportExcel,
  onExportClipboard,
  onExportPrint,
}) => {
  const [isExportOpen, setIsExportOpen] = useState(false);
  const [isMoreFiltersOpen, setIsMoreFiltersOpen] = useState(false);

  const hasActiveFilters =
    filters.searchQuery !== "" ||
    filters.statusFilter !== "ALL" ||
    filters.customerFilter !== "ALL" ||
    filters.dateRange.from !== "" ||
    filters.dateRange.to !== "" ||
    filters.valueRange.min !== null ||
    filters.valueRange.max !== null;

  return (
    <div className="space-y-3 select-none">
      {/* Top Main Filter Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-3 ember-card p-3">
        {/* Left: Search input */}
        <div className="flex items-center gap-2 flex-1 min-w-[260px] max-w-lg">
          <div className="relative w-full">
            <Search className="absolute left-3 top-2.5 w-4 h-4 text-[var(--ember-text-muted)]" />
            <input
              ref={searchInputRef as any}
              type="text"
              placeholder="Search by Invoice No, Customer Code or Name... (Ctrl+F)"
              value={filters.searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full ember-input pl-9 pr-8 py-2 text-xs"
            />
            {filters.searchQuery && (
              <button
                onClick={() => setSearchQuery("")}
                className="absolute right-2.5 top-2.5 text-[var(--ember-text-muted)] hover:text-[var(--ember-text-primary)]"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        </div>

        {/* Right: Quick actions & view controls */}
        <div className="flex flex-wrap items-center gap-2">
          {/* Customer Dropdown Quick Filter */}
          <select
            value={filters.customerFilter}
            onChange={(e) => setCustomerFilter(e.target.value)}
            className="ember-input text-xs py-1.5 px-3 rounded-lg max-w-[180px] truncate"
          >
            <option value="ALL">All Customers</option>
            {uniqueCustomers.map((cust) => (
              <option key={cust.code} value={cust.code}>
                {cust.name} ({cust.code})
              </option>
            ))}
          </select>

          {/* More Filters Toggle */}
          <button
            onClick={() => setIsMoreFiltersOpen((prev) => !prev)}
            className={`px-3 py-1.5 rounded-lg border text-xs transition-all flex items-center gap-1.5 font-medium cursor-pointer shadow-sm ${
              filters.dateRange.from || filters.valueRange.min !== null
                ? "border-[var(--ember-primary)] bg-[var(--ember-primary)]/15 text-[var(--ember-primary)]"
                : "border-[var(--ember-border)] bg-[var(--ember-surface-raised)] text-[var(--ember-text-secondary)] hover:text-[var(--ember-text-primary)]"
            }`}
          >
            <Filter className="w-3.5 h-3.5 text-[var(--ember-primary)]" />
            <span>Filters</span>
          </button>

          {/* Saved Views Menu */}
          <SavedViewsMenu onApplyView={(preset) => applyPresetViewFilters(preset.filters)} />

          {/* Column Visibility & Density */}
          <ColumnVisibilityMenu
            visibleColumns={visibleColumns}
            onChangeVisibleColumns={onChangeVisibleColumns}
          />
          <TableDensityToggle density={density} onChangeDensity={onChangeDensity} />

          {/* Multi-Format Export Dropdown */}
          <div className="relative">
            <button
              onClick={() => setIsExportOpen((prev) => !prev)}
              className="px-3 py-1.5 rounded-lg bg-[var(--ember-primary)] text-white hover:opacity-90 font-semibold text-xs transition-all flex items-center gap-1.5 cursor-pointer shadow-sm"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Export</span>
              <ChevronDown className="w-3 h-3 ml-0.5 opacity-80" />
            </button>

            {isExportOpen && (
              <>
                <div className="fixed inset-0 z-30" onClick={() => setIsExportOpen(false)} />
                <div className="absolute right-0 mt-2 w-48 rounded-xl border border-[var(--ember-border)] bg-[var(--ember-surface)] shadow-2xl p-1.5 z-40 text-xs">
                  <button
                    onClick={() => {
                      onExportCsv();
                      setIsExportOpen(false);
                    }}
                    className="w-full text-left px-3 py-2 rounded-lg hover:bg-[var(--ember-surface-raised)] flex items-center gap-2 text-[var(--ember-text-primary)]"
                  >
                    <FileText className="w-4 h-4 text-emerald-500" />
                    <span>CSV File (.csv)</span>
                  </button>

                  <button
                    onClick={() => {
                      onExportExcel();
                      setIsExportOpen(false);
                    }}
                    className="w-full text-left px-3 py-2 rounded-lg hover:bg-[var(--ember-surface-raised)] flex items-center gap-2 text-[var(--ember-text-primary)]"
                  >
                    <FileSpreadsheet className="w-4 h-4 text-emerald-600" />
                    <span>Excel Workbook (.xls)</span>
                  </button>

                  <button
                    onClick={() => {
                      onExportClipboard();
                      setIsExportOpen(false);
                    }}
                    className="w-full text-left px-3 py-2 rounded-lg hover:bg-[var(--ember-surface-raised)] flex items-center gap-2 text-[var(--ember-text-primary)]"
                  >
                    <Copy className="w-4 h-4 text-sky-500" />
                    <span>Copy to Clipboard</span>
                  </button>

                  <button
                    onClick={() => {
                      onExportPrint();
                      setIsExportOpen(false);
                    }}
                    className="w-full text-left px-3 py-2 rounded-lg hover:bg-[var(--ember-surface-raised)] flex items-center gap-2 text-[var(--ember-text-primary)]"
                  >
                    <Printer className="w-4 h-4 text-purple-500" />
                    <span>Print Report View</span>
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Expanded Filter Drawer (Date Range & Value Thresholds) */}
      {isMoreFiltersOpen && (
        <div className="ember-card p-4 grid grid-cols-1 md:grid-cols-2 gap-4 border-l-4 border-l-[var(--ember-primary)]">
          {/* Date Range Picker */}
          <div>
            <label className="block text-[11px] font-semibold text-[var(--ember-text-muted)] uppercase mb-2 flex items-center gap-1.5">
              <Calendar className="w-3.5 h-3.5 text-[var(--ember-primary)]" />
              Invoice Date Range
            </label>
            <div className="flex items-center gap-2">
              <input
                type="date"
                value={filters.dateRange.from}
                onChange={(e) => setDateRange({ from: e.target.value })}
                className="ember-input text-xs py-1.5 px-3 rounded-lg w-full"
              />
              <span className="text-xs text-[var(--ember-text-muted)]">to</span>
              <input
                type="date"
                value={filters.dateRange.to}
                onChange={(e) => setDateRange({ to: e.target.value })}
                className="ember-input text-xs py-1.5 px-3 rounded-lg w-full"
              />
            </div>
          </div>

          {/* Total Value Threshold Filter */}
          <div>
            <label className="block text-[11px] font-semibold text-[var(--ember-text-muted)] uppercase mb-2 flex items-center gap-1.5">
              <DollarSign className="w-3.5 h-3.5 text-[var(--ember-primary)]" />
              Total Value Range (₹)
            </label>
            <div className="flex items-center gap-2">
              <input
                type="number"
                placeholder="Min Amount"
                value={filters.valueRange.min ?? ""}
                onChange={(e) =>
                  setMinMaxValue(e.target.value ? Number(e.target.value) : null, filters.valueRange.max)
                }
                className="ember-input text-xs py-1.5 px-3 rounded-lg w-full"
              />
              <span className="text-xs text-[var(--ember-text-muted)]">-</span>
              <input
                type="number"
                placeholder="Max Amount"
                value={filters.valueRange.max ?? ""}
                onChange={(e) =>
                  setMinMaxValue(filters.valueRange.min, e.target.value ? Number(e.target.value) : null)
                }
                className="ember-input text-xs py-1.5 px-3 rounded-lg w-full"
              />
            </div>
          </div>
        </div>
      )}

      {/* Active Filter Chips & Reset Row */}
      {hasActiveFilters && (
        <div className="flex items-center flex-wrap gap-2 px-1 text-xs">
          <span className="text-[11px] font-semibold text-[var(--ember-text-muted)] uppercase">Active Filters:</span>
          
          {filters.searchQuery && (
            <span className="px-2.5 py-1 rounded-md bg-[var(--ember-surface-raised)] border border-[var(--ember-border)] text-[var(--ember-text-primary)] flex items-center gap-1">
              Search: "{filters.searchQuery}"
              <X className="w-3 h-3 cursor-pointer text-[var(--ember-text-muted)] hover:text-rose-500" onClick={() => setSearchQuery("")} />
            </span>
          )}

          {filters.statusFilter !== "ALL" && (
            <span className="px-2.5 py-1 rounded-md bg-[var(--ember-surface-raised)] border border-[var(--ember-border)] text-[var(--ember-text-primary)] flex items-center gap-1">
              Status: {filters.statusFilter}
              <X className="w-3 h-3 cursor-pointer text-[var(--ember-text-muted)] hover:text-rose-500" onClick={() => setStatusFilter("ALL")} />
            </span>
          )}

          {filters.customerFilter !== "ALL" && (
            <span className="px-2.5 py-1 rounded-md bg-[var(--ember-surface-raised)] border border-[var(--ember-border)] text-[var(--ember-text-primary)] flex items-center gap-1">
              Customer: {filters.customerFilter}
              <X className="w-3 h-3 cursor-pointer text-[var(--ember-text-muted)] hover:text-rose-500" onClick={() => setCustomerFilter("ALL")} />
            </span>
          )}

          {(filters.dateRange.from || filters.dateRange.to) && (
            <span className="px-2.5 py-1 rounded-md bg-[var(--ember-surface-raised)] border border-[var(--ember-border)] text-[var(--ember-text-primary)] flex items-center gap-1">
              Date: {filters.dateRange.from || "Start"} → {filters.dateRange.to || "End"}
              <X className="w-3 h-3 cursor-pointer text-[var(--ember-text-muted)] hover:text-rose-500" onClick={() => setDateRange({ from: "", to: "" })} />
            </span>
          )}

          <button
            onClick={resetFilters}
            className="text-[11px] font-semibold text-[var(--ember-primary)] hover:underline flex items-center gap-1 ml-2 cursor-pointer"
          >
            <RotateCcw className="w-3 h-3" /> Clear All Filters
          </button>
        </div>
      )}
    </div>
  );
};
