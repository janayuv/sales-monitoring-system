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
    <div className="fixed inset-0 bg-slate-950/70 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-md p-6 shadow-2xl space-y-6 relative overflow-hidden">
        {/* Decorative background pulse */}
        <div className="absolute top-0 right-0 w-32 h-32 bg-indigo-500/10 rounded-full blur-3xl" />

        {/* Heading */}
        <div className="text-center relative">
          <h3 className="text-lg font-bold text-slate-100">Sales Monitoring System</h3>
          <p className="text-xs text-slate-400 mt-1">Enterprise Sales Audit & Analytics Desk</p>
        </div>

        {/* Compile Metadata */}
        <div className="bg-slate-950 p-4 rounded-xl border border-slate-800/80 space-y-2.5 font-mono text-[11px] text-slate-400">
          <div className="flex justify-between border-b border-slate-900 pb-1.5 last:border-0 last:pb-0">
            <span>Version:</span>
            <span className="text-slate-200 font-bold">{buildMetadata?.app_version || "0.1.0"}</span>
          </div>
          <div className="flex justify-between border-b border-slate-900 pb-1.5 last:border-0 last:pb-0">
            <span>Build Number:</span>
            <span className="text-slate-300">{buildMetadata?.build_number || "0"}</span>
          </div>
          <div className="flex justify-between border-b border-slate-900 pb-1.5 last:border-0 last:pb-0">
            <span>Git Branch:</span>
            <span className="text-indigo-400">{buildMetadata?.git_branch || "unknown"}</span>
          </div>
          <div className="flex justify-between border-b border-slate-900 pb-1.5 last:border-0 last:pb-0">
            <span>Git Hash:</span>
            <span className="text-slate-300">{buildMetadata?.git_hash ? buildMetadata.git_hash.substring(0, 8) : "unknown"}</span>
          </div>
          <div className="flex justify-between border-b border-slate-900 pb-1.5 last:border-0 last:pb-0">
            <span>Build Date:</span>
            <span className="text-slate-300">
              {buildMetadata?.build_date || "unknown"} {buildMetadata?.build_time || ""}
            </span>
          </div>
          <div className="flex justify-between border-b border-slate-900 pb-1.5 last:border-0 last:pb-0">
            <span>Architecture:</span>
            <span className="text-slate-300">{buildMetadata?.target || "unknown"}</span>
          </div>
          <div className="flex justify-between border-b border-slate-900 pb-1.5 last:border-0 last:pb-0">
            <span>Compiler:</span>
            <span className="text-slate-500 font-sans text-[10px]">{buildMetadata?.rust_version || "unknown"}</span>
          </div>
        </div>

        {/* Licensing */}
        <div className="text-[10px] text-slate-500 text-center leading-relaxed">
          <p>© 2026 Sales Monitoring System. All rights reserved.</p>
          <p className="mt-0.5">Licensed under Commercial Terms. Unauthorised duplication is strictly prohibited.</p>
        </div>

        {/* Buttons */}
        <div className="flex items-center gap-3">
          <button
            onClick={handleManualCheck}
            disabled={state === "Checking" || state === "Downloading"}
            className="flex-1 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white font-semibold text-xs py-2.5 rounded-lg transition-colors flex items-center justify-center gap-1.5 border border-indigo-500"
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
            className="flex-1 bg-slate-800 hover:bg-slate-700 text-slate-300 font-semibold text-xs py-2.5 rounded-lg transition-colors border border-slate-700"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};
