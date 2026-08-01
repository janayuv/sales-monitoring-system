import { useState, useEffect, useCallback } from "react";
import { SelectionState } from "../../Table/types";
import { CustomerMasterRow } from "../../../types/bindings/CustomerMasterRow";

export function useCustomerSelection(rows: CustomerMasterRow[]) {
  const [selectionState, setSelectionState] = useState<SelectionState>({
    type: "none",
    selectedIds: new Set<string | number>(),
    excludedIds: new Set<string | number>(),
  });

  // Purge stale IDs that no longer exist in dataset upon data refresh
  useEffect(() => {
    if (rows.length === 0) return;
    const validIds = new Set(rows.map((r) => String(r.id)));

    setSelectionState((prev) => {
      if (prev.type === "none") return prev;

      const nextSelected = new Set<string | number>();
      prev.selectedIds.forEach((id) => {
        if (validIds.has(String(id))) nextSelected.add(id);
      });

      return {
        ...prev,
        selectedIds: nextSelected,
        type: nextSelected.size === 0 ? "none" : prev.type,
      };
    });
  }, [rows]);

  const toggleSelectRow = useCallback((id: string | number) => {
    setSelectionState((prev) => {
      const nextSelected = new Set(prev.selectedIds);
      if (nextSelected.has(id)) {
        nextSelected.delete(id);
      } else {
        nextSelected.add(id);
      }

      return {
        type: nextSelected.size === 0 ? "none" : "selected",
        selectedIds: nextSelected,
        excludedIds: new Set(),
      };
    });
  }, []);

  const toggleSelectPage = useCallback((pageRows: CustomerMasterRow[]) => {
    setSelectionState((prev) => {
      const pageIds = pageRows.map((r) => String(r.id));
      const allPageSelected = pageIds.every((id) => prev.selectedIds.has(id));

      const nextSelected = new Set(prev.selectedIds);
      if (allPageSelected) {
        pageIds.forEach((id) => nextSelected.delete(id));
      } else {
        pageIds.forEach((id) => nextSelected.add(id));
      }

      return {
        type: nextSelected.size === 0 ? "none" : "selected",
        selectedIds: nextSelected,
        excludedIds: new Set(),
      };
    });
  }, []);

  const clearSelection = useCallback(() => {
    setSelectionState({
      type: "none",
      selectedIds: new Set(),
      excludedIds: new Set(),
    });
  }, []);

  return {
    selectionState,
    selectedIds: selectionState.selectedIds,
    setSelectionState,
    toggleSelectRow,
    toggleSelectPage,
    clearSelection,
  };
}
