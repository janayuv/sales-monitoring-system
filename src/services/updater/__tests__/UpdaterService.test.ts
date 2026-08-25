// src/services/updater/__tests__/UpdaterService.test.ts
import { describe, it, expect, beforeEach, vi } from "vitest";
import { UpdaterService } from "../UpdaterService";
import { IUpdateProvider } from "../IUpdateProvider";
import { UpdateLogger } from "../../../logging/updateLogger";
import { invoke } from "@tauri-apps/api/core";

let listenCallbacks: Record<string, any> = {};
let mockCustomUpdateInfo: any = null;
let mockInstallError: Error | null = null;
let mockCheckError: Error | null = null;

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn().mockImplementation(async (cmd: string, args: any) => {
    if (cmd === "get_app_setting") {
      if (args?.key === "updater_channel") return "Production";
      if (args?.key === "skipped_version") return "";
      return null;
    }
    if (cmd === "set_app_setting") {
      return undefined;
    }
    if (cmd === "check_for_updates_custom") {
      if (mockCheckError) throw mockCheckError;
      return mockCustomUpdateInfo;
    }
    if (cmd === "install_pending_update_custom") {
      if (mockInstallError) throw mockInstallError;
      if (listenCallbacks["custom-updater-finished"]) {
        listenCallbacks["custom-updater-finished"]();
      }
      return undefined;
    }
    if (cmd === "get_build_constants") {
      return {
        app_version: "1.6.0",
        build_date: "2026-08-25",
        buildtime: "10:00:00",
        git_hash: "abc1234",
        git_branch: "main",
        rust_version: "rustc 1.98.0",
        target: "x86_64-pc-windows-msvc",
        profile: "release",
        build_number: "42",
      };
    }
    return undefined;
  }),
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn().mockImplementation((event: string, cb: any) => {
    listenCallbacks[event] = cb;
    return Promise.resolve(() => {
      delete listenCallbacks[event];
    });
  }),
}));

vi.mock("@tauri-apps/plugin-process", () => ({
  relaunch: vi.fn(),
}));

describe("UpdaterService", () => {
  let mockProvider: IUpdateProvider;
  let service: UpdaterService;

  beforeEach(async () => {
    vi.clearAllMocks();
    listenCallbacks = {};
    mockCustomUpdateInfo = null;
    mockInstallError = null;
    mockCheckError = null;
    localStorage.clear();
    await UpdateLogger.clearLogs();
    UpdateLogger.resetMetrics();

    mockProvider = {
      fetchManifest: vi.fn(),
      fetchReleaseNotes: vi.fn().mockResolvedValue("Mock release notes"),
    };

   service = new UpdaterService(mockProvider);
  });

  describe("Initial State & Constants", () => {
    it("starts in Idle state", () => {
      expect(service.getState()).toBe("Idle");
    });

    it("retrieves build constants via invoke", async () => {
      const meta = await service.getBuildMetadata();
      expect(meta.app_version).toBe("1.6.0");
      expect(invoke).toHaveBeenCalledWith("get_build_constants");
    });
  });

  describe("checkForUpdates", () => {
    it("increments check_count metric and sets NoUpdate when up to date", async () => {
      mockCustomUpdateInfo = null;

      const result = await service.checkForUpdates();
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toBeNull();
      }
      expect(service.getState()).toBe("NoUpdate");
      expect(UpdateLogger.getMetrics().check_count).toBe(1);
    });

    it("increments check_count and sets UpdateAvailable when remote version is newer", async () => {
      mockCustomUpdateInfo = {
        version: "1.7.0",
        date: "2026-08-25",
        body: "New features",
      };

      const onUpdateAvailable = vi.fn();
      service.on("UpdateAvailable", onUpdateAvailable);

      const result = await service.checkForUpdates(true);
      expect(result.success).toBe(true);
      if (result.success && result.data) {
        expect(result.data.version).toBe("1.7.0");
      }
      expect(service.getState()).toBe("UpdateAvailable");
      expect(onUpdateAvailable).toHaveBeenCalled();
      expect(UpdateLogger.getMetrics().check_count).toBe(1);
    });

    it("handles check failure cleanly by updating failed state without polluting download or install failure metrics", async () => {
      mockCheckError = new Error("Network connection refused");

      const result = await service.checkForUpdates();
      expect(result.success).toBe(false);
      expect(service.getState()).toBe("Failed");

      const metrics = UpdateLogger.getMetrics();
      expect(metrics.check_count).toBe(1);
      expect(metrics.download_failure).toBe(0);
      expect(metrics.install_failure).toBe(0);
    });
  });

  describe("downloadAndInstall & Mutually Exclusive Failure Tracking", () => {
    it("fails when attempted from invalid state", async () => {
      const result = await service.downloadAndInstall();
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toBe("DownloadFailed");
      }
    });

    it("tracks successful download and installation into metrics", async () => {
      mockCustomUpdateInfo = { version: "1.7.0", body: "Release" };
      await service.checkForUpdates(true);

      const res = await service.downloadAndInstall();
      expect(res.success).toBe(true);
      expect(service.getState()).toBe("RestartRequired");
      const metrics = UpdateLogger.getMetrics();
      expect(metrics.download_success).toBe(1);
      expect(metrics.install_success).toBe(1);
      expect(metrics.download_failure).toBe(0);
      expect(metrics.install_failure).toBe(0);
    });

    it("records download_failure (and NOT install_failure) when download fails before finishing", async () => {
      mockCustomUpdateInfo = { version: "1.7.0", body: "Release" };
      await service.checkForUpdates(true);

      mockInstallError = new Error("HTTP 500 Network payload download error");

      const res = await service.downloadAndInstall();
      expect(res.success).toBe(false);
      if (!res.success) {
        expect(res.error).toBe("DownloadFailed");
      }
      expect(service.getState()).toBe("Failed");

      const metrics = UpdateLogger.getMetrics();
      expect(metrics.download_failure).toBe(1);
      expect(metrics.install_failure).toBe(0);
    });

    it("records install_failure (and NOT download_failure) when installation fails after download completed", async () => {
      mockCustomUpdateInfo = { version: "1.7.0", body: "Release" };
      await service.checkForUpdates(true);

      vi.mocked(invoke).mockImplementation(async (cmd: string) => {
        if (cmd === "get_app_setting") return "Production";
        if (cmd === "check_for_updates_custom") return { version: "1.7.0" };
        if (cmd === "install_pending_update_custom") {
          if (listenCallbacks["custom-updater-finished"]) {
            listenCallbacks["custom-updater-finished"]();
          }
          throw new Error("Signature verification failed or elevated installer execution error");
        }
        return undefined;
      });

      const res = await service.downloadAndInstall();
      expect(res.success).toBe(false);
      if (!res.success) {
        expect(res.error).toBe("InstallFailed");
      }
      expect(service.getState()).toBe("Failed");

      const metrics = UpdateLogger.getMetrics();
      expect(metrics.download_success).toBe(1);
      expect(metrics.download_failure).toBe(0);
      expect(metrics.install_failure).toBe(1);
    });
  });

  describe("Cancel & System Recovery", () => {
    it("transitions to Cancelled when cancel is called during eligible states", () => {
      const onCancelled = vi.fn();
      service.on("Cancelled", onCancelled);

      (service as any).state = "UpdateAvailable";
      service.cancel();

      expect(service.getState()).toBe("Cancelled");
      expect(onCancelled).toHaveBeenCalled();
    });

    it("performs complete system recovery resetting state and progress", async () => {
      (service as any).state = "Failed";

      const res = await service.performRecovery();
      expect(res.success).toBe(true);
      expect(service.getState()).toBe("Idle");
    });
  });
});
