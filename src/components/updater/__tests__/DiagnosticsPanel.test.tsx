// src/components/updater/__tests__/DiagnosticsPanel.test.tsx
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { DiagnosticsPanel } from "../DiagnosticsPanel";
import { UpdateLogger } from "../../../logging/updateLogger";
import { UpdaterContext, UpdaterContextType } from "../../../context/UpdaterContext";
import { invoke } from "@tauri-apps/api/core";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

describe("DiagnosticsPanel", () => {
  const mockPerformRecovery = vi.fn().mockResolvedValue({ success: true });

  const defaultContextValue: UpdaterContextType = {
    state: "NoUpdate",
    buildMetadata: {
      app_version: "1.6.0",
      build_date: "2026-08-25",
      build_time: "10:00:00",
      git_hash: "abc1234",
      git_branch: "main",
      rust_version: "rustc 1.98.0",
      target: "x86_64-pc-windows-msvc",
      profile: "release",
      build_number: "42",
    },
    downloadProgress: {
      percentage: 0,
      downloadedBytes: 0,
      totalBytes: 0,
      speedBps: 0,
      etaSeconds: 0,
    },
    channel: "Production",
    autoCheck: true,
    checkSchedule: "startup",
    skippedVersion: "",
    lastCheckTime: "2026-08-25T08:24:32.000Z",
    availableManifest: null,
    error: null,
    checkForUpdates: vi.fn(),
    downloadAndInstall: vi.fn(),
    relaunch: vi.fn(),
    cancel: vi.fn(),
    setChannel: vi.fn(),
    setAutoCheck: vi.fn(),
    setCheckSchedule: vi.fn(),
    setSkippedVersion: vi.fn(),
    clearError: vi.fn(),
    performRecovery: mockPerformRecovery,
  };

  const renderComponent = (contextOverrides: Partial<UpdaterContextType> = {}) => {
    const value = { ...defaultContextValue, ...contextOverrides };
    return render(
      <UpdaterContext.Provider value={value}>
        <DiagnosticsPanel />
      </UpdaterContext.Provider>
    );
  };

  beforeEach(async () => {
    vi.clearAllMocks();
    localStorage.clear();
    await UpdateLogger.clearLogs();
    UpdateLogger.resetMetrics();

    vi.mocked(invoke).mockImplementation(async (cmd: string) => {
      if (cmd === "get_diagnostics_info") {
        return {
          os_version: "Microsoft Windows [Version 10.0.19045.5487]",
          webview_version: "133.0.3065.92",
          tauri_version: "2.11.5",
          rust_version: "rustc 1.98.0",
          app_data_path: "C:\\Users\\JANA\\AppData\\Roaming\\com.salesmonitor.app",
          log_directory: "C:\\Users\\JANA\\AppData\\Local\\com.salesmonitor.app\\logs",
        };
      }
      return undefined;
    });

    // Mock confirm and alert
    vi.stubGlobal("confirm", () => true);
    vi.stubGlobal("alert", vi.fn());
  });

  it("renders system diagnostics information correctly", async () => {
    renderComponent();

    expect(screen.getByText(/UPDATER DIAGNOSTICS & SYSTEM METRICS/i)).toBeInTheDocument();
    expect(screen.getByText("Production")).toBeInTheDocument();
    expect(screen.getByText("NoUpdate")).toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getByText(/Microsoft Windows/i)).toBeInTheDocument();
      expect(screen.getByText("133.0.3065.92")).toBeInTheDocument();
      expect(screen.getByText("v2.11.5")).toBeInTheDocument();
    });
  });

  it("displays update analytics metrics and responds to Reset button", async () => {
    UpdateLogger.incrementMetric("check_count");
    UpdateLogger.incrementMetric("check_count");
    UpdateLogger.incrementMetric("download_failure");

    renderComponent();

    expect(screen.getByText("2")).toBeInTheDocument(); // Checks
    expect(screen.getByText("1")).toBeInTheDocument(); // DL Fail

    const resetBtn = screen.getByRole("button", { name: /Reset/i });
    fireEvent.click(resetBtn);

    const metrics = UpdateLogger.getMetrics();
    expect(metrics.check_count).toBe(0);
    expect(metrics.download_failure).toBe(0);
  });

  it("displays updater activity logs and allows clearing history", async () => {
    await UpdateLogger.log("INFO", "Update Check Completed", undefined, "Up to date");

    renderComponent();

    await waitFor(() => {
      expect(screen.getByText("Update Check Completed")).toBeInTheDocument();
      expect(screen.getByText("Up to date")).toBeInTheDocument();
    });

    const clearBtn = screen.getByRole("button", { name: /Clear History/i });
    fireEvent.click(clearBtn);

    await waitFor(() => {
      expect(screen.getByText("No updater activities logged yet.")).toBeInTheDocument();
    });
  });

  it("triggers repair recovery on Repair Updater button click", async () => {
    renderComponent();

    const repairBtn = screen.getByRole("button", { name: /Repair Updater/i });
    fireEvent.click(repairBtn);

    await waitFor(() => {
      expect(mockPerformRecovery).toHaveBeenCalled();
    });
  });
});
