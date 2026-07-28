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
    <div className="space-y-3 bg-[var(--ember-surface-raised)] p-4 rounded-xl border border-[var(--ember-border)]">
      <div className="flex items-center justify-between text-xs font-semibold text-[var(--ember-text-primary)]">
        <span className="flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 rounded-full bg-[var(--ember-primary)] animate-pulse" />
          Downloading Update Package...
        </span>
        <span className="font-mono text-[var(--ember-primary)] font-bold">{percentage}%</span>
      </div>

      {/* Progress Track (Ember Studio: rounded-full 9999px) */}
      <div className="w-full bg-[var(--ember-surface)] rounded-full h-2.5 overflow-hidden border border-[var(--ember-border)]">
        <div
          className="bg-gradient-to-r from-amber-500 via-[var(--ember-primary)] to-orange-700 h-full rounded-full transition-all duration-300 ease-out"
          style={{ width: `${percentage}%` }}
        />
      </div>

      {/* Metrics Row */}
      <div className="flex justify-between items-center text-[10px] text-[var(--ember-text-secondary)] font-medium">
        <span>
          {formatBytes(downloadedBytes)} / {totalBytes > 0 ? formatBytes(totalBytes) : "unknown"}
        </span>
        <div className="flex items-center gap-3 font-mono">
          <span>{formatSpeed(speedBps)}</span>
          <span className="text-[var(--ember-text-muted)]">|</span>
          <span>{formatETA(etaSeconds)}</span>
        </div>
      </div>
    </div>
  );
};
