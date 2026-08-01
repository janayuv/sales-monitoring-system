import { useState, useMemo } from "react";
import { CustomerMasterRow } from "../../../types/bindings/CustomerMasterRow";
import { SortConfig, SavedViewPreset } from "../../Table/types";
import { CUSTOMER_COLUMNS } from "../metadata/customerColumns";
import { CUSTOMER_SAVED_PRESETS } from "../metadata/customerFilters";
import { useCustomerFilters } from "./useCustomerFilters";
import { useCustomerSelection } from "./useCustomerSelection";
import { useCustomerColumns } from "./useCustomerColumns";
import { useCustomerPagination } from "./useCustomerPagination";

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

export function useCustomerTable(rows: CustomerMasterRow[]) {
  const filterState = useCustomerFilters();
  const selectionState = useCustomerSelection(rows);
  const columnState = useCustomerColumns();
  const paginationState = useCustomerPagination();

  const [sortConfig, setSortConfig] = useState<SortConfig<CustomerMasterRow>>({
    columnId: "customer_code",
    direction: "asc",
  });

  const [activePresetId, setActivePresetId] = useState<string>("all");

  // 1. KPI Metric Calculations
  const kpiMetrics = useMemo(() => {
    const total = rows.length;
    const complete = rows.filter((r) => r.match_status === "Complete").length;
    const incomplete = rows.filter((r) => r.match_status === "Incomplete").length;
    const unmapped = rows.filter((r) => r.match_status === "Unmapped").length;
    return { total, complete, incomplete, unmapped };
  }, [rows]);

  // 2. Filter Predicate Evaluation
  const filteredRows = useMemo(() => {
    const { matchStatus, categoryName, approvalStatus, location } = filterState.filters;
    const search = filterState.debouncedSearch;

    return rows.filter((row) => {
      // Search Query
      if (search) {
        const matchesSearch = CUSTOMER_COLUMNS.some((col) => {
          if (!col.searchable) return false;
          const val = col.filterAccessor ? col.filterAccessor(row) : (row as any)[col.id];
          return val != null && String(val).toLowerCase().includes(search);
        });
        if (!matchesSearch) return false;
      }

      // Match Status Filter
      if (matchStatus !== "All" && row.match_status !== matchStatus) return false;

      // Category Filter
      if (categoryName !== "All" && (row.category_name ?? "") !== categoryName) return false;

      // Approval Status Filter
      if (approvalStatus !== "All" && row.status !== approvalStatus) return false;

      // Location Filter
      if (location !== "All" && (row.location ?? "") !== location) return false;

      return true;
    });
  }, [rows, filterState.filters, filterState.debouncedSearch]);

  // 3. Natural Sorting Logic
  const sortedRows = useMemo(() => {
    if (!sortConfig) return filteredRows;

    const colDef = CUSTOMER_COLUMNS.find((c) => c.id === sortConfig.columnId);
    const getVal = colDef?.sortAccessor || ((r: CustomerMasterRow) => (r as any)[sortConfig.columnId] ?? "");

    return [...filteredRows].sort((a, b) => {
      const valA = getVal(a);
      const valB = getVal(b);

      const cmp = collator.compare(String(valA ?? ""), String(valB ?? ""));
      return sortConfig.direction === "asc" ? cmp : -cmp;
    });
  }, [filteredRows, sortConfig]);

  // Reset page to 1 when filters or page size changes
  useMemo(() => {
    paginationState.setPageIndex(1);
  }, [filteredRows.length, paginationState.pageSize]);

  // 4. Pagination Slicing
  const paginatedRows = useMemo(() => {
    const total = sortedRows.length;
    const totalPages = Math.max(1, Math.ceil(total / paginationState.pageSize));
    const validPage = Math.min(Math.max(1, paginationState.pageIndex), totalPages);
    const start = (validPage - 1) * paginationState.pageSize;
    return sortedRows.slice(start, start + paginationState.pageSize);
  }, [sortedRows, paginationState.pageIndex, paginationState.pageSize]);

  // 5. Handle Column Sorting Toggle
  const handleSort = (columnId: string) => {
    setSortConfig((prev) => {
      if (prev.columnId === columnId) {
        return { columnId, direction: prev.direction === "asc" ? "desc" : "asc" };
      }
      return { columnId, direction: "asc" };
    });
  };

  // 6. Apply Saved View Preset
  const handleSelectPreset = (preset: SavedViewPreset) => {
    setActivePresetId(preset.id);
    if (preset.filters) {
      filterState.setFilters((prev) => ({ ...prev, ...preset.filters }));
    }
  };

  // Unique Location options for dropdowns
  const locations = useMemo(() => {
    const set = new Set<string>();
    rows.forEach((r) => {
      if (r.location) set.add(r.location);
    });
    return Array.from(set).sort();
  }, [rows]);

  return {
    // Data
    rows,
    filteredRows,
    sortedRows,
    paginatedRows,
    kpiMetrics,
    locations,
    columns: CUSTOMER_COLUMNS,
    presets: CUSTOMER_SAVED_PRESETS,
    activePresetId,
    sortConfig,

    // Sub-hook states
    filterState,
    selectionState,
    columnState,
    paginationState,

    // Actions
    handleSort,
    handleSelectPreset,
  };
}
