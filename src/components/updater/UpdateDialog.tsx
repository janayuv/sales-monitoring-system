// src/components/updater/UpdateDialog.tsx
import React, { useMemo } from "react";
import { useUpdater } from "../../hooks/useUpdater";
import { ProgressBar } from "./ProgressBar";
import { ReleaseNotes } from "./ReleaseNotes";
import { UpdateErrorCatalog } from "../../types/updater";
import { ArrowUpCircle, Info, RefreshCw, ShieldAlert } from "lucide-react";

export const UpdateDialog: React.FC = () => {
  const {
    state,
    availableManifest,
    downloadProgress,
    error,
    buildMetadata,
    downloadAndInstall,
    relaunch,
    cancel,
    setSkippedVersion,
    clearError,
    checkForUpdates,
  } = useUpdater();

  const isOpen = useMemo(() => {
    return (
      state === "UpdateAvailable" ||
      state === "Downloading" ||
      state === "Downloaded" ||
      state === "Installing" ||
      state === "Installed" ||
      state === "RestartRequired" ||
      (state === "Failed" && error !== null)
    );
  }, [state, error]);

  if (!isOpen || !availableManifest) return null;

  const handleUpdate = async () => {
    // Record analytics metrics
    try {
      const stored = localStorage.getItem("updater_analytics_metrics");
      const metrics = stored
        ? JSON.parse(stored)
        : { check_count: 0, download_success: 0, download_failure: 0, install_success: 0, install_failure: 0 };
      metrics.check_count++;
      localStorage.setItem("updater_analytics_metrics", JSON.stringify(metrics));
    } catch {}

    const result = await downloadAndInstall();
    
    // Record success/fail metrics
    try {
      const stored = localStorage.getItem("updater_analytics_metrics");
      if (stored) {
        const metrics = JSON.parse(stored);
        if (result.success) {
          metrics.download_success++;
          metrics.install_success++;
        } else {
          metrics.download_failure++;
          metrics.install_failure++;
        }
        localStorage.setItem("updater_analytics_metrics", JSON.stringify(metrics));
      }
    } catch {}
  };

  const handleSkip = async () => {
    await setSkippedVersion(availableManifest.version);
    cancel(); // resets state to Idle
  };

  const handleClose = () => {
    clearError();
    cancel(); // resets state to Idle
  };

  const errorMessage = error ? UpdateErrorCatalog[error.type] || error.message : "";

  return (
    <div className="fixed inset-0 bg-slate-950/75 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-lg p-6 shadow-2xl space-y-5 relative overflow-hidden flex flex-col max-h-[90vh]">
        
        {/* Title Block */}
        <div className="flex items-start gap-4 border-b border-slate-800 pb-4">
          <div className="p-3 bg-indigo-500/10 text-indigo-400 rounded-xl">
            <ArrowUpCircle className="w-6 h-6" />
          </div>
          <div>
            <span className="text-[10px] text-slate-500 font-bold uppercase tracking-wider">Software Update</span>
            <h3 className="text-base font-bold text-slate-100 mt-0.5">
              New Version Available
            </h3>
          </div>
        </div>

        {/* Version info badge */}
        <div className="flex items-center gap-3 text-xs bg-slate-950 p-3.5 rounded-xl border border-slate-800/80">
          <Info className="w-4 h-4 text-indigo-400 flex-shrink-0" />
          <div className="text-slate-300">
            Version <span className="font-bold text-indigo-400">v{availableManifest.version}</span> is ready to download (current version: v{buildMetadata?.app_version}).
            {availableManifest.pub_date && (
              <span className="block text-[10px] text-slate-500 mt-0.5">
                Released on {new Date(availableManifest.pub_date).toLocaleDateString()}
              </span>
            )}
          </div>
        </div>

        {/* Body content based on state */}
        <div className="flex-1 overflow-y-auto space-y-4 pr-1.5 custom-scrollbar min-h-[100px]">
          {state === "UpdateAvailable" && (
            <div className="space-y-2">
              <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Release Notes:</span>
              <ReleaseNotes notes={availableManifest.notes || ""} />
            </div>
          )}

          {state === "Downloading" && (
            <div className="py-4">
              <ProgressBar
                percentage={downloadProgress.percentage}
                downloadedBytes={downloadProgress.downloadedBytes}
                totalBytes={downloadProgress.totalBytes}
                speedBps={downloadProgress.speedBps}
                etaSeconds={downloadProgress.etaSeconds}
              />
            </div>
          )}

          {(state === "Downloaded" || state === "Installing" || state === "Installed") && (
            <div className="flex flex-col items-center justify-center py-6 text-center text-slate-400">
              <RefreshCw className="w-8 h-8 animate-spin text-indigo-400 mb-3" />
              <span className="text-sm font-semibold">Installing update packages...</span>
              <span className="text-[11px] text-slate-500 mt-1">Applying cryptographic verification signatures.</span>
            </div>
          )}

          {state === "RestartRequired" && (
            <div className="bg-emerald-950/20 border border-emerald-900/60 rounded-xl p-5 text-center space-y-2 text-emerald-200">
              <h4 className="font-bold text-slate-200 text-sm">Update Successfully Installed</h4>
              <p className="text-xs text-slate-400">
                Please relaunch the application to load the new features and improvements.
              </p>
            </div>
          )}

          {state === "Failed" && error && (
            <div className="bg-rose-950/25 border border-rose-900/60 rounded-xl p-4 flex gap-3 text-rose-200 text-xs">
              <ShieldAlert className="w-5 h-5 flex-shrink-0 text-rose-400 mt-0.5" />
              <div>
                <h4 className="font-bold text-slate-200">Update Operation Failed</h4>
                <p className="text-slate-400 mt-1 leading-relaxed">{errorMessage}</p>
                
                {/* Dynamic Recovery Mode links */}
                <div className="mt-4 flex items-center gap-4 text-[10px] font-semibold text-indigo-400">
                  <a
                    href="https://github.com/janayuv/sales-monitoring-system/releases"
                    target="_blank"
                    rel="noreferrer"
                    className="hover:underline flex items-center gap-1"
                  >
                    Download Manual Installer
                  </a>
                  <span className="text-slate-700">|</span>
                  <button
                    onClick={() => {
                      clearError();
                      checkForUpdates(true);
                    }}
                    className="hover:underline flex items-center gap-1"
                  >
                    Retry Installation
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Footer actions based on state */}
        <div className="border-t border-slate-800 pt-4 flex justify-end gap-3 text-xs font-semibold">
          {state === "UpdateAvailable" && (
            <>
              <button
                onClick={handleSkip}
                className="bg-slate-950 hover:bg-slate-900 text-slate-400 hover:text-slate-300 px-4 py-2.5 rounded-lg border border-slate-850 transition-colors"
              >
                Skip This Version
              </button>
              <button
                onClick={handleClose}
                className="bg-slate-800 hover:bg-slate-700 text-slate-300 px-4 py-2.5 rounded-lg border border-slate-700 transition-colors"
              >
                Later
              </button>
              <button
                onClick={handleUpdate}
                className="bg-indigo-600 hover:bg-indigo-500 text-white px-5 py-2.5 rounded-lg border border-indigo-500 transition-colors"
              >
                Update Now
              </button>
            </>
          )}

          {state === "Downloading" && (
            <button
              onClick={cancel}
              className="bg-slate-800 hover:bg-slate-750 text-slate-300 px-4 py-2.5 rounded-lg border border-slate-700 transition-colors"
            >
              Cancel
            </button>
          )}

          {state === "RestartRequired" && (
            <button
              onClick={relaunch}
              className="bg-indigo-600 hover:bg-indigo-500 text-white px-6 py-2.5 rounded-lg border border-indigo-500 transition-colors flex items-center gap-2"
            >
              Relaunch App
            </button>
          )}

          {state === "Failed" && (
            <button
              onClick={handleClose}
              className="bg-slate-800 hover:bg-slate-700 text-slate-300 px-4 py-2.5 rounded-lg border border-slate-700 transition-colors"
            >
              Close
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
