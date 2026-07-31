import { InvoiceSummary } from "../../../types";

export type StatusType = "ALL" | "Imported" | "Verified" | "Draft" | "Cancelled" | "Credit Note Generated";

export type SortDirection = "asc" | "desc" | null;

export interface SortConfig {
  column: keyof InvoiceSummary | null;
  direction: SortDirection;
}

export type TableDensity = "comfortable" | "compact";

export interface ColumnDef {
  id: keyof InvoiceSummary | "actions";
  label: string;
  align?: "left" | "center" | "right";
  sortable?: boolean;
  exportable?: boolean;
  defaultVisible?: boolean;
  pinned?: boolean;
  width?: string;
}

export interface DateRangeFilter {
  from: string; // YYYY-MM-DD
  to: string;   // YYYY-MM-DD
  preset: "all" | "today" | "this_month" | "last_month" | "custom";
}

export interface ValueRangeFilter {
  min: number | null;
  max: number | null;
}

export interface TableFilters {
  searchQuery: string;
  statusFilter: StatusType;
  customerFilter: string;
  dateRange: DateRangeFilter;
  valueRange: ValueRangeFilter;
}

export interface TableSummary {
  totalCount: number;
  totalTaxable: number;
  totalTax: number;
  totalValue: number;
}

export interface KpiMetrics {
  status: StatusType;
  count: number;
  totalValue: number;
  label: string;
  color: string;
}

export interface TablePreferencesV1 {
  version: "v1";
  pageSize: number;
  density: TableDensity;
  visibleColumns: string[];
  sortConfig: SortConfig;
  activeViewId?: string;
}

export interface SavedView {
  id: string;
  name: string;
  filters: TableFilters;
  sortConfig: SortConfig;
}

export interface ContextMenuState {
  visible: boolean;
  x: number;
  y: number;
  invoice: InvoiceSummary | null;
}
