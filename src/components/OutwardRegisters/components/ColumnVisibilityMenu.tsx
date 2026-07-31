import React, { useState } from "react";
import { REGISTER_COLUMNS } from "../constants/columns";
import { Eye } from "lucide-react";

interface Props {
  visibleColumns: string[];
  onChangeVisibleColumns: (columns: string[]) => void;
}

export const ColumnVisibilityMenu: React.FC<Props> = ({
  visibleColumns,
  onChangeVisibleColumns,
}) => {
  const [isOpen, setIsOpen] = useState(false);

  const toggleColumn = (colId: string) => {
    // Prevent hiding all columns
    if (visibleColumns.includes(colId) && visibleColumns.length === 1) {
      return;
    }

    if (visibleColumns.includes(colId)) {
      onChangeVisibleColumns(visibleColumns.filter((id) => id !== colId));
    } else {
      onChangeVisibleColumns([...visibleColumns, colId]);
    }
  };

  const showAll = () => {
    onChangeVisibleColumns(REGISTER_COLUMNS.map((c) => c.id));
  };

  return (
    <div className="relative">
      <button
        onClick={() => setIsOpen((prev) => !prev)}
        className="p-2 rounded-lg border border-[var(--ember-border)] bg-[var(--ember-surface-raised)] text-xs text-[var(--ember-text-secondary)] hover:text-[var(--ember-text-primary)] transition-all flex items-center gap-1.5 cursor-pointer shadow-sm"
        title="Customize Column Visibility"
      >
        <Eye className="w-3.5 h-3.5 text-[var(--ember-primary)]" />
        <span className="hidden sm:inline font-medium">Columns</span>
      </button>

      {isOpen && (
        <>
          <div
            className="fixed inset-0 z-30"
            onClick={() => setIsOpen(false)}
          />
          <div className="absolute right-0 mt-2 w-52 rounded-xl border border-[var(--ember-border)] bg-[var(--ember-surface)] shadow-2xl p-2 z-40 text-xs">
            <div className="flex items-center justify-between px-2 py-1 mb-1 border-b border-[var(--ember-border-subtle)]">
              <span className="font-bold text-[10px] text-[var(--ember-text-muted)] uppercase tracking-wider">
                Visible Columns
              </span>
              <button
                onClick={showAll}
                className="text-[10px] text-[var(--ember-primary)] hover:underline font-semibold"
              >
                Reset All
              </button>
            </div>

            <div className="space-y-0.5">
              {REGISTER_COLUMNS.map((col) => {
                const isVisible = visibleColumns.includes(col.id);
                return (
                  <label
                    key={col.id}
                    className="flex items-center justify-between px-2.5 py-1.5 rounded-md hover:bg-[var(--ember-surface-raised)] cursor-pointer select-none text-[var(--ember-text-secondary)] hover:text-[var(--ember-text-primary)]"
                  >
                    <span>{col.label}</span>
                    <input
                      type="checkbox"
                      checked={isVisible}
                      onChange={() => toggleColumn(col.id)}
                      className="rounded border-[var(--ember-border)] text-[var(--ember-primary)] focus:ring-0"
                    />
                  </label>
                );
              })}
            </div>
          </div>
        </>
      )}
    </div>
  );
};
