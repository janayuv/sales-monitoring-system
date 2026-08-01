import React from "react";
import { AlignJustify, Menu, List } from "lucide-react";
import { TableDensity } from "./types";

interface TableDensityToggleProps {
  density: TableDensity;
  onChangeDensity: (density: TableDensity) => void;
}

export const TableDensityToggle: React.FC<TableDensityToggleProps> = ({
  density,
  onChangeDensity,
}) => {
  return (
    <div className="flex items-center bg-[var(--ember-surface-raised)] border border-[var(--ember-border)] rounded-lg p-0.5 text-xs">
      <button
        onClick={() => onChangeDensity("compact")}
        className={`px-2 py-1 rounded flex items-center gap-1 transition-colors cursor-pointer ${
          density === "compact"
            ? "bg-[var(--ember-surface)] text-[var(--ember-primary)] font-semibold shadow-sm"
            : "text-[var(--ember-text-muted)] hover:text-[var(--ember-text-primary)]"
        }`}
        title="Compact table row spacing"
      >
        <List className="w-3.5 h-3.5" />
      </button>

      <button
        onClick={() => onChangeDensity("normal")}
        className={`px-2 py-1 rounded flex items-center gap-1 transition-colors cursor-pointer ${
          density === "normal"
            ? "bg-[var(--ember-surface)] text-[var(--ember-primary)] font-semibold shadow-sm"
            : "text-[var(--ember-text-muted)] hover:text-[var(--ember-text-primary)]"
        }`}
        title="Normal table row spacing"
      >
        <Menu className="w-3.5 h-3.5" />
      </button>

      <button
        onClick={() => onChangeDensity("comfortable")}
        className={`px-2 py-1 rounded flex items-center gap-1 transition-colors cursor-pointer ${
          density === "comfortable"
            ? "bg-[var(--ember-surface)] text-[var(--ember-primary)] font-semibold shadow-sm"
            : "text-[var(--ember-text-muted)] hover:text-[var(--ember-text-primary)]"
        }`}
        title="Comfortable table row spacing"
      >
        <AlignJustify className="w-3.5 h-3.5" />
      </button>
    </div>
  );
};
