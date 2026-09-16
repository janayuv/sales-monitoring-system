import React, { useState, useRef } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { readTextFile } from "@tauri-apps/plugin-fs";
import {
  FileSpreadsheet,
  FileJson,
  UploadCloud,
  AlertTriangle,
  Sparkles,
  Database,
  RefreshCw,
  FolderOpen,
} from "lucide-react";
import { Gstr1AuditService } from "../../services/gstr1AuditService";
import { BooksInvoiceRecord, Gstr1InvoiceRecord } from "../../types/gstr1AuditTypes";

interface Props {
  onLoadGstr1Data: (data: Gstr1InvoiceRecord[], sourceName: string) => void;
  onLoadBooksData?: (data: BooksInvoiceRecord[], sourceName: string) => void;
  onLoadSampleDataset: () => void;
  isUsingLiveBooks: boolean;
  onToggleLiveBooks: (useLive: boolean) => void;
  liveBooksCount: number;
  gstr1LoadedCount: number;
  gstr1SourceName: string;
}

export const Gstr1ImportPanel: React.FC<Props> = ({
  onLoadGstr1Data,
  onLoadBooksData,
  onLoadSampleDataset,
  isUsingLiveBooks,
  onToggleLiveBooks,
  liveBooksCount,
  gstr1LoadedCount,
  gstr1SourceName,
}) => {
  const [isProcessing, setIsProcessing] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const gstr1InputRef = useRef<HTMLInputElement>(null);
  const booksInputRef = useRef<HTMLInputElement>(null);

  // Parse GSTR-1 File (JSON or CSV)
  const processGstr1Content = (content: string, filename: string) => {
    try {
      let records: Gstr1InvoiceRecord[] = [];
      const lower = filename.toLowerCase();

      if (lower.endsWith(".json") || content.trim().startsWith("{") || content.trim().startsWith("[")) {
        records = Gstr1AuditService.parseGstr1Json(content);
      } else {
        records = Gstr1AuditService.parseGstr1Csv(content);
      }

      if (records.length === 0) {
        throw new Error("No valid invoice records were found in the uploaded GSTR-1 file.");
      }

      onLoadGstr1Data(records, filename);
      setErrorMessage(null);
    } catch (err: any) {
      console.error(err);
      setErrorMessage(`Failed to parse GSTR-1 file: ${err.message || err}`);
    }
  };

  // Open native file dialog or browser fallback
  const handleSelectGstr1File = async () => {
    setIsProcessing(true);
    setErrorMessage(null);
    try {
      try {
        const selected = await open({
          filters: [
            { name: "GSTR-1 Portal Files", extensions: ["json", "csv", "txt"] },
            { name: "All Files", extensions: ["*"] },
          ],
          multiple: false,
        });

        if (selected) {
          const filePath = Array.isArray(selected) ? selected[0] : selected;
          if (filePath) {
            const content = await readTextFile(filePath);
            const filename = filePath.split(/[\\/]/).pop() || "GSTR-1_File";
            processGstr1Content(content, filename);
            return;
          }
        }
      } catch {
        // Fallback to web input
        if (gstr1InputRef.current) {
          gstr1InputRef.current.click();
        }
      }
    } catch (err: any) {
      setErrorMessage(`File selection failed: ${err.message || err}`);
    } finally {
      setIsProcessing(false);
    }
  };

  const handleGstr1InputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const content = event.target?.result as string;
      if (content) {
        processGstr1Content(content, file.name);
      }
    };
    reader.onerror = () => setErrorMessage("Error reading file");
    reader.readAsText(file);
  };

  const handleBooksInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !onLoadBooksData) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const content = event.target?.result as string;
      if (content) {
        try {
          const records = Gstr1AuditService.parseBooksCsv(content);
          if (records.length === 0) throw new Error("No invoice records found in outward register CSV.");
          onLoadBooksData(records, file.name);
          setErrorMessage(null);
        } catch (err: any) {
          setErrorMessage(`Failed to parse Books register: ${err.message || err}`);
        }
      }
    };
    reader.readAsText(file);
  };

  return (
    <div className="ember-card p-5 space-y-4 border border-[var(--ember-border)] bg-[var(--ember-surface)]">
      {/* Hidden Web file inputs for fallback */}
      <input
        type="file"
        ref={gstr1InputRef}
        onChange={handleGstr1InputChange}
        accept=".json,.csv,.txt"
        className="hidden"
      />
      <input
        type="file"
        ref={booksInputRef}
        onChange={handleBooksInputChange}
        accept=".csv,.txt"
        className="hidden"
      />

      {/* Header and Quick Test dataset banner */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 border-b border-[var(--ember-border)] pb-3">
        <div>
          <h3 className="text-sm font-bold font-serif uppercase tracking-wider text-[var(--ember-primary)] flex items-center gap-2">
            <FolderOpen className="w-4 h-4" />
            GSTR-1 Ingestion & Audit Data Sources
          </h3>
          <p className="text-xs text-[var(--ember-text-secondary)] mt-0.5">
            Configure Books outward register and load official GSTR-1 portal return file (JSON / CSV).
          </p>
        </div>

        {/* Demo Dataset Button */}
        <button
          onClick={onLoadSampleDataset}
          className="ember-btn-primary px-3.5 py-1.5 text-xs flex items-center gap-1.5 shadow-sm cursor-pointer whitespace-nowrap"
        >
          <Sparkles className="w-4 h-4 text-amber-300" />
          Load Sample Audit Dataset
        </button>
      </div>

      {/* Error Banner */}
      {errorMessage && (
        <div className="bg-rose-500/10 border border-rose-500/30 rounded-xl p-3 flex items-center gap-3 text-xs text-rose-700 dark:text-rose-300">
          <AlertTriangle className="w-4 h-4 flex-shrink-0" />
          <span>{errorMessage}</span>
        </div>
      )}

      {/* Two Source Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Source 1: Books (Sales Register) */}
        <div className="bg-[var(--ember-surface-raised)] border border-[var(--ember-border)] rounded-xl p-4 flex flex-col justify-between space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 font-bold text-xs text-blue-700 dark:text-blue-300">
              <Database className="w-4 h-4" />
              Source 1: Books Sales Register
            </div>
            <span className="text-[10px] px-2 py-0.5 rounded-full font-mono bg-blue-500/15 text-blue-700 dark:text-blue-300 font-semibold">
              {isUsingLiveBooks ? "System Database" : "External File"}
            </span>
          </div>

          <div className="text-xs text-[var(--ember-text-secondary)] space-y-1">
            {isUsingLiveBooks ? (
              <div>
                <p className="font-semibold text-[var(--ember-text-primary)]">
                  Active Outward Sales Register ({liveBooksCount} Invoices)
                </p>
                <p className="text-[11px] text-[var(--ember-text-muted)] mt-0.5">
                  Reconciling directly against verified sales invoices loaded in this database.
                </p>
              </div>
            ) : (
              <div>
                <p className="font-semibold text-[var(--ember-text-primary)]">Custom Outward CSV</p>
                <p className="text-[11px] text-[var(--ember-text-muted)] mt-0.5">
                  Uploaded external ERP outward register file.
                </p>
              </div>
            )}
          </div>

          <div className="pt-2 border-t border-[var(--ember-border-subtle)] flex items-center justify-between gap-2">
            <button
              onClick={() => onToggleLiveBooks(!isUsingLiveBooks)}
              className="text-[11px] font-semibold text-[var(--ember-primary)] hover:underline cursor-pointer"
            >
              {isUsingLiveBooks ? "Switch to External Books CSV" : "Switch to System Database Invoices"}
            </button>
            {!isUsingLiveBooks && (
              <button
                onClick={() => booksInputRef.current?.click()}
                className="ember-btn-secondary px-3 py-1 text-[11px] flex items-center gap-1 cursor-pointer"
              >
                <FileSpreadsheet className="w-3.5 h-3.5" />
                Upload CSV
              </button>
            )}
          </div>
        </div>

        {/* Source 2: GSTR-1 Portal Return */}
        <div className="bg-[var(--ember-surface-raised)] border border-[var(--ember-border)] rounded-xl p-4 flex flex-col justify-between space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 font-bold text-xs text-purple-700 dark:text-purple-300">
              <FileJson className="w-4 h-4" />
              Source 2: GSTR-1 Portal Return File
            </div>
            {gstr1LoadedCount > 0 && (
              <span className="text-[10px] px-2 py-0.5 rounded-full font-mono bg-purple-500/15 text-purple-700 dark:text-purple-300 font-semibold">
                {gstr1LoadedCount} Invoices Loaded
              </span>
            )}
          </div>

          <div className="text-xs text-[var(--ember-text-secondary)]">
            {gstr1LoadedCount > 0 ? (
              <div>
                <p className="font-semibold text-[var(--ember-text-primary)] truncate" title={gstr1SourceName}>
                  Active: {gstr1SourceName}
                </p>
                <p className="text-[11px] text-[var(--ember-text-muted)] mt-0.5">
                  Successfully parsed tables B2B, B2CL, CDNR & Auto-drafted e-Invoices.
                </p>
              </div>
            ) : (
              <p className="text-[11px] text-[var(--ember-text-muted)]">
                Upload official GSTR-1 return JSON (downloaded from GST Portal) or standard offline tool CSV.
              </p>
            )}
          </div>

          <div className="pt-2 border-t border-[var(--ember-border-subtle)] flex items-center justify-between gap-2">
            <div className="text-[11px] text-[var(--ember-text-muted)]">
              Supported: .json, .csv
            </div>
            <button
              onClick={handleSelectGstr1File}
              disabled={isProcessing}
              className="ember-btn-secondary px-3.5 py-1 text-[11px] flex items-center gap-1.5 cursor-pointer font-semibold"
            >
              {isProcessing ? (
                <>
                  <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                  Reading...
                </>
              ) : (
                <>
                  <UploadCloud className="w-3.5 h-3.5 text-purple-600 dark:text-purple-400" />
                  {gstr1LoadedCount > 0 ? "Change GSTR-1 File" : "Import GSTR-1 File"}
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
