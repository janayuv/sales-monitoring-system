import { useState } from "react";
import { open, save } from "@tauri-apps/plugin-dialog";
import { ApiService } from "../../services/api";
import { CustomerImportPreview } from "../../types/bindings/CustomerImportPreview";

interface Props {
  onClose: () => void;
  onImported: () => void;
}

export default function CustomerImportPanel({ onClose, onImported }: Props) {
  const [filePath, setFilePath] = useState("");
  const [preview, setPreview] = useState<CustomerImportPreview | null>(null);
  const [busy, setBusy] = useState(false);

  const pick = async () => {
    const sel = await open({ multiple: false, filters: [{ name: "Excel & CSV", extensions: ["xlsx", "xls", "csv"] }] });
    if (!sel) return;
    const p = (Array.isArray(sel) ? sel[0] : sel) as string;
    setFilePath(p);
    setPreview(null);
    setBusy(true);
    try {
      setPreview(await ApiService.previewCustomerMasterImport(p));
    } catch (err: any) {
      alert(`Preview failed: ${err.message || err}`);
    } finally {
      setBusy(false);
    }
  };

  const downloadTemplate = async () => {
    const path = await save({
      defaultPath: "customer_master_template.xlsx",
      filters: [{ name: "Excel Workbook", extensions: ["xlsx"] }],
    });
    if (!path) return;
    setBusy(true);
    try {
      await ApiService.exportCustomerMasterTemplate(path);
      alert(`Template saved to:\n${path}`);
    } catch (err: any) {
      alert(`Failed to save template: ${err.message || err}`);
    } finally {
      setBusy(false);
    }
  };

  const commit = async () => {
    setBusy(true);
    try {
      const res = await ApiService.commitCustomerMasterImport(filePath, "System User");
      alert(`Imported: ${res.inserted} new, ${res.updated} updated, ${res.skipped} skipped.`);
      onImported();
      onClose();
    } catch (err: any) {
      alert(`Import failed: ${err.message || err}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center" onClick={onClose}>
      <div className="w-[520px] ember-card p-6 space-y-4 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-[var(--ember-border)] pb-3">
          <h3 className="text-base font-bold font-serif text-[var(--ember-text-primary)]">Import Customer Master</h3>
          <button onClick={downloadTemplate} disabled={busy} className="text-[var(--ember-primary)] hover:underline text-xs font-medium disabled:opacity-50">
            ↓ Download template (.xlsx)
          </button>
        </div>
        <button onClick={pick} className="ember-btn-secondary px-4 py-2 text-xs w-full text-center">
          Select Excel / CSV File…
        </button>
        {filePath && <p className="text-[11px] text-[var(--ember-text-muted)] truncate font-mono">{filePath}</p>}
        {busy && <p className="text-xs text-[var(--ember-primary)] animate-pulse">Processing preview…</p>}
        {preview && (
          <div className="bg-[var(--ember-surface-raised)] border border-[var(--ember-border)] rounded-lg p-4 text-xs text-[var(--ember-text-secondary)] space-y-1.5">
            <div>Rows in file: <strong className="text-[var(--ember-text-primary)] font-mono">{preview.row_count}</strong></div>
            <div>To insert: <strong className="text-emerald-600 dark:text-emerald-400 font-mono">{preview.to_insert}</strong></div>
            <div>To update: <strong className="text-[var(--ember-primary)] font-mono">{preview.to_update}</strong></div>
            <div>Errors: <strong className="text-rose-600 dark:text-rose-400 font-mono">{preview.errors.length}</strong>, Warnings: <strong className="text-amber-600 dark:text-amber-400 font-mono">{preview.warnings.length}</strong></div>
          </div>
        )}
        <div className="flex gap-3 pt-2">
          <button onClick={commit} disabled={!preview || busy || preview.to_insert + preview.to_update === 0} className="ember-btn-primary px-5 py-2 text-xs disabled:opacity-50">
            Confirm Import
          </button>
          <button onClick={onClose} className="ember-btn-secondary px-5 py-2 text-xs">Close</button>
        </div>
      </div>
    </div>
  );
}
