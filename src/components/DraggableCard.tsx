import React, { useState } from "react";
import { GripVertical } from "lucide-react";

export interface CardLayoutConfig {
  id: string;
  colSpan: 1 | 2 | 3; // 1 = 1 column, 2 = 2 columns, 3 = full width (in 3-col grid)
}

interface DraggableCardProps {
  id: string;
  title?: string;
  children: React.ReactNode;
  colSpan: 1 | 2 | 3;
  onColSpanChange: (id: string, newSpan: 1 | 2 | 3) => void;
  onDragStart: (id: string) => void;
  onDragOver: (e: React.DragEvent, id: string) => void;
  onDrop: (id: string) => void;
  isDragging?: boolean;
  className?: string;
  headerActions?: React.ReactNode;
}

export default function DraggableCard({
  id,
  title,
  children,
  colSpan,
  onColSpanChange,
  onDragStart,
  onDragOver,
  onDrop,
  isDragging = false,
  className = "",
  headerActions,
}: DraggableCardProps) {
  const [isDragOverTarget, setIsDragOverTarget] = useState(false);

  // Map colSpan to Tailwind grid column span classes
  const spanClasses = {
    1: "col-span-1",
    2: "col-span-1 md:col-span-2",
    3: "col-span-1 md:col-span-2 lg:col-span-3",
  }[colSpan];

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    setIsDragOverTarget(true);
    onDragOver(e, id);
  };

  const handleDragLeave = () => {
    setIsDragOverTarget(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOverTarget(false);
    onDrop(id);
  };

  return (
    <div
      draggable
      onDragStart={() => onDragStart(id)}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      className={`ember-card flex flex-col transition-all duration-200 ${spanClasses} ${
        isDragging ? "opacity-40 border-dashed border-[var(--ember-primary)] scale-[0.99]" : ""
      } ${
        isDragOverTarget
          ? "border-2 border-[var(--ember-primary)] shadow-lg ring-2 ring-[var(--ember-primary)]/20 scale-[1.01]"
          : ""
      } ${className}`}
    >
      {/* Draggable Card Header Handle Bar */}
      <div className="px-4 py-2.5 bg-[var(--ember-surface-raised)] border-b border-[var(--ember-border)] flex items-center justify-between gap-2 rounded-t-xl select-none group">
        <div className="flex items-center gap-2 overflow-hidden">
          {/* Drag Grip Handle Icon */}
          <div
            className="cursor-grab active:cursor-grabbing p-1 -ml-1 text-[var(--ember-text-muted)] hover:text-[var(--ember-primary)] transition-colors rounded hover:bg-[var(--ember-surface)]"
            title="Click & Drag to move block position"
          >
            <GripVertical className="w-4 h-4" />
          </div>

          {title && (
            <h4 className="text-xs font-bold font-serif text-[var(--ember-text-primary)] truncate">
              {title}
            </h4>
          )}
        </div>

        {/* Card Controls: Width / ColSpan Selector & Header Actions */}
        <div className="flex items-center gap-2">
          {headerActions}

          <div className="flex items-center bg-[var(--ember-surface)] border border-[var(--ember-border)] rounded-lg p-0.5 text-[10px] font-mono">
            <button
              onClick={() => onColSpanChange(id, 1)}
              className={`px-1.5 py-0.5 rounded transition-colors cursor-pointer ${
                colSpan === 1
                  ? "bg-[var(--ember-primary)] text-white font-bold"
                  : "text-[var(--ember-text-muted)] hover:text-[var(--ember-text-primary)]"
              }`}
              title="Resize: 1 Column Width"
            >
              1x
            </button>
            <button
              onClick={() => onColSpanChange(id, 2)}
              className={`px-1.5 py-0.5 rounded transition-colors cursor-pointer ${
                colSpan === 2
                  ? "bg-[var(--ember-primary)] text-white font-bold"
                  : "text-[var(--ember-text-muted)] hover:text-[var(--ember-text-primary)]"
              }`}
              title="Resize: 2 Columns Width"
            >
              2x
            </button>
            <button
              onClick={() => onColSpanChange(id, 3)}
              className={`px-1.5 py-0.5 rounded transition-colors cursor-pointer ${
                colSpan === 3
                  ? "bg-[var(--ember-primary)] text-white font-bold"
                  : "text-[var(--ember-text-muted)] hover:text-[var(--ember-text-primary)]"
              }`}
              title="Resize: Full Width"
            >
              Full
            </button>
          </div>
        </div>
      </div>

      {/* Card Content */}
      <div className="p-6 flex-1 flex flex-col">{children}</div>
    </div>
  );
}
