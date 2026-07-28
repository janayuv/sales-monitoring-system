// src/logging/updateLogger.ts
import { writeTextFile, readTextFile, exists, stat, rename, remove } from "@tauri-apps/plugin-fs";
import { BaseDirectory } from "@tauri-apps/api/path";
import { UpdateLog } from "../types/updater";

const LOG_FILE = "update.log";
const MAX_LOG_SIZE = 5 * 1024 * 1024; // 5 MB
const BACKUP_COUNT = 5;

export class UpdateLogger {
  private static async rotateLogs(): Promise<void> {
    try {
      const fileExists = await exists(LOG_FILE, { baseDir: BaseDirectory.AppData });
      if (!fileExists) return;

      const fileInfo = await stat(LOG_FILE, { baseDir: BaseDirectory.AppData });
      if (fileInfo.size < MAX_LOG_SIZE) return;

      // Rotate existing backups
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
      console.error("Failed to rotate update logs:", e);
    }
  }

  public static async log(
    level: "INFO" | "WARN" | "ERROR" | "DEBUG",
    event: string,
    version?: string,
    details?: string
  ): Promise<void> {
    try {
      await this.rotateLogs();

      const logEntry: UpdateLog = {
        timestamp: new Date().toISOString(),
        level,
        event,
        version,
        details,
      };

      const line = JSON.stringify(logEntry) + "\n";
      await writeTextFile(LOG_FILE, line, {
        baseDir: BaseDirectory.AppData,
        append: true,
      });

      console.log(`[UpdateLogger - ${level}] ${event} ${version ? `(${version})` : ""} - ${details || ""}`);
    } catch (e) {
      console.error("Failed to write to update log:", e);
    }
  }

  public static async getLogs(linesCount = 100): Promise<UpdateLog[]> {
    try {
      const fileExists = await exists(LOG_FILE, { baseDir: BaseDirectory.AppData });
      if (!fileExists) return [];

      const content = await readTextFile(LOG_FILE, { baseDir: BaseDirectory.AppData });
      const lines = content.trim().split("\n");
      const logs: UpdateLog[] = [];

      const startIdx = Math.max(0, lines.length - linesCount);
      for (let i = startIdx; i < lines.length; i++) {
        if (lines[i].trim()) {
          try {
            logs.push(JSON.parse(lines[i]));
          } catch {
            // Ignore invalid JSON lines
          }
        }
      }

      return logs.reverse();
    } catch (e) {
      console.error("Failed to read update logs:", e);
      return [];
    }
  }

  public static async clearLogs(): Promise<void> {
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
      console.error("Failed to clear update logs:", e);
    }
  }
}
