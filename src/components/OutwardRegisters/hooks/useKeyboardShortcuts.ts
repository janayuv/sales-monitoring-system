import { useEffect, RefObject } from "react";

interface ShortcutHandlers {
  searchInputRef: RefObject<HTMLInputElement | null>;
  onExportCsv: () => void;
  onResetFilters: () => void;
  onPrevPage: () => void;
  onNextPage: () => void;
}

export function useKeyboardShortcuts({
  searchInputRef,
  onExportCsv,
  onResetFilters,
  onPrevPage,
  onNextPage,
}: ShortcutHandlers) {
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // 1. Ctrl+F / Cmd+F -> Focus search bar
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "f") {
        e.preventDefault();
        searchInputRef.current?.focus();
        return;
      }

      // 2. Ctrl+E / Cmd+E -> Trigger Export CSV
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "e") {
        e.preventDefault();
        onExportCsv();
        return;
      }

      // 3. Escape -> Reset filters & blur search
      if (e.key === "Escape") {
        if (document.activeElement === searchInputRef.current) {
          searchInputRef.current?.blur();
        }
        onResetFilters();
        return;
      }

      // 4. Alt + Left Arrow -> Previous Page
      if (e.altKey && e.key === "ArrowLeft") {
        e.preventDefault();
        onPrevPage();
        return;
      }

      // 5. Alt + Right Arrow -> Next Page
      if (e.altKey && e.key === "ArrowRight") {
        e.preventDefault();
        onNextPage();
        return;
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [searchInputRef, onExportCsv, onResetFilters, onPrevPage, onNextPage]);
}
