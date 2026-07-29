import React, { useState, useEffect } from "react";
import { open, save } from "@tauri-apps/plugin-dialog";
import { ApiService } from "../../services/api";
import { DebitNotePrintView } from "./DebitNotePrintView";
import {
  FileText,
  PlusCircle,
  History,
  TrendingUp,
  Settings,
  CheckCircle2,
  AlertTriangle,
  Calendar,
  DollarSign,
  User,
  Check,
  X,
  ShieldCheck,
  ChevronRight,
  ChevronLeft,
  RefreshCw,
  Trash2,
  Upload,
  Download,
  Printer,
} from "lucide-react";

interface CustomerDebitNotesTabProps {
  onNotify?: (message: string, type: "success" | "error" | "info") => void;
}

export const CustomerDebitNotesTab: React.FC<CustomerDebitNotesTabProps> = ({ onNotify }) => {
  const [activeTab, setActiveTab] = useState<"WIZARD" | "HISTORY" | "MASTER" | "REPORTS">("WIZARD");
  const [printViewData, setPrintViewData] = useState<{ header: any; items: any[] } | null>(null);

  
  // Master data state
  const [customers, setCustomers] = useState<any[]>([]);

  // Wizard state (8 Steps)
  const [step, setStep] = useState<number>(1);
  const [selectedCustomerId, setSelectedCustomerId] = useState<number | "">("");
  const [currency, setCurrency] = useState<string>("INR");
  const [exchangeRate, setExchangeRate] = useState<number>(1.0);
  
  // Step 2: Price Revision Items
  const [revisionNo, setRevisionNo] = useState<string>(`REV-${new Date().getFullYear()}-${Math.floor(100 + Math.random() * 900)}`);
  const [effectiveFrom, setEffectiveFrom] = useState<string>(new Date().toISOString().substring(0, 10));
  const [custRef, setCustRef] = useState<string>("");
  const [custPo, setCustPo] = useState<string>("");
  const [remarks, setRemarks] = useState<string>("");
  
  const [revisionItems, setRevisionItems] = useState<
    Array<{ part_number: string; old_price: number; new_price: number; remarks?: string }>
  >([
    { part_number: "", old_price: 0, new_price: 0 },
  ]);

  // Step 4 & 5: Period & Invoices Matching
  const [periodFrom, setPeriodFrom] = useState<string>("2026-04-01");
  const [periodTo, setPeriodTo] = useState<string>(new Date().toISOString().substring(0, 10));
  const [excludedItemIds] = useState<number[]>([]);

  // Step 6 & 7: Simulation Result
  const [simulation, setSimulation] = useState<any | null>(null);
  const [simulating, setSimulating] = useState(false);
  const [generating, setGenerating] = useState(false);

  // History state
  const [debitNotes, setDebitNotes] = useState<any[]>([]);
  const [selectedDN, setSelectedDN] = useState<any | null>(null);
  const [dnDetails, setDnDetails] = useState<[any, any[], any[], any[]] | null>(null);

  // Price Master State
  const [priceMasters, setPriceMasters] = useState<any[]>([]);
  const [newMasterPart, setNewMasterPart] = useState("");
  const [newMasterPrice, setNewMasterPrice] = useState<number>(0);
  const [newMasterDate, setNewMasterDate] = useState(new Date().toISOString().substring(0, 10));

  // Reports state
  const [reportType, setReportType] = useState<string>("CUSTOMER_WISE");
  const [reportData, setReportData] = useState<any>(null);

  useEffect(() => {
    loadCustomers();
    loadDebitNotes();
  }, []);

  const loadCustomers = async () => {
    try {
      const data = await ApiService.getCustomerMaster();
      setCustomers(data || []);
    } catch (err: any) {
      console.error(err);
    }
  };

  const loadDebitNotes = async () => {
    try {
      const list = await ApiService.listCustomerDebitNotes();
      setDebitNotes(list || []);
    } catch (err: any) {
      console.error(err);
    }
  };

  const loadPriceMasters = async () => {
    try {
      const list = await ApiService.getCustomerPriceMaster(selectedCustomerId ? Number(selectedCustomerId) : undefined);
      setPriceMasters(list || []);
    } catch (err: any) {
      console.error(err);
    }
  };

  const downloadTemplate = async () => {
    try {
      const path = await save({
        defaultPath: "customer_price_revision_template.xlsx",
        filters: [{ name: "Excel Workbook", extensions: ["xlsx"] }],
      });
      if (!path) return;
      await ApiService.exportCustomerRevisionTemplate(path);
      onNotify?.(`Template saved to:\n${path}`, "success");
    } catch (err: any) {
      onNotify?.(`Failed to save template: ${err.message || err}`, "error");
    }
  };

  const importExcel = async () => {
    try {
      const sel = await open({
        multiple: false,
        filters: [{ name: "Excel Worksheets", extensions: ["xlsx", "xls"] }],
      });
      if (!sel) return;
      const p = (Array.isArray(sel) ? sel[0] : sel) as string;
      const res = await ApiService.parseCustomerRevisionExcel(p);
      if (res.validation_errors && res.validation_errors.length > 0) {
        const errorMsg = res.validation_errors.slice(0, 5).join("\n");
        const remaining = res.validation_errors.length - 5;
        alert(
          `Excel validation issues detected:\n\n${errorMsg}${
            remaining > 0 ? `\n...and ${remaining} more issues` : ""
          }`
        );
      }
      if (res.items && res.items.length > 0) {
        setRevisionItems(
          res.items.map((i: any) => ({
            part_number: i.part_number,
            old_price: i.old_price,
            new_price: i.new_price,
            remarks: i.remarks || "",
          }))
        );
        onNotify?.(`Successfully imported ${res.valid_count} price revision items!`, "success");
      } else {
        onNotify?.("No valid price revision items found in the Excel file.", "error");
      }
    } catch (err: any) {
      onNotify?.(`Import failed: ${err.message || err}`, "error");
    }
  };

  const handleSimulate = async () => {
    if (!selectedCustomerId) {
      onNotify?.("Please select a customer first", "error");
      return;
    }
    const validItems = revisionItems.filter((i) => i.part_number.trim() !== "" && i.new_price > 0);
    if (validItems.length === 0) {
      onNotify?.("Please enter at least one valid part number and new price", "error");
      return;
    }

    setSimulating(true);
    try {
      const res = await ApiService.simulateCustomerDebitNoteRecovery(
        Number(selectedCustomerId),
        periodFrom,
        periodTo,
        validItems.map(i => ({
          revision_id: 0,
          part_number: i.part_number,
          old_price: i.old_price,
          new_price: i.new_price,
          difference: i.new_price - i.old_price,
          price_source: "Manual",
          remarks: i.remarks || null
        })),
        currency,
        exchangeRate,
        excludedItemIds
      );
      setSimulation(res);
      setStep(7);
      onNotify?.("Simulation calculated successfully", "success");
    } catch (err: any) {
      onNotify?.(`Simulation failed: ${err.message || err}`, "error");
    } finally {
      setSimulating(false);
    }
  };

  const handleGenerate = async () => {
    if (!simulation || simulation.items.length === 0) {
      onNotify?.("No recoverable lines found for generation", "error");
      return;
    }

    setGenerating(true);
    try {
      const dn = await ApiService.generateCustomerDebitNote(
        Number(selectedCustomerId),
        null,
        periodFrom,
        periodTo,
        new Date().toISOString().substring(0, 10),
        custRef || null,
        currency,
        exchangeRate,
        remarks || null,
        `idempotency-${Date.now()}`,
        "Admin User",
        simulation.items
      );
      onNotify?.(`Customer Debit Note ${dn.debit_note_no} generated successfully!`, "success");
      await loadDebitNotes();
      setActiveTab("HISTORY");
      setStep(1);
    } catch (err: any) {
      onNotify?.(`Generation failed: ${err.message || err}`, "error");
    } finally {
      setGenerating(false);
    }
  };

  const handleViewDetails = async (id: number) => {
    try {
      const details = await ApiService.getCustomerDebitNoteDetails(id);
      setSelectedDN(details[0]);
      setDnDetails(details);
    } catch (err: any) {
      onNotify?.(`Failed to load details: ${err.message || err}`, "error");
    }
  };

  const handleOpenPrintView = async (id: number) => {
    try {
      const details = await ApiService.getCustomerDebitNoteDetails(id);
      setPrintViewData({ header: details[0], items: details[1] });
    } catch (err: any) {
      onNotify?.(`Failed to load document preview: ${err.message || err}`, "error");
    }
  };


  const handleStatusChange = async (id: number, status: string, action: string) => {
    try {
      await ApiService.updateCustomerDebitNoteStatus(id, status, action, "Status updated by user", "Admin User");
      onNotify?.(`Debit Note status updated to ${status}`, "success");
      await loadDebitNotes();
      if (selectedDN?.id === id) {
        handleViewDetails(id);
      }
    } catch (err: any) {
      onNotify?.(`Update status failed: ${err.message || err}`, "error");
    }
  };

  const handleCancelDN = async (id: number) => {
    const reason = prompt("Enter cancellation reason:");
    if (!reason) return;
    try {
      await ApiService.cancelCustomerDebitNote(id, reason, "Admin User");
      onNotify?.("Debit Note cancelled and invoice quantities restored!", "success");
      await loadDebitNotes();
      setSelectedDN(null);
    } catch (err: any) {
      onNotify?.(`Cancel failed: ${err.message || err}`, "error");
    }
  };

  const handleSaveMaster = async () => {
    if (!selectedCustomerId || !newMasterPart || newMasterPrice <= 0) {
      onNotify?.("Please select customer, enter part code, and valid price", "error");
      return;
    }
    try {
      await ApiService.saveCustomerPriceMaster(
        Number(selectedCustomerId),
        newMasterPart,
        newMasterPrice,
        newMasterDate,
        "Admin User"
      );
      onNotify?.("Price master updated successfully!", "success");
      loadPriceMasters();
      setNewMasterPart("");
      setNewMasterPrice(0);
    } catch (err: any) {
      onNotify?.(`Failed to save price master: ${err.message || err}`, "error");
    }
  };

  const loadReport = async () => {
    try {
      const res = await ApiService.getCustomerDebitNoteReports(reportType);
      setReportData(res);
    } catch (err: any) {
      onNotify?.(`Failed to load report: ${err.message || err}`, "error");
    }
  };

  return (
    <div className="space-y-6">
      {/* Top Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-4 border-b border-[var(--ember-border)]">
        <div>
          <h1 className="text-2xl font-bold font-serif text-[var(--ember-text-primary)] flex items-center gap-3">
            <FileText className="text-[var(--ember-primary)] w-7 h-7" />
            Customer Retrospective Price Revision Debit Notes
          </h1>
          <p className="text-sm text-[var(--ember-text-muted)] mt-1">
            Automated retrospective price differential calculations, Annexure CDN-A generation, and frozen tax snapshots.
          </p>
        </div>

        {/* Sub-Tabs Nav */}
        <div className="flex items-center bg-[var(--ember-surface)] p-1 rounded-xl border border-[var(--ember-border)] shadow-sm">
          <button
            onClick={() => setActiveTab("WIZARD")}
            className={`px-4 py-2 text-xs font-bold rounded-lg transition-all flex items-center gap-2 cursor-pointer ${
              activeTab === "WIZARD"
                ? "bg-[var(--ember-primary)] text-white shadow-sm"
                : "text-[var(--ember-text-secondary)] hover:text-[var(--ember-text-primary)]"
            }`}
          >
            <PlusCircle className="w-4 h-4" />
            New Debit Note (Wizard)
          </button>
          <button
            onClick={() => setActiveTab("HISTORY")}
            className={`px-4 py-2 text-xs font-bold rounded-lg transition-all flex items-center gap-2 cursor-pointer ${
              activeTab === "HISTORY"
                ? "bg-[var(--ember-primary)] text-white shadow-sm"
                : "text-[var(--ember-text-secondary)] hover:text-[var(--ember-text-primary)]"
            }`}
          >
            <History className="w-4 h-4" />
            Debit Note History ({debitNotes.length})
          </button>
          <button
            onClick={() => {
              setActiveTab("MASTER");
              loadPriceMasters();
            }}
            className={`px-4 py-2 text-xs font-bold rounded-lg transition-all flex items-center gap-2 cursor-pointer ${
              activeTab === "MASTER"
                ? "bg-[var(--ember-primary)] text-white shadow-sm"
                : "text-[var(--ember-text-secondary)] hover:text-[var(--ember-text-primary)]"
            }`}
          >
            <Settings className="w-4 h-4" />
            Price Master
          </button>
          <button
            onClick={() => {
              setActiveTab("REPORTS");
              loadReport();
            }}
            className={`px-4 py-2 text-xs font-bold rounded-lg transition-all flex items-center gap-2 cursor-pointer ${
              activeTab === "REPORTS"
                ? "bg-[var(--ember-primary)] text-white shadow-sm"
                : "text-[var(--ember-text-secondary)] hover:text-[var(--ember-text-primary)]"
            }`}
          >
            <TrendingUp className="w-4 h-4" />
            Reports & Analytics
          </button>
        </div>
      </div>

      {/* --- TAB 1: 8-STEP WIZARD --- */}
      {activeTab === "WIZARD" && (
        <div className="ember-card p-6 bg-[var(--ember-surface)]">
          {/* Step Progress Indicator */}
          <div className="flex items-center justify-between mb-8 pb-6 border-b border-[var(--ember-border)] overflow-x-auto">
            {[
              "Customer Selection",
              "Price Revision",
              "Validation Check",
              "Invoice Period",
              "Line Exclusions",
              "Partial Quantity",
              "Simulation Board",
              "Generate & Annexure",
            ].map((stName, idx) => {
              const stNum = idx + 1;
              const isDone = step > stNum;
              const isCurrent = step === stNum;
              return (
                <div key={stNum} className="flex items-center gap-2">
                  <div
                    className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold transition-all border ${
                      isDone
                        ? "bg-emerald-600/20 text-emerald-600 dark:text-emerald-400 border-emerald-500/30"
                        : isCurrent
                        ? "bg-[var(--ember-primary)] text-white border-[var(--ember-primary)] shadow-sm"
                        : "bg-[var(--ember-surface-raised)] text-[var(--ember-text-muted)] border-[var(--ember-border)]"
                    }`}
                  >
                    {isDone ? <Check className="w-4 h-4" /> : stNum}
                  </div>
                  <span
                    className={`text-xs font-medium hidden lg:inline ${
                      isCurrent ? "text-[var(--ember-primary)] font-bold" : "text-[var(--ember-text-secondary)]"
                    }`}
                  >
                    {stName}
                  </span>
                  {idx < 7 && (
                    <div className={`w-4 h-0.5 hidden lg:block ${isDone ? "bg-emerald-500" : "bg-[var(--ember-border)]"}`} />
                  )}
                </div>
              );
            })}
          </div>

          {/* STEP 1: Customer Selection */}
          {step === 1 && (
            <div className="max-w-xl mx-auto space-y-6">
              <h2 className="text-xl font-bold font-serif text-[var(--ember-text-primary)] flex items-center gap-2">
                <User className="text-[var(--ember-primary)]" /> Step 1: Select Customer & Currency
              </h2>
              <div>
                <label className="block text-xs font-semibold text-[var(--ember-text-secondary)] mb-2">Customer Name</label>
                <select
                  value={selectedCustomerId}
                  onChange={(e) => setSelectedCustomerId(Number(e.target.value))}
                  className="w-full ember-input px-4 py-3 text-sm"
                >
                  <option value="">-- Select Customer --</option>
                  {customers.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.report_name} ({c.customer_code || `ID: ${c.id}`})
                    </option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-[var(--ember-text-secondary)] mb-2">Currency</label>
                  <select
                    value={currency}
                    onChange={(e) => setCurrency(e.target.value)}
                    className="w-full ember-input px-4 py-3 text-sm"
                  >
                    <option value="INR">INR (₹)</option>
                    <option value="USD">USD ($)</option>
                    <option value="EUR">EUR (€)</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-[var(--ember-text-secondary)] mb-2">Exchange Rate</label>
                  <input
                    type="number"
                    step="0.0001"
                    value={exchangeRate}
                    onChange={(e) => setExchangeRate(Number(e.target.value))}
                    className="w-full ember-input px-4 py-3 text-sm"
                  />
                </div>
              </div>

              <button
                disabled={!selectedCustomerId}
                onClick={() => setStep(2)}
                className="w-full py-3.5 bg-[var(--ember-primary)] hover:bg-[var(--ember-primary-hover)] disabled:opacity-40 text-white font-bold rounded-xl shadow-sm transition-all flex items-center justify-center gap-2 cursor-pointer"
              >
                Proceed to Price Revision Input <ChevronRight className="w-5 h-5" />
              </button>
            </div>
          )}

          {/* STEP 2 & 3: Price Revision Items */}
          {(step === 2 || step === 3) && (
            <div className="space-y-6">
              <div className="flex items-center justify-between">
                <h2 className="text-xl font-bold font-serif text-[var(--ember-text-primary)] flex items-center gap-2">
                  <DollarSign className="text-[var(--ember-primary)]" /> Step 2: Revised Selling Prices Input
                </h2>
                <div className="flex gap-3">
                  <button
                    onClick={downloadTemplate}
                    className="px-3.5 py-1.5 bg-[var(--ember-surface-raised)] hover:bg-[var(--ember-border-subtle)] text-xs font-semibold text-[var(--ember-text-primary)] rounded-lg flex items-center gap-1.5 border border-[var(--ember-border)] transition-colors cursor-pointer"
                  >
                    <Download className="w-3.5 h-3.5 text-[var(--ember-text-secondary)]" /> Download Template
                  </button>
                  <button
                    onClick={importExcel}
                    className="px-3.5 py-1.5 bg-[var(--ember-surface-raised)] hover:bg-[var(--ember-border-subtle)] text-xs font-semibold text-[var(--ember-primary)] rounded-lg flex items-center gap-1.5 border border-[var(--ember-border)] transition-colors cursor-pointer"
                  >
                    <Upload className="w-3.5 h-3.5" /> Import Excel
                  </button>
                  <button
                    onClick={() =>
                      setRevisionItems([
                        ...revisionItems,
                        { part_number: "", old_price: 0, new_price: 0 },
                      ])
                    }
                    className="px-3.5 py-1.5 bg-[var(--ember-primary)] hover:bg-[var(--ember-primary-hover)] text-xs font-semibold text-white rounded-lg flex items-center gap-1.5 shadow-sm transition-colors cursor-pointer"
                  >
                    <PlusCircle className="w-3.5 h-3.5" /> Add Row
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-4 gap-4 bg-[var(--ember-surface-raised)] p-4 rounded-xl border border-[var(--ember-border)]">
                <div>
                  <label className="block text-xs font-semibold text-[var(--ember-text-secondary)] mb-1">Revision Letter No</label>
                  <input
                    type="text"
                    value={revisionNo}
                    onChange={(e) => setRevisionNo(e.target.value)}
                    className="w-full ember-input px-3 py-2 text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-[var(--ember-text-secondary)] mb-1">Effective From Date</label>
                  <input
                    type="date"
                    value={effectiveFrom}
                    onChange={(e) => setEffectiveFrom(e.target.value)}
                    className="w-full ember-input px-3 py-2 text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-[var(--ember-text-secondary)] mb-1">Customer PO Ref</label>
                  <input
                    type="text"
                    value={custPo}
                    onChange={(e) => setCustPo(e.target.value)}
                    className="w-full ember-input px-3 py-2 text-sm"
                    placeholder="PO-2026-99"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-[var(--ember-text-secondary)] mb-1">Customer Ref Date</label>
                  <input
                    type="date"
                    value={custRef}
                    onChange={(e) => setCustRef(e.target.value)}
                    className="w-full ember-input px-3 py-2 text-sm"
                  />
                </div>
                <div className="md:col-span-4">
                  <label className="block text-xs font-semibold text-[var(--ember-text-secondary)] mb-1">Remarks / Audit Notes</label>
                  <input
                    type="text"
                    value={remarks}
                    onChange={(e) => setRemarks(e.target.value)}
                    className="w-full ember-input px-3 py-2 text-sm"
                    placeholder="e.g. Approved by Plant Finance Committee on 15-May"
                  />
                </div>
              </div>

              {/* Table */}
              <div className="overflow-x-auto border border-[var(--ember-border)] rounded-xl bg-[var(--ember-bg)]">
                <table className="w-full text-left text-sm text-[var(--ember-text-secondary)]">
                  <thead className="bg-[var(--ember-surface-raised)] text-xs uppercase text-[var(--ember-text-secondary)] font-semibold border-b border-[var(--ember-border)]">
                    <tr>
                      <th className="p-3">#</th>
                      <th className="p-3">Part Number</th>
                      <th className="p-3">Old Price (₹)</th>
                      <th className="p-3">New Price (₹)</th>
                      <th className="p-3">Price Diff (₹)</th>
                      <th className="p-3">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[var(--ember-border)]">
                    {revisionItems.map((item, idx) => {
                      const diff = item.new_price - item.old_price;
                      return (
                        <tr key={idx} className="hover:bg-[var(--ember-surface-raised)]/40">
                          <td className="p-3 text-[var(--ember-text-muted)] font-bold">{idx + 1}</td>
                          <td className="p-3">
                            <input
                              type="text"
                              value={item.part_number}
                              onChange={(e) => {
                                const copy = [...revisionItems];
                                copy[idx].part_number = e.target.value.toUpperCase();
                                setRevisionItems(copy);
                              }}
                              placeholder="e.g. PART-1001"
                              className="w-full ember-input px-2.5 py-1.5 text-sm uppercase font-mono"
                            />
                          </td>
                          <td className="p-3">
                            <input
                              type="number"
                              step="0.0001"
                              value={item.old_price}
                              onChange={(e) => {
                                const copy = [...revisionItems];
                                copy[idx].old_price = Number(e.target.value);
                                setRevisionItems(copy);
                              }}
                              className="w-32 ember-input px-2.5 py-1.5 text-sm"
                            />
                          </td>
                          <td className="p-3">
                            <input
                              type="number"
                              step="0.0001"
                              value={item.new_price}
                              onChange={(e) => {
                                const copy = [...revisionItems];
                                copy[idx].new_price = Number(e.target.value);
                                setRevisionItems(copy);
                              }}
                              className="w-32 ember-input px-2.5 py-1.5 text-sm font-bold text-emerald-600 dark:text-emerald-400"
                            />
                          </td>
                          <td className="p-3 font-semibold text-[var(--ember-primary)]">
                            ₹{diff.toFixed(4)}
                          </td>
                          <td className="p-3">
                            <button
                              onClick={() => {
                                const copy = revisionItems.filter((_, i) => i !== idx);
                                setRevisionItems(copy.length ? copy : [{ part_number: "", old_price: 0, new_price: 0 }]);
                              }}
                              className="text-rose-600 dark:text-rose-400 hover:text-rose-500 p-1 cursor-pointer"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              <div className="flex justify-between items-center pt-4 border-t border-[var(--ember-border)]">
                <button
                  onClick={() => setStep(1)}
                  className="ember-btn-secondary px-5 py-2.5 text-sm flex items-center gap-2 cursor-pointer"
                >
                  <ChevronLeft className="w-4 h-4" /> Back
                </button>
                <button
                  onClick={() => setStep(4)}
                  className="px-6 py-2.5 bg-[var(--ember-primary)] hover:bg-[var(--ember-primary-hover)] text-white font-bold rounded-xl flex items-center gap-2 shadow-sm transition-all cursor-pointer"
                >
                  Next: Invoice Period <ChevronRight className="w-4 h-4" />
                </button>
              </div>
            </div>
          )}

          {/* STEP 4, 5, 6: Invoices & Range */}
          {(step === 4 || step === 5 || step === 6) && (
            <div className="space-y-6 max-w-2xl mx-auto">
              <h2 className="text-xl font-bold font-serif text-[var(--ember-text-primary)] flex items-center gap-2">
                <Calendar className="text-[var(--ember-primary)]" /> Step 4-6: Effective Recovery Date Range
              </h2>

              <div className="grid grid-cols-2 gap-4 bg-[var(--ember-surface-raised)] p-6 rounded-xl border border-[var(--ember-border)]">
                <div>
                  <label className="block text-xs font-semibold text-[var(--ember-text-secondary)] mb-2">Effective Period From</label>
                  <input
                    type="date"
                    value={periodFrom}
                    onChange={(e) => setPeriodFrom(e.target.value)}
                    className="w-full ember-input px-4 py-3 text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-[var(--ember-text-secondary)] mb-2">Effective Period To</label>
                  <input
                    type="date"
                    value={periodTo}
                    onChange={(e) => setPeriodTo(e.target.value)}
                    className="w-full ember-input px-4 py-3 text-sm"
                  />
                </div>
              </div>

              <div className="flex justify-between items-center pt-4 border-t border-[var(--ember-border)]">
                <button
                  onClick={() => setStep(2)}
                  className="ember-btn-secondary px-5 py-2.5 text-sm flex items-center gap-2 cursor-pointer"
                >
                  <ChevronLeft className="w-4 h-4" /> Back
                </button>
                <button
                  onClick={handleSimulate}
                  disabled={simulating}
                  className="px-6 py-3 bg-[var(--ember-primary)] hover:bg-[var(--ember-primary-hover)] disabled:opacity-40 text-white font-bold rounded-xl flex items-center gap-2 shadow-md transition-all cursor-pointer"
                >
                  {simulating ? <RefreshCw className="w-4 h-4 animate-spin" /> : <ShieldCheck className="w-5 h-5" />}
                  Run Simulation Engine
                </button>
              </div>
            </div>
          )}

          {/* STEP 7 & 8: Simulation Board & Generate */}
          {(step === 7 || step === 8) && simulation && (
            <div className="space-y-6">
              <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div>
                  <h2 className="text-xl font-bold font-serif text-[var(--ember-text-primary)] flex items-center gap-2">
                    <ShieldCheck className="text-emerald-600 dark:text-emerald-400" /> Step 7: Simulation Board & Metrics
                  </h2>
                  <p className="text-xs text-[var(--ember-text-muted)] mt-1">
                    Matching invoice lines preview before frozen debit note generation.
                  </p>
                </div>
                <button
                  onClick={handleGenerate}
                  disabled={generating}
                  className="px-6 py-3 bg-[var(--ember-primary)] hover:bg-[var(--ember-primary-hover)] disabled:opacity-40 text-white font-bold rounded-xl shadow-md flex items-center gap-2 text-sm cursor-pointer transition-all"
                >
                  {generating ? <RefreshCw className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-5 h-5" />}
                  Generate Debit Note & Annexure CDN-A
                </button>
              </div>

              {/* KPI Cards */}
              <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
                <div className="ember-card p-4 bg-[var(--ember-bg)]">
                  <div className="text-[10px] uppercase font-bold text-[var(--ember-text-muted)] tracking-wider">Total Invoices</div>
                  <div className="text-xl font-bold font-serif text-[var(--ember-text-primary)] mt-1">{simulation.total_invoices}</div>
                </div>
                <div className="ember-card p-4 bg-[var(--ember-bg)]">
                  <div className="text-[10px] uppercase font-bold text-[var(--ember-text-muted)] tracking-wider">Total Quantity</div>
                  <div className="text-xl font-bold font-serif text-[var(--ember-text-primary)] mt-1">{simulation.total_quantity.toLocaleString()}</div>
                </div>
                <div className="ember-card p-4 bg-[var(--ember-bg)]">
                  <div className="text-[10px] uppercase font-bold text-[var(--ember-text-muted)] tracking-wider">Taxable Diff</div>
                  <div className="text-xl font-bold font-serif text-emerald-600 dark:text-emerald-400 mt-1">₹{simulation.total_taxable.toFixed(2)}</div>
                </div>
                <div className="ember-card p-4 bg-[var(--ember-bg)]">
                  <div className="text-[10px] uppercase font-bold text-[var(--ember-text-muted)] tracking-wider">GST Amount</div>
                  <div className="text-xl font-bold font-serif text-[var(--ember-primary)] mt-1">
                    ₹{(simulation.total_cgst + simulation.total_sgst + simulation.total_igst).toFixed(2)}
                  </div>
                </div>
                <div className="ember-card p-4 bg-[var(--ember-bg)]">
                  <div className="text-[10px] uppercase font-bold text-[var(--ember-text-muted)] tracking-wider">Grand Total</div>
                  <div className="text-xl font-bold font-serif text-amber-600 dark:text-amber-500 mt-1">₹{simulation.grand_total.toFixed(2)}</div>
                </div>
              </div>

              {/* Warnings Block */}
              {simulation.warnings && simulation.warnings.length > 0 && (
                <div className="bg-amber-500/10 border border-amber-500/30 p-4 rounded-xl text-xs text-amber-800 dark:text-amber-300 space-y-1">
                  <div className="font-bold flex items-center gap-1.5 text-amber-600 dark:text-amber-400">
                    <AlertTriangle className="w-4 h-4" /> Warnings Detected:
                  </div>
                  {simulation.warnings.map((w: string, i: number) => (
                    <div key={i}>• {w}</div>
                  ))}
                </div>
              )}

              {/* Matched Lines Table */}
              <div className="overflow-x-auto border border-[var(--ember-border)] rounded-xl max-h-96 bg-[var(--ember-bg)]">
                <table className="w-full text-left text-xs text-[var(--ember-text-secondary)]">
                  <thead className="bg-[var(--ember-surface-raised)] text-[var(--ember-text-secondary)] uppercase sticky top-0 border-b border-[var(--ember-border)] font-semibold">
                    <tr>
                      <th className="p-3">Inv No</th>
                      <th className="p-3">Inv Date</th>
                      <th className="p-3">Part Code</th>
                      <th className="p-3">Qty</th>
                      <th className="p-3">Old Rate</th>
                      <th className="p-3">New Rate</th>
                      <th className="p-3">Diff</th>
                      <th className="p-3">Taxable</th>
                      <th className="p-3">GST Type</th>
                      <th className="p-3">Total Line</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[var(--ember-border)] font-mono">
                    {simulation.items.map((row: any, idx: number) => (
                      <tr key={idx} className="hover:bg-[var(--ember-surface-raised)]/45">
                        <td className="p-3 font-semibold text-[var(--ember-text-primary)]">{row.invoice_number}</td>
                        <td className="p-3 text-[var(--ember-text-muted)]">{row.invoice_date}</td>
                        <td className="p-3 text-[var(--ember-primary)] font-bold">{row.part_code}</td>
                        <td className="p-3 text-[var(--ember-text-primary)]">{row.recovered_qty}</td>
                        <td className="p-3 text-[var(--ember-text-muted)]">₹{row.rate_pre_unit.toFixed(2)}</td>
                        <td className="p-3 text-emerald-600 dark:text-emerald-400 font-bold">₹{row.new_price.toFixed(2)}</td>
                        <td className="p-3 text-[var(--ember-primary)]">₹{row.difference.toFixed(2)}</td>
                        <td className="p-3">₹{row.assessable_difference.toFixed(2)}</td>
                        <td className="p-3 text-[var(--ember-text-muted)]">{row.gst_type}</td>
                        <td className="p-3 font-bold text-amber-600 dark:text-amber-500">₹{row.total_difference.toFixed(2)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      {/* --- TAB 2: HISTORY --- */}
      {activeTab === "HISTORY" && (
        <div className="space-y-6">
          <div className="ember-card p-6 bg-[var(--ember-surface)] overflow-x-auto">
            <table className="w-full text-left text-sm text-[var(--ember-text-secondary)]">
              <thead className="bg-[var(--ember-surface-raised)] text-xs uppercase text-[var(--ember-text-secondary)] font-semibold border-b border-[var(--ember-border)]">
                <tr>
                  <th className="p-3">Debit Note No</th>
                  <th className="p-3">Annexure No</th>
                  <th className="p-3">Customer</th>
                  <th className="p-3">Date</th>
                  <th className="p-3">Taxable</th>
                  <th className="p-3">Total Value</th>
                  <th className="p-3">Outstanding</th>
                  <th className="p-3">Status</th>
                  <th className="p-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--ember-border)]">
                {debitNotes.map((dn) => (
                  <tr key={dn.id} className="hover:bg-[var(--ember-surface-raised)]/40">
                    <td className="p-3 font-mono font-bold text-[var(--ember-primary)]">{dn.debit_note_no}</td>
                    <td className="p-3 text-[var(--ember-text-muted)] font-mono">{dn.annexure_no}</td>
                    <td className="p-3 font-semibold text-[var(--ember-text-primary)]">{dn.frozen_customer_name}</td>
                    <td className="p-3 text-[var(--ember-text-muted)]">{dn.debit_note_date}</td>
                    <td className="p-3">₹{dn.total_taxable.toFixed(2)}</td>
                    <td className="p-3 font-bold text-emerald-600 dark:text-emerald-400">₹{dn.total_value.toFixed(2)}</td>
                    <td className="p-3 text-amber-600 dark:text-amber-500 font-semibold">₹{dn.outstanding_amount.toFixed(2)}</td>
                    <td className="p-3">
                      <span
                        className={`px-2.5 py-1 rounded-full text-xs font-bold ${
                          dn.status === "Cancelled"
                            ? "bg-rose-500/10 text-rose-600 dark:text-rose-400 border border-rose-500/20"
                            : dn.status === "Approved"
                            ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20"
                            : "bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 border border-indigo-500/20"
                        }`}
                      >
                        {dn.status}
                      </span>
                    </td>
                    <td className="p-3 text-right space-x-2">
                      <button
                        onClick={() => handleOpenPrintView(dn.id)}
                        className="px-3 py-1.5 bg-[var(--ember-primary)] hover:bg-[var(--ember-primary-hover)] text-white rounded-lg text-xs font-bold shadow-xs cursor-pointer inline-flex items-center gap-1.5"
                      >
                        <Printer className="w-3.5 h-3.5" /> View Voucher
                      </button>
                      <button
                        onClick={() => handleViewDetails(dn.id)}
                        className="px-3 py-1.5 bg-[var(--ember-surface-raised)] hover:bg-[var(--ember-border-subtle)] text-[var(--ember-text-primary)] rounded-lg text-xs font-bold border border-[var(--ember-border)] cursor-pointer"
                      >
                        Details
                      </button>
                      {dn.status !== "Cancelled" && (
                        <button
                          onClick={() => handleCancelDN(dn.id)}
                          className="px-2.5 py-1.5 bg-rose-500/10 hover:bg-rose-500/20 text-rose-600 dark:text-rose-400 rounded-lg text-xs font-bold cursor-pointer"
                        >
                          Cancel
                        </button>
                      )}
                    </td>

                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Details Drawer */}
          {selectedDN && dnDetails && (
            <div className="ember-card p-6 bg-[var(--ember-surface)] border-l-4 border-l-[var(--ember-primary)] space-y-6">
              <div className="flex items-center justify-between border-b border-[var(--ember-border)] pb-4">
                <div>
                  <h3 className="text-xl font-bold font-serif text-[var(--ember-text-primary)] flex items-center gap-2">
                    <FileText className="text-[var(--ember-primary)]" /> {selectedDN.debit_note_no} ({selectedDN.annexure_no})
                  </h3>
                  <p className="text-xs text-[var(--ember-text-muted)] mt-1">Customer: {selectedDN.frozen_customer_name}</p>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => handleOpenPrintView(selectedDN.id)}
                    className="px-3 py-1.5 bg-[var(--ember-primary)] hover:bg-[var(--ember-primary-hover)] text-white text-xs font-bold rounded-lg shadow-sm cursor-pointer inline-flex items-center gap-1.5"
                  >
                    <Printer className="w-3.5 h-3.5" /> View Voucher
                  </button>
                  {["Verified", "Approved", "Posted", "Locked"].map((st) => (
                    <button
                      key={st}
                      onClick={() => handleStatusChange(selectedDN.id, st, `Marked as ${st}`)}
                      className="px-3 py-1.5 bg-[var(--ember-surface-raised)] hover:bg-[var(--ember-border-subtle)] text-xs font-bold text-[var(--ember-text-primary)] rounded-lg border border-[var(--ember-border)] cursor-pointer"
                    >
                      {st}
                    </button>
                  ))}
                  <button
                    onClick={() => setSelectedDN(null)}
                    className="p-1.5 text-[var(--ember-text-muted)] hover:text-[var(--ember-text-primary)] cursor-pointer"
                  >
                    <X className="w-5 h-5" />
                  </button>
                </div>
              </div>

              {/* Items Table */}
              <div>
                <h4 className="text-sm font-bold text-[var(--ember-text-primary)] mb-2">Annexure Invoice Mapping Lines</h4>
                <div className="overflow-x-auto border border-[var(--ember-border)] rounded-xl max-h-64 bg-[var(--ember-bg)]">
                  <table className="w-full text-left text-xs text-[var(--ember-text-secondary)]">
                    <thead className="bg-[var(--ember-surface-raised)] text-[var(--ember-text-secondary)] uppercase border-b border-[var(--ember-border)] font-semibold">
                      <tr>
                        <th className="p-2.5">Inv No</th>
                        <th className="p-2.5">Part Code</th>
                        <th className="p-2.5">Qty</th>
                        <th className="p-2.5">Old Rate</th>
                        <th className="p-2.5">New Rate</th>
                        <th className="p-2.5">Diff</th>
                        <th className="p-2.5">Total Diff</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[var(--ember-border)] font-mono">
                      {dnDetails[1].map((line: any, idx: number) => (
                        <tr key={idx}>
                          <td className="p-2.5 font-bold text-[var(--ember-text-primary)]">{line.invoice_number}</td>
                          <td className="p-2.5 text-[var(--ember-primary)]">{line.part_code}</td>
                          <td className="p-2.5 text-[var(--ember-text-primary)]">{line.recovered_qty}</td>
                          <td className="p-2.5 text-[var(--ember-text-muted)]">₹{line.rate_pre_unit.toFixed(2)}</td>
                          <td className="p-2.5 text-emerald-600 dark:text-emerald-400 font-bold">₹{line.new_price.toFixed(2)}</td>
                          <td className="p-2.5">₹{line.difference.toFixed(2)}</td>
                          <td className="p-2.5 font-bold text-amber-600 dark:text-amber-500">₹{line.total_difference.toFixed(2)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* --- TAB 3: PRICE MASTER --- */}
      {activeTab === "MASTER" && (
        <div className="space-y-6">
          <div className="ember-card p-6 bg-[var(--ember-surface)] max-w-xl mx-auto space-y-4 shadow-md">
            <h2 className="text-xl font-bold font-serif text-[var(--ember-text-primary)] flex items-center gap-2">
              <Settings className="text-[var(--ember-primary)]" /> Save Active Master Selling Price
            </h2>

            <div>
              <label className="block text-xs font-semibold text-[var(--ember-text-secondary)] mb-1">Customer</label>
              <select
                value={selectedCustomerId}
                onChange={(e) => setSelectedCustomerId(Number(e.target.value))}
                className="w-full ember-input px-4 py-2.5 text-sm"
              >
                <option value="">-- Select Customer --</option>
                {customers.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.report_name}
                  </option>
                ))}
              </select>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-semibold text-[var(--ember-text-secondary)] mb-1">Part Number</label>
                <input
                  type="text"
                  value={newMasterPart}
                  onChange={(e) => setNewMasterPart(e.target.value.toUpperCase())}
                  className="w-full ember-input px-4 py-2.5 text-sm uppercase font-mono"
                  placeholder="PART-1001"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-[var(--ember-text-secondary)] mb-1">New Active Price (₹)</label>
                <input
                  type="number"
                  step="0.0001"
                  value={newMasterPrice}
                  onChange={(e) => setNewMasterPrice(Number(e.target.value))}
                  className="w-full ember-input px-4 py-2.5 text-sm font-bold text-emerald-600 dark:text-emerald-400"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-[var(--ember-text-secondary)] mb-1">Effective Date</label>
              <input
                type="date"
                value={newMasterDate}
                onChange={(e) => setNewMasterDate(e.target.value)}
                className="w-full ember-input px-4 py-2.5 text-sm"
              />
            </div>

            <button
              onClick={handleSaveMaster}
              className="w-full py-3 bg-[var(--ember-primary)] hover:bg-[var(--ember-primary-hover)] text-white font-bold rounded-xl shadow-sm cursor-pointer transition-all"
            >
              Update Price Master & Auto-Close Previous Entry
            </button>
          </div>

          {/* Master Table */}
          <div className="ember-card p-6 bg-[var(--ember-surface)] overflow-x-auto">
            <h3 className="text-sm font-bold text-[var(--ember-text-primary)] mb-4">Current Price Master Registry</h3>
            <table className="w-full text-left text-sm text-[var(--ember-text-secondary)]">
              <thead className="bg-[var(--ember-surface-raised)] text-xs uppercase text-[var(--ember-text-secondary)] font-semibold border-b border-[var(--ember-border)]">
                <tr>
                  <th className="p-3">Customer</th>
                  <th className="p-3">Part Code</th>
                  <th className="p-3">Description</th>
                  <th className="p-3">Active Price (₹)</th>
                  <th className="p-3">Effective Date</th>
                  <th className="p-3">Effective To</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--ember-border)]">
                {priceMasters.map((row) => (
                  <tr key={row.id} className="hover:bg-[var(--ember-surface-raised)]/40">
                    <td className="p-3 font-semibold text-[var(--ember-text-primary)]">{row.customer_name}</td>
                    <td className="p-3 font-mono font-bold text-[var(--ember-primary)]">{row.part_number}</td>
                    <td className="p-3 text-[var(--ember-text-muted)]">{row.part_description || "-"}</td>
                    <td className="p-3 font-bold text-emerald-600 dark:text-emerald-400">₹{row.current_price.toFixed(4)}</td>
                    <td className="p-3 text-[var(--ember-text-muted)]">{row.effective_date}</td>
                    <td className="p-3 text-[var(--ember-text-muted)]">{row.effective_to || "Open-Ended"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* --- TAB 4: REPORTS --- */}
      {activeTab === "REPORTS" && (
        <div className="space-y-6">
          <div className="flex items-center gap-4 bg-[var(--ember-surface)] p-4 rounded-xl border border-[var(--ember-border)] shadow-sm">
            <span className="text-sm font-bold text-[var(--ember-text-primary)]">Report Type:</span>
            <select
              value={reportType}
              onChange={(e) => {
                setReportType(e.target.value);
                loadReport();
              }}
              className="ember-input px-3 py-2 text-sm"
            >
              <option value="CUSTOMER_WISE">Customer-Wise Recovery Summary</option>
              <option value="PART_WISE">Part-Wise Differential Summary</option>
              <option value="REGISTER">Debit Note Register</option>
            </select>
            <button
              onClick={loadReport}
              className="px-4 py-2 bg-[var(--ember-primary)] hover:bg-[var(--ember-primary-hover)] text-white rounded-lg text-sm font-semibold flex items-center gap-1.5 cursor-pointer transition-all"
            >
              <RefreshCw className="w-4 h-4" /> Refresh Data
            </button>
          </div>

          {reportData && (
            <div className="ember-card p-6 bg-[var(--ember-surface)] overflow-x-auto">
              <pre className="text-xs font-mono text-[var(--ember-text-primary)] bg-[var(--ember-bg)] p-4 rounded-xl max-h-96 overflow-y-auto border border-[var(--ember-border)]">
                {JSON.stringify(reportData, null, 2)}
              </pre>
            </div>
          )}
        </div>
      )}


      {printViewData && (
        <DebitNotePrintView
          header={printViewData.header}
          items={printViewData.items}
          onClose={() => setPrintViewData(null)}
        />
      )}
    </div>
  );
};

