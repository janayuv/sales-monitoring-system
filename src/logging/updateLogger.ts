// src/logging/updateLogger.ts
import { writeTextFile, readTextFile, exists, stat, rename, remove } from "@tauri-apps/plugin-fs";
import { BaseDirectory } from "@tauri-apps/api/path";
import { UpdateLog, UpdateMetrics } from "../types/updater";

const LOG_FILE = "update.log";
const MAX_LOG_SIZE = 5 * 1024 * 1024; // 5 MB
const BACKUP_COUNT = 5;
const METRICS_STORAGE_KEY = "updater_analytics_metrics";
const FALLBACK_LOGS_KEY = "updater_history_logs";
const MAX_FALLBACK_LOGS = 200;

const DEFAULT_METRICS: UpdateMetrics = {
  check_count: 0,
  download_success: 0,
  download_failure: 0,
  install_success: 0,
  install_failure: 0,
};

// In-memory fallback logs cache
let inMemoryLogs: UpdateLog[] = [];
const isTauri = typeof window !== "undefined" && ("__TAURI_INTERNALS__" in window || "__TAURI__" in window);

export class UpdateLogger {
  // --------------------------------------------------------------------------
  // Analytics Metrics Management
  // --------------------------------------------------------------------------

  /**
   * Retrieves current update analytics metrics.
   */
  public static getMetrics(): UpdateMetrics {
    try {
      if (typeof window !== "undefined" && window.localStorage) {
        const stored = localStorage.getItem(METRICS_STORAGE_KEY);
        if (stored) {
          const parsed = JSON.parse(stored);
          return {
            check_count: typeof parsed.check_count === "number" ? parsed.check_count : 0,
            download_success: typeof parsed.download_success === "number" ? parsed.download_success : 0,
            download_failure: typeof parsed.download_failure === "number" ? parsed.download_failure : 0,
            install_success: typeof parsed.install_success === "number" ? parsed.install_success : 0,
            install_failure: typeof parsed.install_failure === "number" ? parsed.install_failure : 0,
          };
        }
      }
    } catch (e) {
      console.warn("[UpdateLogger] Failed to read metrics from localStorage:", e);
    }
    return { ...DEFAULT_METRICS };
  }

  /**
   * Atomically increments a specific analytics metric counter.
   */
  public static incrementMetric(metric: keyof UpdateMetrics): void {
    try {
      const current = this.getMetrics();
      current[metric] = (current[metric] || 0) + 1;
      if (typeof window !== "undefined" && window.localStorage) {
        localStorage.setItem(METRICS_STORAGE_KEY, JSON.stringify(current));
      }
    } catch (e) {
      console.warn(`[UpdateLogger] Failed to increment metric '${metric}':`, e);
    }
  }

  /**
   * Resets all update analytics metrics to zero.
   */
  public static resetMetrics(): void {
    try {
      if (typeof window !== "undefined" && window.localStorage) {
        localStorage.setItem(METRICS_STORAGE_KEY, JSON.stringify(DEFAULT_METRICS));
      }
    } catch (e) {
      console.warn("[UpdateLogger] Failed to reset metrics:", e);
    }
  }

  // --------------------------------------------------------------------------
  // Structured Updater Logging
  // --------------------------------------------------------------------------

  private static async rotateLogs(): Promise<void> {
    if (!isTauri) return;
    try {
      const fileExists = await exists(LOG_FILE, { baseDir: BaseDirectory.AppData });
      if (!fileExists) return;

      const fileInfo = await stat(LOG_FILE, { baseDir: BaseDirectory.AppData });
      if (fileInfo.size < MAX_LOG_SIZE) return;

      // Rotate existing backups: update.log.5 removed, update.log.4 -> update.log.5, etc.
      for (let i = BACKUP_COUNT; i >= 1; i--) {
        const currentBackup = `${LOG_FILE}.${i}`;
        const prevBackup = i === 1 ? LOG_FILE : `${LOG_FILE}.${i - 1}`;

        const prevExists = await exists(prevBackup, { baseDir: BaseDirectory.AppData });
        if (prevExists) {
          const currentExists = await exists(currentBackup, { baseDir: BaseDirectory.AppData });
          if (currentExists) {
            await remove(currentBackup, { baseDir: BaseDirectory.AppData });
          }
          await rename(prevBackup, currentBackup, {
            oldPathBaseDir: BaseDirectory.AppData,
            newPathBaseDir: BaseDirectory.AppData,
          });
        }
      }
    } catch (e) {
      console.warn("[UpdateLogger] Failed to rotate update logs:", e);
    }
  }

  /**
   * Records a structured updater log entry.
   * Persists to both the filesystem log and the in-memory/localStorage fallback store.
   */
  public static async log(
    level: "INFO" | "WARN" | "ERROR" | "DEBUG",
    event: string,
    version?: string,
    details?: string
  ): Promise<void> {
    const logEntry: UpdateLog = {
      timestamp: new Date().toISOString(),
      level,
      event,
      version,
      details,
    };

    // 1. Update in-memory and localStorage cache for instant UI availability
    inMemoryLogs.unshift(logEntry);
    if (inMemoryLogs.length > MAX_FALLBACK_LOGS) {
      inMemoryLogs = inMemoryLogs.slice(0, MAX_FALLBACK_LOGS);
    }

    try {
      if (typeof window !== "undefined" && window.localStorage) {
        localStorage.setItem(FALLBACK_LOGS_KEY, JSON.stringify(inMemoryLogs));
      }
    } catch {
      // Ignore localStorage quotas
    }

    // 2. Persist to Tauri filesystem if running in Tauri environment
    if (isTauri) {
      try {
        await this.rotateLogs();

        const line = JSON.stringify(logEntry) + "\n";
        await writeTextFile(LOG_FILE, line, {
          baseDir: BaseDirectory.AppData,
          append: true,
        });
      } catch (e) {
        // Non-fatal: logged to console and preserved in memory/localStorage
        console.warn("[UpdateLogger] Filesystem write failed, preserved in local store:", e);
      }
    }

    console.log(`[UpdateLogger - ${level}] ${event} ${version ? `(${version})` : ""} - ${details || ""}`);
  }

  /**
   * Retrieves the most recent updater logs in reverse chronological order (newest first).
   */
  public static async getLogs(linesCount = 100): Promise<UpdateLog[]> {
    let fsLogs: UpdateLog[] = [];

    // 1. Try reading from filesystem if in Tauri
    if (isTauri) {
      try {
        const fileExists = await exists(LOG_FILE, { baseDir: BaseDirectory.AppData });
        if (fileExists) {
          const content = await readTextFile(LOG_FILE, { baseDir: BaseDirectory.AppData });
          const lines = content.trim().split("\n");

          for (let i = 0; i < lines.length; i++) {
            const trimmed = lines[i].trim();
            if (trimmed) {
              try {
                fsLogs.push(JSON.parse(trimmed));
              } catch {
                // Ignore invalid JSON lines
              }
            }
          }
        }
      } catch (e) {
        console.warn("[UpdateLogger] Could not read from filesystem, using fallback store:", e);
      }
    }

    // If filesystem logs were found, return the requested count in newest-first order
    if (fsLogs.length > 0) {
      // Synchronize in-memory cache
      inMemoryLogs = [...fsLogs].reverse();
      return fsLogs.slice(-linesCount).reverse();
    }

    // 2. Fallback to localStorage / in-memory store
    if (inMemoryLogs.length === 0) {
      try {
        if (typeof window !== "undefined" && window.localStorage) {
          const stored = localStorage.getItem(FALLBACK_LOGS_KEY);
          if (stored) {
            inMemoryLogs = JSON.parse(stored);
          }
        }
      } catch {
        inMemoryLogs = [];
      }
    }

    return inMemoryLogs.slice(0, linesCount);
  }

  /**
   * Clears all updater history logs from disk and local stores.
   */
  public static async clearLogs(): Promise<void> {
    // 1. Clear memory and local storage
    inMemoryLogs = [];
    try {
      if (typeof window !== "undefined" && window.localStorage) {
        localStorage.removeItem(FALLBACK_LOGS_KEY);
      }
    } catch {
      // Ignore
    }

    // 2. Clear filesystem logs if in Tauri
    if (isTauri) {
      try {
        const fileExists = await exists(LOG_FILE, { baseDir: BaseDirectory.AppData });
        if (fileExists) {
          await remove(LOG_FILE, { baseDir: BaseDirectory.AppData });
        }
        for (let i = 1; i <= BACKUP_COUNT; i++) {
          const backupFile = `${LOG_FILE}.${i}`;
          const backupExists = await exists(backupFile, { baseDir: BaseDirectory.AppData });
          if (backupExists) {
            await remove(backupFile, { baseDir: BaseDirectory.AppData });
          }
        }
      } catch (e) {
        console.warn("[UpdateLogger] Failed to clear filesystem logs:", e);
      }
    }
  }
}
