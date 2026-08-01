// src/services/updater/UpdaterService.ts
import { invoke } from "@tauri-apps/api/core";
import { listen, UnlistenFn } from "@tauri-apps/api/event";
import { relaunch as tauriRelaunch } from "@tauri-apps/plugin-process";
import { IUpdateProvider } from "./IUpdateProvider";
import { UpdateSettingsService } from "./UpdateSettingsService";
import { UpdateState, UpdateError, UpdateResult, UpdateManifest, BuildMetadata } from "../../types/updater";
import { CustomUpdateInfo } from "../../types/bindings/CustomUpdateInfo";
import { UpdateLogger } from "../../logging/updateLogger";

type UpdaterEvent =
  | "StateChanged"
  | "UpdateCheckStarted"
  | "UpdateAvailable"
  | "NoUpdate"
  | "DownloadProgress"
  | "DownloadCompleted"
  | "InstallStarted"
  | "InstallCompleted"
  | "RestartRequired"
  | "Failed"
  | "Cancelled";

type EventListener = (...args: any[]) => void;

export class UpdaterService {
  private provider: IUpdateProvider;
  private state: UpdateState = "Idle";
  private listeners: Map<UpdaterEvent, Set<EventListener>> = new Map();
  private activeDownloadProgress = {
    percentage: 0,
    downloadedBytes: 0,
    totalBytes: 0,
    speedBps: 0,
    etaSeconds: 0,
  };
  private buildConstants: BuildMetadata | null = null;

  constructor(provider: IUpdateProvider) {
    this.provider = provider;
  }

  // Event emitter helper
  public on(event: UpdaterEvent, listener: EventListener): void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event)!.add(listener);
  }

  public off(event: UpdaterEvent, listener: EventListener): void {
    const set = this.listeners.get(event);
    if (set) {
      set.delete(listener);
    }
  }

  private emit(event: UpdaterEvent, ...args: any[]): void {
    const set = this.listeners.get(event);
    if (set) {
      set.forEach((ln) => {
        try {
          ln(...args);
        } catch (e) {
          console.error(`Error in updater event listener for ${event}:`, e);
        }
      });
    }
  }

  public getState(): UpdateState {
    return this.state;
  }

  private setState(state: UpdateState): void {
    const oldState = this.state;
    if (oldState !== state) {
      this.state = state;
      this.emit("StateChanged", state, oldState);
      UpdateLogger.log("INFO", `State changed: ${oldState} -> ${state}`);
    }
  }

  /**
   * Retrieves build constants generated at compile time.
   */
  public async getBuildMetadata(): Promise<BuildMetadata> {
    if (this.buildConstants) return this.buildConstants;
    try {
      this.buildConstants = await invoke<BuildMetadata>("get_build_constants");
      return this.buildConstants;
    } catch (e) {
      console.error("Failed to load build constants:", e);
      return {
        app_version: "0.1.0",
        build_date: "unknown",
        build_time: "unknown",
        git_hash: "unknown",
        git_branch: "unknown",
        rust_version: "unknown",
        target: "unknown",
        profile: "unknown",
        build_number: "0",
      };
    }
  }

  /**
   * Helper to perform network retries with exponential backoff.
   */
  private async retryWithBackoff<T>(
    operation: () => Promise<T>,
    retryCount: number,
    delayMs: number,
    multiplier: number
  ): Promise<T> {
    let attempt = 0;
    while (true) {
      try {
        return await operation();
      } catch (e) {
        attempt++;
        if (attempt >= retryCount) {
          throw e;
        }
        const backoffDelay = delayMs * Math.pow(multiplier, attempt - 1);
        await new Promise((res) => setTimeout(res, backoffDelay));
      }
    }
  }

  /**
   * Checks for updates against the configured channel.
   *
   * Detection runs through the Rust backend (`check_for_updates_custom`), which uses
   * tauri-plugin-updater to fetch and compare the manifest server-side. This avoids the
   * webview CORS failures that occur when fetching GitHub release assets directly from the
   * frontend, and keeps version detection consistent with the download/install step.
   *
   * @param force If true, ignores skipped versions (e.g. manual click).
   */
  public async checkForUpdates(force = false): Promise<UpdateResult<UpdateManifest | null>> {
    if (this.state === "Downloading" || this.state === "Installing") {
      return {
        success: false,
        error: "DownloadFailed",
        message: "An update check cannot be run while downloading or installing an update.",
      };
    }

    this.setState("Checking");
    this.emit("UpdateCheckStarted");

    try {
      const channel = await UpdateSettingsService.getChannel();

      // 1. Check via the Rust backend with retry logic (server-side, no webview CORS).
      //    Returns the update info when a newer version exists, or null when up to date.
      const info = await this.retryWithBackoff(
        () => invoke<CustomUpdateInfo | null>("check_for_updates_custom", { channel }),
        3,
        1500,
        2
      );

      // 2. No newer version available.
      if (!info) {
        this.setState("NoUpdate");
        this.emit("NoUpdate");
        return { success: true, data: null };
      }

      // 3. Skipped version check (unless forced).
      if (!force) {
        const skipped = await UpdateSettingsService.getSkippedVersion();
        if (skipped === info.version) {
          this.setState("NoUpdate");
          this.emit("NoUpdate");
          return { success: true, data: null };
        }
      }

      // 4. Resolve release notes (GitHub API supports CORS; falls back gracefully).
      let notes = info.body ?? "";
      try {
        notes = await this.provider.fetchReleaseNotes(info.version);
      } catch {
        // Keep whatever the manifest provided (may be empty).
      }

      const manifest: UpdateManifest = {
        manifestVersion: 1,
        version: info.version,
        notes,
        pub_date: info.date ?? undefined,
        platforms: {},
      };

      // Update is available!
      this.setState("UpdateAvailable");
      this.emit("UpdateAvailable", manifest);
      return { success: true, data: manifest };
    } catch (e) {
      const isOffline = !navigator.onLine;
      const errType: UpdateError = isOffline ? "Offline" : "Unknown";
      const errMsg = isOffline
        ? "Internet connection is offline."
        : e instanceof Error
        ? e.message
        : typeof e === "string"
        ? e
        : "Failed to check for updates.";

      this.setState("Failed");
      this.emit("Failed", errType, errMsg);
      return { success: false, error: errType, message: errMsg };
    }
  }

  /**
   * Downloads and installs the pending update.
   */
  public async downloadAndInstall(): Promise<UpdateResult<void>> {
    if (this.state !== "UpdateAvailable" && this.state !== "Failed") {
      return {
        success: false,
        error: "DownloadFailed",
        message: "No update check has been run or no update is available.",
      };
    }

    this.setState("Downloading");

    let unlistenProgress: UnlistenFn | null = null;
    let unlistenFinished: UnlistenFn | null = null;

    try {
      const channel = await UpdateSettingsService.getChannel();

      // Setup event listeners
      let startTime = Date.now();
      let downloadedBytes = 0;
      let totalBytes = 0;

      unlistenProgress = await listen<[number, number]>("custom-updater-progress", (event) => {
        const [chunkSize, total] = event.payload;
        if (totalBytes === 0 && total > 0) {
          totalBytes = total;
          this.activeDownloadProgress.totalBytes = total;
          this.emit("DownloadProgress", {
            percentage: 0,
            downloadedBytes: 0,
            totalBytes,
            speedBps: 0,
            etaSeconds: 0,
          });
        }
        downloadedBytes += chunkSize;
        const percentage = totalBytes > 0 ? Math.round((downloadedBytes / totalBytes) * 100) : 0;

        const elapsedSeconds = (Date.now() - startTime) / 1000;
        const speedBps = elapsedSeconds > 0 ? downloadedBytes / elapsedSeconds : 0;
        const remainingBytes = totalBytes > downloadedBytes ? totalBytes - downloadedBytes : 0;
        const etaSeconds = speedBps > 0 ? Math.round(remainingBytes / speedBps) : 0;

        this.activeDownloadProgress = {
          percentage,
          downloadedBytes,
          totalBytes,
          speedBps,
          etaSeconds,
        };
        this.emit("DownloadProgress", { ...this.activeDownloadProgress });
      });

      unlistenFinished = await listen<void>("custom-updater-finished", () => {
        this.setState("Downloaded");
        this.emit("DownloadCompleted");
      });

      // Run updater check natively to cache update details
      const update = await invoke<any>("check_for_updates_custom", { channel });
      if (!update) {
        if (unlistenProgress) unlistenProgress();
        if (unlistenFinished) unlistenFinished();
        this.setState("Failed");
        this.emit("Failed", "DownloadFailed", "The update package is no longer available on the server.");
        return {
          success: false,
          error: "DownloadFailed",
          message: "The update package is no longer available on the server.",
        };
      }

      // Execute download and install
      await invoke("install_pending_update_custom");

      if (unlistenProgress) unlistenProgress();
      if (unlistenFinished) unlistenFinished();

      this.setState("RestartRequired");
      this.emit("RestartRequired");
      return { success: true, data: undefined };
    } catch (e) {
      if (unlistenProgress) unlistenProgress();
      if (unlistenFinished) unlistenFinished();
      this.setState("Failed");
      const errType: UpdateError = "InstallFailed";
      const errMsg = e instanceof Error ? e.message : String(e);
      this.emit("Failed", errType, errMsg);
      return { success: false, error: errType, message: errMsg };
    }
  }

  /**
   * Relaunches the application.
   */
  public async relaunch(): Promise<void> {
    try {
      this.setState("Idle");
      await tauriRelaunch();
    } catch (e) {
      this.setState("Failed");
      this.emit("Failed", "RestartFailed", `Relaunch failed: ${e}`);
    }
  }

  /**
   * Cancels the download/installation (if possible).
   */
  public cancel(): void {
    if (this.state === "Downloading" || this.state === "Checking" || this.state === "UpdateAvailable") {
      this.setState("Cancelled");
      this.emit("Cancelled");
    }
  }

  /**
   * Helper to clean up any temporary states or logs.
   */
  public async performCleanup(): Promise<void> {
    try {
      // Basic cleanup of cached files can be handled here if custom downloads are used.
      // With Tauri-native, installer cleanup is automated by the operating system wrapper.
      UpdateLogger.log("INFO", "Running automatic updater directory cleanup.");
    } catch (e) {
      console.warn("Cleanup warning:", e);
    }
  }

  /**
   * System Recovery Hook
   * Resets skip version flags, clears local download metrics, and resets state machine back to Idle.
   */
  public async performRecovery(): Promise<UpdateResult<void>> {
    try {
      UpdateLogger.log("WARN", "Executing manual recovery procedure for update system.");

      // 1. Reset skipped versions to allow re-checking skipped updates
      await UpdateSettingsService.setSkippedVersion("");

      // 2. Clear progress trackers
      this.activeDownloadProgress = {
        percentage: 0,
        downloadedBytes: 0,
        totalBytes: 0,
        speedBps: 0,
        etaSeconds: 0,
      };

      // 3. Reset state machine
      this.setState("Idle");

      UpdateLogger.log("INFO", "Updater recovery procedure completed successfully.");
      return { success: true, data: undefined };
    } catch (e) {
      UpdateLogger.log("ERROR", `Updater recovery failed: ${e}`);
      return {
        success: false,
        error: "Unknown",
        message: e instanceof Error ? e.message : String(e),
      };
    }
  }
}
