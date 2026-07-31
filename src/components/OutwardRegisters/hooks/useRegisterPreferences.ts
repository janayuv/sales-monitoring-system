import { useState } from "react";
import { PreferenceService } from "../services/preferenceService";
import { TablePreferencesV1, TableDensity, SortConfig } from "../types/register";

export function useRegisterPreferences() {
  const [preferences, setPreferences] = useState<TablePreferencesV1>(() =>
    PreferenceService.loadPreferences()
  );

  const setDensity = (density: TableDensity) => {
    setPreferences((prev) => {
      const next = { ...prev, density };
      PreferenceService.savePreferences(next);
      return next;
    });
  };

  const setPageSize = (pageSize: number) => {
    setPreferences((prev) => {
      const next = { ...prev, pageSize };
      PreferenceService.savePreferences(next);
      return next;
    });
  };

  const setVisibleColumns = (visibleColumns: string[]) => {
    setPreferences((prev) => {
      const next = { ...prev, visibleColumns };
      PreferenceService.savePreferences(next);
      return next;
    });
  };

  const setSavedSortConfig = (sortConfig: SortConfig) => {
    setPreferences((prev) => {
      const next = { ...prev, sortConfig };
      PreferenceService.savePreferences(next);
      return next;
    });
  };

  const resetAllPreferences = () => {
    const defaults = PreferenceService.resetPreferences();
    setPreferences(defaults);
  };

  return {
    preferences,
    setDensity,
    setPageSize,
    setVisibleColumns,
    setSavedSortConfig,
    resetAllPreferences,
  };
}
