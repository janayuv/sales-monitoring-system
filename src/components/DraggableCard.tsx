import React, { useState, useEffect } from "react";
import { GripVertical, ChevronLeft, ChevronRight } from "lucide-react";

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
  onDragOver?: (e: React.DragEvent, id: string) => void;
  onDrop: (id: string) => void;
  onDragEnd?: () => void;
  onMove?: (id: string, direction: "prev" | "next") => void;
  canMovePrev?: boolean;
  canMoveNext?: boolean;
  positionIndex?: number;
  totalCards?: number;
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
  onDrop,
  onDragEnd,
  onMove,
  canMovePrev = false,
  canMoveNext = false,
  positionIndex,
  totalCards,
  isDragging = false,
  className = "",
  headerActions,
}: DraggableCardProps) {
  const [isDragOverTarget, setIsDragOverTarget] = useState(false);

  // Listen for pointer drag hover events
  useEffect(() => {
    const handleHoverEvent = (e: Event) => {
      const customEvt = e as CustomEvent<{ targetId: string | null }>;
      if (customEvt.detail?.targetId === id) {
        setIsDragOverTarget(true);
      } else {
        setIsDragOverTarget(false);
      }
    };

    const handleClearHover = () => {
      setIsDragOverTarget(false);
    };

    window.addEventListener("card-drag-hover", handleHoverEvent);
    window.addEventListener("card-drag-clear", handleClearHover);
    return () => {
      window.removeEventListener("card-drag-hover", handleHoverEvent);
      window.removeEventListener("card-drag-clear", handleClearHover);
    };
  }, [id]);

  // Map colSpan to Tailwind grid column span classes
  const spanClasses = {
    1: "col-span-1",
    2: "col-span-1 md:col-span-2",
    3: "col-span-1 md:col-span-2 lg:col-span-3",
  }[colSpan];

  // Pointer-based Drag Handler (100% reliable across WebViews/Tauri/Browsers)
  const handlePointerDownHandle = (e: React.PointerEvent) => {
    if (e.button !== 0) return; // Left click only
    e.preventDefault();

    document.body.style.cursor = "grabbing";
    document.body.style.userSelect = "none";

    onDragStart(id);

    const handlePointerMove = (moveEvt: PointerEvent) => {
      const elem = document.elementFromPoint(moveEvt.clientX, moveEvt.clientY);
      const cardElem = elem?.closest("[data-card-id]");
      if (cardElem) {
        const targetId = cardElem.getAttribute("data-card-id");
        if (targetId && targetId !== id) {
          window.dispatchEvent(
            new CustomEvent("card-drag-hover", { detail: { targetId } })
          );
        } else {
          window.dispatchEvent(new CustomEvent("card-drag-clear"));
        }
      } else {
        window.dispatchEvent(new CustomEvent("card-drag-clear"));
      }
    };

    const handlePointerUp = (upEvt: PointerEvent) => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);

      document.body.style.cursor = "";
      document.body.style.userSelect = "";

      const elem = document.elementFromPoint(upEvt.clientX, upEvt.clientY);
      const cardElem = elem?.closest("[data-card-id]");
      
      window.dispatchEvent(new CustomEvent("card-drag-clear"));

      if (cardElem) {
        const targetId = cardElem.getAttribute("data-card-id");
        if (targetId && targetId !== id) {
          onDrop(targetId);
          return;
        }
      }

      if (onDragEnd) {
        onDragEnd();
      }
    };

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);
  };

  return (
    <div
      data-card-id={id}
      className={`ember-card flex flex-col transition-all duration-200 ${spanClasses} ${
        isDragging ? "opacity-40 border-dashed border-[var(--ember-primary)] scale-[0.99] ring-2 ring-[var(--ember-primary)]/40" : ""
      } ${
        isDragOverTarget
          ? "border-2 border-[var(--ember-primary)] shadow-xl ring-4 ring-[var(--ember-primary)]/30 scale-[1.01]"
          : ""
      } ${className}`}
    >
      {/* Draggable Card Header Handle Bar */}
      <div className="px-4 py-2.5 bg-[var(--ember-surface-raised)] border-b border-[var(--ember-border)] flex items-center justify-between gap-2 rounded-t-xl select-none group">
        <div className="flex items-center gap-2 overflow-hidden">
          {/* Drag Grip Handle Icon */}
          <div
            onPointerDown={handlePointerDownHandle}
            className="cursor-grab active:cursor-grabbing p-1.5 -ml-1 text-[var(--ember-text-muted)] hover:text-[var(--ember-primary)] hover:bg-[var(--ember-surface)] transition-colors rounded-md touch-none flex items-center justify-center"
            title="Click & Drag handle to move block position"
          >
            <GripVertical className="w-4 h-4 pointer-events-none" />
          </div>

          {title && (
            <h4 className="text-xs font-bold font-serif text-[var(--ember-text-primary)] truncate">
              {title}
            </h4>
          )}
        </div>

        {/* Card Controls: Manual Move / Position adjustment & Width Selector */}
        <div className="flex items-center gap-2">
          {headerActions}

          {/* Manual Block Position Adjustment Controls */}
          {onMove && (
            <div className="flex items-center bg-[var(--ember-surface)] border border-[var(--ember-border)] rounded-lg p-0.5 text-[10px]">
              <button
                type="button"
                disabled={!canMovePrev}
                onClick={(e) => {
                  e.stopPropagation();
                  onMove(id, "prev");
                }}
                className="p-1 rounded text-[var(--ember-text-muted)] hover:text-[var(--ember-text-primary)] disabled:opacity-30 disabled:cursor-not-allowed hover:bg-[var(--ember-surface-raised)] transition-colors cursor-pointer"
                title="Move card left / up in layout"
              >
                <ChevronLeft className="w-3.5 h-3.5" />
              </button>

              {positionIndex !== undefined && totalCards !== undefined && (
                <span className="px-1.5 font-mono text-[9px] font-bold text-[var(--ember-text-secondary)] select-none">
                  {positionIndex + 1}/{totalCards}
                </span>
              )}

              <button
                type="button"
                disabled={!canMoveNext}
                onClick={(e) => {
                  e.stopPropagation();
                  onMove(id, "next");
                }}
                className="p-1 rounded text-[var(--ember-text-muted)] hover:text-[var(--ember-text-primary)] disabled:opacity-30 disabled:cursor-not-allowed hover:bg-[var(--ember-surface-raised)] transition-colors cursor-pointer"
                title="Move card right / down in layout"
              >
                <ChevronRight className="w-3.5 h-3.5" />
              </button>
            </div>
          )}

          {/* Width Selector */}
          <div className="flex items-center bg-[var(--ember-surface)] border border-[var(--ember-border)] rounded-lg p-0.5 text-[10px] font-mono">
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onColSpanChange(id, 1);
              }}
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
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onColSpanChange(id, 2);
              }}
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
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onColSpanChange(id, 3);
              }}
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



