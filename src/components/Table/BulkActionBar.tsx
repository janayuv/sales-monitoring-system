import React, { useState, useEffect } from "react";
import { Download, X, RotateCcw, CheckCircle } from "lucide-react";

interface BulkActionBarProps {
  selectedCount: number;
  isProcessing?: boolean;
  onExportSelected: () => void;
  onClearSelection: () => void;
  actions?: {
    id: string;
    label: string;
    icon?: React.ComponentType<{ className?: string }>;
    onClick: () => void;
    undoable?: boolean;
  }[];
  onUndoLastAction?: () => void;
}

export const BulkActionBar: React.FC<BulkActionBarProps> = ({
  selectedCount,
  isProcessing = false,
  onExportSelected,
  onClearSelection,
  actions = [],
  onUndoLastAction,
}) => {
  const [undoToast, setUndoToast] = useState<{ message: string; timer: number } | null>(null);

  useEffect(() => {
    if (!undoToast) return;
    const interval = setInterval(() => {
      setUndoToast((prev) => {
        if (!prev || prev.timer <= 1) return null;
        return { ...prev, timer: prev.timer - 1 };
      });
    }, 1000);
    return () => clearInterval(interval);
  }, [undoToast]);

  if (selectedCount === 0 && !undoToast) return null;

  return (
    <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-40 bg-[var(--ember-surface)] border border-[var(--ember-border)] rounded-2xl shadow-2xl p-3 flex items-center gap-4 text-xs animate-slideUp">
      {selectedCount > 0 && (
        <>
          <div className="flex items-center gap-2 font-mono">
            <span className="px-2.5 py-1 bg-[var(--ember-primary-light)] text-[var(--ember-primary)] font-bold rounded-lg border border-[var(--ember-primary)]/30">
              {selectedCount} selected
            </span>
          </div>

          <div className="h-4 w-px bg-[var(--ember-border)]" />

          <div className="flex items-center gap-2">
            {actions.map((act) => (
              <button
                key={act.id}
                disabled={isProcessing}
                onClick={() => {
                  act.onClick();
                  if (act.undoable && onUndoLastAction) {
                    setUndoToast({ message: `${act.label} completed.`, timer: 5 });
                  }
                }}
                className="ember-btn-primary px-3 py-1.5 text-xs flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
              >
                {act.icon && <act.icon className="w-3.5 h-3.5" />}
                <span>{act.label}</span>
              </button>
            ))}

            <button
              onClick={onExportSelected}
              className="ember-btn-secondary px-3 py-1.5 text-xs flex items-center gap-1.5 cursor-pointer"
            >
              <Download className="w-3.5 h-3.5 text-[var(--ember-primary)]" /> Export Selected
            </button>
          </div>

          <div className="h-4 w-px bg-[var(--ember-border)]" />

          <button
            onClick={onClearSelection}
            className="p-1.5 text-[var(--ember-text-muted)] hover:text-[var(--ember-text-primary)] hover:bg-[var(--ember-surface-raised)] rounded-lg transition-colors cursor-pointer"
            title="Deselect all rows (Esc)"
          >
            <X className="w-4 h-4" />
          </button>
        </>
      )}

      {undoToast && (
        <div className="flex items-center gap-3 bg-emerald-500/15 border border-emerald-500/30 text-emerald-700 dark:text-emerald-300 px-3 py-1.5 rounded-xl font-medium">
          <CheckCircle className="w-4 h-4 text-emerald-500" />
          <span>{undoToast.message}</span>
          <button
            onClick={() => {
              onUndoLastAction?.();
              setUndoToast(null);
            }}
            className="flex items-center gap-1 px-2 py-0.5 bg-emerald-500 text-white rounded font-bold text-[11px] hover:bg-emerald-600 transition-colors cursor-pointer"
          >
            <RotateCcw className="w-3 h-3" /> Undo ({undoToast.timer}s)
          </button>
        </div>
      )}
    </div>
  );
};
