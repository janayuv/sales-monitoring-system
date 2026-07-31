import React from "react";
import { TableDensity } from "../types/register";
import { MoveVertical, Rows } from "lucide-react";

interface Props {
  density: TableDensity;
  onChangeDensity: (density: TableDensity) => void;
}

export const TableDensityToggle: React.FC<Props> = ({
  density,
  onChangeDensity,
}) => {
  return (
    <button
      onClick={() =>
        onChangeDensity(density === "comfortable" ? "compact" : "comfortable")
      }
      className="p-2 rounded-lg border border-[var(--ember-border)] bg-[var(--ember-surface-raised)] text-xs text-[var(--ember-text-secondary)] hover:text-[var(--ember-text-primary)] transition-all flex items-center gap-1.5 cursor-pointer shadow-sm"
      title={`Switch to ${density === "comfortable" ? "Compact" : "Comfortable"} View`}
    >
      {density === "comfortable" ? (
        <MoveVertical className="w-3.5 h-3.5 text-[var(--ember-primary)]" />
      ) : (
        <Rows className="w-3.5 h-3.5 text-[var(--ember-primary)]" />
      )}
      <span className="hidden md:inline capitalize font-medium">{density}</span>
    </button>
  );
};
