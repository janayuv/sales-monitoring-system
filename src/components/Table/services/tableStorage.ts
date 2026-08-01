import { STORAGE_VERSION } from "../constants";
import { TableTelemetry } from "./tableTelemetry";

export class TableStorage {
  private static getKey(tableKey: string, feature: string): string {
    return `${tableKey}-${feature}-${STORAGE_VERSION}`;
  }

  static get<T>(tableKey: string, feature: string, fallback: T): T {
    const key = this.getKey(tableKey, feature);
    try {
      const raw = localStorage.getItem(key);
      if (!raw) return fallback;
      return JSON.parse(raw) as T;
    } catch (err: any) {
      // Backup corrupted value for recovery
      try {
        const raw = localStorage.getItem(key);
        if (raw) {
          localStorage.setItem(`_corrupted_${key}`, raw);
        }
      } catch (_) {}

      TableTelemetry.log("storage", "storage_parse_failed", { key, error: err.message });
      return fallback;
    }
  }

  static set<T>(tableKey: string, feature: string, value: T): void {
    const key = this.getKey(tableKey, feature);
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch (err: any) {
      TableTelemetry.log("storage", "storage_write_failed", { key, error: err.message });
    }
  }

  static remove(tableKey: string, feature: string): void {
    const key = this.getKey(tableKey, feature);
    try {
      localStorage.removeItem(key);
    } catch (err: any) {
      TableTelemetry.log("storage", "storage_remove_failed", { key, error: err.message });
    }
  }
}
