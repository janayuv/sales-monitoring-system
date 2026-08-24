import React, { useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import {
  FileUp,
  FileSpreadsheet,
  AlertTriangle,
  CheckCircle,
  RefreshCw,
  XCircle,
  Info,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import { ApiService } from "../../services/api";
import { ImportTemplateRow } from "../../types/bindings/ImportTemplateRow";
import { ImportPreview } from "../../types/bindings/ImportPreview";
import { ReSyncConfirmModal } from "./ReSyncConfirmModal";

export interface ImportWizardTabProps {
  templates: ImportTemplateRow[];
  onImportSuccess?: () => void;
}

export const ImportWizardTab: React.FC<ImportWizardTabProps> = ({
  templates,
  onImportSuccess,
}) => {
  const [selectedTemplateId, setSelectedTemplateId] = useState<number | null>(
    templates.length > 0 && templates[0].id != null ? Number(templates[0].id) : null
  );
  const [selectedFilePath, setSelectedFilePath] = useState<string>("");
  const [isPreviewing, setIsPreviewing] = useState<boolean>(false);
  const [previewData, setPreviewData] = useState<ImportPreview | null>(null);
  const [importStatus, setImportStatus] = useState<"idle" | "importing" | "success" | "error">("idle");
  const [statusMessage, setStatusMessage] = useState<string>("");
  const [showReSyncModal, setShowReSyncModal] = useState<boolean>(false);

  // Sync default template if list updates
  React.useEffect(() => {
    if (selectedTemplateId === null && templates.length > 0 && templates[0].id != null) {
      setSelectedTemplateId(Number(templates[0].id));
    }
  }, [templates, selectedTemplateId]);

  // Open native file picker using Tauri Dialog plugin
  const handleSelectFile = async () => {
    try {
      const selected = await open({
        filters: [{ name: "Excel & CSV Files", extensions: ["xlsx", "xls", "csv"] }],
        multiple: false,
      });
      if (selected) {
        const filePath = (Array.isArray(selected) ? selected[0] : selected) as string;
        if (filePath) {
          const cleanPath = filePath.trim().replace(/^"(.*)"$/, "$1");
          setSelectedFilePath(cleanPath);
          setPreviewData(null);
          setImportStatus("idle");
          setStatusMessage("");
        }
      }
    } catch (err: any) {
      console.error(err);
      alert(`File selection error: ${err.message || err}`);
    }
  };

  const handleFileDrop = (e: React.DragEvent) => {
    e.preventDefault();
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      const file = e.dataTransfer.files[0];
      const path = (file as any).path || file.name;
      if (path) {
        const cleanPath = path.trim().replace(/^"(.*)"$/, "$1");
        setSelectedFilePath(cleanPath);
        setPreviewData(null);
        setImportStatus("idle");
        setStatusMessage("");
      }
    }
  };

  const handleRunPreview = async () => {
    if (!selectedTemplateId || !selectedFilePath) return;
    setIsPreviewing(true);
    setImportStatus("idle");
    setStatusMessage("");
    try {
      const result = await ApiService.previewImportFile(
        selectedFilePath,
        selectedTemplateId,
        "System User"
      );
      setPreviewData(result);
    } catch (err: any) {
      setImportStatus("error");
      setStatusMessage(`Preview Error: ${err.message || err}`);
    } finally {
      setIsPreviewing(false);
    }
  };

  // Execute normal Append import
  const handleCommitAppend = async () => {
    if (!selectedTemplateId || !selectedFilePath) return;
    setImportStatus("importing");
    setStatusMessage("");
    try {
      const batchId = await ApiService.commitImportBatch(
        selectedFilePath,
        selectedTemplateId,
        "System User",
        "Standard batch outward sales upload",
        "Append"
      );
      setImportStatus("success");
      setStatusMessage(`Successfully imported new batch ID: ${batchId}`);
      setPreviewData(null);
      setSelectedFilePath("");
      if (onImportSuccess) {
        onImportSuccess();
      }
    } catch (err: any) {
      setImportStatus("error");
      setStatusMessage(err.message || err.toString());
    }
  };

  // Execute ReSync import after modal confirmation
  const handleConfirmReSync = async () => {
    if (!selectedTemplateId || !selectedFilePath) return;
    setImportStatus("importing");
    try {
      const batchId = await ApiService.commitImportBatch(
        selectedFilePath,
        selectedTemplateId,
        "System User",
        "Batch ReSync and transaction HSN synchronization",
        "ReSync"
      );
      setShowReSyncModal(false);
      setImportStatus("success");
      setStatusMessage(`Successfully re-synchronized Batch ID: ${batchId}. All matching invoices, items, and tax/HSN fields have been updated in-place.`);
      setPreviewData(null);
      setSelectedFilePath("");
      if (onImportSuccess) {
        onImportSuccess();
      }
    } catch (err: any) {
      setShowReSyncModal(false);
      setImportStatus("error");
      setStatusMessage(err.message || err.toString());
    }
  };

  const handleReset = () => {
    setSelectedFilePath("");
    setPreviewData(null);
    setImportStatus("idle");
    setStatusMessage("");
  };

  return (
    <div className="space-y-8 max-w-5xl">
      {/* Drag and Drop Zone */}
      <div
        onClick={handleSelectFile}
        onDragOver={(e) => e.preventDefault()}
        onDrop={handleFileDrop}
        className="border-2 border-dashed border-[var(--ember-border)] hover:border-[var(--ember-primary)] bg-[var(--ember-surface)] hover:bg-[var(--ember-surface-raised)] rounded-xl p-8 text-center cursor-pointer transition-all duration-200 group"
      >
        <div className="p-3 bg-[var(--ember-primary-light)] text-[var(--ember-primary)] rounded-full w-12 h-12 flex items-center justify-center mx-auto mb-3 group-hover:scale-110 transition-transform">
          <FileUp className="w-6 h-6" />
        </div>
        <h4 className="text-xs font-bold font-serif text-[var(--ember-text-primary)] uppercase tracking-wider">
          Click to Browse or Drag & Drop Sales Spreadsheet
        </h4>
        <p className="text-[11px] text-[var(--ember-text-muted)] mt-1">
          Supports ERP outward exports in .xlsx, .xls, or .csv formats
        </p>
        {selectedFilePath && (
          <div className="mt-3 inline-block bg-[var(--ember-surface-raised)] px-3 py-1.5 rounded-lg border border-[var(--ember-border)] text-xs font-mono text-[var(--ember-primary)]">
            Selected: {selectedFilePath}
          </div>
        )}
      </div>

      {/* Import Setup Card */}
      <div className="ember-card p-6">
        <h3 className="text-sm font-bold font-serif text-[var(--ember-primary)] mb-6 uppercase tracking-wider">
          Configure Import Job
        </h3>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
          <div>
            <label className="block text-xs font-semibold text-[var(--ember-text-secondary)] mb-2">
              Selected Mapping Template
            </label>
            <select
              value={selectedTemplateId || ""}
              onChange={(e) => setSelectedTemplateId(Number(e.target.value))}
              disabled={importStatus === "importing"}
              className="w-full ember-input p-2.5 text-xs font-semibold disabled:opacity-50"
            >
              {templates.map((t) => (
                <option key={t.id?.toString()} value={t.id?.toString()}>
                  {t.template_name} ({t.source_type})
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-xs font-semibold text-[var(--ember-text-secondary)] mb-2">
              Excel File Source Path
            </label>
            <div className="flex gap-2">
              <input
                type="text"
                placeholder="Browse or paste file path (e.g. C:\Reports\DailySales.xlsx)..."
                value={selectedFilePath}
                disabled={importStatus === "importing"}
                onChange={(e) => {
                  const rawPath = e.target.value;
                  const cleanPath = rawPath.trim().replace(/^"(.*)"$/, "$1");
                  setSelectedFilePath(cleanPath);
                  setPreviewData(null);
                  setImportStatus("idle");
                  setStatusMessage("");
                }}
                className="flex-1 ember-input p-2.5 text-xs font-mono disabled:opacity-50"
              />
              <button
                onClick={handleSelectFile}
                disabled={importStatus === "importing"}
                className="ember-btn-primary px-4 py-2.5 text-xs flex items-center gap-1.5 disabled:opacity-50"
              >
                <FileSpreadsheet className="w-4 h-4" /> Browse
              </button>
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[var(--ember-border)] pt-6">
          <div>
            {selectedFilePath && (
              <button
                onClick={handleReset}
                disabled={importStatus === "importing"}
                className="text-xs text-[var(--ember-text-muted)] hover:text-[var(--ember-text-secondary)] transition-colors disabled:opacity-50 cursor-pointer"
              >
                Clear Selection
              </button>
            )}
          </div>

          <div className="flex items-center gap-3">
            {selectedFilePath && (
              <button
                onClick={handleRunPreview}
                disabled={isPreviewing || importStatus === "importing"}
                className="ember-btn-secondary px-5 py-2.5 text-xs flex items-center gap-1.5 disabled:opacity-50 cursor-pointer"
              >
                {isPreviewing ? <RefreshCw className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
                Run Validation Preview
              </button>
            )}

            {/* Commit Action Buttons depending on is_duplicate */}
            {previewData && previewData.errors.length === 0 && (
              <>
                {previewData.is_duplicate ? (
                  <button
                    onClick={() => setShowReSyncModal(true)}
                    disabled={importStatus === "importing"}
                    className="px-5 py-2.5 rounded-lg text-xs font-bold bg-indigo-600 hover:bg-indigo-700 active:bg-indigo-800 text-white flex items-center gap-2 shadow-sm transition-all disabled:opacity-50 cursor-pointer"
                  >
                    {importStatus === "importing" ? (
                      <>
                        <RefreshCw className="w-4 h-4 animate-spin" />
                        <span>Re-synchronizing...</span>
                      </>
                    ) : (
                      <>
                        <RefreshCw className="w-4 h-4" />
                        <span>Re-sync & Update Batch</span>
                      </>
                    )}
                  </button>
                ) : (
                  <button
                    onClick={handleCommitAppend}
                    disabled={importStatus === "importing"}
                    className="ember-btn-primary px-5 py-2.5 text-xs flex items-center gap-1.5 disabled:opacity-50 cursor-pointer"
                  >
                    {importStatus === "importing" ? (
                      <>
                        <RefreshCw className="w-4 h-4 animate-spin" />
                        <span>Importing...</span>
                      </>
                    ) : (
                      <>
                        <CheckCircle className="w-4 h-4" />
                        <span>Commit Import Batch</span>
                      </>
                    )}
                  </button>
                )}
              </>
            )}
          </div>
        </div>
      </div>

      {/* Status alerts */}
      {importStatus === "success" && (
        <div className="bg-emerald-500/10 border border-emerald-500/30 rounded-xl p-5 flex items-start justify-between gap-4 text-emerald-800 dark:text-emerald-200">
          <div className="flex gap-4">
            <CheckCircle className="w-5 h-5 flex-shrink-0 mt-0.5 text-emerald-600 dark:text-emerald-400" />
            <div>
              <h4 className="font-bold text-sm text-[var(--ember-text-primary)]">Operation Completed Successfully</h4>
              <p className="text-xs text-[var(--ember-text-secondary)] mt-1">{statusMessage}</p>
            </div>
          </div>
          <button
            onClick={handleReset}
            className="px-3 py-1.5 rounded-lg bg-[var(--ember-surface)] border border-[var(--ember-border)] hover:bg-[var(--ember-surface-raised)] text-xs font-semibold text-[var(--ember-text-primary)] transition-colors shrink-0 cursor-pointer"
          >
            Import Another File
          </button>
        </div>
      )}

      {importStatus === "error" && (
        <div className="bg-rose-500/10 border border-rose-500/30 rounded-xl p-5 flex gap-4 text-rose-800 dark:text-rose-200">
          <XCircle className="w-5 h-5 flex-shrink-0 mt-0.5 text-rose-600 dark:text-rose-400" />
          <div className="flex-1 min-w-0">
            <h4 className="font-bold text-sm text-[var(--ember-text-primary)]">Import / ReSync Failed</h4>
            <p className="text-xs text-[var(--ember-text-secondary)] mt-1 break-words">{statusMessage}</p>
            <p className="text-[11px] text-[var(--ember-text-muted)] mt-2">
              All database changes have been rolled back safely. Your existing invoices and records remain unchanged.
            </p>
          </div>
        </div>
      )}

      {/* Informational ReSync Card when duplicate file detected */}
      {previewData && previewData.is_duplicate && (
        <div className="p-5 rounded-2xl bg-gradient-to-r from-indigo-500/10 via-blue-500/10 to-indigo-500/10 border border-indigo-500/25 space-y-4">
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-indigo-500/15 text-indigo-600 dark:text-indigo-400 rounded-xl border border-indigo-500/30">
                <RefreshCw className="w-5 h-5" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h4 className="text-sm font-bold font-serif text-[var(--ember-text-primary)]">
                    Previously Imported File Detected
                  </h4>
                  <span className="bg-indigo-500/20 text-indigo-700 dark:text-indigo-300 font-mono text-[11px] font-bold px-2.5 py-0.5 rounded-full border border-indigo-500/30">
                    Batch #{previewData.existing_batch_id ? previewData.existing_batch_id.toString() : "N/A"}
                  </span>
                </div>
                {previewData.existing_batch_imported_at && (
                  <p className="text-xs text-[var(--ember-text-muted)] mt-0.5">
                    Originally imported on: {previewData.existing_batch_imported_at}
                  </p>
                )}
              </div>
            </div>

            <div className="flex items-center gap-2">
              <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-lg bg-indigo-500/15 text-indigo-700 dark:text-indigo-300 text-xs font-semibold">
                <ShieldCheck className="w-4 h-4" /> Safe In-Place ReSync
              </span>
            </div>
          </div>

          <p className="text-xs text-[var(--ember-text-secondary)] leading-relaxed">
            This file matches a previously committed upload. Re-syncing will update quantities, rates, assessable values, and authoritative HSN/tax codes for matched invoices without duplicating rows or breaking existing credit/debit notes.
          </p>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-1">
            <div className="p-3 bg-[var(--ember-surface)] rounded-xl border border-[var(--ember-border)]">
              <span className="text-[11px] text-[var(--ember-text-muted)] font-medium">Matching Invoices</span>
              <p className="text-base font-bold font-mono text-indigo-600 dark:text-indigo-400 mt-0.5">
                {previewData.proposed_updates} to Update
              </p>
            </div>
            <div className="p-3 bg-[var(--ember-surface)] rounded-xl border border-[var(--ember-border)]">
              <span className="text-[11px] text-[var(--ember-text-muted)] font-medium">New Unmatched Invoices</span>
              <p className="text-base font-bold font-mono text-emerald-600 dark:text-emerald-400 mt-0.5">
                +{previewData.proposed_inserts} New
              </p>
            </div>
            <div className="p-3 bg-[var(--ember-surface)] rounded-xl border border-[var(--ember-border)]">
              <span className="text-[11px] text-[var(--ember-text-muted)] font-medium">Absent Invoices Protection</span>
              <p className="text-base font-bold text-slate-600 dark:text-slate-300 mt-0.5 flex items-center gap-1 text-xs">
                <ShieldCheck className="w-3.5 h-3.5 text-emerald-500" /> Never Deleted
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Preview Analysis Panel */}
      {previewData && (
        <div className="ember-card p-6 space-y-6">
          <div className="flex flex-wrap items-center justify-between gap-4 border-b border-[var(--ember-border)] pb-4">
            <div>
              <h4 className="text-sm font-bold font-serif text-[var(--ember-primary)]">
                Validation Results Summary
              </h4>
              <p className="text-[10px] text-[var(--ember-text-muted)] font-mono mt-0.5">
                SHA256 File Signature: {previewData.batch_hash}
              </p>
            </div>
            <div className="flex flex-wrap gap-4 text-xs font-semibold font-mono">
              <span className="text-[var(--ember-primary)]">{previewData.row_count - 1} rows parsed</span>
              <span className="text-emerald-700 dark:text-emerald-400">+{previewData.proposed_inserts} new</span>
              <span className="text-indigo-700 dark:text-indigo-400">*{previewData.proposed_updates} updates</span>
              <span className="text-rose-700 dark:text-rose-400">{previewData.errors.length} errors</span>
              <span className="text-amber-700 dark:text-amber-400">{previewData.warnings.length} warnings</span>
            </div>
          </div>

          {/* HSN and Tax Sync Informational Banner */}
          <div className="p-4 rounded-xl bg-[var(--ember-surface-raised)] border border-[var(--ember-border)] flex items-start gap-3 text-xs">
            <Sparkles className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />
            <div className="space-y-1">
              <p className="font-semibold text-[var(--ember-text-primary)]">
                Transaction HSN & Tax Rate Synchronization
              </p>
              <p className="text-[var(--ember-text-secondary)]">
                Authoritative transaction HSN codes and GST rates mapped in this spreadsheet will synchronize directly into invoice line items upon committing.
              </p>
            </div>
          </div>

          {/* Errors */}
          {previewData.errors.length > 0 && (
            <div className="space-y-2">
              <h5 className="text-xs font-semibold text-rose-600 dark:text-rose-400 flex items-center gap-1.5">
                <XCircle className="w-4 h-4" /> Validation Errors (Blocks Import)
              </h5>
              <div className="border border-[var(--ember-border)] rounded-lg overflow-hidden bg-[var(--ember-surface-raised)] text-xs">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="bg-[var(--ember-surface)] text-[var(--ember-text-secondary)] font-bold border-b border-[var(--ember-border)]">
                      <th className="p-3">Excel Row</th>
                      <th className="p-3">Invoice No</th>
                      <th className="p-3">Field Key</th>
                      <th className="p-3">Error Scenario</th>
                      <th className="p-3">Actual Value</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[var(--ember-border-subtle)]">
                    {previewData.errors.map((err, i) => (
                      <tr key={i} className="hover:bg-[var(--ember-surface)] text-rose-700 dark:text-rose-300">
                        <td className="p-3">
                          {err.row_no === 0 ? (
                            <span className="font-semibold text-rose-700 dark:text-rose-300 bg-rose-500/15 px-2 py-0.5 rounded text-[11px]">
                              Header Row 1
                            </span>
                          ) : (
                            <span>Row {err.row_no}</span>
                          )}
                        </td>
                        <td className="p-3 font-mono text-[var(--ember-text-muted)]">
                          {err.row_no === 0 ? "Header Column" : (err.invoice_no || "N/A")}
                        </td>
                        <td className="p-3 font-semibold text-[var(--ember-text-primary)] font-mono">{err.field_name}</td>
                        <td className="p-3">
                          {err.error_type === "ERR_IMPORT_001" ? (
                            <span className="font-semibold text-rose-600 dark:text-rose-400">Missing Column Header</span>
                          ) : err.error_type === "ERR_IMPORT_002" ? (
                            <span className="font-semibold text-rose-600 dark:text-rose-400">Duplicate File</span>
                          ) : (
                            err.error_type
                          )}
                        </td>
                        <td className="p-3 font-mono bg-rose-500/5">
                          {err.error_type === "ERR_IMPORT_002" ? (
                            <span className="text-rose-700 dark:text-rose-300 font-sans text-xs font-semibold">
                              This file has already been imported into your database. Switch to ReSync mode to update existing records.
                            </span>
                          ) : err.row_no === 0 ? (
                            <span className="text-amber-700 dark:text-amber-300 font-sans text-xs">
                              Column for '<strong className="text-[var(--ember-text-primary)]">{err.field_name}</strong>' was not found in Row 1 of your Excel file.
                            </span>
                          ) : (
                            err.actual_value
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Warnings */}
          {previewData.warnings.length > 0 && (
            <div className="space-y-2">
              <h5 className="text-xs font-semibold text-amber-600 dark:text-amber-400 flex items-center gap-1.5">
                <AlertTriangle className="w-4 h-4" /> Import Warnings (Auto-Resolves/Seed Registry Queue)
              </h5>
              <div className="border border-[var(--ember-border)] rounded-lg overflow-hidden bg-[var(--ember-surface-raised)] text-xs">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="bg-[var(--ember-surface)] text-[var(--ember-text-secondary)] font-bold border-b border-[var(--ember-border)]">
                      <th className="p-3">Excel Row</th>
                      <th className="p-3">Invoice No</th>
                      <th className="p-3">Warning Scenario</th>
                      <th className="p-3">Value / Context</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[var(--ember-border-subtle)]">
                    {previewData.warnings.map((warn, i) => (
                      <tr key={i} className="hover:bg-[var(--ember-surface)] text-[var(--ember-text-primary)]">
                        <td className="p-3 font-mono">
                          {warn.row_no === 0 ? "Global" : `Row ${warn.row_no}`}
                        </td>
                        <td className="p-3 font-mono text-[var(--ember-text-muted)]">
                          {warn.invoice_no || "N/A"}
                        </td>
                        <td className="p-3">
                          {warn.warning_type === "WARN_DUPLICATE_BATCH" ? (
                            <span className="text-indigo-600 dark:text-indigo-400 font-semibold flex items-center gap-1">
                              <Info className="w-3.5 h-3.5" /> Existing Batch Detected (ReSync Available)
                            </span>
                          ) : (
                            <span className="text-amber-600 dark:text-amber-400 font-medium">
                              {warn.warning_type}
                            </span>
                          )}
                        </td>
                        <td className="p-3 text-[var(--ember-text-secondary)] font-sans">
                          {warn.warning_type === "WARN_DUPLICATE_BATCH" ? (
                            <span>
                              This file was previously imported. ReSync mode is available to safely update matching records in-place without data duplication.
                            </span>
                          ) : warn.warning_type === "ERR_VALIDATION_004" ? (
                            <span>
                              Unrecognized {warn.field_name}: <strong className="text-[var(--ember-primary)] font-mono">{warn.actual_value}</strong>. Auto-creates registry entry in review queue.
                            </span>
                          ) : (
                            <span>
                              {warn.field_name ? `${warn.field_name}: ` : ""}
                              {warn.actual_value} (Expected: {warn.expected_value})
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Confirmation Modal for ReSync */}
      <ReSyncConfirmModal
        isOpen={showReSyncModal}
        previewData={previewData}
        isImporting={importStatus === "importing"}
        onConfirm={handleConfirmReSync}
        onClose={() => {
          if (importStatus !== "importing") {
            setShowReSyncModal(false);
          }
        }}
      />
    </div>
  );
};
