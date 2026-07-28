// src/components/updater/ProgressBar.tsx
import React from "react";

interface ProgressBarProps {
  percentage: number;
  downloadedBytes: number;
  totalBytes: number;
  speedBps: number;
  etaSeconds: number;
}

export const ProgressBar: React.FC<ProgressBarProps> = ({
  percentage,
  downloadedBytes,
  totalBytes,
  speedBps,
  etaSeconds,
}) => {
  const formatBytes = (bytes: number): string => {
    if (bytes === 0) return "0 Bytes";
    const k = 1024;
    const sizes = ["Bytes", "KB", "MB", "GB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + " " + sizes[i];
  };

  const formatSpeed = (bytesPerSec: number): string => {
    if (bytesPerSec === 0) return "0 KB/s";
    return `${formatBytes(bytesPerSec)}/s`;
  };

  const formatETA = (seconds: number): string => {
    if (seconds <= 0) return "calculating...";
    if (seconds < 60) return `${seconds}s remaining`;
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}m ${secs}s remaining`;
  };

  return (
    <div className="space-y-3 bg-slate-950 p-4 rounded-xl border border-slate-800">
      <div className="flex items-center justify-between text-xs font-semibold text-slate-300">
        <span className="flex items-center gap-1.5">
          <span className="w-2 h-2 rounded-full bg-indigo-500 animate-pulse" />
          Downloading Update Package...
        </span>
        <span className="font-mono text-indigo-400">{percentage}%</span>
      </div>

      {/* Progress Track */}
      <div className="w-full bg-slate-900 rounded-full h-2.5 overflow-hidden border border-slate-800">
        <div
          className="bg-gradient-to-r from-indigo-500 via-purple-500 to-pink-500 h-full rounded-full transition-all duration-300 ease-out"
          style={{ width: `${percentage}%` }}
        />
      </div>

      {/* Metrics Row */}
      <div className="flex justify-between items-center text-[10px] text-slate-400 font-medium">
        <span>
          {formatBytes(downloadedBytes)} / {totalBytes > 0 ? formatBytes(totalBytes) : "unknown"}
        </span>
        <div className="flex items-center gap-3">
          <span className="font-mono">{formatSpeed(speedBps)}</span>
          <span className="text-slate-500">|</span>
          <span>{formatETA(etaSeconds)}</span>
        </div>
      </div>
    </div>
  );
};
