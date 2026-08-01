import React, { useEffect, useRef } from "react";
import { RowActionDefinition } from "./types";

interface ContextMenuProps<T> {
  contextMenu: { mouseX: number; mouseY: number; row: T } | null;
  actions: RowActionDefinition<T>[];
  onClose: () => void;
}

export function ContextMenu<T>({ contextMenu, actions, onClose }: ContextMenuProps<T>) {
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!contextMenu) return;

    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [contextMenu, onClose]);

  if (!contextMenu) return null;

  const activeActions = actions.filter((a) => !a.hidden || !a.hidden(contextMenu.row));

  return (
    <div
      ref={menuRef}
      style={{ top: `${contextMenu.mouseY}px`, left: `${contextMenu.mouseX}px` }}
      className="fixed z-50 min-w-48 bg-[var(--ember-surface)] border border-[var(--ember-border)] rounded-xl shadow-2xl p-1.5 text-xs animate-fadeIn"
      role="menu"
    >
      {activeActions.map((act) => {
        const isDisabled = act.disabled?.(contextMenu.row);
        const IconComponent = act.icon;

        return (
          <React.Fragment key={act.id}>
            <button
              disabled={isDisabled}
              onClick={() => {
                act.onClick(contextMenu.row);
                onClose();
              }}
              className={`w-full flex items-center justify-between px-3 py-2 rounded text-left transition-colors cursor-pointer ${
                act.danger
                  ? "text-rose-600 hover:bg-rose-500/10"
                  : "text-[var(--ember-text-primary)] hover:bg-[var(--ember-surface-raised)]"
              } ${isDisabled ? "opacity-40 cursor-not-allowed" : ""}`}
              role="menuitem"
            >
              <div className="flex items-center gap-2">
                {IconComponent && <IconComponent className="w-3.5 h-3.5 text-[var(--ember-primary)]" />}
                <span>{act.label}</span>
              </div>
              {act.shortcut && (
                <span className="text-[10px] font-mono text-[var(--ember-text-muted)]">{act.shortcut}</span>
              )}
            </button>
            {act.dividerAfter && <div className="my-1 border-t border-[var(--ember-border)]" />}
          </React.Fragment>
        );
      })}
    </div>
  );
}
