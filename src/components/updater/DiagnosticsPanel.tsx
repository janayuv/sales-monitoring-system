// src/components/updater/DiagnosticsPanel.tsx
import React, { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useUpdater } from "../../hooks/useUpdater";
import { UpdateLog, UpdateMetrics } from "../../types/updater";
import { DiagnosticsInfo } from "../../types/bindings/DiagnosticsInfo";
import { UpdateLogger } from "../../logging/updateLogger";
import { DEFAULT_UPDATER_CONFIG } from "../../config/updater";
import { RotateCcw } from "lucide-react";

export const DiagnosticsPanel: React.FC = () => {
  const { channel, lastCheckTime, state, performRecovery } = useUpdater();
  const [logs, setLogs] = useState<UpdateLog[]>([]);
  const [diagnostics, setDiagnostics] = useState<DiagnosticsInfo | null>(null);
  const [isRecovering, setIsRecovering] = useState(false);
  const [metrics, setMetrics] = useState<UpdateMetrics>({
    check_count: 0,
    download_success: 0,
    download_failure: 0,
    install_success: 0,
    install_failure: 0,
  });

  const loadLogs = async () => {
    const list = await UpdateLogger.getLogs(15);
    setLogs(list);
  };

  const loadDiagnostics = async () => {
    try {
      const info = await invoke<DiagnosticsInfo>("get_diagnostics_info");
      setDiagnostics(info);
    } catch (e) {
      console.warn("Failed to load system diagnostics from Rust:", e);
    }
  };

  const loadMetrics = () => {
    try {
      const stored = localStorage.getItem("updater_analytics_metrics");
      if (stored) {
        setMetrics(JSON.parse(stored));
      }
    } catch (e) {
      console.error("Failed to load metrics:", e);
    }
  };

  const handleClearLogs = async () => {
    if (confirm("Are you sure you want to clear all updater history logs?")) {
      await UpdateLogger.clearLogs();
      await loadLogs();
    }
  };

  const handleResetMetrics = () => {
    if (confirm("Are you sure you want to reset update analytics metrics?")) {
      const empty = {
        check_count: 0,
        download_success: 0,
        download_failure: 0,
        install_success: 0,
        install_failure: 0,
      };
      localStorage.setItem("updater_analytics_metrics", JSON.stringify(empty));
      setMetrics(empty);
    }
  };

  const handleTriggerRecovery = async () => {
    if (
      confirm(
        "Initiating Updater Recovery will:\n" +
        "1. Reset skipped version flags so they check again.\n" +
        "2. Clear download metrics caches.\n" +
        "3. Reset updater lifecycle state machine to Idle.\n\n" +
        "Proceed with recovery?"
      )
    ) {
      setIsRecovering(true);
      try {
        const res = await performRecovery();
        if (res.success) {
          alert("Updater system recovered successfully.");
        } else {
          alert(`Recovery failed: ${res.message}`);
        }
      } catch (e) {
        alert(`Error during recovery invocation: ${e}`);
      } finally {
        setIsRecovering(false);
        loadLogs();
        loadMetrics();
      }
    }
  };

  useEffect(() => {
    loadLogs();
    loadMetrics();
    loadDiagnostics();
    // Poll logs occasionally if state shifts
    const timer = setInterval(loadLogs, 5000);
    return () => clearInterval(timer);
  }, [state]);

  const endpointUrl = `https://github.com/janayuv/sales-monitoring-system/releases/latest/download/${
    channel === "Preview" ? "preview-latest.json" : channel === "Internal" ? "internal-latest.json" : "latest.json"
  }`;

  return (
    <div className="space-y-6">
      {/* Metrics & Info */}
      <div className="bg-slate-950 p-5 rounded-xl border border-slate-800 space-y-4">
        <div className="flex justify-between items-center">
          <h4 className="text-xs font-bold text-slate-200 uppercase tracking-wider text-indigo-400">
            Updater Diagnostics & System metrics
          </h4>
          <button
            onClick={handleTriggerRecovery}
            disabled={isRecovering}
            className="text-[10px] bg-rose-950/40 hover:bg-rose-900/60 disabled:opacity-50 text-rose-300 font-semibold px-3 py-1.5 rounded border border-rose-900/40 flex items-center gap-1.5 transition-colors"
          >
            <RotateCcw className="w-3 h-3" />
            {isRecovering ? "Recovering..." : "Repair Updater"}
          </button>
        </div>

        <div className="grid grid-cols-2 gap-x-6 gap-y-3 text-xs">
          <div className="flex justify-between border-b border-slate-900 pb-1.5">
            <span className="text-slate-400 font-semibold">Active Channel:</span>
            <span className="font-semibold text-indigo-300">{channel}</span>
          </div>
          <div className="flex justify-between border-b border-slate-900 pb-1.5">
            <span className="text-slate-400 font-semibold">Current State:</span>
            <span className="font-mono font-bold text-slate-300">{state}</span>
          </div>
          <div className="flex justify-between border-b border-slate-900 pb-1.5 col-span-2">
            <span className="text-slate-400 font-semibold">Manifest Endpoint:</span>
            <span className="font-mono text-[10px] text-slate-300 truncate max-w-sm" title={endpointUrl}>
              {endpointUrl}
            </span>
          </div>
          <div className="flex justify-between border-b border-slate-900 pb-1.5">
            <span className="text-slate-400 font-semibold">Last Checked:</span>
            <span className="text-slate-300">
              {lastCheckTime ? new Date(lastCheckTime).toLocaleTimeString() : "Never"}
            </span>
          </div>
          <div className="flex justify-between border-b border-slate-900 pb-1.5">
            <span className="text-slate-400 font-semibold">Schema Version:</span>
            <span className="font-mono text-slate-300">v{DEFAULT_UPDATER_CONFIG.manifestVersion}</span>
          </div>

          {/* System info fields */}
          <div className="flex justify-between border-b border-slate-900 pb-1.5">
            <span className="text-slate-400 font-semibold">Operating System:</span>
            <span className="text-slate-300 truncate max-w-[170px]" title={diagnostics?.os_version}>
              {diagnostics?.os_version || "Checking..."}
            </span>
          </div>
          <div className="flex justify-between border-b border-slate-900 pb-1.5">
            <span className="text-slate-400 font-semibold">Webview Engine:</span>
            <span className="text-slate-300 truncate max-w-[170px]" title={diagnostics?.webview_version}>
              {diagnostics?.webview_version || "Checking..."}
            </span>
          </div>
          <div className="flex justify-between border-b border-slate-900 pb-1.5">
            <span className="text-slate-400 font-semibold">Tauri Framework:</span>
            <span className="font-mono text-slate-300">v{diagnostics?.tauri_version || "..."}</span>
          </div>
          <div className="flex justify-between border-b border-slate-900 pb-1.5">
            <span className="text-slate-400 font-semibold">Rust Compiler:</span>
            <span className="text-[10px] text-slate-500 font-mono truncate max-w-[150px]" title={diagnostics?.rust_version}>
              {diagnostics?.rust_version || "..."}
            </span>
          </div>

          <div className="flex justify-between border-b border-slate-900 pb-1.5 col-span-2">
            <span className="text-slate-400 font-semibold">App Data Path:</span>
            <span className="font-mono text-[9px] text-slate-400 truncate max-w-md" title={diagnostics?.app_data_path}>
              {diagnostics?.app_data_path || "Checking..."}
            </span>
          </div>
          <div className="flex justify-between border-b border-slate-900 pb-1.5 col-span-2">
            <span className="text-slate-400 font-semibold">Log Directory:</span>
            <span className="font-mono text-[9px] text-slate-400 truncate max-w-md" title={diagnostics?.log_directory}>
              {diagnostics?.log_directory || "Checking..."}
            </span>
          </div>
        </div>

        {/* Analytics Counter metrics */}
        <div className="pt-2 border-t border-slate-800">
          <div className="flex justify-between items-center mb-3">
            <h5 className="text-[11px] font-bold text-slate-300 uppercase tracking-wide">Update Analytics</h5>
            <button
              onClick={handleResetMetrics}
              className="text-[10px] text-indigo-400 hover:text-indigo-300 hover:underline font-semibold"
            >
              Reset
            </button>
          </div>
          <div className="grid grid-cols-5 gap-2 text-center">
            <div className="bg-slate-900/60 p-2.5 rounded-lg border border-slate-800/80">
              <span className="block text-[10px] text-slate-500 font-semibold uppercase">Checks</span>
              <span className="font-mono text-sm font-bold text-slate-300">{metrics.check_count}</span>
            </div>
            <div className="bg-slate-900/60 p-2.5 rounded-lg border border-slate-800/80">
              <span className="block text-[10px] text-slate-500 font-semibold uppercase">Dl Success</span>
              <span className="font-mono text-sm font-bold text-emerald-400">{metrics.download_success}</span>
            </div>
            <div className="bg-slate-900/60 p-2.5 rounded-lg border border-slate-800/80">
              <span className="block text-[10px] text-slate-500 font-semibold uppercase">Dl Fail</span>
              <span className="font-mono text-sm font-bold text-rose-400">{metrics.download_failure}</span>
            </div>
            <div className="bg-slate-900/60 p-2.5 rounded-lg border border-slate-800/80">
              <span className="block text-[10px] text-slate-500 font-semibold uppercase">Inst Ok</span>
              <span className="font-mono text-sm font-bold text-indigo-400">{metrics.install_success}</span>
            </div>
            <div className="bg-slate-900/60 p-2.5 rounded-lg border border-slate-800/80">
              <span className="block text-[10px] text-slate-500 font-semibold uppercase">Inst Fail</span>
              <span className="font-mono text-sm font-bold text-rose-400">{metrics.install_failure}</span>
            </div>
          </div>
        </div>
      </div>

      {/* History Log view */}
      <div className="bg-slate-950 p-5 rounded-xl border border-slate-800 space-y-3">
        <div className="flex justify-between items-center">
          <h4 className="text-xs font-bold text-slate-200 uppercase tracking-wider text-indigo-400">
            Updater Log Viewer (Last 15 Actions)
          </h4>
          <button
            onClick={handleClearLogs}
            className="text-[10px] text-rose-400 hover:text-rose-300 hover:underline font-semibold"
          >
            Clear History
          </button>
        </div>

        <div className="bg-slate-950/60 border border-slate-900 rounded-xl p-3 max-h-[220px] overflow-y-auto custom-scrollbar font-mono text-[10px] space-y-1.5">
          {logs.length === 0 ? (
            <p className="text-slate-600 italic text-center py-6">No updater activities logged yet.</p>
          ) : (
            logs.map((log, idx) => (
              <div key={idx} className="border-b border-slate-900 pb-1.5 last:border-0 last:pb-0">
                <div className="flex justify-between text-slate-500">
                  <span>{new Date(log.timestamp).toLocaleString()}</span>
                  <span className={log.level === "ERROR" ? "text-rose-500" : log.level === "WARN" ? "text-amber-500" : "text-slate-400"}>
                    {log.level}
                  </span>
                </div>
                <div className="text-slate-300 mt-0.5">
                  <span className="text-indigo-400">{log.event}</span>
                  {log.version && <span className="text-slate-400 text-[9px] bg-slate-900 px-1 py-0.5 rounded ml-1.5">v{log.version}</span>}
                </div>
                {log.details && <div className="text-slate-500 italic mt-0.5 max-w-md truncate">{log.details}</div>}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
};
