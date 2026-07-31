import React, { useState } from "react";
import { TableFilters } from "../types/register";
import { Bookmark, ChevronDown, Check } from "lucide-react";

interface SavedViewPreset {
  id: string;
  name: string;
  filters: TableFilters;
}

const PRESET_VIEWS: SavedViewPreset[] = [
  {
    id: "default",
    name: "All Registers (Default)",
    filters: {
      searchQuery: "",
      statusFilter: "ALL",
      customerFilter: "ALL",
      dateRange: { from: "", to: "", preset: "all" },
      valueRange: { min: null, max: null },
    },
  },
  {
    id: "verified_only",
    name: "Verified Sales Invoices",
    filters: {
      searchQuery: "",
      statusFilter: "Verified",
      customerFilter: "ALL",
      dateRange: { from: "", to: "", preset: "all" },
      valueRange: { min: null, max: null },
    },
  },
  {
    id: "high_value",
    name: "High Value (>= ₹1 Lakh)",
    filters: {
      searchQuery: "",
      statusFilter: "ALL",
      customerFilter: "ALL",
      dateRange: { from: "", to: "", preset: "all" },
      valueRange: { min: 100000, max: null },
    },
  },
  {
    id: "drafts",
    name: "Pending Draft Invoices",
    filters: {
      searchQuery: "",
      statusFilter: "Draft",
      customerFilter: "ALL",
      dateRange: { from: "", to: "", preset: "all" },
      valueRange: { min: null, max: null },
    },
  },
];

interface Props {
  activeViewId?: string;
  onApplyView: (preset: SavedViewPreset) => void;
}

export const SavedViewsMenu: React.FC<Props> = ({
  activeViewId = "default",
  onApplyView,
}) => {
  const [isOpen, setIsOpen] = useState(false);

  const activePreset =
    PRESET_VIEWS.find((p) => p.id === activeViewId) || PRESET_VIEWS[0];

  return (
    <div className="relative">
      <button
        onClick={() => setIsOpen((prev) => !prev)}
        className="px-3 py-1.5 rounded-lg border border-[var(--ember-border)] bg-[var(--ember-surface-raised)] text-xs text-[var(--ember-text-secondary)] hover:text-[var(--ember-text-primary)] transition-all flex items-center gap-2 font-medium cursor-pointer shadow-sm"
        title="Saved View Presets"
      >
        <Bookmark className="w-3.5 h-3.5 text-[var(--ember-primary)]" />
        <span>{activePreset.name}</span>
        <ChevronDown className="w-3.5 h-3.5 text-[var(--ember-text-muted)]" />
      </button>

      {isOpen && (
        <>
          <div
            className="fixed inset-0 z-30"
            onClick={() => setIsOpen(false)}
          />
          <div className="absolute right-0 mt-2 w-56 rounded-xl border border-[var(--ember-border)] bg-[var(--ember-surface)] shadow-2xl p-1.5 z-40 text-xs">
            <div className="px-2.5 py-1.5 font-bold text-[10px] text-[var(--ember-text-muted)] uppercase tracking-wider">
              Saved Views Presets
            </div>

            {PRESET_VIEWS.map((preset) => {
              const isSelected = activePreset.id === preset.id;
              return (
                <button
                  key={preset.id}
                  onClick={() => {
                    onApplyView(preset);
                    setIsOpen(false);
                  }}
                  className={`w-full text-left px-2.5 py-2 rounded-lg transition-colors flex items-center justify-between cursor-pointer ${
                    isSelected
                      ? "bg-[var(--ember-primary)]/15 text-[var(--ember-primary)] font-semibold"
                      : "text-[var(--ember-text-secondary)] hover:bg-[var(--ember-surface-raised)] hover:text-[var(--ember-text-primary)]"
                  }`}
                >
                  <span>{preset.name}</span>
                  {isSelected && <Check className="w-3.5 h-3.5 text-[var(--ember-primary)]" />}
                </button>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
};
