// src/context/UpdaterContext.tsx
import React, { createContext, useState, useEffect, useCallback, useMemo } from "react";
import { UpdateState, UpdateError, UpdateChannel, UpdateManifest, BuildMetadata, UpdateResult } from "../types/updater";
import { UpdaterService } from "../services/updater/UpdaterService";
import { GitHubReleaseService } from "../services/updater/GitHubReleaseService";
import { UpdateSettingsService } from "../services/updater/UpdateSettingsService";

export interface UpdaterContextType {
  state: UpdateState;
  buildMetadata: BuildMetadata | null;
  downloadProgress: {
    percentage: number;
    downloadedBytes: number;
    totalBytes: number;
    speedBps: number;
    etaSeconds: number;
  };
  channel: UpdateChannel;
  autoCheck: boolean;
  checkSchedule: string;
  skippedVersion: string;
  lastCheckTime: string;
  availableManifest: UpdateManifest | null;
  error: { type: UpdateError; message: string } | null;
  checkForUpdates: (force?: boolean) => Promise<UpdateResult<UpdateManifest | null>>;
  downloadAndInstall: () => Promise<UpdateResult<void>>;
  relaunch: () => Promise<void>;
  cancel: () => void;
  setChannel: (channel: UpdateChannel) => Promise<void>;
  setAutoCheck: (enabled: boolean) => Promise<void>;
  setCheckSchedule: (schedule: string) => Promise<void>;
  setSkippedVersion: (version: string) => Promise<void>;
  clearError: () => void;
  performRecovery: () => Promise<UpdateResult<void>>;
}

export const UpdaterContext = createContext<UpdaterContextType | null>(null);

export const UpdaterProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [state, setState] = useState<UpdateState>("Idle");
  const [buildMetadata, setBuildMetadata] = useState<BuildMetadata | null>(null);
  const [downloadProgress, setDownloadProgress] = useState({
    percentage: 0,
    downloadedBytes: 0,
    totalBytes: 0,
    speedBps: 0,
    etaSeconds: 0,
  });

  // Preferences state
  const [channel, setChannelState] = useState<UpdateChannel>("Production");
  const [autoCheck, setAutoCheckState] = useState<boolean>(true);
  const [checkSchedule, setCheckScheduleState] = useState<string>("startup");
  const [skippedVersion, setSkippedVersionState] = useState<string>("");
  const [lastCheckTime, setLastCheckTimeState] = useState<string>("");
  const [availableManifest, setAvailableManifest] = useState<UpdateManifest | null>(null);
  const [error, setError] = useState<{ type: UpdateError; message: string } | null>(null);

  // Initialize service
  const service = useMemo(() => new UpdaterService(new GitHubReleaseService()), []);

  // Fetch preferences
  const refreshSettings = useCallback(async () => {
    try {
      const ch = await UpdateSettingsService.getChannel();
      const ac = await UpdateSettingsService.getAutoCheck();
      const cs = await UpdateSettingsService.getCheckSchedule();
      const sv = await UpdateSettingsService.getSkippedVersion();
      const lc = await UpdateSettingsService.getLastCheckTime();

      setChannelState(ch);
      setAutoCheckState(ac);
      setCheckScheduleState(cs);
      setSkippedVersionState(sv);
      setLastCheckTimeState(lc);
    } catch (e) {
      console.error("Failed to load updater settings:", e);
    }
  }, []);

  // Update preferences wrappers
  const setChannel = async (ch: UpdateChannel) => {
    await UpdateSettingsService.setChannel(ch);
    setChannelState(ch);
    // Write unencrypted settings file for Rust backend on next boot
    try {
      const { writeTextFile } = await import("@tauri-apps/plugin-fs");
      const { BaseDirectory } = await import("@tauri-apps/api/path");
      await writeTextFile("updater_settings.json", JSON.stringify({ channel: ch }), {
        baseDir: BaseDirectory.AppData,
      });
    } catch (e) {
      console.warn("Could not write updater_settings.json fallback:", e);
    }
  };

  const setAutoCheck = async (enabled: boolean) => {
    await UpdateSettingsService.setAutoCheck(enabled);
    setAutoCheckState(enabled);
  };

  const setCheckSchedule = async (schedule: string) => {
    await UpdateSettingsService.setCheckSchedule(schedule);
    setCheckScheduleState(schedule);
  };

  const setSkippedVersion = async (version: string) => {
    await UpdateSettingsService.setSkippedVersion(version);
    setSkippedVersionState(version);
  };

  const clearError = useCallback(() => setError(null), []);

  const checkForUpdates = useCallback(
    async (force = false) => {
      setError(null);
      const result = await service.checkForUpdates(force);
      
      const nowStr = new Date().toISOString();
      await UpdateSettingsService.setLastCheckTime(nowStr);
      setLastCheckTimeState(nowStr);

      return result;
    },
    [service]
  );

  const downloadAndInstall = useCallback(async () => {
    setError(null);
    return await service.downloadAndInstall();
  }, [service]);

  const relaunch = useCallback(async () => {
    await service.relaunch();
  }, [service]);

  const cancel = useCallback(() => {
    service.cancel();
  }, [service]);

  const performRecovery = useCallback(async () => {
    const result = await service.performRecovery();
    await refreshSettings();
    return result;
  }, [service, refreshSettings]);

  // Hook up event listeners to service
  useEffect(() => {
    // Run settings migrations
    UpdateSettingsService.runMigrations().then(refreshSettings);

    // Get build constants
    service.getBuildMetadata().then(setBuildMetadata);

    const onStateChanged = (newState: UpdateState) => {
      setState(newState);
      if (newState === "Idle" || newState === "NoUpdate") {
        setAvailableManifest(null);
      }
    };

    const onDownloadProgress = (progress: typeof downloadProgress) => {
      setDownloadProgress(progress);
    };

    const onUpdateAvailable = (manifest: UpdateManifest) => {
      setAvailableManifest(manifest);
    };

    const onFailed = (errType: UpdateError, errMsg: string) => {
      setError({ type: errType, message: errMsg });
    };

    service.on("StateChanged", onStateChanged);
    service.on("DownloadProgress", onDownloadProgress);
    service.on("UpdateAvailable", onUpdateAvailable);
    service.on("Failed", onFailed);

    return () => {
      service.off("StateChanged", onStateChanged);
      service.off("DownloadProgress", onDownloadProgress);
      service.off("UpdateAvailable", onUpdateAvailable);
      service.off("Failed", onFailed);
    };
  }, [service, refreshSettings]);

  const contextValue = useMemo(
    () => ({
      state,
      buildMetadata,
      downloadProgress,
      channel,
      autoCheck,
      checkSchedule,
      skippedVersion,
      lastCheckTime,
      availableManifest,
      error,
      checkForUpdates,
      downloadAndInstall,
      relaunch,
      cancel,
      setChannel,
      setAutoCheck,
      setCheckSchedule,
      setSkippedVersion,
      clearError,
      performRecovery,
    }),
    [
      state,
      buildMetadata,
      downloadProgress,
      channel,
      autoCheck,
      checkSchedule,
      skippedVersion,
      lastCheckTime,
      availableManifest,
      error,
      checkForUpdates,
      downloadAndInstall,
      relaunch,
      cancel,
      clearError,
      performRecovery,
    ]
  );

  return <UpdaterContext.Provider value={contextValue}>{children}</UpdaterContext.Provider>;
};
