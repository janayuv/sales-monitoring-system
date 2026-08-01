import React from "react";
import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from "lucide-react";
import { PAGE_SIZE_OPTIONS } from "./constants";

interface TablePaginationProps {
  totalItems: number;
  pageSize: number;
  pageIndex: number;
  onPageChange: (page: number) => void;
  onPageSizeChange: (pageSize: number) => void;
}

export const TablePagination: React.FC<TablePaginationProps> = ({
  totalItems,
  pageSize,
  pageIndex,
  onPageChange,
  onPageSizeChange,
}) => {
  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
  const validPage = Math.min(Math.max(1, pageIndex), totalPages);
  const startIndex = totalItems > 0 ? (validPage - 1) * pageSize + 1 : 0;
  const endIndex = Math.min(totalItems, validPage * pageSize);

  return (
    <div className="p-4 border-t border-[var(--ember-border)] bg-[var(--ember-surface-raised)] flex flex-col sm:flex-row items-center justify-between gap-4 text-xs select-none">
      {/* Counters & Page Size */}
      <div className="flex items-center gap-4 text-[var(--ember-text-secondary)]">
        <span>
          Showing <strong className="text-[var(--ember-text-primary)] font-mono">{startIndex}</strong> to{" "}
          <strong className="text-[var(--ember-text-primary)] font-mono">{endIndex}</strong> of{" "}
          <strong className="text-[var(--ember-text-primary)] font-mono">{totalItems}</strong> entries
        </span>

        <div className="flex items-center gap-2">
          <span className="text-[var(--ember-text-muted)] text-[11px]">Rows per page:</span>
          <select
            value={pageSize}
            onChange={(e) => onPageSizeChange(Number(e.target.value))}
            className="ember-input px-2 py-1 text-xs font-mono cursor-pointer"
            aria-label="Rows per page"
          >
            {PAGE_SIZE_OPTIONS.map((size) => (
              <option key={size} value={size}>
                {size}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Navigation buttons */}
      <div className="flex items-center gap-1.5">
        <button
          onClick={() => onPageChange(1)}
          disabled={validPage <= 1}
          className="ember-btn-secondary p-1.5 text-xs disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer"
          title="First Page"
          aria-label="First Page"
        >
          <ChevronsLeft className="w-4 h-4" />
        </button>
        <button
          onClick={() => onPageChange(validPage - 1)}
          disabled={validPage <= 1}
          className="ember-btn-secondary p-1.5 text-xs disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer"
          title="Previous Page"
          aria-label="Previous Page"
        >
          <ChevronLeft className="w-4 h-4" />
        </button>

        <span className="px-3 py-1 bg-[var(--ember-surface)] border border-[var(--ember-border)] rounded-lg text-xs font-mono text-[var(--ember-text-primary)]">
          Page <strong className="text-[var(--ember-primary)]">{validPage}</strong> of {totalPages}
        </span>

        <button
          onClick={() => onPageChange(validPage + 1)}
          disabled={validPage >= totalPages}
          className="ember-btn-secondary p-1.5 text-xs disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer"
          title="Next Page"
          aria-label="Next Page"
        >
          <ChevronRight className="w-4 h-4" />
        </button>
        <button
          onClick={() => onPageChange(totalPages)}
          disabled={validPage >= totalPages}
          className="ember-btn-secondary p-1.5 text-xs disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer"
          title="Last Page"
          aria-label="Last Page"
        >
          <ChevronsRight className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
};
