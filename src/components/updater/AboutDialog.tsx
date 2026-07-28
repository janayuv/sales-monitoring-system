// src/components/updater/AboutDialog.tsx
import React from "react";
import { useUpdater } from "../../hooks/useUpdater";
import { RefreshCw } from "lucide-react";

interface AboutDialogProps {
  isOpen: boolean;
  onClose: () => void;
}

export const AboutDialog: React.FC<AboutDialogProps> = ({ isOpen, onClose }) => {
  const { buildMetadata, state, checkForUpdates } = useUpdater();

  if (!isOpen) return null;

  const handleManualCheck = async () => {
    try {
      await checkForUpdates(true); // force = true (override skipped version & rollouts)
    } catch (e) {
      console.error(e);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="ember-card w-full max-w-md p-6 shadow-2xl space-y-6 relative overflow-hidden">
        {/* Decorative background pulse */}
        <div className="absolute top-0 right-0 w-32 h-32 bg-[var(--ember-primary-light)] rounded-full blur-3xl pointer-events-none" />

        {/* Heading */}
        <div className="text-center relative">
          <h3 className="text-lg font-bold font-serif text-[var(--ember-text-primary)]">Sales Monitoring System</h3>
          <p className="text-xs text-[var(--ember-text-muted)] mt-1">Enterprise Sales Audit & Analytics Desk</p>
        </div>

        {/* Compile Metadata */}
        <div className="bg-[var(--ember-surface-raised)] p-4 rounded-xl border border-[var(--ember-border)] space-y-2.5 font-mono text-[11px] text-[var(--ember-text-secondary)]">
          <div className="flex justify-between border-b border-[var(--ember-border-subtle)] pb-1.5 last:border-0 last:pb-0">
            <span>Version:</span>
            <span className="text-[var(--ember-text-primary)] font-bold">{buildMetadata?.app_version || "0.1.0"}</span>
          </div>
          <div className="flex justify-between border-b border-[var(--ember-border-subtle)] pb-1.5 last:border-0 last:pb-0">
            <span>Build Number:</span>
            <span className="text-[var(--ember-text-primary)]">{buildMetadata?.build_number || "0"}</span>
          </div>
          <div className="flex justify-between border-b border-[var(--ember-border-subtle)] pb-1.5 last:border-0 last:pb-0">
            <span>Git Branch:</span>
            <span className="text-[var(--ember-primary)]">{buildMetadata?.git_branch || "unknown"}</span>
          </div>
          <div className="flex justify-between border-b border-[var(--ember-border-subtle)] pb-1.5 last:border-0 last:pb-0">
            <span>Git Hash:</span>
            <span className="text-[var(--ember-text-secondary)]">{buildMetadata?.git_hash ? buildMetadata.git_hash.substring(0, 8) : "unknown"}</span>
          </div>
          <div className="flex justify-between border-b border-[var(--ember-border-subtle)] pb-1.5 last:border-0 last:pb-0">
            <span>Build Date:</span>
            <span className="text-[var(--ember-text-secondary)]">
              {buildMetadata?.build_date || "unknown"} {buildMetadata?.build_time || ""}
            </span>
          </div>
          <div className="flex justify-between border-b border-[var(--ember-border-subtle)] pb-1.5 last:border-0 last:pb-0">
            <span>Architecture:</span>
            <span className="text-[var(--ember-text-secondary)]">{buildMetadata?.target || "unknown"}</span>
          </div>
          <div className="flex justify-between border-b border-[var(--ember-border-subtle)] pb-1.5 last:border-0 last:pb-0">
            <span>Compiler:</span>
            <span className="text-[var(--ember-text-muted)] font-sans text-[10px]">{buildMetadata?.rust_version || "unknown"}</span>
          </div>
        </div>

        {/* Licensing */}
        <div className="text-[10px] text-[var(--ember-text-muted)] text-center leading-relaxed">
          <p>© 2026 Sales Monitoring System. All rights reserved.</p>
          <p className="mt-0.5">Licensed under Commercial Terms. Unauthorised duplication is strictly prohibited.</p>
        </div>

        {/* Buttons */}
        <div className="flex items-center gap-3">
          <button
            onClick={handleManualCheck}
            disabled={state === "Checking" || state === "Downloading"}
            className="flex-1 ember-btn-primary py-2.5 text-xs flex items-center justify-center gap-1.5 disabled:opacity-50"
          >
            {state === "Checking" ? (
              <>
                <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                Checking...
              </>
            ) : (
              "Check for Updates"
            )}
          </button>
          <button
            onClick={onClose}
            className="flex-1 ember-btn-secondary py-2.5 text-xs"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};
