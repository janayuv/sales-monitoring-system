import React, { useState, useRef, useEffect } from "react";
import {
  Search,
  RotateCcw,
  Download,
  FileSpreadsheet,
  UserPlus,
  Printer,
  Copy,
} from "lucide-react";
import { CustomerCategoryRow } from "../../../services/api";
import { CustomerFiltersState } from "../metadata/customerFilters";
import { ColumnDefinition, SavedViewPreset, TableDensity } from "../../Table/types";
import { CustomerMasterRow } from "../../../types/bindings/CustomerMasterRow";
import { ColumnVisibilityMenu } from "../../Table/ColumnVisibilityMenu";
import { TableDensityToggle } from "../../Table/TableDensityToggle";
import { SavedViewsMenu } from "../../Table/SavedViewsMenu";

interface CustomerFilterBarProps {
  filters: CustomerFiltersState;
  categories: CustomerCategoryRow[];
  locations: string[];
  columns: ColumnDefinition<CustomerMasterRow>[];
  visibleColumns: string[];
  density: TableDensity;
  presets: SavedViewPreset[];
  activePresetId: string;
  setFilters: React.Dispatch<React.SetStateAction<CustomerFiltersState>>;
  resetFilters: () => void;
  onChangeVisibleColumns: (cols: string[]) => void;
  onChangeDensity: (density: TableDensity) => void;
  onSelectPreset: (preset: SavedViewPreset) => void;
  onExportCsv: (scope: "all" | "filtered") => void;
  onExportClipboard: (scope: "all" | "filtered") => void;
  onExportPrint: (scope: "all" | "filtered") => void;
  onOpenImport: () => void;
  onOpenCreate: () => void;
}

export const CustomerFilterBar: React.FC<CustomerFilterBarProps> = ({
  filters,
  categories,
  locations,
  columns,
  visibleColumns,
  density,
  presets,
  activePresetId,
  setFilters,
  resetFilters,
  onChangeVisibleColumns,
  onChangeDensity,
  onSelectPreset,
  onExportCsv,
  onExportClipboard,
  onExportPrint,
  onOpenImport,
  onOpenCreate,
}) => {
  const [isExportOpen, setIsExportOpen] = useState(false);
  const exportRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (exportRef.current && !exportRef.current.contains(e.target as Node)) {
        setIsExportOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  return (
    <div className="ember-card p-4 space-y-4">
      {/* Top Row: Search & Action Buttons */}
      <div className="flex flex-col lg:flex-row items-center justify-between gap-4">
        {/* Search Input */}
        <div className="relative w-full lg:w-96">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-[var(--ember-text-muted)]" />
          <input
            value={filters.searchQuery}
            onChange={(e) => setFilters((f) => ({ ...f, searchQuery: e.target.value }))}
            placeholder="Search code, name, Tally, GSTIN, location... (/)"
            className="ember-input pl-9 pr-3 py-2 text-xs w-full"
          />
        </div>

        {/* Controls & Actions */}
        <div className="flex flex-wrap items-center gap-2.5 w-full lg:w-auto justify-end">
          <SavedViewsMenu
            presets={presets}
            activePresetId={activePresetId}
            onSelectPreset={onSelectPreset}
          />

          <ColumnVisibilityMenu
            columns={columns}
            visibleColumns={visibleColumns}
            onChangeVisibleColumns={onChangeVisibleColumns}
          />

          <TableDensityToggle density={density} onChangeDensity={onChangeDensity} />

          {/* Multi-Scope Export Dropdown */}
          <div className="relative" ref={exportRef}>
            <button
              onClick={() => setIsExportOpen(!isExportOpen)}
              className="ember-btn-secondary px-3 py-1.5 text-xs flex items-center gap-1.5 cursor-pointer"
            >
              <Download className="w-3.5 h-3.5 text-[var(--ember-primary)]" /> Export
            </button>

            {isExportOpen && (
              <div className="absolute right-0 mt-2 w-48 bg-[var(--ember-surface)] border border-[var(--ember-border)] rounded-xl shadow-xl z-30 p-1.5 text-xs animate-fadeIn">
                <div className="px-2.5 py-1 text-[10px] font-bold text-[var(--ember-text-muted)] uppercase tracking-wider">
                  Export Options
                </div>
                <button
                  onClick={() => {
                    onExportCsv("filtered");
                    setIsExportOpen(false);
                  }}
                  className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded hover:bg-[var(--ember-surface-raised)] text-left cursor-pointer"
                >
                  <FileSpreadsheet className="w-3.5 h-3.5 text-emerald-500" /> Export CSV (Filtered)
                </button>
                <button
                  onClick={() => {
                    onExportCsv("all");
                    setIsExportOpen(false);
                  }}
                  className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded hover:bg-[var(--ember-surface-raised)] text-left cursor-pointer"
                >
                  <FileSpreadsheet className="w-3.5 h-3.5 text-emerald-500" /> Export CSV (All Records)
                </button>
                <button
                  onClick={() => {
                    onExportClipboard("filtered");
                    setIsExportOpen(false);
                  }}
                  className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded hover:bg-[var(--ember-surface-raised)] text-left cursor-pointer"
                >
                  <Copy className="w-3.5 h-3.5 text-sky-500" /> Copy to Clipboard
                </button>
                <button
                  onClick={() => {
                    onExportPrint("filtered");
                    setIsExportOpen(false);
                  }}
                  className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded hover:bg-[var(--ember-surface-raised)] text-left cursor-pointer"
                >
                  <Printer className="w-3.5 h-3.5 text-amber-500" /> Print Table
                </button>
              </div>
            )}
          </div>

          <button
            onClick={onOpenImport}
            className="ember-btn-secondary px-3.5 py-1.5 text-xs flex items-center gap-1.5 cursor-pointer"
          >
            <FileSpreadsheet className="w-3.5 h-3.5 text-[var(--ember-primary)]" /> Import Master
          </button>

          <button
            onClick={onOpenCreate}
            className="ember-btn-primary px-3.5 py-1.5 text-xs flex items-center gap-1.5 cursor-pointer"
          >
            <UserPlus className="w-3.5 h-3.5" /> + Add Customer
          </button>
        </div>
      </div>

      {/* Bottom Row: Filter Dropdowns */}
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3 border-t border-[var(--ember-border)] pt-3 text-xs">
        {/* Match Status Dropdown */}
        <div className="space-y-1">
          <label className="text-[11px] font-semibold text-[var(--ember-text-secondary)]">
            Match Status
          </label>
          <select
            value={filters.matchStatus}
            onChange={(e) => setFilters((f) => ({ ...f, matchStatus: e.target.value }))}
            className="ember-input px-2.5 py-1.5 text-xs w-full cursor-pointer"
          >
            <option value="All">All Statuses</option>
            <option value="Complete">Complete (Verified)</option>
            <option value="Incomplete">Incomplete Mapping</option>
            <option value="Unmapped">Unmapped Accounts</option>
          </select>
        </div>

        {/* Category Dropdown */}
        <div className="space-y-1">
          <label className="text-[11px] font-semibold text-[var(--ember-text-secondary)]">
            Category
          </label>
          <select
            value={filters.categoryName}
            onChange={(e) => setFilters((f) => ({ ...f, categoryName: e.target.value }))}
            className="ember-input px-2.5 py-1.5 text-xs w-full cursor-pointer"
          >
            <option value="All">All Categories</option>
            {categories.map((c) => (
              <option key={c.id} value={c.name}>
                {c.name}
              </option>
            ))}
          </select>
        </div>

        {/* Approval Status Dropdown */}
        <div className="space-y-1">
          <label className="text-[11px] font-semibold text-[var(--ember-text-secondary)]">
            Approval Status
          </label>
          <select
            value={filters.approvalStatus}
            onChange={(e) => setFilters((f) => ({ ...f, approvalStatus: e.target.value }))}
            className="ember-input px-2.5 py-1.5 text-xs w-full cursor-pointer"
          >
            <option value="All">All Approvals</option>
            <option value="Approved">Approved</option>
            <option value="Pending_Review">Pending Review</option>
          </select>
        </div>

        {/* Location Dropdown & Reset */}
        <div className="space-y-1">
          <div className="flex items-center justify-between">
            <label className="text-[11px] font-semibold text-[var(--ember-text-secondary)]">
              Location
            </label>
            <button
              onClick={resetFilters}
              className="text-[10px] text-[var(--ember-primary)] hover:underline flex items-center gap-0.5 cursor-pointer font-semibold"
            >
              <RotateCcw className="w-2.5 h-2.5" /> Reset
            </button>
          </div>
          <select
            value={filters.location}
            onChange={(e) => setFilters((f) => ({ ...f, location: e.target.value }))}
            className="ember-input px-2.5 py-1.5 text-xs w-full cursor-pointer"
          >
            <option value="All">All Locations</option>
            {locations.map((loc) => (
              <option key={loc} value={loc}>
                {loc}
              </option>
            ))}
          </select>
        </div>
      </div>
    </div>
  );
};
