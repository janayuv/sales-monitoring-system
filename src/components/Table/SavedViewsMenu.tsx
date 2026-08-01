import React, { useState, useRef, useEffect } from "react";
import { Bookmark, Check } from "lucide-react";
import { SavedViewPreset } from "./types";

interface SavedViewsMenuProps {
  presets: SavedViewPreset[];
  activePresetId?: string;
  onSelectPreset: (preset: SavedViewPreset) => void;
}

export const SavedViewsMenu: React.FC<SavedViewsMenuProps> = ({
  presets,
  activePresetId,
  onSelectPreset,
}) => {
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

  const activePreset = presets.find((p) => p.id === activePresetId) || presets[0];

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="ember-btn-secondary px-3 py-1.5 text-xs flex items-center gap-1.5 cursor-pointer"
        title="Saved View Presets"
      >
        <Bookmark className="w-3.5 h-3.5 text-[var(--ember-primary)]" />
        <span>View: <strong>{activePreset?.name || "Default"}</strong></span>
      </button>

      {isOpen && (
        <div className="absolute left-0 mt-2 w-48 bg-[var(--ember-surface)] border border-[var(--ember-border)] rounded-xl shadow-xl z-30 p-1.5 text-xs animate-fadeIn">
          <div className="px-2.5 py-1.5 font-semibold text-[var(--ember-text-muted)] text-[11px] uppercase tracking-wider border-b border-[var(--ember-border)] mb-1">
            Preset Views
          </div>
          {presets.map((p) => {
            const isSelected = p.id === activePresetId;
            return (
              <button
                key={p.id}
                onClick={() => {
                  onSelectPreset(p);
                  setIsOpen(false);
                }}
                className={`w-full flex items-center justify-between px-2.5 py-2 rounded text-left transition-colors cursor-pointer ${
                  isSelected
                    ? "bg-[var(--ember-primary-light)] text-[var(--ember-primary)] font-semibold"
                    : "hover:bg-[var(--ember-surface-raised)] text-[var(--ember-text-secondary)]"
                }`}
              >
                <span>{p.name}</span>
                {isSelected && <Check className="w-3.5 h-3.5" />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
};
