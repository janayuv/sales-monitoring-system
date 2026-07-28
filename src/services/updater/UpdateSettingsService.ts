// src/services/updater/UpdateSettingsService.ts
/**
 * UpdateSettingsService
 * 
 * Manages preferences specific ONLY to the software update manager subsystem.
 * Unlike general application settings (e.g. company profiles, invoice matching rules, database paths),
 * updater settings govern the lifecycle of software release channels, background checks intervals,
 * and skips/rollouts versions configurations.
 * 
 * Storage Consistency Policy:
 * 1. Tauri Runtime (Desktop App): SQLite is the single source of truth. During database migrations
 *    or early application boot sequences, values are temporarily cached in an in-memory cache.
 *    LocalStorage is NOT used to prevent data synchronization drift.
 * 2. Browser Runtime (Web Preview): LocalStorage is used if running outside of Tauri.
 */
import { invoke } from "@tauri-apps/api/core";
import { UpdateChannel } from "../../types/updater";

const LOCAL_STORAGE_PREFIX = "updater_settings_";
const isTauri = typeof window !== "undefined" && (window as any).__TAURI__ !== undefined;
const memoryCache = new Map<string, string>();

export class UpdateSettingsService {
  private static async getSetting(key: string, defaultVal: string): Promise<string> {
    if (!isTauri) {
      // Browser environment: Use LocalStorage directly
      const fallback = localStorage.getItem(LOCAL_STORAGE_PREFIX + key);
      return fallback !== null ? fallback : defaultVal;
    }

    try {
      // Desktop app: Try fetching from SQLite settings first
      const val = await invoke<string>("get_app_setting", {
        settingKey: key,
        defaultVal: defaultVal,
      });
      // Synchronize memory cache
      memoryCache.set(key, val);
      return val;
    } catch (e) {
      // Fallback to memory cache during early boot / database initialization lockouts
      const cached = memoryCache.get(key);
      if (cached !== undefined) return cached;
      
      console.warn(`Database setting fetch failed for ${key} during startup; utilizing default fallback:`, e);
      return defaultVal;
    }
  }

  private static async setSetting(key: string, value: string): Promise<void> {
    if (!isTauri) {
      // Browser environment: Use LocalStorage directly
      localStorage.setItem(LOCAL_STORAGE_PREFIX + key, value);
      return;
    }

    // Always update memory cache immediately
    memoryCache.set(key, value);

    try {
      // Try to save to SQLite settings
      await invoke("set_app_setting", {
        settingKey: key,
        settingValue: value,
      });
    } catch (e) {
      // Database is disconnected, busy, or migrating; relies on memory cache
      console.warn(`Database setting write failed for ${key}, using memory cache fallback:`, e);
    }
  }

  // Schema versioning for updater preferences
  public static async getSchemaVersion(): Promise<number> {
    const versionStr = await this.getSetting("updater_schema_version", "1");
    return parseInt(versionStr, 10) || 1;
  }

  public static async setSchemaVersion(version: number): Promise<void> {
    await this.setSetting("updater_schema_version", version.toString());
  }

  // Update channel preference (Production, Preview, Internal)
  public static async getChannel(): Promise<UpdateChannel> {
    const channel = await this.getSetting("updater_channel", "Production");
    return channel as UpdateChannel;
  }

  public static async setChannel(channel: UpdateChannel): Promise<void> {
    await this.setSetting("updater_channel", channel);
  }

  // Auto check preference
  public static async getAutoCheck(): Promise<boolean> {
    const val = await this.getSetting("updater_auto_check", "true");
    return val === "true";
  }

  public static async setAutoCheck(enabled: boolean): Promise<void> {
    await this.setSetting("updater_auto_check", enabled ? "true" : "false");
  }

  // Skipped version
  public static async getSkippedVersion(): Promise<string> {
    return await this.getSetting("updater_skipped_version", "");
  }

  public static async setSkippedVersion(version: string): Promise<void> {
    await this.setSetting("updater_skipped_version", version);
  }

  // Check schedule: 'startup' | 'daily' | 'weekly' | 'manual'
  public static async getCheckSchedule(): Promise<string> {
    return await this.getSetting("updater_check_schedule", "startup");
  }

  public static async setCheckSchedule(schedule: string): Promise<void> {
    await this.setSetting("updater_check_schedule", schedule);
  }

  // Last checked timestamp (ISO string)
  public static async getLastCheckTime(): Promise<string> {
    return await this.getSetting("updater_last_check_time", "");
  }

  public static async setLastCheckTime(timestamp: string): Promise<void> {
    await this.setSetting("updater_last_check_time", timestamp);
  }

  // Migration logic for updater settings schema versioning
  public static async runMigrations(): Promise<void> {
    const currentVersion = await this.getSchemaVersion();
    const TARGET_VERSION = 1;

    if (currentVersion < TARGET_VERSION) {
      console.log(`Migrating updater settings schema from v${currentVersion} to v${TARGET_VERSION}`);
      // Perform settings migration here if needed in future versions
      await this.setSchemaVersion(TARGET_VERSION);
    }
  }
}
