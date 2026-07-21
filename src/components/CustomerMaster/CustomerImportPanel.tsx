import { useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
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
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center" onClick={onClose}>
      <div className="w-[520px] bg-slate-900 border border-slate-800 rounded-xl p-6 space-y-4" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-lg font-bold text-slate-100">Import Customer Master</h3>
        <button onClick={pick} className="bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold px-4 py-2 rounded-lg">Select Excel / CSV…</button>
        {filePath && <p className="text-[11px] text-slate-500 truncate">{filePath}</p>}
        {busy && <p className="text-xs text-indigo-400">Working…</p>}
        {preview && (
          <div className="bg-slate-950 border border-slate-800 rounded-lg p-4 text-xs text-slate-300 space-y-1">
            <div>Rows: <strong>{preview.row_count}</strong></div>
            <div>To insert: <strong className="text-emerald-400">{preview.to_insert}</strong></div>
            <div>To update: <strong className="text-indigo-400">{preview.to_update}</strong></div>
            <div>Errors: <strong className="text-rose-400">{preview.errors.length}</strong>, Warnings: <strong className="text-amber-400">{preview.warnings.length}</strong></div>
          </div>
        )}
        <div className="flex gap-3">
          <button onClick={commit} disabled={!preview || busy || preview.to_insert + preview.to_update === 0} className="bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold px-5 py-2 rounded-lg disabled:opacity-50">Confirm Import</button>
          <button onClick={onClose} className="bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold px-5 py-2 rounded-lg">Close</button>
        </div>
      </div>
    </div>
  );
}
