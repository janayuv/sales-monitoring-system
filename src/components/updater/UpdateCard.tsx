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
    <div className="ember-card p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-[var(--ember-border)] pb-4">
        <div>
          <h3 className="text-sm font-bold font-serif uppercase tracking-wider text-[var(--ember-primary)]">
            Application Update Manager
          </h3>
          <p className="text-xs text-[var(--ember-text-muted)] mt-1">
            Configure software channels, automatic release schedules, and run manual check loops.
          </p>
        </div>
        <Sliders className="w-5 h-5 text-[var(--ember-primary)]" />
      </div>

      {/* Main Settings Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Settings options column */}
        <div className="space-y-4">
          {/* Version / Checked display */}
          <div className="bg-[var(--ember-surface-raised)] p-4 rounded-xl border border-[var(--ember-border)] space-y-2 text-xs">
            <div className="flex justify-between">
              <span className="text-[var(--ember-text-secondary)]">Installed Version:</span>
              <span className="font-mono text-[var(--ember-text-primary)] font-bold">v{buildMetadata?.app_version || "0.1.0"}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-[var(--ember-text-secondary)]">Last Checked:</span>
              <span className="text-[var(--ember-text-primary)]">
                {lastCheckTime ? new Date(lastCheckTime).toLocaleDateString() + " " + new Date(lastCheckTime).toLocaleTimeString() : "Never checked"}
              </span>
            </div>
          </div>

          {/* Toggle Auto Check */}
          <div className="flex items-center justify-between bg-[var(--ember-surface-raised)] p-3.5 rounded-xl border border-[var(--ember-border)]">
            <div className="text-xs">
              <span className="block font-semibold text-[var(--ember-text-primary)]">Automatic Checks</span>
              <span className="text-[10px] text-[var(--ember-text-muted)]">Query update servers in the background.</span>
            </div>
            <button
              onClick={handleToggleAutoCheck}
              className="text-[var(--ember-text-muted)] hover:text-[var(--ember-primary)] transition-colors focus:outline-none cursor-pointer"
            >
              {autoCheck ? (
                <ToggleRight className="w-9 h-9 text-[var(--ember-primary)]" />
              ) : (
                <ToggleLeft className="w-9 h-9 text-[var(--ember-text-muted)]" />
              )}
            </button>
          </div>

          {/* Selector columns */}
          <div className="grid grid-cols-2 gap-4">
            {/* Update Channel selector */}
            <div className="bg-[var(--ember-surface-raised)] p-3.5 rounded-xl border border-[var(--ember-border)] space-y-1.5">
              <label className="block text-[10px] font-semibold text-[var(--ember-text-muted)] uppercase tracking-wider">
                Release Ring
              </label>
              <select
                value={channel}
                onChange={(e) => setChannel(e.target.value as UpdateChannel)}
                className="w-full ember-input p-2 text-xs font-semibold"
              >
                <option value="Production">Production</option>
                <option value="Preview">Preview</option>
                <option value="Internal">Internal</option>
              </select>
            </div>

            {/* Check Schedule selector */}
            <div className="bg-[var(--ember-surface-raised)] p-3.5 rounded-xl border border-[var(--ember-border)] space-y-1.5">
              <label className="block text-[10px] font-semibold text-[var(--ember-text-muted)] uppercase tracking-wider">
                Check Interval
              </label>
              <select
                value={checkSchedule}
                onChange={(e) => setCheckSchedule(e.target.value)}
                disabled={!autoCheck}
                className="w-full ember-input p-2 text-xs font-semibold disabled:opacity-55"
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
            className="w-full ember-btn-primary text-xs py-2.5 flex items-center justify-center gap-2 disabled:opacity-50"
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
          <div className="flex-1 bg-[var(--ember-surface-raised)] p-4 rounded-xl border border-[var(--ember-border)] flex flex-col justify-between">
            <div className="space-y-2 text-xs">
              <span className="font-semibold text-[var(--ember-text-primary)] block flex items-center gap-1.5">
                <Cpu className="w-4 h-4 text-[var(--ember-primary)]" />
                Troubleshooting Support
              </span>
              <p className="text-[11px] text-[var(--ember-text-muted)] leading-relaxed">
                If the updater plugin experiences network issues or signature mismatches, toggle diagnostic tools to view detailed structured activity logs.
              </p>
            </div>
            
            <button
              onClick={() => setShowDiagnostics(!showDiagnostics)}
              className="mt-4 w-full ember-btn-secondary text-xs py-2 flex items-center justify-center gap-1.5"
            >
              <Activity className="w-3.5 h-3.5" />
              {showDiagnostics ? "Hide Diagnostics details" : "Show Diagnostics details"}
            </button>
          </div>
        </div>
      </div>

      {/* Diagnostics panel container */}
      {showDiagnostics && (
        <div className="pt-6 border-t border-[var(--ember-border)]">
          <DiagnosticsPanel />
        </div>
      )}
    </div>
  );
};
