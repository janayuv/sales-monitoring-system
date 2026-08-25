// src/components/updater/__tests__/UpdateDialog.test.tsx
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { UpdateDialog } from "../UpdateDialog";
import { UpdaterContext, UpdaterContextType } from "../../../context/UpdaterContext";
import { UpdateLogger } from "../../../logging/updateLogger";

describe("UpdateDialog", () => {
  const mockDownloadAndInstall = vi.fn().mockResolvedValue({ success: true });
  const mockSetSkippedVersion = vi.fn().mockResolvedValue(undefined);
  const mockCancel = vi.fn();
  const mockRelaunch = vi.fn().mockResolvedValue(undefined);

  const defaultContextValue: UpdaterContextType = {
    state: "UpdateAvailable",
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
      percentage: 45,
      downloadedBytes: 4500000,
      totalBytes: 10000000,
      speedBps: 500000,
      etaSeconds: 11,
    },
    channel: "Production",
    autoCheck: true,
    checkSchedule: "startup",
    skippedVersion: "",
    lastCheckTime: "2026-08-25T08:24:32.000Z",
    availableManifest: {
      manifestVersion: 1,
      version: "1.7.0",
      notes: "Feature improvements and bug fixes",
      pub_date: "2026-08-25",
      platforms: {},
    },
    error: null,
    checkForUpdates: vi.fn(),
    downloadAndInstall: mockDownloadAndInstall,
    relaunch: mockRelaunch,
    cancel: mockCancel,
    setChannel: vi.fn(),
    setAutoCheck: vi.fn(),
    setCheckSchedule: vi.fn(),
    setSkippedVersion: mockSetSkippedVersion,
    clearError: vi.fn(),
    performRecovery: vi.fn(),
  };

  const renderComponent = (contextOverrides: Partial<UpdaterContextType> = {}) => {
    const value = { ...defaultContextValue, ...contextOverrides };
    return render(
      <UpdaterContext.Provider value={value}>
        <UpdateDialog />
      </UpdaterContext.Provider>
    );
  };

  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    UpdateLogger.resetMetrics();
  });

  it("renders new version information and release notes when update is available", () => {
    renderComponent();

    expect(screen.getByText(/New Version Available/i)).toBeInTheDocument();
    expect(screen.getByText("v1.7.0")).toBeInTheDocument();
    expect(screen.getByText(/Feature improvements and bug fixes/i)).toBeInTheDocument();
  });

  it("calls downloadAndInstall directly on Update Now button click", async () => {
    renderComponent();

    const updateBtn = screen.getByRole("button", { name: /Update Now/i });
    fireEvent.click(updateBtn);

    expect(mockDownloadAndInstall).toHaveBeenCalled();
  });

  it("skips version when Skip This Version is clicked", async () => {
    renderComponent();

    const skipBtn = screen.getByRole("button", { name: /Skip This Version/i });
    fireEvent.click(skipBtn);

    await waitFor(() => {
      expect(mockSetSkippedVersion).toHaveBeenCalledWith("1.7.0");
      expect(mockCancel).toHaveBeenCalled();
    });
  });

  it("renders download progress bar when state is Downloading", () => {
    renderComponent({ state: "Downloading" });

    expect(screen.getByText("45%")).toBeInTheDocument();
  });

  it("renders restart button when state is RestartRequired", () => {
    renderComponent({ state: "RestartRequired" });

    const relaunchBtn = screen.getByRole("button", { name: /Relaunch App/i });
    fireEvent.click(relaunchBtn);

    expect(mockRelaunch).toHaveBeenCalled();
  });
});
