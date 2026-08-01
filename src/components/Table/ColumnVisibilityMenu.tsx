import { useState, useRef, useEffect } from "react";
import { Columns, Check, RotateCcw } from "lucide-react";
import { ColumnDefinition } from "./types";

interface ColumnVisibilityMenuProps<T> {
  columns: ColumnDefinition<T>[];
  visibleColumns: string[];
  onChangeVisibleColumns: (columns: string[]) => void;
}

export function ColumnVisibilityMenu<T>({
  columns,
  visibleColumns,
  onChangeVisibleColumns,
}: ColumnVisibilityMenuProps<T>) {
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const toggleColumn = (id: string) => {
    if (visibleColumns.includes(id)) {
      if (visibleColumns.length <= 1) return; // Prevent hiding all columns
      onChangeVisibleColumns(visibleColumns.filter((c) => c !== id));
    } else {
      onChangeVisibleColumns([...visibleColumns, id]);
    }
  };

  const handleReset = () => {
    const defaultCols = columns.filter((c) => c.defaultVisible !== false).map((c) => c.id);
    onChangeVisibleColumns(defaultCols);
  };

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="ember-btn-secondary px-3 py-1.5 text-xs flex items-center gap-1.5 cursor-pointer"
        title="Customise table columns"
      >
        <Columns className="w-3.5 h-3.5 text-[var(--ember-primary)]" />
        <span>Columns</span>
      </button>

      {isOpen && (
        <div className="absolute right-0 mt-2 w-56 bg-[var(--ember-surface)] border border-[var(--ember-border)] rounded-xl shadow-xl z-30 p-2 text-xs animate-fadeIn">
          <div className="flex items-center justify-between px-2 py-1.5 border-b border-[var(--ember-border)] font-semibold text-[var(--ember-text-primary)]">
            <span>Toggle Columns</span>
            <button
              onClick={handleReset}
              className="text-[var(--ember-primary)] hover:underline flex items-center gap-1 text-[11px]"
              title="Reset to default view"
            >
              <RotateCcw className="w-3 h-3" /> Reset
            </button>
          </div>

          <div className="mt-1.5 max-h-60 overflow-y-auto space-y-0.5">
            {columns.map((col) => {
              const isVisible = visibleColumns.includes(col.id);
              return (
                <label
                  key={col.id}
                  className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-[var(--ember-surface-raised)] cursor-pointer select-none"
                >
                  <input
                    type="checkbox"
                    checked={isVisible}
                    onChange={() => toggleColumn(col.id)}
                    className="rounded border-[var(--ember-border)] text-[var(--ember-primary)] focus:ring-[var(--ember-primary)] cursor-pointer"
                  />
                  <span className="flex-1 text-[var(--ember-text-secondary)]">{col.title}</span>
                  {isVisible && <Check className="w-3.5 h-3.5 text-[var(--ember-primary)]" />}
                </label>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
