// src/components/updater/UpdateCard.tsx
import React, { useState } from "react";
import { useUpdater } from "../../hooks/useUpdater";
import { DiagnosticsPanel } from "./DiagnosticsPanel";
import { RefreshCw, ToggleLeft, ToggleRight, Sliders, Cpu, Activity } from "lucide-react";
import { UpdateChannel } from "../../types/updater";

export const UpdateCard: React.FC = () => {
  const {
    buildMetadata,
    channel,
    autoCheck,
    checkSchedule,
    lastCheckTime,
    state,
    checkForUpdates,
    setChannel,
    setAutoCheck,
    setCheckSchedule,
  } = useUpdater();

  const [showDiagnostics, setShowDiagnostics] = useState(false);

  const handleManualCheck = async () => {
    try {
      await checkForUpdates(true); // force = true (override skip/rollout rules)
    } catch (e) {
      console.error(e);
    }
  };

  const handleToggleAutoCheck = () => {
    setAutoCheck(!autoCheck);
  };

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-slate-800 pb-4">
        <div>
          <h3 className="text-sm font-bold text-slate-200 uppercase tracking-wider text-indigo-400">
            Application Update Manager
          </h3>
          <p className="text-xs text-slate-400 mt-1">
            Configure software channels, automatic release schedules, and run manual check loops.
          </p>
        </div>
        <Sliders className="w-5 h-5 text-indigo-400" />
      </div>

      {/* Main Settings Grid */}
      <div className="grid grid-cols-2 gap-6">
        {/* Settings options column */}
        <div className="space-y-4">
          {/* Version / Checked display */}
          <div className="bg-slate-950 p-4 rounded-xl border border-slate-800 space-y-2 text-xs">
            <div className="flex justify-between">
              <span className="text-slate-400">Installed Version:</span>
              <span className="font-mono text-slate-200 font-bold">v{buildMetadata?.app_version || "0.1.0"}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-400">Last Checked:</span>
              <span className="text-slate-300">
                {lastCheckTime ? new Date(lastCheckTime).toLocaleDateString() + " " + new Date(lastCheckTime).toLocaleTimeString() : "Never checked"}
              </span>
            </div>
          </div>

          {/* Toggle Auto Check */}
          <div className="flex items-center justify-between bg-slate-950 p-3.5 rounded-xl border border-slate-800">
            <div className="text-xs">
              <span className="block font-semibold text-slate-200">Automatic Checks</span>
              <span className="text-[10px] text-slate-500">Query update servers in the background.</span>
            </div>
            <button
              onClick={handleToggleAutoCheck}
              className="text-slate-400 hover:text-indigo-400 transition-colors focus:outline-none"
            >
              {autoCheck ? (
                <ToggleRight className="w-9 h-9 text-indigo-500" />
              ) : (
                <ToggleLeft className="w-9 h-9 text-slate-700" />
              )}
            </button>
          </div>

          {/* Selector columns */}
          <div className="grid grid-cols-2 gap-4">
            {/* Update Channel selector */}
            <div className="bg-slate-950 p-3.5 rounded-xl border border-slate-800 space-y-1.5">
              <label className="block text-[10px] font-semibold text-slate-400 uppercase tracking-wider">
                Release Ring
              </label>
              <select
                value={channel}
                onChange={(e) => setChannel(e.target.value as UpdateChannel)}
                className="w-full bg-slate-900 border border-slate-850 rounded-lg p-2 text-xs font-semibold text-slate-200 focus:outline-none focus:border-indigo-500"
              >
                <option value="Production">Production</option>
                <option value="Preview">Preview</option>
                <option value="Internal">Internal</option>
              </select>
            </div>

            {/* Check Schedule selector */}
            <div className="bg-slate-950 p-3.5 rounded-xl border border-slate-800 space-y-1.5">
              <label className="block text-[10px] font-semibold text-slate-400 uppercase tracking-wider">
                Check Interval
              </label>
              <select
                value={checkSchedule}
                onChange={(e) => setCheckSchedule(e.target.value)}
                disabled={!autoCheck}
                className="w-full bg-slate-900 border border-slate-850 rounded-lg p-2 text-xs font-semibold text-slate-200 focus:outline-none focus:border-indigo-500 disabled:opacity-55"
              >
                <option value="startup">App Startup</option>
                <option value="daily">Daily</option>
                <option value="weekly">Weekly</option>
              </select>
            </div>
          </div>

          {/* Trigger check button */}
          <button
            onClick={handleManualCheck}
            disabled={state === "Checking" || state === "Downloading" || state === "Installing"}
            className="w-full bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white font-semibold text-xs py-2.5 rounded-lg transition-colors flex items-center justify-center gap-2"
          >
            {state === "Checking" ? (
              <>
                <RefreshCw className="w-3.5 h-3.5 animate-spin" /> Querying Release Servers...
              </>
            ) : (
              "Check Now for Updates"
            )}
          </button>
        </div>

        {/* Diagnostics & Logs column */}
        <div className="space-y-4 flex flex-col">
          <div className="flex-1 bg-slate-950/45 p-4 rounded-xl border border-slate-850 flex flex-col justify-between">
            <div className="space-y-2 text-xs">
              <span className="font-semibold text-slate-300 block flex items-center gap-1.5">
                <Cpu className="w-4 h-4 text-indigo-400" />
                Troubleshooting Support
              </span>
              <p className="text-[11px] text-slate-500 leading-relaxed">
                If the updater plugin experiences network issues or signature mismatches, toggle diagnostic tools to view detailed structured activity logs.
              </p>
            </div>
            
            <button
              onClick={() => setShowDiagnostics(!showDiagnostics)}
              className="mt-4 w-full bg-slate-800 hover:bg-slate-700 text-slate-200 font-semibold text-xs py-2 rounded-lg transition-colors border border-slate-750 flex items-center justify-center gap-1.5"
            >
              <Activity className="w-3.5 h-3.5" />
              {showDiagnostics ? "Hide Diagnostics details" : "Show Diagnostics details"}
            </button>
          </div>
        </div>
      </div>

      {/* Diagnostics panel container */}
      {showDiagnostics && (
        <div className="pt-6 border-t border-slate-800/80 animate-fade-in">
          <DiagnosticsPanel />
        </div>
      )}
    </div>
  );
};
