import { useState, useEffect } from "react";
import { open, save } from "@tauri-apps/plugin-dialog";
import { writeTextFile } from "@tauri-apps/plugin-fs";
import {
  FileUp,
  LayoutDashboard,
  FileSpreadsheet,
  AlertTriangle,
  CheckCircle,
  RefreshCw,
  Settings,
  TrendingUp,
  XCircle,
  Building,
  Search,
  Eye,
  FileText,
  FileJson,
  Trash2,
  Calendar,
  Clock,
  Percent,
  PlusCircle,
  ShieldCheck,
  Tag,
  Download,
  BarChart3,
  PieChart,
  Users,
  Info
} from "lucide-react";
import { ApiService } from "./services/api";
import { ImportPreview } from "./types/bindings/ImportPreview";
import { ImportTemplateRow } from "./types/bindings/ImportTemplateRow";
import { InvoiceSummary } from "./types/bindings/InvoiceSummary";
import { InvoiceRow } from "./types/bindings/InvoiceRow";
import { InvoiceItemRow } from "./types/bindings/InvoiceItemRow";
import { AuditLogRow } from "./types/bindings/AuditLogRow";
import { SupplierPriceRevisionRow } from "./types/bindings/SupplierPriceRevisionRow";
import { DebitNoteRow } from "./types/bindings/DebitNoteRow";
import { DebitNoteItemRow } from "./types/bindings/DebitNoteItemRow";
import { CreditNoteRow } from "./types/bindings/CreditNoteRow";
import { SupplierRow } from "./types/bindings/SupplierRow";
import { MonthlySalesRow } from "./types/bindings/MonthlySalesRow";
import { GstRateSummaryRow } from "./types/bindings/GstRateSummaryRow";
import { RankingRow } from "./types/bindings/RankingRow";
import { ExportResult } from "./types/bindings/ExportResult";

import { useUpdaterScheduler } from "./hooks/useUpdater";
import { UpdateCard } from "./components/updater/UpdateCard";
import { UpdateDialog } from "./components/updater/UpdateDialog";
import { AboutDialog } from "./components/updater/AboutDialog";

// App component state
// ... (omitting other states for readability in snippet, but they follow)

import { DashboardMetrics } from "./types/bindings/DashboardMetrics";
import { MaintenanceResult } from "./types/bindings/MaintenanceResult";
import { BackupStatus } from "./types/bindings/BackupStatus";
import DashboardKpis from "./components/DashboardKpis";
import CustomerMasterTab from "./components/CustomerMaster/CustomerMasterTab";
import CompanyProfileForm from "./components/CompanySettings/CompanyProfileForm";

function App() {
  // Update scheduler & states
  useUpdaterScheduler();
  const [isAboutOpen, setIsAboutOpen] = useState(false);

  // Navigation & Core States
  const [activeTab, setActiveTab] = useState<"dashboard" | "import" | "registers" | "customer_matching" | "revisions" | "notes" | "reports" | "settings">("dashboard");
  const [companyCode, setCompanyCode] = useState("DEMO");
  const [encryptionKey, setEncryptionKey] = useState("demo1234");
  const [isConnected, setIsConnected] = useState(false);
  const [activeFY] = useState("FY 2025-26");

  // Suppliers master lookup
  const [suppliers, setSuppliers] = useState<SupplierRow[]>([]);

  // Import View States
  const [templates, setTemplates] = useState<ImportTemplateRow[]>([]);
  const [selectedTemplateId, setSelectedTemplateId] = useState<number | null>(null);
  const [selectedFilePath, setSelectedFilePath] = useState("");
  const [isPreviewing, setIsPreviewing] = useState(false);
  const [previewData, setPreviewData] = useState<ImportPreview | null>(null);
  const [importStatus, setImportStatus] = useState<"idle" | "importing" | "success" | "error">("idle");
  const [statusMessage, setStatusMessage] = useState("");

  // Registers States
  const [invoices, setInvoices] = useState<InvoiceSummary[]>([]);
  const [loadingInvoices, setLoadingInvoices] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("ALL");
  const [cursorHistory, setCursorHistory] = useState<Array<{ date: string; no: string }>>([]);
  const [currentPageIndex, setCurrentPageIndex] = useState(0);

  // Invoice Details Drawer States
  const [selectedInvoice, setSelectedInvoice] = useState<InvoiceRow | null>(null);
  const [selectedInvoiceItems, setSelectedInvoiceItems] = useState<InvoiceItemRow[]>([]);
  const [selectedInvoiceAuditLogs, setSelectedInvoiceAuditLogs] = useState<AuditLogRow[]>([]);
  const [isDetailOpen, setIsDetailOpen] = useState(false);
  const [loadingDetails, setLoadingDetails] = useState(false);

  // Price Revisions States
  const [revisions, setRevisions] = useState<SupplierPriceRevisionRow[]>([]);
  const [loadingRevisions, setLoadingRevisions] = useState(false);
  const [isRevisionModalOpen, setIsRevisionModalOpen] = useState(false);
  
  // New Revision Form
  const [revSupplierId, setRevSupplierId] = useState<number | "">("");
  const [revPartCode, setRevPartCode] = useState("");
  const [revOldPrice, setRevOldPrice] = useState<number | "">("");
  const [revNewPrice, setRevNewPrice] = useState<number | "">("");
  const [revEffectiveDate, setRevEffectiveDate] = useState("");
  const [revRemarks, setRevRemarks] = useState("");

  // Price Revision Detail / Preview Recovery State
  const [selectedRevision, setSelectedRevision] = useState<SupplierPriceRevisionRow | null>(null);
  const [recoveryPreview, setRecoveryPreview] = useState<DebitNoteItemRow[]>([]);
  const [loadingRecoveryPreview, setLoadingRecoveryPreview] = useState(false);
  const [debitNoteNoInput, setDebitNoteNoInput] = useState("");
  const [debitNoteRemarksInput, setDebitNoteRemarksInput] = useState("");

  // Adjustment Notes States
  const [activeNotesSubTab, setActiveNotesSubTab] = useState<"debit" | "credit">("debit");
  const [debitNotes, setDebitNotes] = useState<DebitNoteRow[]>([]);
  const [creditNotes, setCreditNotes] = useState<CreditNoteRow[]>([]);
  const [loadingNotes, setLoadingNotes] = useState(false);

  // Reports & Export States
  const [reportSubTab, setReportSubTab] = useState<"export" | "monthly" | "gst" | "customers" | "items">("export");
  const [reportDateFrom, setReportDateFrom] = useState("");
  const [reportDateTo, setReportDateTo] = useState("");
  const [exportFormat, setExportFormat] = useState<"tally" | "excel" | "csv" | "einvoice_json">("tally");
  const [isExporting, setIsExporting] = useState(false);
  const [exportResult, setExportResult] = useState<ExportResult | null>(null);
  const [monthlySales, setMonthlySales] = useState<MonthlySalesRow[]>([]);
  const [gstRateSummary, setGstRateSummary] = useState<GstRateSummaryRow[]>([]);
  const [topCustomers, setTopCustomers] = useState<RankingRow[]>([]);
  const [topItems, setTopItems] = useState<RankingRow[]>([]);
  const [loadingReports, setLoadingReports] = useState(false);
  const [dashboardMetrics, setDashboardMetrics] = useState<DashboardMetrics | null>(null);

  // Maintenance & Backup & App Settings States
  const [maintenanceResult, setMaintenanceResult] = useState<MaintenanceResult | null>(null);
  const [backupStatus, setBackupStatus] = useState<BackupStatus | null>(null);
  const [isCheckingIntegrity, setIsCheckingIntegrity] = useState(false);
  const [isVacuuming, setIsVacuuming] = useState(false);
  const [isBackingUp, setIsBackingUp] = useState(false);
  const [tallyRegisterCode, setTallyRegisterCode] = useState("TF");
  const [isSavingRegisterCode, setIsSavingRegisterCode] = useState(false);

  // Auto-connect to DEMO profile on startup
  useEffect(() => {
    handleConnect();
  }, []);

  // Reload lists on navigation
  useEffect(() => {
    if (isConnected) {
      if (activeTab === "registers") {
        loadInvoices();
      } else if (activeTab === "revisions") {
        loadRevisions();
        loadSuppliers();
      } else if (activeTab === "notes") {
        loadNotes();
      } else if (activeTab === "reports") {
        loadMonthlySales();
      } else if (activeTab === "dashboard") {
        loadDashboardMetrics();
      } else if (activeTab === "settings") {
        loadBackupStatus();
        loadTallyRegisterCode();
      }
    }
  }, [activeTab, isConnected]);

  const handleConnect = async () => {
    try {
      await ApiService.switchCompanyProfile(companyCode, encryptionKey);
      setIsConnected(true);
      loadTallyRegisterCode();
      
      const list = await ApiService.getImportTemplates();
      setTemplates(list);
      if (list.length > 0) {
        setSelectedTemplateId(Number(list[0].id));
      }
    } catch (err: any) {
      console.error(err);
      alert(`Connection failed: ${err.message || err}`);
    }
  };

  const handleDisconnect = async () => {
    try {
      await ApiService.closeActiveProfile();
      setIsConnected(false);
      setTemplates([]);
      setPreviewData(null);
      setSelectedFilePath("");
      setInvoices([]);
      setRevisions([]);
      setDebitNotes([]);
      setCreditNotes([]);
    } catch (err) {
      console.error(err);
    }
  };

  const loadSuppliers = async () => {
    try {
      const list = await ApiService.getSuppliers();
      setSuppliers(list);
    } catch (err) {
      console.error(err);
    }
  };

  const loadInvoices = async (cDate?: string | null, cNo?: string | null) => {
    setLoadingInvoices(true);
    try {
      const list = await ApiService.listInvoices(cDate, cNo, 12);
      setInvoices(list);
    } catch (err) {
      console.error(err);
    } finally {
      setLoadingInvoices(false);
    }
  };

  const loadRevisions = async () => {
    setLoadingRevisions(true);
    try {
      const list = await ApiService.getPriceRevisions();
      setRevisions(list);
    } catch (err) {
      console.error(err);
    } finally {
      setLoadingRevisions(false);
    }
  };

  const loadNotes = async () => {
    setLoadingNotes(true);
    try {
      const dNotes = await ApiService.listDebitNotes();
      const cNotes = await ApiService.listCreditNotes();
      setDebitNotes(dNotes);
      setCreditNotes(cNotes);
    } catch (err) {
      console.error(err);
    } finally {
      setLoadingNotes(false);
    }
  };

  // Dashboard Metrics
  const loadDashboardMetrics = async () => {
    try {
      const metrics = await ApiService.getDashboardMetrics();
      setDashboardMetrics(metrics);
    } catch (err) {
      console.error(err);
    }
  };

  // Report Data Loaders
  const loadMonthlySales = async () => {
    setLoadingReports(true);
    try {
      const data = await ApiService.getMonthlySalesSummary();
      setMonthlySales(data);
    } catch (err) {
      console.error(err);
    } finally {
      setLoadingReports(false);
    }
  };

  const loadReportData = async () => {
    if (!reportDateFrom || !reportDateTo) return;
    setLoadingReports(true);
    try {
      const [gst, customers, items] = await Promise.all([
        ApiService.getGstRateSummary(reportDateFrom, reportDateTo),
        ApiService.getTopCustomers(reportDateFrom, reportDateTo, 10),
        ApiService.getTopItems(reportDateFrom, reportDateTo, 20),
      ]);
      setGstRateSummary(gst);
      setTopCustomers(customers);
      setTopItems(items);
    } catch (err) {
      console.error(err);
    } finally {
      setLoadingReports(false);
    }
  };

  const handleExport = async () => {
    if (!reportDateFrom || !reportDateTo) {
      alert("Please select a date range for export");
      return;
    }
    
    const ext = exportFormat === "einvoice_json" ? "json" : (exportFormat === "csv" ? "csv" : "xlsx");
    const filterName = exportFormat === "einvoice_json" ? "JSON Files" : (exportFormat === "csv" ? "CSV Files" : "Excel Files");
    const defaultFilename = exportFormat === "einvoice_json"
      ? `einvoice_credit_notes_${reportDateFrom}_${reportDateTo}.json`
      : `sales_export_${reportDateFrom}_${reportDateTo}.${ext}`;
    
    const savePath = await save({
      defaultPath: defaultFilename,
      filters: [{ name: filterName, extensions: [ext] }],
    });
    
    if (!savePath) return;
    
    setIsExporting(true);
    setExportResult(null);
    try {
      let result: ExportResult;
      if (exportFormat === "tally") {
        result = await ApiService.exportTallyExcel(reportDateFrom, reportDateTo, savePath);
      } else if (exportFormat === "excel") {
        result = await ApiService.exportStandardExcel(reportDateFrom, reportDateTo, savePath);
      } else if (exportFormat === "csv") {
        result = await ApiService.exportCsv(reportDateFrom, reportDateTo, savePath);
      } else {
        result = await ApiService.exportCreditNotesEInvoiceJson(reportDateFrom, reportDateTo, savePath);
      }
      setExportResult(result);
    } catch (err: any) {
      const msg = err.message || String(err);
      if (msg.includes("ERR_TALLY_UNMAPPED_CUSTOMERS") || msg.includes("need a Tally customer name")) {
        if (confirm(`${msg}\n\nWould you like to open Customer Master now to set their Tally customer names?`)) {
          setActiveTab("customer_matching");
        }
      } else {
        alert(`Export failed: ${msg}`);
      }
    } finally {
      setIsExporting(false);
    }
  };

  // Phase 6: Maintenance & Backup Handlers
  const loadBackupStatus = async () => {
    try {
      const status = await ApiService.getBackupStatus(companyCode);
      setBackupStatus(status);
    } catch (err) {
      console.error(err);
    }
  };

  const handleCheckIntegrity = async () => {
    setIsCheckingIntegrity(true);
    setMaintenanceResult(null);
    try {
      const res = await ApiService.checkDbIntegrity();
      setMaintenanceResult(res);
    } catch (err: any) {
      setMaintenanceResult({
        routine: "PRAGMA integrity_check",
        status: "FAILED",
        details: err.message || String(err),
        duration_ms: 0n as any,
      });
    } finally {
      setIsCheckingIntegrity(false);
    }
  };

  const handleVacuumDb = async () => {
    setIsVacuuming(true);
    setMaintenanceResult(null);
    try {
      const res = await ApiService.vacuumDatabase();
      setMaintenanceResult(res);
    } catch (err: any) {
      setMaintenanceResult({
        routine: "VACUUM & ANALYZE",
        status: "FAILED",
        details: err.message || String(err),
        duration_ms: 0n as any,
      });
    } finally {
      setIsVacuuming(false);
    }
  };

  const handleCreateBackup = async () => {
    const savePath = await save({
      defaultPath: `${companyCode}_backup_${new Date().toISOString().slice(0, 10)}.bak`,
      filters: [{ name: "Backup Files", extensions: ["bak", "db", "sql"] }],
    });

    if (!savePath) return;

    setIsBackingUp(true);
    try {
      await ApiService.createDbBackup(companyCode, activeFY, savePath);
      alert("Database backup completed successfully!");
      loadBackupStatus();
    } catch (err: any) {
      alert(`Backup failed: ${err.message || err}`);
    } finally {
      setIsBackingUp(false);
    }
  };

  const loadTallyRegisterCode = async () => {
    try {
      const val = await ApiService.getAppSetting("tally_register_code", "TF");
      setTallyRegisterCode(val);
    } catch (err) {
      console.error("Failed to load tally register code:", err);
    }
  };

  const handleSaveTallyRegisterCode = async () => {
    setIsSavingRegisterCode(true);
    try {
      const codeToSave = tallyRegisterCode.trim().toUpperCase() || "TF";
      await ApiService.setAppSetting("tally_register_code", codeToSave);
      setTallyRegisterCode(codeToSave);
      alert(`Tally Register Code saved as "${codeToSave}"!\nThis will be written in the "Re Type" column on every generated Tally row.`);
    } catch (err: any) {
      alert(`Failed to save register code: ${err.message || err}`);
    } finally {
      setIsSavingRegisterCode(false);
    }
  };

  // Revisions & Recovery Note generation
  const handleCreateRevision = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!revSupplierId || !revPartCode || !revOldPrice || !revNewPrice || !revEffectiveDate) {
      alert("Please fill all required price revision fields");
      return;
    }
    try {
      await ApiService.createPriceRevision(
        Number(revSupplierId),
        revPartCode,
        Number(revOldPrice),
        Number(revNewPrice),
        revEffectiveDate,
        revRemarks
      );
      setIsRevisionModalOpen(false);
      
      // Reset Form fields
      setRevPartCode("");
      setRevOldPrice("");
      setRevNewPrice("");
      setRevEffectiveDate("");
      setRevRemarks("");

      loadRevisions();
    } catch (err: any) {
      alert(`Error creating price revision: ${err.message || err}`);
    }
  };

  const handleSelectRevision = async (rev: SupplierPriceRevisionRow) => {
    setSelectedRevision(rev);
    setLoadingRecoveryPreview(true);
    setDebitNoteNoInput(`DN-REV-${rev.id}`);
    try {
      const items = await ApiService.previewRevisionRecovery(Number(rev.id));
      setRecoveryPreview(items);
    } catch (err: any) {
      alert(`Error loading recovery items: ${err.message || err}`);
    } finally {
      setLoadingRecoveryPreview(false);
    }
  };

  const handleGenerateDebitNote = async () => {
    if (!selectedRevision || !debitNoteNoInput) return;
    try {
      await ApiService.generateDebitNote(
        Number(selectedRevision.id),
        debitNoteNoInput,
        debitNoteRemarksInput
      );
      alert(`Debit Note ${debitNoteNoInput} generated successfully!`);
      setSelectedRevision(null);
      setRecoveryPreview([]);
      setDebitNoteNoInput("");
      setDebitNoteRemarksInput("");
      loadRevisions();
    } catch (err: any) {
      alert(`Debit Note Generation Error: ${err.message || err}`);
    }
  };

  const handleApproveDebitNote = async (no: string) => {
    try {
      await ApiService.approveDebitNote(no, "System User");
      alert(`Debit Note ${no} Approved & Locked!`);
      loadNotes();
    } catch (err: any) {
      alert(`Error approving note: ${err.message || err}`);
    }
  };

  // Credit Note Auto Generation for Cancelled Invoices
  const handleAutoGenerateCreditNote = async () => {
    if (!selectedInvoice) return;
    try {
      const cnNo = await ApiService.autoGenerateCreditNote(
        selectedInvoice.invoice_number,
        "Auto-generated Credit Note for cancelled invoice matcher"
      );
      alert(`Credit Note ${cnNo} generated!`);
      loadNotes();
      loadInvoices();
    } catch (err: any) {
      alert(`Error generating credit note: ${err.message || err}`);
    }
  };

  const handleExportCreditNotes = async () => {
    if (creditNotes.length === 0) {
      alert("No credit notes available to export.");
      return;
    }
    try {
      const selectedPath = await save({
        defaultPath: "Credit_Notes_Register.csv",
        filters: [{ name: "CSV Spreadsheet", extensions: ["csv"] }],
      });
      if (!selectedPath) return;

      let csv = "Credit Note No,Invoice Reference,Date,Taxable Amount (INR),Total Refund (INR),Status\n";
      creditNotes.forEach((cn) => {
        csv += `"${cn.credit_note_number}","${cn.invoice_number}","${cn.credit_note_date}",${cn.total_taxable},${cn.total_value},"${cn.status}"\n`;
      });

      await writeTextFile(selectedPath, csv);
      alert(`Credit Notes Register successfully exported to:\n${selectedPath}`);
    } catch (err: any) {
      alert(`Failed to export credit notes: ${err.message || err}`);
    }
  };

  const handleExportDebitNotes = async () => {
    if (debitNotes.length === 0) {
      alert("No debit notes available to export.");
      return;
    }
    try {
      const selectedPath = await save({
        defaultPath: "Debit_Notes_Register.csv",
        filters: [{ name: "CSV Spreadsheet", extensions: ["csv"] }],
      });
      if (!selectedPath) return;

      let csv = "Debit Note No,Supplier Reference,Date,Taxable Amount (INR),Total Recoverable (INR),Status\n";
      debitNotes.forEach((dn) => {
        csv += `"${dn.debit_note_number}","Supplier #${dn.supplier_id}","${dn.debit_note_date}",${dn.total_taxable},${dn.total_value},"${dn.status}"\n`;
      });

      await writeTextFile(selectedPath, csv);
      alert(`Debit Notes Register successfully exported to:\n${selectedPath}`);
    } catch (err: any) {
      alert(`Failed to export debit notes: ${err.message || err}`);
    }
  };

  const handleNextPage = () => {
    if (invoices.length < 12) return;
    const lastItem = invoices[invoices.length - 1];
    const newCursor = { date: lastItem.invoice_date, no: lastItem.invoice_number };
    
    setCursorHistory([...cursorHistory, newCursor]);
    setCurrentPageIndex(currentPageIndex + 1);
    loadInvoices(newCursor.date, newCursor.no);
  };

  const handlePrevPage = () => {
    if (currentPageIndex === 0) return;
    const prevHistory = [...cursorHistory];
    prevHistory.pop();
    
    const prevCursor = prevHistory[prevHistory.length - 1] || null;
    
    setCursorHistory(prevHistory);
    setCurrentPageIndex(currentPageIndex - 1);
    loadInvoices(prevCursor?.date || null, prevCursor?.no || null);
  };

  // Details Inspector
  const handleOpenDetails = async (invoiceNumber: string) => {
    setLoadingDetails(true);
    setIsDetailOpen(true);
    try {
      const [header, items] = await ApiService.getInvoiceDetails(invoiceNumber);
      setSelectedInvoice(header);
      setSelectedInvoiceItems(items);

      const logs = await ApiService.getRecordAuditLogs("invoices", invoiceNumber);
      setSelectedInvoiceAuditLogs(logs);
    } catch (err: any) {
      alert(`Error loading details: ${err.message || err}`);
      setIsDetailOpen(false);
    } finally {
      setLoadingDetails(false);
    }
  };

  const handleUpdateStatus = async (status: string) => {
    if (!selectedInvoice) return;
    try {
      await ApiService.updateInvoiceStatus(selectedInvoice.invoice_number, status, "System User");
      await handleOpenDetails(selectedInvoice.invoice_number);
      await loadInvoices();
    } catch (err: any) {
      alert(`Error: ${err.message || err}`);
    }
  };

  const handleDeleteRecord = async () => {
    if (!selectedInvoice) return;
    if (!confirm("Are you sure you want to permanently delete this invoice? This action is audited and cannot be undone.")) return;
    try {
      await ApiService.deleteInvoiceRecord(selectedInvoice.invoice_number, "System User");
      setIsDetailOpen(false);
      setSelectedInvoice(null);
      await loadInvoices();
    } catch (err: any) {
      alert(`Error deleting record: ${err.message || err}`);
    }
  };

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
      }
    }
  };

  const handleRunPreview = async () => {
    if (!selectedTemplateId || !selectedFilePath) return;
    setIsPreviewing(true);
    setImportStatus("idle");
    try {
      const result = await ApiService.previewImportFile(
        selectedFilePath,
        selectedTemplateId,
        "System User"
      );
      setPreviewData(result);
    } catch (err: any) {
      alert(`Preview Error: ${err.message || err}`);
    } finally {
      setIsPreviewing(false);
    }
  };

  const handleCommitImport = async () => {
    if (!selectedTemplateId || !selectedFilePath) return;
    setImportStatus("importing");
    try {
      const batchId = await ApiService.commitImportBatch(
        selectedFilePath,
        selectedTemplateId,
        "System User",
        "Standard batch outward sales upload"
      );
      setImportStatus("success");
      setStatusMessage(`Successfully imported batch ID: ${batchId}`);
      setPreviewData(null);
      setSelectedFilePath("");
      loadInvoices();
    } catch (err: any) {
      setImportStatus("error");
      setStatusMessage(err.message || err.toString());
    }
  };

  const filteredInvoices = invoices.filter((inv) => {
    const matchesSearch =
      inv.invoice_number.toLowerCase().includes(searchQuery.toLowerCase()) ||
      inv.customer_name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      inv.customer_code.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesStatus =
      statusFilter === "ALL" || inv.status.toUpperCase() === statusFilter.toUpperCase();
    return matchesSearch && matchesStatus;
  });

  return (
    <div className="flex h-screen bg-slate-950 text-slate-100 font-sans overflow-hidden">
      {/* Sidebar Navigation */}
      <aside className="w-64 bg-slate-900 border-r border-slate-800 flex flex-col justify-between z-10">
        <div>
          {/* Logo Header */}
          <div className="h-16 flex items-center px-6 border-b border-slate-800 gap-3">
            <div className="p-2 bg-indigo-500/10 text-indigo-400 rounded-lg">
              <TrendingUp className="w-6 h-6" />
            </div>
            <div>
              <h1 className="text-sm font-bold tracking-wide uppercase text-indigo-400">Sales Monitor</h1>
              <p className="text-[10px] text-slate-400">Offline ERP Matcher</p>
            </div>
          </div>

          {/* Nav Items */}
          <nav className="p-4 space-y-1">
            <button
              onClick={() => setActiveTab("dashboard")}
              className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg text-sm transition-all duration-200 ${
                activeTab === "dashboard"
                  ? "bg-indigo-600 text-white font-medium shadow-md shadow-indigo-600/10"
                  : "text-slate-400 hover:bg-slate-800/50 hover:text-slate-100"
              }`}
            >
              <LayoutDashboard className="w-4 h-4" />
              Dashboard
            </button>
            <button
              onClick={() => setActiveTab("registers")}
              className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg text-sm transition-all duration-200 ${
                activeTab === "registers"
                  ? "bg-indigo-600 text-white font-medium shadow-md shadow-indigo-600/10"
                  : "text-slate-400 hover:bg-slate-800/50 hover:text-slate-100"
              }`}
            >
              <FileSpreadsheet className="w-4 h-4" />
              Outward Registers
            </button>
            <button
              onClick={() => setActiveTab("customer_matching")}
              className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg text-sm transition-all duration-200 ${
                activeTab === "customer_matching"
                  ? "bg-indigo-600 text-white font-medium shadow-md shadow-indigo-600/10"
                  : "text-slate-400 hover:bg-slate-800/50 hover:text-slate-100"
              }`}
            >
              <Users className="w-4 h-4" />
              Customer Master
            </button>
            <button
              onClick={() => setActiveTab("revisions")}
              className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg text-sm transition-all duration-200 ${
                activeTab === "revisions"
                  ? "bg-indigo-600 text-white font-medium shadow-md shadow-indigo-600/10"
                  : "text-slate-400 hover:bg-slate-800/50 hover:text-slate-100"
              }`}
            >
              <Percent className="w-4 h-4" />
              Price Revisions
            </button>
            <button
              onClick={() => setActiveTab("notes")}
              className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg text-sm transition-all duration-200 ${
                activeTab === "notes"
                  ? "bg-indigo-600 text-white font-medium shadow-md shadow-indigo-600/10"
                  : "text-slate-400 hover:bg-slate-800/50 hover:text-slate-100"
              }`}
            >
              <Tag className="w-4 h-4" />
              Adjustment Notes
            </button>
            <button
              onClick={() => setActiveTab("reports")}
              className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg text-sm transition-all duration-200 ${
                activeTab === "reports"
                  ? "bg-indigo-600 text-white font-medium shadow-md shadow-indigo-600/10"
                  : "text-slate-400 hover:bg-slate-800/50 hover:text-slate-100"
              }`}
            >
              <BarChart3 className="w-4 h-4" />
              Reports & Export
            </button>
            <button
              onClick={() => setActiveTab("import")}
              className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg text-sm transition-all duration-200 ${
                activeTab === "import"
                  ? "bg-indigo-600 text-white font-medium shadow-md shadow-indigo-600/10"
                  : "text-slate-400 hover:bg-slate-800/50 hover:text-slate-100"
              }`}
            >
              <FileUp className="w-4 h-4" />
              Import Wizard
            </button>
            <button
              onClick={() => setActiveTab("settings")}
              className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg text-sm transition-all duration-200 ${
                activeTab === "settings"
                  ? "bg-indigo-600 text-white font-medium shadow-md shadow-indigo-600/10"
                  : "text-slate-400 hover:bg-slate-800/50 hover:text-slate-100"
              }`}
            >
              <Settings className="w-4 h-4" />
              Company Settings
            </button>
            <button
              onClick={() => setIsAboutOpen(true)}
              className="w-full flex items-center gap-3 px-4 py-3 rounded-lg text-sm text-slate-400 hover:bg-slate-800/50 hover:text-slate-100 transition-all duration-200"
            >
              <Info className="w-4 h-4 text-indigo-400" />
              About Application
            </button>
          </nav>
        </div>

        {/* Database Status Panel */}
        <div className="p-4 border-t border-slate-800 bg-slate-950/40">
          <div className="flex items-center gap-3">
            <div
              className={`w-2.5 h-2.5 rounded-full animate-pulse ${
                isConnected ? "bg-emerald-500" : "bg-rose-500"
              }`}
            />
            <div className="flex-1 min-w-0">
              <p className="text-xs font-semibold text-slate-200 truncate">
                {isConnected ? `company_${companyCode}.db` : "Disconnected"}
              </p>
              <p className="text-[10px] text-slate-400">
                {isConnected ? `Active: ${activeFY}` : "System Database Locked"}
              </p>
            </div>
            {isConnected && (
              <button
                onClick={handleDisconnect}
                className="p-1 hover:bg-slate-800 text-slate-400 hover:text-slate-200 rounded-md transition-colors"
                title="Disconnect Profile"
              >
                <XCircle className="w-4 h-4" />
              </button>
            )}
          </div>
        </div>
      </aside>

      {/* Main Content Area */}
      <main className="flex-1 flex flex-col min-w-0 overflow-y-auto relative">
        {/* Top Header */}
        <header className="h-16 border-b border-slate-800 bg-slate-900/50 backdrop-blur-md flex items-center justify-between px-8 z-10">
          <div>
            <span className="text-xs text-slate-400 font-medium">Outward Matching Engine</span>
            <h2 className="text-sm font-semibold text-slate-200">
              {activeTab === "dashboard" && "Dashboard Overview"}
              {activeTab === "registers" && "Sales Invoice Registers"}
              {activeTab === "revisions" && "Supplier Price Revisions Tracker"}
              {activeTab === "notes" && "Debit & Credit Adjustment Notes"}
              {activeTab === "reports" && "Reports & Export Center"}
              {activeTab === "import" && "Configure Excel Outward Import"}
              {activeTab === "settings" && "Company Profile Settings"}
            </h2>
          </div>

          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2 bg-slate-800/80 px-3 py-1.5 rounded-lg border border-slate-700 text-xs text-slate-300">
              <Building className="w-3.5 h-3.5 text-indigo-400" />
              <span>Active Profile: <strong className="text-indigo-400">{companyCode}</strong></span>
            </div>
          </div>
        </header>

        {/* Dynamic Panels */}
        <div className="flex-1 p-8">
          {activeTab === "dashboard" && (
            <div className="space-y-8">
              {!isConnected && (
                <div className="bg-amber-950/20 border border-amber-900/60 rounded-xl p-4 flex gap-4 text-amber-200">
                  <AlertTriangle className="w-5 h-5 flex-shrink-0 mt-0.5" />
                  <div>
                    <h4 className="font-bold text-sm">Database Disconnected</h4>
                    <p className="text-xs text-amber-400/90 mt-1">
                      Verify encryption keys and connect a company profile in settings to populate statistics and import registers.
                    </p>
                  </div>
                </div>
              )}

              <DashboardKpis metrics={dashboardMetrics} />
            </div>
          )}

          {activeTab === "registers" && (
            <div className="space-y-6">
              {/* Toolbar */}
              <div className="flex items-center justify-between gap-4 bg-slate-900 border border-slate-800 p-4 rounded-xl">
                <div className="flex items-center gap-3 flex-1 max-w-md">
                  <div className="relative w-full">
                    <Search className="absolute left-3 top-2.5 w-4 h-4 text-slate-500" />
                    <input
                      type="text"
                      placeholder="Search by Invoice No, Customer Code or Name..."
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      className="w-full bg-slate-950 border border-slate-800 rounded-lg pl-9 pr-4 py-2 text-xs text-slate-200 focus:outline-none focus:border-indigo-500"
                    />
                  </div>
                </div>

                <div className="flex gap-1 bg-slate-950 border border-slate-800 p-1 rounded-lg text-xs">
                  {["ALL", "Imported", "Verified", "Draft", "Cancelled"].map((status) => (
                    <button
                      key={status}
                      onClick={() => setStatusFilter(status)}
                      className={`px-3 py-1.5 rounded-md transition-all ${
                        statusFilter === status
                          ? "bg-slate-800 text-slate-100 font-semibold"
                          : "text-slate-400 hover:text-slate-200"
                      }`}
                    >
                      {status}
                    </button>
                  ))}
                </div>
              </div>

              {/* Table Register Grid */}
              <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden shadow-xl">
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse text-xs">
                    <thead>
                      <tr className="bg-slate-950 text-slate-400 font-bold border-b border-slate-800 select-none">
                        <th className="p-4">Invoice No</th>
                        <th className="p-4">Invoice Date</th>
                        <th className="p-4">Customer Details</th>
                        <th className="p-4 text-right">Taxable (₹)</th>
                        <th className="p-4 text-right">Tax (₹)</th>
                        <th className="p-4 text-right">Total Value (₹)</th>
                        <th className="p-4 text-center">Status</th>
                        <th className="p-4 text-center">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800/60">
                      {loadingInvoices ? (
                        <tr>
                          <td colSpan={8} className="p-12 text-center text-slate-500">
                            <RefreshCw className="w-6 h-6 animate-spin mx-auto mb-2 text-indigo-400" />
                            Loading registers database...
                          </td>
                        </tr>
                      ) : filteredInvoices.length === 0 ? (
                        <tr>
                          <td colSpan={8} className="p-12 text-center text-slate-500">
                            No invoices matched filter criteria.
                          </td>
                        </tr>
                      ) : (
                        filteredInvoices.map((inv) => (
                          <tr
                            key={inv.invoice_number}
                            onDoubleClick={() => handleOpenDetails(inv.invoice_number)}
                            className="hover:bg-slate-800/35 transition-colors cursor-pointer select-none"
                          >
                            <td className="p-4 font-mono font-bold text-indigo-400">{inv.invoice_number}</td>
                            <td className="p-4 font-medium text-slate-300">{inv.invoice_date}</td>
                            <td className="p-4">
                              <div className="font-semibold text-slate-200">{inv.customer_name}</div>
                              <div className="text-[10px] text-slate-500 mt-0.5">{inv.customer_code}</div>
                            </td>
                            <td className="p-4 text-right font-mono font-medium text-slate-300">
                              {inv.total_taxable.toLocaleString("en-IN", { minimumFractionDigits: 2 })}
                            </td>
                            <td className="p-4 text-right font-mono text-slate-400">
                              {inv.total_tax.toLocaleString("en-IN", { minimumFractionDigits: 2 })}
                            </td>
                            <td className="p-4 text-right font-mono font-bold text-slate-100">
                              {inv.total_value.toLocaleString("en-IN", { minimumFractionDigits: 2 })}
                            </td>
                            <td className="p-4 text-center">
                              <span
                                className={`px-2 py-0.5 rounded-full text-[10px] font-semibold tracking-wide uppercase ${
                                  inv.status === "Verified"
                                    ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20"
                                    : inv.status === "Cancelled"
                                    ? "bg-rose-500/10 text-rose-400 border border-rose-500/20"
                                    : inv.status === "Draft"
                                    ? "bg-amber-500/10 text-amber-400 border border-amber-500/20"
                                    : "bg-indigo-500/10 text-indigo-400 border border-indigo-500/20"
                                }`}
                              >
                                {inv.status}
                              </span>
                            </td>
                            <td className="p-4 text-center">
                              <button
                                onClick={() => handleOpenDetails(inv.invoice_number)}
                                className="p-1.5 hover:bg-slate-800 text-slate-400 hover:text-slate-200 rounded-md transition-colors inline-flex items-center gap-1"
                              >
                                <Eye className="w-3.5 h-3.5" /> inspect
                              </button>
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>

                {/* Pagination */}
                <div className="bg-slate-950 p-4 border-t border-slate-800 flex justify-between items-center text-xs">
                  <span className="text-slate-500">Page {currentPageIndex + 1}</span>
                  <div className="flex gap-2">
                    <button
                      onClick={handlePrevPage}
                      disabled={currentPageIndex === 0}
                      className="bg-slate-900 hover:bg-slate-800 border border-slate-800 rounded px-3 py-1.5 text-slate-300 disabled:opacity-40"
                    >
                      Prev
                    </button>
                    <button
                      onClick={handleNextPage}
                      disabled={invoices.length < 12}
                      className="bg-slate-900 hover:bg-slate-800 border border-slate-800 rounded px-3 py-1.5 text-slate-300 disabled:opacity-40"
                    >
                      Next
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}

          {activeTab === "customer_matching" && <CustomerMasterTab />}

          {activeTab === "revisions" && (
            <div className="grid grid-cols-3 gap-6 items-start">
              {/* Revisions list */}
              <div className="col-span-2 space-y-4">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-bold text-slate-200 uppercase tracking-wider text-indigo-400">Price Revisions History</h3>
                  <button
                    onClick={() => setIsRevisionModalOpen(true)}
                    className="bg-indigo-600 hover:bg-indigo-500 text-white font-semibold text-xs px-3.5 py-2 rounded-lg flex items-center gap-1 transition-colors"
                  >
                    <PlusCircle className="w-4 h-4" /> Add price revision
                  </button>
                </div>

                <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden text-xs">
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="bg-slate-950 text-slate-400 font-bold border-b border-slate-800">
                        <th className="p-4">Part Code</th>
                        <th className="p-4">Supplier ID</th>
                        <th className="p-4 text-right">Old Price</th>
                        <th className="p-4 text-right">New Price</th>
                        <th className="p-4">Effective Date</th>
                        <th className="p-4 text-center">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800/60">
                      {loadingRevisions ? (
                        <tr>
                          <td colSpan={6} className="p-8 text-center text-slate-500">Loading revisions...</td>
                        </tr>
                      ) : revisions.length === 0 ? (
                        <tr>
                          <td colSpan={6} className="p-8 text-center text-slate-500">No price revisions logged.</td>
                        </tr>
                      ) : (
                        revisions.map((rev) => (
                          <tr
                            key={rev.id?.toString()}
                            onClick={() => handleSelectRevision(rev)}
                            className={`hover:bg-slate-800/35 transition-colors cursor-pointer select-none ${
                              selectedRevision?.id === rev.id ? "bg-indigo-500/5 border-l-2 border-indigo-500" : ""
                            }`}
                          >
                            <td className="p-4 font-bold text-slate-200">{rev.part_code}</td>
                            <td className="p-4 text-slate-400">Supplier #{rev.supplier_id}</td>
                            <td className="p-4 text-right font-mono text-slate-400">₹{rev.old_price.toFixed(2)}</td>
                            <td className="p-4 text-right font-mono text-emerald-400">₹{rev.new_price.toFixed(2)}</td>
                            <td className="p-4 font-mono text-slate-300">{rev.effective_date}</td>
                            <td className="p-4 text-center">
                              <span className={`px-2 py-0.5 rounded-full text-[9px] font-semibold uppercase ${
                                rev.status === "Approved" ? "bg-emerald-500/10 text-emerald-400" : "bg-amber-500/10 text-amber-400"
                              }`}>
                                {rev.status}
                              </span>
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Price revision preview panel */}
              <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 space-y-6">
                <h4 className="text-xs font-bold text-slate-300 uppercase tracking-wider border-b border-slate-800 pb-3">
                  Revision Recovery Inspector
                </h4>
                {selectedRevision ? (
                  <div className="space-y-6 text-xs">
                    <div className="bg-slate-950 p-4 rounded-lg border border-slate-800 space-y-2">
                      <div><strong className="text-slate-400">Target Part:</strong> <span className="font-mono text-slate-200">{selectedRevision.part_code}</span></div>
                      <div><strong className="text-slate-400">Effective Date:</strong> <span className="font-mono text-slate-200">{selectedRevision.effective_date}</span></div>
                      <div><strong className="text-slate-400">Price difference:</strong> <span className="text-rose-400 font-bold">-₹{selectedRevision.difference.toFixed(2)}</span></div>
                    </div>

                    {loadingRecoveryPreview ? (
                      <div className="text-center text-slate-500 py-6">Calculating recovery impact...</div>
                    ) : recoveryPreview.length === 0 ? (
                      <div className="text-center text-slate-500 py-6">No matching invoices found for recovery.</div>
                    ) : (
                      <div className="space-y-4">
                        <div className="flex items-center justify-between font-semibold border-b border-slate-800 pb-2">
                          <span>Invoices Impacted:</span>
                          <span className="text-indigo-400 font-mono">{recoveryPreview.length} lines</span>
                        </div>
                        
                        <div className="max-h-48 overflow-y-auto space-y-2">
                          {recoveryPreview.map((item, i) => (
                            <div key={i} className="flex justify-between border-b border-slate-800/40 pb-1.5 text-[10px]">
                              <span className="font-mono text-slate-400">Inv {item.invoice_number}</span>
                              <span className="font-mono text-slate-200">Qty {item.quantity} (₹{item.total_difference.toFixed(2)})</span>
                            </div>
                          ))}
                        </div>

                        {selectedRevision.status !== "Approved" && (
                          <div className="pt-4 border-t border-slate-800 space-y-3">
                            <div>
                              <label className="block text-[10px] text-slate-500 mb-1 font-semibold">Debit Note Reference Number</label>
                              <input
                                type="text"
                                value={debitNoteNoInput}
                                onChange={(e) => setDebitNoteNoInput(e.target.value)}
                                className="w-full bg-slate-950 border border-slate-850 rounded p-2 text-xs focus:outline-none focus:border-indigo-500"
                              />
                            </div>
                            <div>
                              <label className="block text-[10px] text-slate-500 mb-1 font-semibold">Remarks</label>
                              <input
                                type="text"
                                value={debitNoteRemarksInput}
                                onChange={(e) => setDebitNoteRemarksInput(e.target.value)}
                                className="w-full bg-slate-950 border border-slate-850 rounded p-2 text-xs focus:outline-none focus:border-indigo-500"
                              />
                            </div>
                            <button
                              onClick={handleGenerateDebitNote}
                              className="w-full bg-indigo-600 hover:bg-indigo-500 text-white font-semibold py-2 rounded-lg transition-colors flex items-center justify-center gap-1.5"
                            >
                              <ShieldCheck className="w-4 h-4" /> Generate Recovery Debit Note
                            </button>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                ) : (
                  <p className="text-xs text-slate-500 text-center py-12">Select a price revision from the history to view potential debit note recoveries.</p>
                )}
              </div>
            </div>
          )}

          {activeTab === "notes" && (
            <div className="space-y-6">
              {/* Subtab Toggle */}
              <div className="flex items-center justify-between border-b border-slate-800 pb-3">
                <div className="flex gap-2">
                  <button
                    onClick={() => setActiveNotesSubTab("debit")}
                    className={`px-4 py-2 text-xs font-semibold rounded-lg transition-all ${
                      activeNotesSubTab === "debit" ? "bg-indigo-600 text-white shadow-md" : "text-slate-400 hover:text-slate-200"
                    }`}
                  >
                    Debit Notes (Supplier Price Recovery)
                  </button>
                  <button
                    onClick={() => setActiveNotesSubTab("credit")}
                    className={`px-4 py-2 text-xs font-semibold rounded-lg transition-all ${
                      activeNotesSubTab === "credit" ? "bg-indigo-600 text-white shadow-md" : "text-slate-400 hover:text-slate-200"
                    }`}
                  >
                    Credit Notes (Sales Cancellations)
                  </button>
                </div>

                {activeNotesSubTab === "credit" ? (
                  <button
                    onClick={handleExportCreditNotes}
                    className="bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold px-4 py-2 rounded-lg transition-colors flex items-center gap-1.5"
                  >
                    <Download className="w-3.5 h-3.5 text-indigo-400" /> Export Credit Notes CSV
                  </button>
                ) : (
                  <button
                    onClick={handleExportDebitNotes}
                    className="bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold px-4 py-2 rounded-lg transition-colors flex items-center gap-1.5"
                  >
                    <Download className="w-3.5 h-3.5 text-indigo-400" /> Export Debit Notes CSV
                  </button>
                )}
              </div>

              {/* Notes Register Grid */}
              <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden shadow-xl text-xs">
                {activeNotesSubTab === "debit" ? (
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="bg-slate-950 text-slate-400 font-bold border-b border-slate-800">
                        <th className="p-4">Debit Note No</th>
                        <th className="p-4">Supplier Reference</th>
                        <th className="p-4 font-mono">Date</th>
                        <th className="p-4 text-right">Taxable Amount</th>
                        <th className="p-4 text-right">Total Recoverable</th>
                        <th className="p-4 text-center">Status</th>
                        <th className="p-4 text-center">Action</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800/60">
                      {loadingNotes ? (
                        <tr>
                          <td colSpan={7} className="p-8 text-center text-slate-500">Loading notes...</td>
                        </tr>
                      ) : debitNotes.length === 0 ? (
                        <tr>
                          <td colSpan={7} className="p-8 text-center text-slate-500">No debit notes found.</td>
                        </tr>
                      ) : (
                        debitNotes.map((dn) => (
                          <tr key={dn.debit_note_number} className="hover:bg-slate-800/10">
                            <td className="p-4 font-mono font-bold text-indigo-400">{dn.debit_note_number}</td>
                            <td className="p-4">Supplier #{dn.supplier_id}</td>
                            <td className="p-4 font-mono">{dn.debit_note_date}</td>
                            <td className="p-4 text-right font-mono text-slate-300">₹{dn.total_taxable.toLocaleString("en-IN", { minimumFractionDigits: 2 })}</td>
                            <td className="p-4 text-right font-mono font-bold text-emerald-400">₹{dn.total_value.toLocaleString("en-IN", { minimumFractionDigits: 2 })}</td>
                            <td className="p-4 text-center">
                              <span className={`px-2 py-0.5 rounded-full text-[9px] font-semibold uppercase ${
                                dn.status === "Approved" ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20" : "bg-amber-500/10 text-amber-400 border border-amber-500/20"
                              }`}>
                                {dn.status}
                              </span>
                            </td>
                            <td className="p-4 text-center">
                              {dn.status === "Draft" && (
                                <button
                                  onClick={() => handleApproveDebitNote(dn.debit_note_number)}
                                  className="bg-indigo-600/10 hover:bg-indigo-600 text-indigo-400 hover:text-white border border-indigo-500/20 px-3 py-1 rounded transition-colors text-[10px] font-semibold"
                                >
                                  Approve & Lock
                                </button>
                              )}
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                ) : (
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="bg-slate-950 text-slate-400 font-bold border-b border-slate-800">
                        <th className="p-4">Credit Note No</th>
                        <th className="p-4">Invoice Reference</th>
                        <th className="p-4 font-mono">Date</th>
                        <th className="p-4 text-right">Taxable Value</th>
                        <th className="p-4 text-right">Total Refund</th>
                        <th className="p-4 text-center">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800/60">
                      {loadingNotes ? (
                        <tr>
                          <td colSpan={6} className="p-8 text-center text-slate-500">Loading notes...</td>
                        </tr>
                      ) : creditNotes.length === 0 ? (
                        <tr>
                          <td colSpan={6} className="p-8 text-center text-slate-500">No credit notes found.</td>
                        </tr>
                      ) : (
                        creditNotes.map((cn) => (
                          <tr key={cn.credit_note_number} className="hover:bg-slate-800/10">
                            <td className="p-4 font-mono font-bold text-indigo-400">{cn.credit_note_number}</td>
                            <td className="p-4 font-mono text-slate-400">{cn.invoice_number}</td>
                            <td className="p-4 font-mono">{cn.credit_note_date}</td>
                            <td className="p-4 text-right font-mono text-slate-300">₹{cn.total_taxable.toLocaleString("en-IN", { minimumFractionDigits: 2 })}</td>
                            <td className="p-4 text-right font-mono font-bold text-rose-400">₹{cn.total_value.toLocaleString("en-IN", { minimumFractionDigits: 2 })}</td>
                            <td className="p-4 text-center">
                              <span className={`px-2 py-0.5 rounded-full text-[9px] font-semibold uppercase ${
                                cn.status === "Approved" ? "bg-emerald-500/10 text-emerald-400" : "bg-amber-500/10 text-amber-400"
                              }`}>
                                {cn.status}
                              </span>
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                )}
              </div>
            </div>
          )}

          {activeTab === "import" && (
            <div className="space-y-8 max-w-5xl">
              {/* Drag and Drop Zone */}
              <div
                onClick={handleSelectFile}
                onDragOver={(e) => e.preventDefault()}
                onDrop={handleFileDrop}
                className="border-2 border-dashed border-slate-800 hover:border-indigo-500/60 bg-slate-900/60 hover:bg-indigo-950/20 rounded-xl p-8 text-center cursor-pointer transition-all duration-200 group"
              >
                <div className="p-3 bg-indigo-500/10 text-indigo-400 rounded-full w-12 h-12 flex items-center justify-center mx-auto mb-3 group-hover:scale-110 transition-transform">
                  <FileUp className="w-6 h-6" />
                </div>
                <h4 className="text-xs font-bold text-slate-200 uppercase tracking-wider">
                  Click to Browse or Drag & Drop Sales Spreadsheet
                </h4>
                <p className="text-[11px] text-slate-400 mt-1">
                  Supports ERP outward exports in .xlsx, .xls, or .csv formats
                </p>
                {selectedFilePath && (
                  <div className="mt-3 inline-block bg-slate-950 px-3 py-1.5 rounded-lg border border-slate-800 text-xs font-mono text-indigo-400">
                    Selected: {selectedFilePath}
                  </div>
                )}
              </div>

              {/* Import Setup Card */}
              <div className="bg-slate-900 border border-slate-800 rounded-xl p-6">
                <h3 className="text-sm font-bold text-slate-200 mb-6 uppercase tracking-wider text-indigo-400">Configure Import Job</h3>

                <div className="grid grid-cols-2 gap-6 mb-6">
                  <div>
                    <label className="block text-xs font-semibold text-slate-400 mb-2">Selected Mapping Template</label>
                    <select
                      value={selectedTemplateId || ""}
                      onChange={(e) => setSelectedTemplateId(Number(e.target.value))}
                      className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2.5 text-xs text-slate-200 focus:outline-none focus:border-indigo-500"
                    >
                      {templates.map((t) => (
                        <option key={t.id?.toString()} value={t.id?.toString()}>
                          {t.template_name} ({t.source_type})
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-400 mb-2">Excel File Source Path</label>
                    <div className="flex gap-2">
                      <input
                        type="text"
                        placeholder="Browse or paste file path (e.g. C:\Reports\DailySales.xlsx)..."
                        value={selectedFilePath}
                        onChange={(e) => {
                          const rawPath = e.target.value;
                          const cleanPath = rawPath.trim().replace(/^"(.*)"$/, "$1");
                          setSelectedFilePath(cleanPath);
                          setPreviewData(null);
                          setImportStatus("idle");
                        }}
                        className="flex-1 bg-slate-950 border border-slate-800 rounded-lg p-2.5 text-xs text-slate-200 focus:outline-none focus:border-indigo-500"
                      />
                      <button
                        onClick={handleSelectFile}
                        className="bg-indigo-600 hover:bg-indigo-500 text-white font-semibold text-xs px-4 py-2.5 rounded-lg transition-colors flex items-center gap-1.5"
                      >
                        <FileSpreadsheet className="w-4 h-4" /> Browse
                      </button>
                    </div>
                  </div>
                </div>

                <div className="flex justify-end gap-3 border-t border-slate-800/80 pt-6">
                  {selectedFilePath && (
                    <button
                      onClick={handleRunPreview}
                      disabled={isPreviewing}
                      className="bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 font-semibold text-xs px-5 py-2.5 rounded-lg transition-colors flex items-center gap-1.5 disabled:opacity-50"
                    >
                      {isPreviewing ? <RefreshCw className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
                      Run Validation Preview
                    </button>
                  )}

                  {previewData && previewData.errors.length === 0 && (
                    <button
                      onClick={handleCommitImport}
                      disabled={importStatus === "importing"}
                      className="bg-indigo-600 hover:bg-indigo-500 text-white font-semibold text-xs px-5 py-2.5 rounded-lg transition-colors flex items-center gap-1.5"
                    >
                      {importStatus === "importing" ? (
                        <RefreshCw className="w-4 h-4 animate-spin" />
                      ) : (
                        <CheckCircle className="w-4 h-4" />
                      )}
                      Commit Import Batch
                    </button>
                  )}
                </div>
              </div>

              {/* Status alerts */}
              {importStatus === "success" && (
                <div className="bg-emerald-950/20 border border-emerald-900/60 rounded-xl p-4 flex gap-4 text-emerald-200">
                  <CheckCircle className="w-5 h-5 flex-shrink-0 mt-0.5" />
                  <div>
                    <h4 className="font-bold text-sm">Import Completed Successfully</h4>
                    <p className="text-xs text-emerald-400/90 mt-1">{statusMessage}</p>
                  </div>
                </div>
              )}
              {importStatus === "error" && (
                <div className="bg-rose-950/20 border border-rose-900/60 rounded-xl p-4 flex gap-4 text-rose-200">
                  <XCircle className="w-5 h-5 flex-shrink-0 mt-0.5" />
                  <div>
                    <h4 className="font-bold text-sm">Import Failed</h4>
                    <p className="text-xs text-rose-400/90 mt-1">{statusMessage}</p>
                  </div>
                </div>
              )}

              {/* Preview Analysis Panel */}
              {previewData && (
                <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 space-y-6">
                  <div className="flex items-center justify-between border-b border-slate-800 pb-4">
                    <div>
                      <h4 className="text-sm font-bold text-slate-200">Validation Results Summary</h4>
                      <p className="text-[10px] text-slate-400 mt-0.5">SHA256 File Signature: {previewData.batch_hash}</p>
                    </div>
                    <div className="flex gap-4 text-xs font-semibold">
                      <span className="text-indigo-400">{previewData.row_count - 1} rows parsed</span>
                      <span className="text-emerald-400">+{previewData.proposed_inserts} new</span>
                      <span className="text-blue-400">*{previewData.proposed_updates} updates</span>
                      <span className="text-rose-400">{previewData.errors.length} errors</span>
                      <span className="text-amber-400">{previewData.warnings.length} warnings</span>
                    </div>
                  </div>

                  {/* Errors */}
                  {previewData.errors.length > 0 && (
                    <div className="space-y-2">
                      <h5 className="text-xs font-semibold text-rose-400 flex items-center gap-1.5">
                        <XCircle className="w-4 h-4" /> Validation Errors (Blocks Import)
                      </h5>
                      <div className="bg-slate-950 border border-slate-800 rounded-lg overflow-hidden text-xs">
                        <table className="w-full text-left border-collapse">
                          <thead>
                            <tr className="bg-slate-900 text-slate-400 font-semibold border-b border-slate-800">
                              <th className="p-3">Excel Row</th>
                              <th className="p-3">Invoice No</th>
                              <th className="p-3">Field Key</th>
                              <th className="p-3">Error Scenario</th>
                              <th className="p-3">Actual Value</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-800/60">
                            {previewData.errors.map((err, i) => (
                              <tr key={i} className="hover:bg-slate-900/30 text-rose-200/90">
                                <td className="p-3">
                                  {err.row_no === 0 ? (
                                    <span className="font-semibold text-rose-400 bg-rose-500/10 px-2 py-0.5 rounded text-[11px]">
                                      Header Row 1
                                    </span>
                                  ) : (
                                    <span>Row {err.row_no}</span>
                                  )}
                                </td>
                                <td className="p-3 font-mono text-slate-400">
                                  {err.row_no === 0 ? "Header Column" : (err.invoice_no || "N/A")}
                                </td>
                                <td className="p-3 font-semibold text-slate-300 font-mono">{err.field_name}</td>
                                <td className="p-3">
                                  {err.error_type === "ERR_IMPORT_001" ? (
                                    <span className="font-semibold text-rose-300">Missing Column Header</span>
                                  ) : err.error_type === "ERR_IMPORT_002" ? (
                                    <span className="font-semibold text-rose-400">Duplicate File</span>
                                  ) : (
                                    err.error_type
                                  )}
                                </td>
                                <td className="p-3 font-mono bg-rose-500/5">
                                  {err.error_type === "ERR_IMPORT_002" ? (
                                    <span className="text-rose-300 font-sans text-xs font-semibold">
                                      This file has already been imported into your database in a previous batch. Double importing identical files is blocked to prevent data duplication.
                                    </span>
                                  ) : err.row_no === 0 ? (
                                    <span className="text-amber-300 font-sans text-xs">
                                      Column for '<strong className="text-white">{err.field_name}</strong>' was not found in Row 1 of your Excel file.
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
                      <h5 className="text-xs font-semibold text-amber-400 flex items-center gap-1.5">
                        <AlertTriangle className="w-4 h-4" /> Import Warnings (Auto-Resolves/Seed Registry Queue)
                      </h5>
                      <div className="bg-slate-950 border border-slate-800 rounded-lg overflow-hidden text-xs">
                        <table className="w-full text-left border-collapse">
                          <thead>
                            <tr className="bg-slate-900 text-slate-400 font-semibold border-b border-slate-800">
                              <th className="p-3">Excel Row</th>
                              <th className="p-3">Invoice No</th>
                              <th className="p-3">Field Key</th>
                              <th className="p-3">Warning Type</th>
                              <th className="p-3">Description</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-800/60">
                            {previewData.warnings.map((wrn, i) => (
                              <tr key={i} className="hover:bg-slate-900/30 text-amber-200/90">
                                <td className="p-3">{wrn.row_no}</td>
                                <td className="p-3 font-mono">{wrn.invoice_no || "N/A"}</td>
                                <td className="p-3 font-semibold text-slate-400">{wrn.field_name}</td>
                                <td className="p-3">{wrn.warning_type}</td>
                                <td className="p-3">
                                  {wrn.warning_type === "ERR_VALIDATION_004" ? (
                                    <span className="flex items-center gap-1">
                                      Unrecognized code: <strong className="text-indigo-400">{wrn.actual_value}</strong>. Auto-creates registry in review queue.
                                    </span>
                                  ) : (
                                    <span>Totals mismatch. Expected sum: {wrn.expected_value}</span>
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
            </div>
          )}

          {activeTab === "reports" && (
            <div className="space-y-6">
              {/* Reports Sub-Header Navigation */}
              <div className="flex items-center justify-between border-b border-slate-800 pb-4">
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setReportSubTab("export")}
                    className={`px-4 py-2 rounded-lg text-xs font-semibold transition-colors flex items-center gap-2 ${
                      reportSubTab === "export"
                        ? "bg-indigo-600 text-white shadow-md shadow-indigo-600/20"
                        : "bg-slate-900 text-slate-400 hover:text-slate-200 border border-slate-800"
                    }`}
                  >
                    <Download className="w-3.5 h-3.5" />
                    Tally & Data Exporter
                  </button>
                  <button
                    onClick={() => setReportSubTab("monthly")}
                    className={`px-4 py-2 rounded-lg text-xs font-semibold transition-colors flex items-center gap-2 ${
                      reportSubTab === "monthly"
                        ? "bg-indigo-600 text-white shadow-md shadow-indigo-600/20"
                        : "bg-slate-900 text-slate-400 hover:text-slate-200 border border-slate-800"
                    }`}
                  >
                    <BarChart3 className="w-3.5 h-3.5" />
                    Monthly Performance
                  </button>
                  <button
                    onClick={() => setReportSubTab("gst")}
                    className={`px-4 py-2 rounded-lg text-xs font-semibold transition-colors flex items-center gap-2 ${
                      reportSubTab === "gst"
                        ? "bg-indigo-600 text-white shadow-md shadow-indigo-600/20"
                        : "bg-slate-900 text-slate-400 hover:text-slate-200 border border-slate-800"
                    }`}
                  >
                    <PieChart className="w-3.5 h-3.5" />
                    GST Tax Breakdown
                  </button>
                  <button
                    onClick={() => setReportSubTab("customers")}
                    className={`px-4 py-2 rounded-lg text-xs font-semibold transition-colors flex items-center gap-2 ${
                      reportSubTab === "customers"
                        ? "bg-indigo-600 text-white shadow-md shadow-indigo-600/20"
                        : "bg-slate-900 text-slate-400 hover:text-slate-200 border border-slate-800"
                    }`}
                  >
                    <Building className="w-3.5 h-3.5" />
                    Top Customers
                  </button>
                  <button
                    onClick={() => setReportSubTab("items")}
                    className={`px-4 py-2 rounded-lg text-xs font-semibold transition-colors flex items-center gap-2 ${
                      reportSubTab === "items"
                        ? "bg-indigo-600 text-white shadow-md shadow-indigo-600/20"
                        : "bg-slate-900 text-slate-400 hover:text-slate-200 border border-slate-800"
                    }`}
                  >
                    <Tag className="w-3.5 h-3.5" />
                    Top Part Sales
                  </button>
                </div>

                <div className="flex items-center gap-2">
                  <input
                    type="date"
                    value={reportDateFrom}
                    onChange={(e) => setReportDateFrom(e.target.value)}
                    className="bg-slate-950 border border-slate-800 rounded-lg px-3 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-indigo-500"
                  />
                  <span className="text-xs text-slate-500">to</span>
                  <input
                    type="date"
                    value={reportDateTo}
                    onChange={(e) => setReportDateTo(e.target.value)}
                    className="bg-slate-950 border border-slate-800 rounded-lg px-3 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-indigo-500"
                  />
                  <button
                    onClick={loadReportData}
                    className="bg-slate-800 hover:bg-slate-700 text-slate-200 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors"
                  >
                    Filter
                  </button>
                </div>
              </div>

              {/* Sub-Tab 1: Export Generator */}
              {reportSubTab === "export" && (
                <div className="grid grid-cols-3 gap-6">
                  <div className="col-span-2 bg-slate-900 border border-slate-800 rounded-xl p-6 space-y-6">
                    <div>
                      <h3 className="text-sm font-bold text-slate-200 uppercase tracking-wider text-indigo-400">
                        Export Format Options
                      </h3>
                      <p className="text-xs text-slate-400 mt-1">
                        Select the destination layout format to compile outward sales invoices into downloadable files.
                      </p>
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                      <div
                        onClick={() => setExportFormat("tally")}
                        className={`cursor-pointer p-4 rounded-xl border transition-all ${
                          exportFormat === "tally"
                            ? "bg-indigo-600/10 border-indigo-500 text-indigo-300"
                            : "bg-slate-950 border-slate-800 text-slate-400 hover:border-slate-700"
                        }`}
                      >
                        <FileSpreadsheet className="w-6 h-6 mb-2 text-indigo-400" />
                        <h4 className="font-bold text-xs text-slate-200">Tally Excel (Multi-Rate Split)</h4>
                        <p className="text-[10px] text-slate-400 mt-1">
                          Splits multi-tax rate invoices into separate voucher lines (e.g. 372076 → 372076, 372076A) for seamless Tally Prime import.
                        </p>
                      </div>

                      <div
                        onClick={() => setExportFormat("excel")}
                        className={`cursor-pointer p-4 rounded-xl border transition-all ${
                          exportFormat === "excel"
                            ? "bg-indigo-600/10 border-indigo-500 text-indigo-300"
                            : "bg-slate-950 border-slate-800 text-slate-400 hover:border-slate-700"
                        }`}
                      >
                        <FileText className="w-6 h-6 mb-2 text-emerald-400" />
                        <h4 className="font-bold text-xs text-slate-200">Standard Flat Excel</h4>
                        <p className="text-[10px] text-slate-400 mt-1">
                          Consolidated flat spreadsheet listing all invoice items with complete tax breakdown columns.
                        </p>
                      </div>

                      <div
                        onClick={() => setExportFormat("csv")}
                        className={`cursor-pointer p-4 rounded-xl border transition-all ${
                          exportFormat === "csv"
                            ? "bg-indigo-600/10 border-indigo-500 text-indigo-300"
                            : "bg-slate-950 border-slate-800 text-slate-400 hover:border-slate-700"
                        }`}
                      >
                        <Download className="w-6 h-6 mb-2 text-blue-400" />
                        <h4 className="font-bold text-xs text-slate-200">CSV Raw Stream</h4>
                        <p className="text-[10px] text-slate-400 mt-1">
                          Ultra-fast plaintext CSV output for downstream data processing, Python pipelines, or custom ERP integration.
                        </p>
                      </div>

                      <div
                        onClick={() => setExportFormat("einvoice_json")}
                        className={`cursor-pointer p-4 rounded-xl border transition-all ${
                          exportFormat === "einvoice_json"
                            ? "bg-indigo-600/10 border-indigo-500 text-indigo-300"
                            : "bg-slate-950 border-slate-800 text-slate-400 hover:border-slate-700"
                        }`}
                      >
                        <FileJson className="w-6 h-6 mb-2 text-amber-400" />
                        <h4 className="font-bold text-xs text-slate-200">E-Invoice JSON (Credit Notes)</h4>
                        <p className="text-[10px] text-slate-400 mt-1">
                          Generates hierarchical JSON upload files matching the GST portal standard v1.1 schema specifically for Credit Notes.
                        </p>
                      </div>
                    </div>

                    <div className="pt-4 border-t border-slate-800 flex items-center justify-between">
                      <div className="text-xs text-slate-400">
                        <span>Range: </span>
                        <span className="font-semibold text-slate-200">
                          {reportDateFrom || "All Dates"} to {reportDateTo || "Latest"}
                        </span>
                      </div>
                      <button
                        onClick={handleExport}
                        disabled={isExporting}
                        className="bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white font-semibold text-xs px-6 py-2.5 rounded-lg transition-colors flex items-center gap-2"
                      >
                        {isExporting ? (
                          <>
                            <RefreshCw className="w-4 h-4 animate-spin" />
                            Compiling File...
                          </>
                        ) : (
                          <>
                            <Download className="w-4 h-4" />
                            Generate & Save Export File
                          </>
                        )}
                      </button>
                    </div>

                    {/* Export Result Notification */}
                    {exportResult && (
                      <div className="bg-emerald-950/20 border border-emerald-900/60 rounded-xl p-4 flex gap-4 text-emerald-200 text-xs">
                        <CheckCircle className="w-5 h-5 flex-shrink-0 text-emerald-400 mt-0.5" />
                        <div>
                          <h4 className="font-bold text-slate-200">{exportResult.format} Generation Complete</h4>
                          <p className="text-slate-400 mt-0.5">{exportResult.message}</p>
                          <p className="font-mono text-[10px] text-emerald-400 mt-1">Saved to: {exportResult.output_path}</p>
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Rules & Export Help Card */}
                  <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 space-y-4">
                    <h4 className="text-xs font-bold text-indigo-400 uppercase tracking-wider">Tally Rate-Split Export Rules</h4>
                    <div className="space-y-3 text-xs text-slate-400 leading-relaxed">
                      <div className="bg-slate-950 p-3 rounded-lg border border-slate-800">
                        <p className="font-semibold text-slate-300 mb-1">Rule 1: Invoice Number Preservation</p>
                        <p className="text-[11px]">The primary GST rate item group preserves the exact invoice number exported from your ERP system.</p>
                      </div>
                      <div className="bg-slate-950 p-3 rounded-lg border border-slate-800">
                        <p className="font-semibold text-slate-300 mb-1">Rule 2: Alphabetical Suffix Allocation</p>
                        <p className="text-[11px]">Subsequent rate groups append uppercase alphabetical labels (A, B, C...) to ensure voucher line integrity in Tally Prime.</p>
                      </div>
                      <div className="bg-slate-950 p-3 rounded-lg border border-slate-800">
                        <p className="font-semibold text-slate-300 mb-1">Rule 3: Cancelled Invoice Shield</p>
                        <p className="text-[11px]">Invoices flagged as Draft or Cancelled are automatically excluded from Tally exports.</p>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* Sub-Tab 2: Monthly Sales Performance */}
              {reportSubTab === "monthly" && (
                <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 space-y-6">
                  <div className="flex items-center justify-between border-b border-slate-800 pb-4">
                    <h3 className="text-sm font-bold text-slate-200 uppercase tracking-wider text-indigo-400">
                      Monthly Outward Sales Register Summary
                    </h3>
                    <button
                      onClick={loadMonthlySales}
                      className="text-xs text-indigo-400 hover:text-indigo-300 font-semibold flex items-center gap-1"
                    >
                      <RefreshCw className="w-3.5 h-3.5" /> Refresh Data
                    </button>
                  </div>

                  {loadingReports ? (
                    <div className="p-8 text-center text-slate-400 text-xs flex justify-center items-center gap-2">
                      <RefreshCw className="w-4 h-4 animate-spin text-indigo-400" />
                      Loading monthly aggregates...
                    </div>
                  ) : (
                    <div className="bg-slate-950 border border-slate-800 rounded-lg overflow-hidden text-xs">
                      <table className="w-full text-left border-collapse">
                        <thead>
                          <tr className="bg-slate-900 text-slate-400 font-semibold border-b border-slate-800">
                            <th className="p-3">Month</th>
                            <th className="p-3 text-right">Invoice Count</th>
                            <th className="p-3 text-right">Taxable Value (₹)</th>
                            <th className="p-3 text-right">CGST (₹)</th>
                            <th className="p-3 text-right">SGST (₹)</th>
                            <th className="p-3 text-right">IGST (₹)</th>
                            <th className="p-3 text-right">Gross Total (₹)</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-800/60">
                          {monthlySales.map((row, idx) => (
                            <tr key={idx} className="hover:bg-slate-900/30 text-slate-300">
                              <td className="p-3 font-semibold text-slate-200 font-mono">{row.month_label}</td>
                              <td className="p-3 text-right font-mono text-slate-400">{row.invoice_count}</td>
                              <td className="p-3 text-right font-mono">₹{row.total_taxable.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td>
                              <td className="p-3 text-right font-mono text-emerald-400/90">₹{row.total_cgst.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td>
                              <td className="p-3 text-right font-mono text-emerald-400/90">₹{row.total_sgst.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td>
                              <td className="p-3 text-right font-mono text-blue-400/90">₹{row.total_igst.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td>
                              <td className="p-3 text-right font-mono font-bold text-indigo-400">₹{row.total_value.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              )}

              {/* Sub-Tab 3: GST Rate Breakdown */}
              {reportSubTab === "gst" && (
                <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 space-y-6">
                  <h3 className="text-sm font-bold text-slate-200 uppercase tracking-wider text-indigo-400 border-b border-slate-800 pb-4">
                    GST Tax Liability Breakdown by Rate Tier
                  </h3>

                  <div className="bg-slate-950 border border-slate-800 rounded-lg overflow-hidden text-xs">
                    <table className="w-full text-left border-collapse">
                      <thead>
                        <tr className="bg-slate-900 text-slate-400 font-semibold border-b border-slate-800">
                          <th className="p-3">GST Rate Tier</th>
                          <th className="p-3 text-right">Invoices</th>
                          <th className="p-3 text-right">Assessable Value (₹)</th>
                          <th className="p-3 text-right">CGST (₹)</th>
                          <th className="p-3 text-right">SGST (₹)</th>
                          <th className="p-3 text-right">IGST (₹)</th>
                          <th className="p-3 text-right">Total Tax (₹)</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-800/60">
                        {gstRateSummary.length === 0 ? (
                          <tr>
                            <td colSpan={7} className="p-6 text-center text-slate-500">
                              No GST data found for date range filter. Select dates above and click Filter.
                            </td>
                          </tr>
                        ) : (
                          gstRateSummary.map((row, idx) => (
                            <tr key={idx} className="hover:bg-slate-900/30 text-slate-300">
                              <td className="p-3 font-semibold text-slate-200 flex items-center gap-2">
                                <span className="w-2 h-2 rounded-full bg-indigo-500"></span>
                                {row.gst_rate}% GST Tier
                              </td>
                              <td className="p-3 text-right font-mono text-slate-400">{row.invoice_count}</td>
                              <td className="p-3 text-right font-mono">₹{row.taxable_amount.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td>
                              <td className="p-3 text-right font-mono text-emerald-400/90">₹{row.cgst_amount.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td>
                              <td className="p-3 text-right font-mono text-emerald-400/90">₹{row.sgst_amount.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td>
                              <td className="p-3 text-right font-mono text-blue-400/90">₹{row.igst_amount.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td>
                              <td className="p-3 text-right font-mono font-bold text-indigo-400">₹{row.total_tax.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td>
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* Sub-Tab 4: Top Customers */}
              {reportSubTab === "customers" && (
                <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 space-y-6">
                  <h3 className="text-sm font-bold text-slate-200 uppercase tracking-wider text-indigo-400 border-b border-slate-800 pb-4">
                    Top 10 Customers Revenue Ranking
                  </h3>

                  <div className="bg-slate-950 border border-slate-800 rounded-lg overflow-hidden text-xs">
                    <table className="w-full text-left border-collapse">
                      <thead>
                        <tr className="bg-slate-900 text-slate-400 font-semibold border-b border-slate-800">
                          <th className="p-3 w-16 text-center">Rank</th>
                          <th className="p-3">Customer Code</th>
                          <th className="p-3">Customer Name</th>
                          <th className="p-3 text-right">Invoices Billed</th>
                          <th className="p-3 text-right">Total Revenue (₹)</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-800/60">
                        {topCustomers.length === 0 ? (
                          <tr>
                            <td colSpan={5} className="p-6 text-center text-slate-500">
                              No customer revenue data for selected date range filter.
                            </td>
                          </tr>
                        ) : (
                          topCustomers.map((row) => (
                            <tr key={row.rank} className="hover:bg-slate-900/30 text-slate-300">
                              <td className="p-3 text-center font-bold text-indigo-400">#{row.rank}</td>
                              <td className="p-3 font-mono font-semibold text-slate-200">{row.code}</td>
                              <td className="p-3 text-slate-200 font-medium">{row.name}</td>
                              <td className="p-3 text-right font-mono text-slate-400">{row.invoice_count}</td>
                              <td className="p-3 text-right font-mono font-bold text-emerald-400">
                                ₹{row.total_value.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                              </td>
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* Sub-Tab 5: Top Part Numbers */}
              {reportSubTab === "items" && (
                <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 space-y-6">
                  <h3 className="text-sm font-bold text-slate-200 uppercase tracking-wider text-indigo-400 border-b border-slate-800 pb-4">
                    Top Part Numbers Sales Matrix
                  </h3>

                  <div className="bg-slate-950 border border-slate-800 rounded-lg overflow-hidden text-xs">
                    <table className="w-full text-left border-collapse">
                      <thead>
                        <tr className="bg-slate-900 text-slate-400 font-semibold border-b border-slate-800">
                          <th className="p-3 w-16 text-center">Rank</th>
                          <th className="p-3">Part Code</th>
                          <th className="p-3">Part Description</th>
                          <th className="p-3 text-right">Quantity Sold</th>
                          <th className="p-3 text-right">Invoices</th>
                          <th className="p-3 text-right">Total Revenue (₹)</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-800/60">
                        {topItems.length === 0 ? (
                          <tr>
                            <td colSpan={6} className="p-6 text-center text-slate-500">
                              No part sales data for selected date range filter.
                            </td>
                          </tr>
                        ) : (
                          topItems.map((row) => (
                            <tr key={row.rank} className="hover:bg-slate-900/30 text-slate-300">
                              <td className="p-3 text-center font-bold text-indigo-400">#{row.rank}</td>
                              <td className="p-3 font-mono font-semibold text-slate-200">{row.code}</td>
                              <td className="p-3 text-slate-200 font-medium">{row.name}</td>
                              <td className="p-3 text-right font-mono text-slate-400">{row.total_qty.toLocaleString()}</td>
                              <td className="p-3 text-right font-mono text-slate-400">{row.invoice_count}</td>
                              <td className="p-3 text-right font-mono font-bold text-emerald-400">
                                ₹{row.total_value.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                              </td>
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          )}

          {activeTab === "settings" && (
            <div className="space-y-8 max-w-3xl">
              {/* Profile setup card */}
              <div className="bg-slate-900 border border-slate-800 rounded-xl p-6">
                <h3 className="text-sm font-bold text-slate-200 mb-6 uppercase tracking-wider text-indigo-400">Database Connection Switcher</h3>

                <div className="space-y-4 mb-6">
                  <div>
                    <label className="block text-xs font-semibold text-slate-400 mb-2">Company Code Profile</label>
                    <input
                      type="text"
                      value={companyCode}
                      onChange={(e) => setCompanyCode(e.target.value.trim().toUpperCase())}
                      disabled={isConnected}
                      className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2.5 text-xs text-slate-200 focus:outline-none focus:border-indigo-500 disabled:opacity-50"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-400 mb-2">SQLCipher Encryption Password</label>
                    <input
                      type="password"
                      value={encryptionKey}
                      onChange={(e) => setEncryptionKey(e.target.value)}
                      disabled={isConnected}
                      className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2.5 text-xs text-slate-200 focus:outline-none focus:border-indigo-500 disabled:opacity-50"
                    />
                  </div>
                </div>

                <div className="flex justify-end pt-4 border-t border-slate-800">
                  {isConnected ? (
                    <button
                      onClick={handleDisconnect}
                      className="bg-rose-600 hover:bg-rose-500 text-white font-semibold text-xs px-5 py-2.5 rounded-lg transition-colors flex items-center gap-1.5"
                    >
                      Disconnect Profile Connection
                    </button>
                  ) : (
                    <button
                      onClick={handleConnect}
                      className="bg-indigo-600 hover:bg-indigo-500 text-white font-semibold text-xs px-5 py-2.5 rounded-lg transition-colors"
                    >
                      Connect & Authenticate Profile
                    </button>
                  )}
                </div>
              </div>

              <CompanyProfileForm />

              {/* Tally Register Code Card */}
              <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 space-y-4">
                <div>
                  <h3 className="text-sm font-bold text-slate-100 font-mono tracking-wide">tally_register_code</h3>
                  <p className="text-xs text-slate-400 mt-1">
                    Register code (RE) written on every generated Tally row — meaning unconfirmed upstream, kept as a constant
                  </p>
                </div>

                <div className="flex items-center gap-3 pt-2">
                  <input
                    type="text"
                    value={tallyRegisterCode}
                    onChange={(e) => setTallyRegisterCode(e.target.value.toUpperCase())}
                    placeholder="TF"
                    className="w-48 bg-slate-950 border border-slate-800 rounded-lg p-2.5 text-sm font-mono text-slate-100 focus:outline-none focus:border-indigo-500 font-bold"
                  />
                  <button
                    onClick={handleSaveTallyRegisterCode}
                    disabled={isSavingRegisterCode}
                    className="bg-slate-800 hover:bg-slate-700 disabled:opacity-50 text-slate-200 font-semibold text-xs px-5 py-2.5 rounded-lg transition-colors border border-slate-700 flex items-center gap-1.5"
                  >
                    {isSavingRegisterCode ? "Saving..." : "Save"}
                  </button>
                </div>
              </div>

              {/* Maintenance Card */}
              <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 space-y-6">
                <div className="flex items-center justify-between border-b border-slate-800 pb-4">
                  <div>
                    <h3 className="text-sm font-bold text-slate-200 uppercase tracking-wider text-indigo-400">Database File Maintenance</h3>
                    <p className="text-xs text-slate-400 mt-1">Run SQLite integrity verification checks and storage defragmentation (VACUUM & ANALYZE).</p>
                  </div>
                  <ShieldCheck className="w-5 h-5 text-indigo-400" />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="bg-slate-950 p-4 rounded-xl border border-slate-800 space-y-3">
                    <h4 className="text-xs font-bold text-slate-200 flex items-center gap-2">
                      <CheckCircle className="w-4 h-4 text-emerald-400" /> Integrity Verification
                    </h4>
                    <p className="text-[11px] text-slate-400 leading-relaxed">
                      Scans B-Tree structures, index pages, and foreign keys using PRAGMA integrity_check to ensure file consistency.
                    </p>
                    <button
                      onClick={handleCheckIntegrity}
                      disabled={isCheckingIntegrity}
                      className="w-full bg-slate-800 hover:bg-slate-700 disabled:opacity-50 text-slate-200 text-xs font-semibold py-2 rounded-lg transition-colors flex items-center justify-center gap-2"
                    >
                      {isCheckingIntegrity ? (
                        <>
                          <RefreshCw className="w-3.5 h-3.5 animate-spin" /> Verifying File...
                        </>
                      ) : (
                        "Run PRAGMA Integrity Check"
                      )}
                    </button>
                  </div>

                  <div className="bg-slate-950 p-4 rounded-xl border border-slate-800 space-y-3">
                    <h4 className="text-xs font-bold text-slate-200 flex items-center gap-2">
                      <RefreshCw className="w-4 h-4 text-indigo-400" /> Storage Defragmentation
                    </h4>
                    <p className="text-[11px] text-slate-400 leading-relaxed">
                      Executes VACUUM to reclaim deleted invoice storage space and updates query optimization statistics via ANALYZE.
                    </p>
                    <button
                      onClick={handleVacuumDb}
                      disabled={isVacuuming}
                      className="w-full bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-xs font-semibold py-2 rounded-lg transition-colors flex items-center justify-center gap-2"
                    >
                      {isVacuuming ? (
                        <>
                          <RefreshCw className="w-3.5 h-3.5 animate-spin" /> Optimizing DB...
                        </>
                      ) : (
                        "Execute VACUUM & ANALYZE"
                      )}
                    </button>
                  </div>
                </div>

                {maintenanceResult && (
                  <div className={`p-4 rounded-xl border text-xs ${
                    maintenanceResult.status === "HEALTHY" || maintenanceResult.status === "OPTIMIZED"
                      ? "bg-emerald-950/20 border-emerald-900/60 text-emerald-200"
                      : "bg-rose-950/20 border-rose-900/60 text-rose-200"
                  }`}>
                    <div className="flex items-center justify-between font-bold text-slate-200">
                      <span>{maintenanceResult.routine} [{maintenanceResult.status}]</span>
                      <span className="font-mono text-[10px] text-slate-400">{maintenanceResult.duration_ms?.toString()} ms</span>
                    </div>
                    <p className="text-slate-400 mt-1">{maintenanceResult.details}</p>
                  </div>
                )}
              </div>

              {/* Backup & Recovery Card */}
              <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 space-y-6">
                <div className="flex items-center justify-between border-b border-slate-800 pb-4">
                  <div>
                    <h3 className="text-sm font-bold text-slate-200 uppercase tracking-wider text-indigo-400">Database Backup & Recovery Manager</h3>
                    <p className="text-xs text-slate-400 mt-1">Export encrypted database backups with metadata headers for disaster recovery.</p>
                  </div>
                  <Download className="w-5 h-5 text-indigo-400" />
                </div>

                {backupStatus && backupStatus.is_backup_due && (
                  <div className="bg-amber-950/20 border border-amber-900/60 rounded-xl p-4 flex gap-4 text-amber-200 text-xs">
                    <AlertTriangle className="w-5 h-5 flex-shrink-0 text-amber-400 mt-0.5" />
                    <div>
                      <h4 className="font-bold text-slate-200">Backup Recommended</h4>
                      <p className="text-slate-400 mt-0.5">
                        It has been {backupStatus.days_since_backup} days since your last recorded backup. Create a backup to protect your sales records.
                      </p>
                    </div>
                  </div>
                )}

                <div className="bg-slate-950 p-4 rounded-xl border border-slate-800 flex items-center justify-between">
                  <div className="text-xs text-slate-400">
                    <p className="font-semibold text-slate-200">Active Profile: {companyCode}</p>
                    <p className="text-[11px] mt-0.5">
                      Last Backup: {backupStatus?.last_backup_at ? new Date(backupStatus.last_backup_at).toLocaleString() : "Never recorded"}
                    </p>
                  </div>

                  <button
                    onClick={handleCreateBackup}
                    disabled={isBackingUp}
                    className="bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white font-semibold text-xs px-5 py-2.5 rounded-lg transition-colors flex items-center gap-2"
                  >
                    {isBackingUp ? (
                      <>
                        <RefreshCw className="w-4 h-4 animate-spin" /> Compiling Backup...
                      </>
                    ) : (
                      <>
                        <Download className="w-4 h-4" /> Create Instant Backup
                      </>
                    )}
                  </button>
                </div>
              </div>

              {/* Updater configuration setting card */}
              <UpdateCard />
            </div>
          )}
        </div>

        {/* Invoice Details Drawer Inspector */}
        {isDetailOpen && (
          <div className="absolute inset-0 bg-slate-950/80 backdrop-blur-sm z-50 flex justify-end transition-all duration-300">
            <div className="w-full max-w-3xl bg-slate-900 border-l border-slate-850 h-full flex flex-col shadow-2xl overflow-y-auto">
              {loadingDetails ? (
                <div className="flex-1 flex flex-col items-center justify-center text-slate-400">
                  <RefreshCw className="w-8 h-8 animate-spin text-indigo-400 mb-3" />
                  <span>Loading invoice record and lines...</span>
                </div>
              ) : selectedInvoice ? (
                <div className="flex-1 flex flex-col justify-between">
                  <div className="p-6 border-b border-slate-800 flex items-center justify-between bg-slate-950/20">
                    <div className="flex items-center gap-3">
                      <div className="p-2 bg-indigo-500/10 text-indigo-400 rounded-lg">
                        <FileText className="w-5 h-5" />
                      </div>
                      <div>
                        <span className="text-[10px] text-slate-500 font-bold uppercase tracking-wider">Invoice Details</span>
                        <h3 className="text-base font-bold text-slate-200 font-mono">No. {selectedInvoice.invoice_number}</h3>
                      </div>
                    </div>
                    <button
                      onClick={() => setIsDetailOpen(false)}
                      className="p-1.5 hover:bg-slate-800 text-slate-400 hover:text-slate-200 rounded-lg transition-colors text-xs font-semibold"
                    >
                      Close Inspector
                    </button>
                  </div>

                  <div className="p-6 flex-1 space-y-6">
                    <div className="grid grid-cols-3 gap-6 bg-slate-950/30 p-4 rounded-xl border border-slate-800">
                      <div>
                        <span className="text-[10px] text-slate-500 font-semibold block">Invoice Date</span>
                        <span className="text-xs text-slate-300 mt-1 inline-flex items-center gap-1">
                          <Calendar className="w-3.5 h-3.5 text-slate-400" /> {selectedInvoice.invoice_date}
                        </span>
                      </div>
                      <div>
                        <span className="text-[10px] text-slate-500 font-semibold block">Supply Destination</span>
                        <span className="text-xs text-slate-300 mt-1 block truncate">
                          {selectedInvoice.place_of_supply || "Not Specified"}
                        </span>
                      </div>
                      <div>
                        <span className="text-[10px] text-slate-500 font-semibold block">Active Status</span>
                        <span
                          className={`mt-1 inline-block px-2 py-0.5 rounded-full text-[9px] font-bold uppercase ${
                            selectedInvoice.status === "Verified"
                              ? "bg-emerald-500/10 text-emerald-400"
                              : selectedInvoice.status === "Cancelled"
                              ? "bg-rose-500/10 text-rose-400"
                              : "bg-indigo-500/10 text-indigo-400"
                          }`}
                        >
                          {selectedInvoice.status}
                        </span>
                      </div>
                    </div>

                    <div className="grid grid-cols-4 gap-4 bg-slate-950/10 p-4 rounded-xl border border-slate-800/80">
                      <div>
                        <span className="text-[10px] text-slate-500 block">Taxable Total</span>
                        <span className="text-sm font-bold text-slate-200 font-mono">
                          ₹{selectedInvoice.total_taxable.toLocaleString("en-IN", { minimumFractionDigits: 2 })}
                        </span>
                      </div>
                      <div>
                        <span className="text-[10px] text-slate-500 block">CGST Total</span>
                        <span className="text-sm font-mono text-slate-400">
                          ₹{selectedInvoice.total_cgst.toLocaleString("en-IN", { minimumFractionDigits: 2 })}
                        </span>
                      </div>
                      <div>
                        <span className="text-[10px] text-slate-500 block">SGST Total</span>
                        <span className="text-sm font-mono text-slate-400">
                          ₹{selectedInvoice.total_sgst.toLocaleString("en-IN", { minimumFractionDigits: 2 })}
                        </span>
                      </div>
                      <div>
                        <span className="text-[10px] text-slate-500 block">Total Value</span>
                        <span className="text-sm font-bold text-indigo-400 font-mono">
                          ₹{selectedInvoice.total_value.toLocaleString("en-IN", { minimumFractionDigits: 2 })}
                        </span>
                      </div>
                    </div>

                    <div className="space-y-2">
                      <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wider">Invoice Line Items</h4>
                      <div className="border border-slate-800 rounded-lg overflow-hidden bg-slate-950/20 text-xs">
                        <table className="w-full text-left border-collapse">
                          <thead>
                            <tr className="bg-slate-950 text-slate-400 font-bold border-b border-slate-800">
                              <th className="p-3">Part Details</th>
                              <th className="p-3 text-right">Qty</th>
                              <th className="p-3 text-right">Rate</th>
                              <th className="p-3 text-right">Taxable</th>
                              <th className="p-3 text-right">Gross</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-800/60">
                            {selectedInvoiceItems.map((item, idx) => (
                              <tr key={idx} className="hover:bg-slate-800/10">
                                <td className="p-3">
                                  <div className="font-semibold text-slate-200">{item.part_code}</div>
                                </td>
                                <td className="p-3 text-right font-mono text-slate-300">{item.quantity}</td>
                                <td className="p-3 text-right font-mono text-slate-400">₹{item.rate_pre_unit.toFixed(2)}</td>
                                <td className="p-3 text-right font-mono text-slate-300">₹{item.assessable_value.toFixed(2)}</td>
                                <td className="p-3 text-right font-mono font-bold text-slate-100">₹{item.total_value.toFixed(2)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>

                    <div className="space-y-2">
                      <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
                        <Clock className="w-4 h-4 text-indigo-400" /> Audit Log History
                      </h4>
                      {selectedInvoiceAuditLogs.length === 0 ? (
                        <p className="text-[10px] text-slate-500 italic bg-slate-950/20 p-3 rounded-lg border border-slate-800/40">
                          No modification logs found for this invoice.
                        </p>
                      ) : (
                        <div className="border border-slate-800 rounded-lg overflow-hidden bg-slate-950/20 text-[10px]">
                          <table className="w-full text-left border-collapse">
                            <thead>
                              <tr className="bg-slate-950 text-slate-400 font-bold border-b border-slate-800">
                                <th className="p-3">Timestamp</th>
                                <th className="p-3">User Action</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-800/60">
                              {selectedInvoiceAuditLogs.map((log, idx) => (
                                <tr key={idx} className="hover:bg-slate-800/10 text-slate-300">
                                  <td className="p-3 text-slate-500 font-mono">{log.timestamp}</td>
                                  <td className="p-3 font-medium">{log.user_action}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="p-6 border-t border-slate-800 bg-slate-950/20 flex justify-between gap-4">
                    <button
                      onClick={handleDeleteRecord}
                      className="bg-rose-950/20 text-rose-400 border border-rose-900/40 hover:bg-rose-900/10 font-semibold text-xs px-4 py-2 rounded-lg flex items-center gap-1.5"
                    >
                      <Trash2 className="w-4 h-4" /> Delete Record
                    </button>

                    <div className="flex gap-2">
                      {selectedInvoice.status === "Cancelled" && (
                        <button
                          onClick={handleAutoGenerateCreditNote}
                          className="bg-indigo-600 hover:bg-indigo-500 text-white font-semibold text-xs px-4 py-2 rounded-lg flex items-center gap-1.5"
                        >
                          <PlusCircle className="w-4 h-4" /> Auto-generate Credit Note
                        </button>
                      )}
                      {selectedInvoice.status !== "Cancelled" && selectedInvoice.status !== "Credit Note Generated" && (
                        <button
                          onClick={() => handleUpdateStatus("Cancelled")}
                          className="bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 font-semibold text-xs px-4 py-2 rounded-lg"
                        >
                          Cancel Invoice
                        </button>
                      )}
                      {selectedInvoice.status !== "Verified" && selectedInvoice.status !== "Credit Note Generated" && (
                        <button
                          onClick={() => handleUpdateStatus("Verified")}
                          className="bg-indigo-600 hover:bg-indigo-500 text-white font-semibold text-xs px-5 py-2 rounded-lg flex items-center gap-1.5"
                        >
                          <CheckCircle className="w-4 h-4" /> Mark Verified
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              ) : null}
            </div>
          </div>
        )}

        {/* Record New Revision Dialog Modal */}
        {isRevisionModalOpen && (
          <div className="absolute inset-0 bg-slate-950/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
            <div className="w-full max-w-lg bg-slate-900 border border-slate-800 rounded-xl p-6 shadow-2xl relative">
              <h3 className="text-sm font-bold text-slate-200 uppercase tracking-wider text-indigo-400 mb-6">
                Record Supplier Price Revision
              </h3>

              <form onSubmit={handleCreateRevision} className="space-y-4 text-xs">
                <div>
                  <label className="block text-slate-400 mb-1.5 font-semibold">Select Supplier</label>
                  <select
                    required
                    value={revSupplierId}
                    onChange={(e) => setRevSupplierId(Number(e.target.value))}
                    className="w-full bg-slate-950 border border-slate-800 rounded p-2.5 text-slate-200 focus:outline-none focus:border-indigo-500"
                  >
                    <option value="">-- Choose Supplier --</option>
                    {suppliers.map((s) => (
                      <option key={s.id?.toString()} value={s.id?.toString()}>
                        {s.supplier_name} ({s.supplier_code})
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-slate-400 mb-1.5 font-semibold">Part / Item Code</label>
                  <input
                    required
                    type="text"
                    placeholder="e.g. 8708.99.00"
                    value={revPartCode}
                    onChange={(e) => setRevPartCode(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-800 rounded p-2.5 text-slate-200 focus:outline-none focus:border-indigo-500"
                  />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-slate-400 mb-1.5 font-semibold">Old Rate (₹)</label>
                    <input
                      required
                      type="number"
                      step="0.01"
                      placeholder="0.00"
                      value={revOldPrice}
                      onChange={(e) => setRevOldPrice(e.target.value === "" ? "" : Number(e.target.value))}
                      className="w-full bg-slate-950 border border-slate-800 rounded p-2.5 text-slate-200 focus:outline-none focus:border-indigo-500"
                    />
                  </div>

                  <div>
                    <label className="block text-slate-400 mb-1.5 font-semibold">New Rate (₹)</label>
                    <input
                      required
                      type="number"
                      step="0.01"
                      placeholder="0.00"
                      value={revNewPrice}
                      onChange={(e) => setRevNewPrice(e.target.value === "" ? "" : Number(e.target.value))}
                      className="w-full bg-slate-950 border border-slate-800 rounded p-2.5 text-slate-200 focus:outline-none focus:border-indigo-500"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-slate-400 mb-1.5 font-semibold">Effective Date</label>
                  <input
                    required
                    type="date"
                    value={revEffectiveDate}
                    onChange={(e) => setRevEffectiveDate(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-800 rounded p-2.5 text-slate-200 focus:outline-none focus:border-indigo-500"
                  />
                </div>

                <div>
                  <label className="block text-slate-400 mb-1.5 font-semibold">Remarks</label>
                  <input
                    type="text"
                    placeholder="Enter revision reason..."
                    value={revRemarks}
                    onChange={(e) => setRevRemarks(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-800 rounded p-2.5 text-slate-200 focus:outline-none focus:border-indigo-500"
                  />
                </div>

                <div className="flex justify-end gap-3 pt-4 border-t border-slate-800">
                  <button
                    type="button"
                    onClick={() => setIsRevisionModalOpen(false)}
                    className="bg-slate-800 hover:bg-slate-700 text-slate-300 px-4 py-2.5 rounded font-semibold transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="bg-indigo-600 hover:bg-indigo-500 text-white px-4 py-2.5 rounded font-semibold transition-colors"
                  >
                    Save Revision
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}
      </main>

      {/* Global Updater Prompts & About Popovers */}
      <UpdateDialog />
      <AboutDialog isOpen={isAboutOpen} onClose={() => setIsAboutOpen(false)} />
    </div>
  );
}

export default App;
