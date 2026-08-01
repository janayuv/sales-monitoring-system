import React from "react";

export type TableDensity = "compact" | "normal" | "comfortable";

export interface ColumnDefinition<T> {
  id: string;
  title: string;
  width?: number;
  minWidth?: number;
  sortable?: boolean;
  exportable?: boolean;
  searchable?: boolean;
  defaultVisible?: boolean;
  align?: "left" | "center" | "right";
  formatter?: (row: T) => React.ReactNode;
  exportFormatter?: (row: T) => string;
  sortAccessor?: (row: T) => any;
  filterAccessor?: (row: T) => string;
}

export interface RowActionDefinition<T> {
  id: string;
  label: string;
  icon?: React.ComponentType<{ className?: string }>;
  shortcut?: string;
  onClick: (row: T) => void;
  disabled?: (row: T) => boolean;
  hidden?: (row: T) => boolean;
  dividerAfter?: boolean;
  danger?: boolean;
}

export interface SortConfig<T> {
  columnId: keyof T | string;
  direction: "asc" | "desc";
}

export interface SelectionState {
  type: "none" | "selected" | "all_filtered" | "filtered_except";
  selectedIds: Set<string | number>;
  excludedIds: Set<string | number>;
}

export interface SavedViewPreset {
  id: string;
  name: string;
  isDefault?: boolean;
  visibleColumns?: string[];
  density?: TableDensity;
  pageSize?: number;
  sortConfig?: SortConfig<any>;
  filters?: Record<string, any>;
}

export interface PaginationState {
  pageIndex: number;
  pageSize: number;
  totalItems: number;
}
