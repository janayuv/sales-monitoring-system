import React from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";

interface Props {
  totalItems: number;
  pageSize: number;
  currentPageIndex: number;
  totalPages: number;
  onPrevPage: () => void;
  onNextPage: () => void;
  onPageSizeChange: (size: number) => void;
}

export const PaginationBar: React.FC<Props> = ({
  totalItems,
  pageSize,
  currentPageIndex,
  totalPages,
  onPrevPage,
  onNextPage,
  onPageSizeChange,
}) => {
  const startIdx = totalItems === 0 ? 0 : currentPageIndex * pageSize + 1;
  const endIdx = Math.min(totalItems, (currentPageIndex + 1) * pageSize);

  return (
    <div className="bg-[var(--ember-surface-raised)] px-4 py-3 border-t border-[var(--ember-border)] flex flex-wrap items-center justify-between gap-4 text-xs select-none">
      <div className="flex items-center gap-3 text-[var(--ember-text-muted)] font-mono">
        <span>
          Showing <strong className="text-[var(--ember-text-primary)]">{startIdx}</strong> to{" "}
          <strong className="text-[var(--ember-text-primary)]">{endIdx}</strong> of{" "}
          <strong className="text-[var(--ember-primary)]">{totalItems}</strong> invoices
        </span>

        {/* Page Size Selector */}
        <div className="flex items-center gap-1.5 ml-4">
          <span className="text-[11px] font-sans">Rows per page:</span>
          <select
            value={pageSize}
            onChange={(e) => onPageSizeChange(Number(e.target.value))}
            className="ember-input text-xs py-1 px-2 rounded cursor-pointer font-mono"
          >
            {[10, 25, 50, 100].map((size) => (
              <option key={size} value={size}>
                {size}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="flex items-center gap-2">
        <span className="text-[var(--ember-text-muted)] font-mono mr-2">
          Page {currentPageIndex + 1} of {totalPages}
        </span>
        <button
          onClick={onPrevPage}
          disabled={currentPageIndex === 0}
          className="ember-btn-secondary px-3 py-1.5 text-xs flex items-center gap-1 disabled:opacity-40 cursor-pointer"
          title="Previous Page (Alt + LeftArrow)"
        >
          <ChevronLeft className="w-3.5 h-3.5" /> Prev
        </button>
        <button
          onClick={onNextPage}
          disabled={currentPageIndex >= totalPages - 1}
          className="ember-btn-secondary px-3 py-1.5 text-xs flex items-center gap-1 disabled:opacity-40 cursor-pointer"
          title="Next Page (Alt + RightArrow)"
        >
          Next <ChevronRight className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
};
