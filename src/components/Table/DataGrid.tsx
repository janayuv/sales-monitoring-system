import React from "react";
import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react";
import { ColumnDefinition, SelectionState, SortConfig, TableDensity } from "./types";
import { DENSITY_PADDING_MAP } from "./constants";

interface DataGridProps<T> {
  data: T[];
  columns: ColumnDefinition<T>[];
  visibleColumns: string[];
  rowKey: (row: T) => string | number;
  loading?: boolean;
  density?: TableDensity;
  sortConfig?: SortConfig<T> | null;
  selectionState?: SelectionState;
  onSort?: (columnId: string) => void;
  onToggleSelectRow?: (rowKey: string | number) => void;
  onToggleSelectPage?: () => void;
  onRowDoubleClick?: (row: T) => void;
  onRowContextMenu?: (e: React.MouseEvent, row: T) => void;
  emptyState?: React.ReactNode;
}

function DataGridInner<T>({
  data,
  columns,
  visibleColumns,
  rowKey,
  loading = false,
  density = "normal",
  sortConfig = null,
  selectionState,
  onSort,
  onToggleSelectRow,
  onToggleSelectPage,
  onRowDoubleClick,
  onRowContextMenu,
  emptyState,
}: DataGridProps<T>) {
  const activeCols = columns.filter((c) => visibleColumns.includes(c.id));
  const paddingClass = DENSITY_PADDING_MAP[density] || DENSITY_PADDING_MAP.normal;

  // Determine if current page items are all selected
  const isPageSelected =
    data.length > 0 &&
    onToggleSelectRow &&
    selectionState &&
    data.every((item) => {
      const id = rowKey(item);
      if (selectionState.type === "all_filtered") return true;
      if (selectionState.type === "filtered_except") return !selectionState.excludedIds.has(id);
      return selectionState.selectedIds.has(id);
    });

  return (
    <div className="overflow-x-auto relative w-full border-t border-[var(--ember-border)] select-none">
      <table className="w-full text-left border-collapse" role="grid">
        <thead>
          <tr className="bg-[var(--ember-surface-raised)] text-[var(--ember-text-secondary)] font-bold border-b border-[var(--ember-border)] text-xs">
            {onToggleSelectRow && (
              <th className="p-3 w-10 text-center">
                <input
                  type="checkbox"
                  checked={Boolean(isPageSelected)}
                  onChange={() => onToggleSelectPage?.()}
                  className="rounded border-[var(--ember-border)] text-[var(--ember-primary)] focus:ring-[var(--ember-primary)] cursor-pointer"
                  aria-label="Select all rows on page"
                />
              </th>
            )}
            {activeCols.map((col) => {
              const isSorted = sortConfig?.columnId === col.id;
              const alignClass =
                col.align === "center" ? "text-center" : col.align === "right" ? "text-right" : "text-left";

              return (
                <th
                  key={col.id}
                  onClick={() => col.sortable && onSort?.(col.id)}
                  style={{ width: col.width, minWidth: col.minWidth }}
                  className={`p-3 font-semibold ${alignClass} ${
                    col.sortable ? "cursor-pointer hover:bg-[var(--ember-surface)] transition-colors select-none" : ""
                  }`}
                  aria-sort={
                    isSorted ? (sortConfig.direction === "asc" ? "ascending" : "descending") : undefined
                  }
                >
                  <div
                    className={`inline-flex items-center gap-1.5 ${
                      col.align === "center" ? "justify-center" : col.align === "right" ? "justify-end" : "justify-start"
                    }`}
                  >
                    <span>{col.title}</span>
                    {col.sortable && (
                      <span className="text-[var(--ember-text-muted)]">
                        {isSorted ? (
                          sortConfig.direction === "asc" ? (
                            <ArrowUp className="w-3.5 h-3.5 text-[var(--ember-primary)]" />
                          ) : (
                            <ArrowDown className="w-3.5 h-3.5 text-[var(--ember-primary)]" />
                          )
                        ) : (
                          <ArrowUpDown className="w-3 h-3 opacity-40 hover:opacity-100" />
                        )}
                      </span>
                    )}
                  </div>
                </th>
              );
            })}
          </tr>
        </thead>

        <tbody className="divide-y divide-[var(--ember-border-subtle)] text-xs">
          {loading ? (
            // Skeleton Loading Rows
            Array.from({ length: 5 }).map((_, idx) => (
              <tr key={`skeleton-${idx}`} className="animate-pulse">
                {onToggleSelectRow && <td className="p-3 w-10 text-center"><div className="w-4 h-4 bg-gray-300 dark:bg-gray-700 rounded mx-auto" /></td>}
                {activeCols.map((col) => (
                  <td key={col.id} className={paddingClass}>
                    <div className="h-4 bg-gray-200 dark:bg-gray-800 rounded w-3/4" />
                  </td>
                ))}
              </tr>
            ))
          ) : data.length === 0 ? (
            <tr>
              <td colSpan={activeCols.length + (onToggleSelectRow ? 1 : 0)} className="p-8 text-center text-[var(--ember-text-muted)]">
                {emptyState || "No records available."}
              </td>
            </tr>
          ) : (
            data.map((row) => {
              const id = rowKey(row);
              const isSelected =
                selectionState &&
                (selectionState.type === "all_filtered" ||
                  (selectionState.type === "filtered_except" && !selectionState.excludedIds.has(id)) ||
                  selectionState.selectedIds.has(id));

              return (
                <tr
                  key={id}
                  onDoubleClick={() => onRowDoubleClick?.(row)}
                  onContextMenu={(e) => onRowContextMenu?.(e, row)}
                  className={`transition-colors cursor-pointer ${
                    isSelected
                      ? "bg-[var(--ember-primary-light)]/20 hover:bg-[var(--ember-primary-light)]/30"
                      : "hover:bg-[var(--ember-surface-raised)]"
                  }`}
                  aria-selected={Boolean(isSelected)}
                >
                  {onToggleSelectRow && (
                    <td className="p-3 w-10 text-center" onClick={(e) => e.stopPropagation()}>
                      <input
                        type="checkbox"
                        checked={Boolean(isSelected)}
                        onChange={() => onToggleSelectRow(id)}
                        className="rounded border-[var(--ember-border)] text-[var(--ember-primary)] focus:ring-[var(--ember-primary)] cursor-pointer"
                        aria-label={`Select row ${id}`}
                      />
                    </td>
                  )}
                  {activeCols.map((col) => {
                    const alignClass =
                      col.align === "center" ? "text-center" : col.align === "right" ? "text-right" : "text-left";
                    const val = col.formatter ? col.formatter(row) : (row as any)[col.id] ?? "—";

                    return (
                      <td key={col.id} className={`${paddingClass} ${alignClass}`}>
                        {val}
                      </td>
                    );
                  })}
                </tr>
              );
            })
          )}
        </tbody>
      </table>
    </div>
  );
}

export const DataGrid = React.memo(DataGridInner) as typeof DataGridInner;
