import React from "react";
import { Filter } from "lucide-react";

interface TableSummaryBarProps {
  totalItems: number;
  filteredItems: number;
  selectedCount?: number;
  activeFilterCount?: number;
  hiddenColumnsCount?: number;
  isTopSticky?: boolean;
}

export const TableSummaryBar: React.FC<TableSummaryBarProps> = ({
  totalItems,
  filteredItems,
  selectedCount = 0,
  activeFilterCount = 0,
  hiddenColumnsCount = 0,
  isTopSticky = false,
}) => {
  return (
    <div
      className={`px-4 py-2.5 bg-[var(--ember-surface-raised)] border-b border-[var(--ember-border)] flex flex-wrap items-center justify-between gap-3 text-xs select-none ${
        isTopSticky ? "sticky top-0 z-10" : ""
      }`}
    >
      <div className="flex items-center gap-4 text-[var(--ember-text-secondary)] font-mono">
        <span>
          Showing <strong className="text-[var(--ember-primary)] font-bold">{filteredItems}</strong> of{" "}
          <strong className="text-[var(--ember-text-primary)]">{totalItems}</strong> records
        </span>

        {selectedCount > 0 && (
          <span className="px-2 py-0.5 rounded bg-[var(--ember-primary-light)] text-[var(--ember-primary)] font-bold border border-[var(--ember-primary)]/30">
            {selectedCount} selected
          </span>
        )}
      </div>

      <div className="flex items-center gap-3 text-[11px] text-[var(--ember-text-muted)]">
        {activeFilterCount > 0 && (
          <span className="flex items-center gap-1 text-[var(--ember-primary)] font-semibold">
            <Filter className="w-3 h-3" /> {activeFilterCount} filter(s) active
          </span>
        )}
        {hiddenColumnsCount > 0 && <span>{hiddenColumnsCount} column(s) hidden</span>}
      </div>
    </div>
  );
};
