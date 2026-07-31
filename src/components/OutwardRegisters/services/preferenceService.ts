import { TablePreferencesV1 } from "../types/register";

const PREF_KEY = "register-table-v1";

const DEFAULT_PREFERENCES: TablePreferencesV1 = {
  version: "v1",
  pageSize: 25,
  density: "comfortable",
  visibleColumns: [
    "invoice_number",
    "invoice_date",
    "customer_name",
    "total_taxable",
    "total_tax",
    "total_value",
    "status",
    "actions",
  ],
  sortConfig: {
    column: "invoice_date",
    direction: "desc",
  },
};

export class PreferenceService {
  public static loadPreferences(): TablePreferencesV1 {
    try {
      const stored = localStorage.getItem(PREF_KEY);
      if (!stored) return DEFAULT_PREFERENCES;
      const parsed = JSON.parse(stored);
      if (parsed.version !== "v1") {
        return DEFAULT_PREFERENCES;
      }
      return { ...DEFAULT_PREFERENCES, ...parsed };
    } catch (err) {
      console.warn("Failed to load table preferences from storage:", err);
      return DEFAULT_PREFERENCES;
    }
  }

  public static savePreferences(prefs: Partial<TablePreferencesV1>): void {
    try {
      const current = PreferenceService.loadPreferences();
      const updated: TablePreferencesV1 = {
        ...current,
        ...prefs,
        version: "v1",
      };
      localStorage.setItem(PREF_KEY, JSON.stringify(updated));
    } catch (err) {
      console.warn("Failed to save table preferences:", err);
    }
  }

  public static resetPreferences(): TablePreferencesV1 {
    try {
      localStorage.removeItem(PREF_KEY);
    } catch (err) {
      // ignore
    }
    return DEFAULT_PREFERENCES;
  }
}
