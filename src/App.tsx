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
  Info,
  RotateCcw,
  LayoutGrid,
  Edit2,
  Printer,
  X,
  PanelLeftClose,
  PanelLeftOpen,
  Maximize2
} from "lucide-react";
import { ApiService } from "./services/api";
import { CustomerDebitNotesTab } from "./components/CustomerDebitNotes/CustomerDebitNotesTab";
import { ImportPreview } from "./types/bindings/ImportPreview";

import { ImportTemplateRow } from "./types/bindings/ImportTemplateRow";
import { InvoiceSummary } from "./types/bindings/InvoiceSummary";
import { InvoiceRow } from "./types/bindings/InvoiceRow";
import { OutwardRegisterTable } from "./components/OutwardRegisters/OutwardRegisterTable";
import { InvoiceEditModal } from "./components/OutwardRegisters/components/InvoiceEditModal";
import { InvoiceItemRow } from "./types/bindings/InvoiceItemRow";
import { AuditLogRow } from "./types/bindings/AuditLogRow";
import { SupplierPriceRevisionRow } from "./types/bindings/SupplierPriceRevisionRow";
import { DebitNoteRow } from "./types/bindings/DebitNoteRow";
import { DebitNoteItemRow } from "./types/bindings/DebitNoteItemRow";
import { CreditNoteHeader } from "./types/bindings/CreditNoteHeader";
import { CreditNoteDetails } from "./types/bindings/CreditNoteDetails";
import { CreditNotePrintView } from "./components/CustomerCreditNotes/CreditNotePrintView";
import { CreditNoteEditModal } from "./components/CustomerCreditNotes/CreditNoteEditModal";
import { CreditNoteDeleteConfirmModal } from "./components/CustomerCreditNotes/CreditNoteDeleteConfirmModal";
import { SupplierRow } from "./types/bindings/SupplierRow";
import { MonthlySalesRow } from "./types/bindings/MonthlySalesRow";
import { GstRateSummaryRow } from "./types/bindings/GstRateSummaryRow";
import { RankingRow } from "./types/bindings/RankingRow";
import { ExportResult } from "./types/bindings/ExportResult";

import { useUpdaterScheduler } from "./hooks/useUpdater";
import { UpdateCard } from "./components/updater/UpdateCard";
import { UpdateDialog } from "./components/updater/UpdateDialog";
import { AboutDialog } from "./components/updater/AboutDialog";
import { ThemeToggle } from "./components/ThemeToggle";
import DraggableCard, { CardLayoutConfig } from "./components/DraggableCard";

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

  // Sidebar visibility state persisted in localStorage
  const [isSidebarOpen, setIsSidebarOpen] = useState<boolean>(() => {
    const saved = localStorage.getItem("sidebar_open");
    return saved !== null ? JSON.parse(saved) : true;
  });

  useEffect(() => {
    localStorage.setItem("sidebar_open", JSON.stringify(isSidebarOpen));
  }, [isSidebarOpen]);

  // Keyboard shortcut Ctrl+B / Cmd+B to toggle sidebar hide/unhide
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "b") {
        e.preventDefault();
        setIsSidebarOpen((prev) => !prev);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  // Navigation & Core States
  const [activeTab, setActiveTab] = useState<"dashboard" | "import" | "registers" | "customer_matching" | "cust_debit_notes" | "revisions" | "notes" | "reports" | "settings">("dashboard");

  const [companyCode, setCompanyCode] = useState<string>(() => {
    return localStorage.getItem("active_company_code") || "DEMO";
  });
  const [encryptionKey, setEncryptionKey] = useState<string>(() => {
    return localStorage.getItem("active_encryption_key") || "demo1234";
  });
  const [isConnected, setIsConnected] = useState(false);
  const [isConnecting, setIsConnecting] = useState(true);
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

  // Invoice Details Drawer States
  const [selectedInvoice, setSelectedInvoice] = useState<InvoiceRow | null>(null);
  const [selectedInvoiceItems, setSelectedInvoiceItems] = useState<InvoiceItemRow[]>([]);
  const [selectedInvoiceAuditLogs, setSelectedInvoiceAuditLogs] = useState<AuditLogRow[]>([]);
  const [isDetailOpen, setIsDetailOpen] = useState(false);
  const [inspectWindowSize, setInspectWindowSize] = useState<"1x" | "2x" | "full">("2x");
  const [loadingDetails, setLoadingDetails] = useState(false);
  const [editingInvoiceNumber, setEditingInvoiceNumber] = useState<string | null>(null);

  const handleStartEditInspector = async (invNo: string) => {
    try {
      await ApiService.validateInvoiceEditEligibility(invNo);
      setIsDetailOpen(false);
      setEditingInvoiceNumber(invNo);
    } catch (err: any) {
      alert(`Cannot edit invoice: ${err.message || err}`);
    }
  };

  const handleSavedEditInspector = async () => {
    setEditingInvoiceNumber(null);
    await loadInvoices();
  };

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
  const [creditNotes, setCreditNotes] = useState<CreditNoteHeader[]>([]);
  const [loadingNotes, setLoadingNotes] = useState(false);
  const [selectedCreditNoteNo, setSelectedCreditNoteNo] = useState<string | null>(null);
  const [showEditCreditNoteModal, setShowEditCreditNoteModal] = useState(false);
  const [showDeleteCreditNoteModal, setShowDeleteCreditNoteModal] = useState(false);
  const [showPrintCreditNoteModal, setShowPrintCreditNoteModal] = useState(false);
  const [showViewCreditNoteModal, setShowViewCreditNoteModal] = useState(false);
  const [currentCreditNoteDetails, setCurrentCreditNoteDetails] = useState<CreditNoteDetails | null>(null);
  const [includeDeletedCreditNotes, setIncludeDeletedCreditNotes] = useState(false);

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

  // Settings layout persistence & drag state
  const SETTINGS_STORAGE_KEY = "ember-settings-layout";
  const DEFAULT_SETTINGS_LAYOUT: CardLayoutConfig[] = [
    { id: "company_profile", colSpan: 3 },
    { id: "db_switcher", colSpan: 1 },
    { id: "tally_code", colSpan: 1 },
    { id: "db_maintenance", colSpan: 1 },
    { id: "backup_manager", colSpan: 1 },
    { id: "app_updater", colSpan: 1 },
  ];

  const [settingsLayout, setSettingsLayout] = useState<CardLayoutConfig[]>(() => {
    try {
      const saved = localStorage.getItem(SETTINGS_STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length > 0) return parsed;
      }
    } catch (e) {
      console.error(e);
    }
    return DEFAULT_SETTINGS_LAYOUT;
  });

  const [draggedSettingsId, setDraggedSettingsId] = useState<string | null>(null);

  const saveSettingsLayout = (newLayout: CardLayoutConfig[]) => {
    setSettingsLayout(newLayout);
    try {
      localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(newLayout));
    } catch (e) {
      console.error(e);
    }
  };

  const resetSettingsLayout = () => {
    saveSettingsLayout(DEFAULT_SETTINGS_LAYOUT);
  };

  const handleSettingsColSpanChange = (id: string, newSpan: 1 | 2 | 3) => {
    const updated = settingsLayout.map((item) => (item.id === id ? { ...item, colSpan: newSpan } : item));
    saveSettingsLayout(updated);
  };

  const handleMoveSettingsCard = (id: string, direction: "prev" | "next") => {
    const idx = settingsLayout.findIndex((item) => item.id === id);
    if (idx === -1) return;
    const targetIdx = direction === "prev" ? idx - 1 : idx + 1;
    if (targetIdx < 0 || targetIdx >= settingsLayout.length) return;

    const newLayout = [...settingsLayout];
    const [movedItem] = newLayout.splice(idx, 1);
    newLayout.splice(targetIdx, 0, movedItem);
    saveSettingsLayout(newLayout);
  };

  const handleSettingsDragStart = (id: string) => {
    setDraggedSettingsId(id);
  };

  const handleSettingsDragEnd = () => {
    setDraggedSettingsId(null);
  };

  const handleSettingsDrop = (targetId: string) => {
    if (!draggedSettingsId || draggedSettingsId === targetId) {
      setDraggedSettingsId(null);
      return;
    }
    const draggedIdx = settingsLayout.findIndex((item) => item.id === draggedSettingsId);
    const targetIdx = settingsLayout.findIndex((item) => item.id === targetId);

    if (draggedIdx !== -1 && targetIdx !== -1) {
      const newLayout = [...settingsLayout];
      const [removed] = newLayout.splice(draggedIdx, 1);
      newLayout.splice(targetIdx, 0, removed);
      saveSettingsLayout(newLayout);
    }
    setDraggedSettingsId(null);
  };

  // Maintenance & Backup & App Settings States
  const [maintenanceResult, setMaintenanceResult] = useState<MaintenanceResult | null>(null);
  const [backupStatus, setBackupStatus] = useState<BackupStatus | null>(null);
  const [isCheckingIntegrity, setIsCheckingIntegrity] = useState(false);
  const [isVacuuming, setIsVacuuming] = useState(false);
  const [isBackingUp, setIsBackingUp] = useState(false);
  const [tallyRegisterCode, setTallyRegisterCode] = useState("TF");
  const [isSavingRegisterCode, setIsSavingRegisterCode] = useState(false);

  // Auto-connect to profile on startup / refresh unless user explicitly disconnected
  useEffect(() => {
    const wasConnected = localStorage.getItem("was_connected");
    if (wasConnected !== "false") {
      handleConnect();
    } else {
      setIsConnecting(false);
    }
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

  const handleConnect = async (codeOverride?: string, keyOverride?: string) => {
    const targetCode = codeOverride || companyCode;
    const targetKey = keyOverride || encryptionKey;
    setIsConnecting(true);
    try {
      await ApiService.switchCompanyProfile(targetCode, targetKey);
      setCompanyCode(targetCode);
      setEncryptionKey(targetKey);
      setIsConnected(true);
      localStorage.setItem("active_company_code", targetCode);
      localStorage.setItem("active_encryption_key", targetKey);
      localStorage.setItem("was_connected", "true");

      loadTallyRegisterCode();
      
      const list = await ApiService.getImportTemplates();
      setTemplates(list);
      if (list.length > 0) {
        setSelectedTemplateId(Number(list[0].id));
      }
    } catch (err: any) {
      console.error(err);
      setIsConnected(false);
      if (codeOverride || keyOverride) {
        alert(`Connection failed: ${err.message || err}`);
      }
    } finally {
      setIsConnecting(false);
    }
  };

  const handleConnectDemo = async () => {
    await handleConnect("DEMO", "demo1234");
  };

  const handleDisconnect = async () => {
    try {
      await ApiService.closeActiveProfile();
      setIsConnected(false);
      localStorage.setItem("was_connected", "false");
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
      const list = await ApiService.listInvoices(cDate, cNo, 10000);
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
      const cNotes = await ApiService.listCreditNotes(includeDeletedCreditNotes);
      setDebitNotes(dNotes);
      setCreditNotes(cNotes);
    } catch (err) {
      console.error(err);
    } finally {
      setLoadingNotes(false);
    }
  };

  useEffect(() => {
    if (isConnected && activeTab === "notes") {
      loadNotes();
    }
  }, [includeDeletedCreditNotes]);

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

  const handleViewCreditNote = async (cnNo: string) => {
    try {
      const res = await ApiService.getCreditNoteDetails(cnNo);
      if (res) {
        setCurrentCreditNoteDetails(res);
        setSelectedCreditNoteNo(cnNo);
        setShowViewCreditNoteModal(true);
      }
    } catch (e: any) {
      alert(e.message || "Failed to load credit note details");
    }
  };

  const handleEditCreditNote = (cnNo: string) => {
    setSelectedCreditNoteNo(cnNo);
    setShowEditCreditNoteModal(true);
  };

  const handlePrintCreditNote = async (cnNo: string) => {
    try {
      const res = await ApiService.getCreditNoteDetails(cnNo);
      if (res) {
        setCurrentCreditNoteDetails(res);
        setSelectedCreditNoteNo(cnNo);
        setShowPrintCreditNoteModal(true);
      }
    } catch (e: any) {
      alert(e.message || "Failed to load print preview");
    }
  };

  const handleDeleteCreditNote = (cnNo: string) => {
    setSelectedCreditNoteNo(cnNo);
    setShowDeleteCreditNoteModal(true);
  };

  const handleRestoreCreditNote = async (cnNo: string) => {
    if (confirm(`Are you sure you want to restore Credit Note ${cnNo}?`)) {
      try {
        await ApiService.restoreCreditNoteRecord(cnNo, "System User");
        await loadNotes();
      } catch (e: any) {
        alert(e.message || "Failed to restore Credit Note");
      }
    }
  };

  const handleSubmitCreditNote = async (cnNo: string) => {
    try {
      await ApiService.submitCreditNoteForReview(cnNo, "System User");
      await loadNotes();
    } catch (e: any) {
      alert(e.message || "Failed to submit for review");
    }
  };

  const handleApproveCreditNote = async (cnNo: string) => {
    try {
      await ApiService.approveCreditNoteRecord(cnNo, "System User");
      await loadNotes();
    } catch (e: any) {
      alert(e.message || "Failed to approve credit note");
    }
  };

  const handleRejectCreditNote = async (cnNo: string) => {
    try {
      await ApiService.rejectCreditNoteToDraft(cnNo, "System User");
      await loadNotes();
    } catch (e: any) {
      alert(e.message || "Failed to return to draft");
    }
  };

  const handleExportCreditNoteRecord = async (cnNo: string) => {
    try {
      await ApiService.exportCreditNoteRecord(cnNo, "System User");
      await loadNotes();
    } catch (e: any) {
      alert(e.message || "Failed to export credit note");
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

  return (
    <div className="flex h-screen bg-[var(--ember-bg)] text-[var(--ember-text-primary)] font-sans overflow-hidden transition-colors duration-200">
      {/* Sidebar Navigation */}
      <aside
        className={`bg-[var(--ember-sidebar-bg)] border-r border-[var(--ember-border)] flex flex-col justify-between z-10 select-none transition-all duration-300 ease-in-out shrink-0 ${
          isSidebarOpen
            ? "w-64 opacity-100"
            : "w-0 opacity-0 overflow-hidden border-r-0 pointer-events-none"
        }`}
      >
        <div>
          {/* Logo Header */}
          <div className="h-16 flex items-center justify-between px-6 border-b border-[var(--ember-border)] gap-3">
            <div className="flex items-center gap-3 min-w-0">
              <div className="p-2 bg-[var(--ember-primary-light)] text-[var(--ember-primary)] rounded-lg flex-shrink-0">
                <TrendingUp className="w-6 h-6" />
              </div>
              <div className="min-w-0 overflow-hidden">
                <h1 className="text-sm font-bold font-serif tracking-wide uppercase text-[var(--ember-primary)] truncate">Sales Monitor</h1>
                <p className="text-[10px] text-[var(--ember-text-muted)] truncate">Offline ERP Matcher</p>
              </div>
            </div>
            <button
              onClick={() => setIsSidebarOpen(false)}
              className="p-1.5 hover:bg-[var(--ember-surface-raised)] text-[var(--ember-text-muted)] hover:text-[var(--ember-text-primary)] rounded-lg transition-colors flex-shrink-0 cursor-pointer"
              title="Hide Sidebar (Ctrl+B)"
            >
              <PanelLeftClose className="w-4 h-4" />
            </button>
          </div>

          {/* Nav Items */}
          <nav className="p-4 space-y-1">
            {[
              { id: "dashboard", label: "Dashboard", icon: LayoutDashboard },
              { id: "registers", label: "Outward Registers", icon: FileSpreadsheet },
              { id: "customer_matching", label: "Customer Master", icon: Users },
              { id: "cust_debit_notes", label: "Customer Debit Notes", icon: FileText },
              { id: "revisions", label: "Price Revisions", icon: Percent },

              { id: "notes", label: "Adjustment Notes", icon: Tag },
              { id: "reports", label: "Reports & Export", icon: BarChart3 },
              { id: "import", label: "Import Wizard", icon: FileUp },
              { id: "settings", label: "Company Settings", icon: Settings },
            ].map((nav) => {
              const Icon = nav.icon;
              const isActive = activeTab === nav.id;
              return (
                <button
                  key={nav.id}
                  onClick={() => setActiveTab(nav.id as any)}
                  className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg text-sm transition-all duration-150 cursor-pointer ${
                    isActive
                      ? "border-l-4 border-[var(--ember-primary)] bg-[var(--ember-surface-raised)] text-[var(--ember-primary)] font-semibold shadow-sm"
                      : "text-[var(--ember-text-secondary)] hover:bg-[var(--ember-surface-raised)] hover:text-[var(--ember-text-primary)]"
                  }`}
                >
                  <Icon className={`w-4 h-4 ${isActive ? "text-[var(--ember-primary)]" : "text-[var(--ember-text-muted)]"}`} />
                  {nav.label}
                </button>
              );
            })}
            <button
              onClick={() => setIsAboutOpen(true)}
              className="w-full flex items-center gap-3 px-4 py-3 rounded-lg text-sm text-[var(--ember-text-secondary)] hover:bg-[var(--ember-surface-raised)] hover:text-[var(--ember-text-primary)] transition-all duration-150 cursor-pointer"
            >
              <Info className="w-4 h-4 text-[var(--ember-primary)]" />
              About Application
            </button>
          </nav>
        </div>

        {/* Database Status Panel */}
        <div className="p-4 border-t border-[var(--ember-border)] bg-[var(--ember-surface)]">
          <div className="flex items-center gap-3">
            <div
              className={`w-2.5 h-2.5 rounded-full ${
                isConnecting
                  ? "bg-amber-400 animate-ping"
                  : isConnected
                  ? "bg-emerald-500 animate-pulse"
                  : "bg-rose-500"
              }`}
            />
            <div className="flex-1 min-w-0">
              <p className="text-xs font-semibold text-[var(--ember-text-primary)] truncate font-mono">
                {isConnecting
                  ? "Connecting..."
                  : isConnected
                  ? `company_${companyCode}.db`
                  : "Disconnected"}
              </p>
              <p className="text-[10px] text-[var(--ember-text-muted)]">
                {isConnected ? `Active: ${activeFY}` : "System Database Locked"}
              </p>
            </div>
            {isConnected ? (
              <button
                onClick={handleDisconnect}
                className="p-1 hover:bg-[var(--ember-surface-raised)] text-[var(--ember-text-muted)] hover:text-[var(--ember-text-primary)] rounded-md transition-colors cursor-pointer"
                title="Disconnect Profile"
              >
                <XCircle className="w-4 h-4" />
              </button>
            ) : !isConnecting && (
              <button
                onClick={handleConnectDemo}
                className="text-[10px] bg-emerald-600 hover:bg-emerald-500 text-white font-medium px-2 py-1 rounded transition-colors cursor-pointer"
                title="Login to DEMO Account"
              >
                Demo Login
              </button>
            )}
          </div>
        </div>
      </aside>

      {/* Main Content Area */}
      <main className="flex-1 flex flex-col min-w-0 overflow-y-auto relative">
        {/* Top Header */}
        <header className="h-16 border-b border-[var(--ember-border)] bg-[var(--ember-header-bg)] backdrop-blur-md flex items-center justify-between px-6 z-10">
          <div className="flex items-center gap-3">
            <button
              onClick={() => setIsSidebarOpen((prev) => !prev)}
              className="p-2 text-[var(--ember-text-muted)] hover:text-[var(--ember-text-primary)] hover:bg-[var(--ember-surface-raised)] border border-[var(--ember-border)] rounded-lg transition-colors cursor-pointer flex items-center justify-center shadow-sm"
              title={isSidebarOpen ? "Hide Sidebar (Ctrl+B)" : "Unhide Sidebar (Ctrl+B)"}
            >
              {isSidebarOpen ? <PanelLeftClose className="w-4 h-4" /> : <PanelLeftOpen className="w-4 h-4 text-[var(--ember-primary)]" />}
            </button>
            <div>
              <span className="text-xs text-[var(--ember-text-muted)] font-medium">Outward Matching Engine</span>
              <h2 className="text-base font-bold font-serif text-[var(--ember-text-primary)]">
              {activeTab === "dashboard" && "Dashboard Overview"}
              {activeTab === "registers" && "Sales Invoice Registers"}
              {activeTab === "revisions" && "Supplier Price Revisions Tracker"}
              {activeTab === "notes" && "Debit & Credit Adjustment Notes"}
              {activeTab === "reports" && "Reports & Export Center"}
              {activeTab === "import" && "Configure Excel Outward Import"}
              {activeTab === "settings" && "Company Profile Settings"}
              {activeTab === "customer_matching" && "Customer Master Database"}
              {activeTab === "cust_debit_notes" && "Customer Retrospective Price Revision Debit Notes"}
            </h2>
          </div>
        </div>

          <div className="flex items-center gap-3">
            <div className={`flex items-center gap-2 px-3 py-1.5 rounded-lg border text-xs text-[var(--ember-text-primary)] ${
              isConnected
                ? "bg-[var(--ember-surface-raised)] border-[var(--ember-border)]"
                : "bg-amber-950/30 border-amber-800/50"
            }`}>
              <Building className="w-3.5 h-3.5 text-[var(--ember-primary)]" />
              <span>
                Active Profile: <strong className="text-[var(--ember-primary)] font-mono">{companyCode}</strong>
                {!isConnected && !isConnecting && (
                  <span className="ml-1.5 text-rose-400 font-normal">(Disconnected)</span>
                )}
              </span>
            </div>
            {!isConnected && !isConnecting && (
              <button
                onClick={handleConnectDemo}
                className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-medium rounded-lg transition-colors shadow-sm flex items-center gap-1.5 cursor-pointer"
              >
                <ShieldCheck className="w-3.5 h-3.5" />
                Login to DEMO
              </button>
            )}
            <ThemeToggle showLabel />
          </div>
        </header>

        {/* Dynamic Panels */}
        <div className="flex-1 p-8">
          {activeTab === "cust_debit_notes" && (
            <CustomerDebitNotesTab onNotify={(msg) => alert(msg)} />
          )}


          {activeTab === "dashboard" && (

            <div className="space-y-8">
              {!isConnected && !isConnecting && (
                <div className="bg-amber-950/20 border border-amber-900/60 rounded-xl p-4 flex flex-col md:flex-row md:items-center justify-between gap-4 text-amber-200 shadow-sm">
                  <div className="flex items-start gap-3">
                    <AlertTriangle className="w-5 h-5 text-amber-400 flex-shrink-0 mt-0.5" />
                    <div>
                      <h4 className="font-bold text-sm text-amber-100">Database Disconnected</h4>
                      <p className="text-xs text-amber-300/80 mt-0.5">
                        Connect a company profile or log in to the DEMO account to populate statistics, price revisions, and invoice registers.
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0 self-end md:self-center">
                    <button
                      onClick={handleConnectDemo}
                      className="px-3.5 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold rounded-lg transition-colors flex items-center gap-1.5 shadow-sm cursor-pointer"
                    >
                      <ShieldCheck className="w-3.5 h-3.5" />
                      Login to DEMO Account
                    </button>
                    <button
                      onClick={() => handleConnect()}
                      className="px-3.5 py-1.5 bg-amber-800/80 hover:bg-amber-700 text-amber-100 text-xs font-semibold rounded-lg border border-amber-600/50 transition-colors flex items-center gap-1.5 cursor-pointer"
                    >
                      <RefreshCw className="w-3.5 h-3.5" />
                      Reconnect ({companyCode})
                    </button>
                  </div>
                </div>
              )}

              <DashboardKpis metrics={dashboardMetrics} />
            </div>
          )}

          {activeTab === "registers" && (
            <OutwardRegisterTable
              invoices={invoices}
              loading={loadingInvoices}
              companyCode={companyCode}
              onOpenDetails={handleOpenDetails}
              onRefreshData={loadInvoices}
            />
          )}

          {activeTab === "customer_matching" && <CustomerMasterTab />}

          {activeTab === "revisions" && (
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-start">
              {/* Revisions list */}
              <div className="lg:col-span-2 space-y-4">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-bold font-serif text-[var(--ember-primary)] uppercase tracking-wider">Price Revisions History</h3>
                  <button
                    onClick={() => setIsRevisionModalOpen(true)}
                    className="ember-btn-primary px-3.5 py-2 text-xs flex items-center gap-1"
                  >
                    <PlusCircle className="w-4 h-4" /> Add price revision
                  </button>
                </div>

                <div className="ember-card overflow-hidden text-xs">
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="bg-[var(--ember-surface-raised)] text-[var(--ember-text-secondary)] font-bold border-b border-[var(--ember-border)]">
                        <th className="p-4">Part Code</th>
                        <th className="p-4">Supplier ID</th>
                        <th className="p-4 text-right">Old Price</th>
                        <th className="p-4 text-right">New Price</th>
                        <th className="p-4">Effective Date</th>
                        <th className="p-4 text-center">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[var(--ember-border-subtle)]">
                      {loadingRevisions ? (
                        <tr>
                          <td colSpan={6} className="p-8 text-center text-[var(--ember-text-muted)]">Loading revisions...</td>
                        </tr>
                      ) : revisions.length === 0 ? (
                        <tr>
                          <td colSpan={6} className="p-8 text-center text-[var(--ember-text-muted)]">No price revisions logged.</td>
                        </tr>
                      ) : (
                        revisions.map((rev) => (
                          <tr
                            key={rev.id?.toString()}
                            onClick={() => handleSelectRevision(rev)}
                            className={`hover:bg-[var(--ember-surface-raised)] transition-colors cursor-pointer select-none ${
                              selectedRevision?.id === rev.id ? "bg-[var(--ember-primary-light)] border-l-4 border-[var(--ember-primary)]" : ""
                            }`}
                          >
                            <td className="p-4 font-mono font-bold text-[var(--ember-text-primary)]">{rev.part_code}</td>
                            <td className="p-4 text-[var(--ember-text-secondary)]">Supplier #{rev.supplier_id}</td>
                            <td className="p-4 text-right font-mono text-[var(--ember-text-muted)]">₹{rev.old_price.toFixed(2)}</td>
                            <td className="p-4 text-right font-mono text-emerald-600 dark:text-emerald-400 font-semibold">₹{rev.new_price.toFixed(2)}</td>
                            <td className="p-4 font-mono text-[var(--ember-text-secondary)]">{rev.effective_date}</td>
                            <td className="p-4 text-center">
                              <span className={`px-2.5 py-1 ember-chip ${
                                rev.status === "Approved" ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border border-emerald-500/30" : "bg-amber-500/15 text-amber-700 dark:text-amber-300 border border-amber-500/30"
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
              <div className="ember-card p-6 space-y-6">
                <h4 className="text-xs font-bold font-serif text-[var(--ember-text-primary)] uppercase tracking-wider border-b border-[var(--ember-border)] pb-3">
                  Revision Recovery Inspector
                </h4>
                {selectedRevision ? (
                  <div className="space-y-6 text-xs">
                    <div className="bg-[var(--ember-surface-raised)] p-4 rounded-lg border border-[var(--ember-border)] space-y-2">
                      <div><strong className="text-[var(--ember-text-secondary)]">Target Part:</strong> <span className="font-mono text-[var(--ember-primary)] font-bold">{selectedRevision.part_code}</span></div>
                      <div><strong className="text-[var(--ember-text-secondary)]">Effective Date:</strong> <span className="font-mono text-[var(--ember-text-primary)]">{selectedRevision.effective_date}</span></div>
                      <div><strong className="text-[var(--ember-text-secondary)]">Price difference:</strong> <span className="text-rose-600 dark:text-rose-400 font-bold font-mono">-₹{selectedRevision.difference.toFixed(2)}</span></div>
                    </div>

                    {loadingRecoveryPreview ? (
                      <div className="text-center text-[var(--ember-text-muted)] py-6">Calculating recovery impact...</div>
                    ) : recoveryPreview.length === 0 ? (
                      <div className="text-center text-[var(--ember-text-muted)] py-6">No matching invoices found for recovery.</div>
                    ) : (
                      <div className="space-y-4">
                        <div className="flex items-center justify-between font-semibold border-b border-[var(--ember-border)] pb-2">
                          <span className="text-[var(--ember-text-primary)]">Invoices Impacted:</span>
                          <span className="text-[var(--ember-primary)] font-mono">{recoveryPreview.length} lines</span>
                        </div>
                        
                        <div className="max-h-48 overflow-y-auto space-y-2 pr-1">
                          {recoveryPreview.map((item, i) => (
                            <div key={i} className="flex justify-between border-b border-[var(--ember-border-subtle)] pb-1.5 text-[10px]">
                              <span className="font-mono text-[var(--ember-text-secondary)]">Inv {item.invoice_number}</span>
                              <span className="font-mono text-[var(--ember-text-primary)] font-semibold">Qty {item.quantity} (₹{item.total_difference.toFixed(2)})</span>
                            </div>
                          ))}
                        </div>

                        {selectedRevision.status !== "Approved" && (
                          <div className="pt-4 border-t border-[var(--ember-border)] space-y-3">
                            <div>
                              <label className="block text-[10px] text-[var(--ember-text-muted)] mb-1 font-semibold">Debit Note Reference Number</label>
                              <input
                                type="text"
                                value={debitNoteNoInput}
                                onChange={(e) => setDebitNoteNoInput(e.target.value)}
                                className="w-full ember-input p-2 text-xs"
                              />
                            </div>
                            <div>
                              <label className="block text-[10px] text-[var(--ember-text-muted)] mb-1 font-semibold">Remarks</label>
                              <input
                                type="text"
                                value={debitNoteRemarksInput}
                                onChange={(e) => setDebitNoteRemarksInput(e.target.value)}
                                className="w-full ember-input p-2 text-xs"
                              />
                            </div>
                            <button
                              onClick={handleGenerateDebitNote}
                              className="w-full ember-btn-primary py-2 text-xs flex items-center justify-center gap-1.5 cursor-pointer"
                            >
                              <ShieldCheck className="w-4 h-4" /> Generate Recovery Debit Note
                            </button>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                ) : (
                  <p className="text-xs text-[var(--ember-text-muted)] text-center py-12">Select a price revision from the history to view potential debit note recoveries.</p>
                )}
              </div>
            </div>
          )}

          {activeTab === "notes" && (
            <div className="space-y-6">
              {/* Subtab Toggle */}
              <div className="flex items-center justify-between border-b border-[var(--ember-border)] pb-3">
                <div className="flex gap-2">
                  <button
                    onClick={() => setActiveNotesSubTab("debit")}
                    className={`px-4 py-2 text-xs font-semibold rounded-lg transition-all cursor-pointer ${
                      activeNotesSubTab === "debit" ? "ember-btn-primary shadow-sm" : "ember-btn-secondary text-[var(--ember-text-secondary)]"
                    }`}
                  >
                    Debit Notes (Supplier Price Recovery)
                  </button>
                  <button
                    onClick={() => setActiveNotesSubTab("credit")}
                    className={`px-4 py-2 text-xs font-semibold rounded-lg transition-all cursor-pointer ${
                      activeNotesSubTab === "credit" ? "ember-btn-primary shadow-sm" : "ember-btn-secondary text-[var(--ember-text-secondary)]"
                    }`}
                  >
                    Credit Notes (Sales Cancellations)
                  </button>
                </div>

                {activeNotesSubTab === "credit" ? (
                  <div className="flex items-center gap-4">
                    <label className="flex items-center gap-1.5 text-xs text-[var(--ember-text-secondary)] font-semibold select-none cursor-pointer">
                      <input
                        type="checkbox"
                        checked={includeDeletedCreditNotes}
                        onChange={(e) => setIncludeDeletedCreditNotes(e.target.checked)}
                        className="rounded border-[var(--ember-border)] text-[var(--ember-primary)] focus:ring-[var(--ember-primary)]"
                      />
                      Include Soft-Deleted
                    </label>
                    <button
                      onClick={handleExportCreditNotes}
                      className="ember-btn-secondary px-4 py-2 text-xs flex items-center gap-1.5 cursor-pointer"
                    >
                      <Download className="w-3.5 h-3.5 text-[var(--ember-primary)]" /> Export Credit Notes CSV
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={handleExportDebitNotes}
                    className="ember-btn-secondary px-4 py-2 text-xs flex items-center gap-1.5"
                  >
                    <Download className="w-3.5 h-3.5 text-[var(--ember-primary)]" /> Export Debit Notes CSV
                  </button>
                )}
              </div>

              {/* Notes Register Grid */}
              <div className="ember-card overflow-hidden text-xs">
                {activeNotesSubTab === "debit" ? (
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="bg-[var(--ember-surface-raised)] text-[var(--ember-text-secondary)] font-bold border-b border-[var(--ember-border)]">
                        <th className="p-4">Debit Note No</th>
                        <th className="p-4">Supplier Reference</th>
                        <th className="p-4 font-mono">Date</th>
                        <th className="p-4 text-right">Taxable Amount</th>
                        <th className="p-4 text-right">Total Recoverable</th>
                        <th className="p-4 text-center">Status</th>
                        <th className="p-4 text-center">Action</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[var(--ember-border-subtle)]">
                      {loadingNotes ? (
                        <tr>
                          <td colSpan={7} className="p-8 text-center text-[var(--ember-text-muted)]">Loading notes...</td>
                        </tr>
                      ) : debitNotes.length === 0 ? (
                        <tr>
                          <td colSpan={7} className="p-8 text-center text-[var(--ember-text-muted)]">No debit notes found.</td>
                        </tr>
                      ) : (
                        debitNotes.map((dn) => (
                          <tr key={dn.debit_note_number} className="hover:bg-[var(--ember-surface-raised)] transition-colors">
                            <td className="p-4 font-mono font-bold text-[var(--ember-primary)]">{dn.debit_note_number}</td>
                            <td className="p-4 text-[var(--ember-text-secondary)]">Supplier #{dn.supplier_id}</td>
                            <td className="p-4 font-mono text-[var(--ember-text-secondary)]">{dn.debit_note_date}</td>
                            <td className="p-4 text-right font-mono text-[var(--ember-text-primary)]">₹{dn.total_taxable.toLocaleString("en-IN", { minimumFractionDigits: 2 })}</td>
                            <td className="p-4 text-right font-mono font-bold text-emerald-600 dark:text-emerald-400">₹{dn.total_value.toLocaleString("en-IN", { minimumFractionDigits: 2 })}</td>
                            <td className="p-4 text-center">
                              <span className={`px-2.5 py-1 ember-chip ${
                                dn.status === "Approved" ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border border-emerald-500/30" : "bg-amber-500/15 text-amber-700 dark:text-amber-300 border border-amber-500/30"
                              }`}>
                                {dn.status}
                              </span>
                            </td>
                            <td className="p-4 text-center">
                              {dn.status === "Draft" && (
                                <button
                                  onClick={() => handleApproveDebitNote(dn.debit_note_number)}
                                  className="ember-btn-primary px-3 py-1 text-[10px] cursor-pointer"
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
                      <tr className="bg-[var(--ember-surface-raised)] text-[var(--ember-text-secondary)] font-bold border-b border-[var(--ember-border)]">
                        <th className="p-4">Credit Note No</th>
                        <th className="p-4">Invoice Reference</th>
                        <th className="p-4 font-mono">Date</th>
                        <th className="p-4 text-right">Taxable Value</th>
                        <th className="p-4 text-right">Total Refund</th>
                        <th className="p-4 text-center">Status</th>
                        <th className="p-4 text-center">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[var(--ember-border-subtle)]">
                      {loadingNotes ? (
                        <tr>
                          <td colSpan={7} className="p-8 text-center text-[var(--ember-text-muted)]">Loading notes...</td>
                        </tr>
                      ) : creditNotes.length === 0 ? (
                        <tr>
                          <td colSpan={7} className="p-8 text-center text-[var(--ember-text-muted)]">No credit notes found.</td>
                        </tr>
                      ) : (
                        creditNotes.map((cn) => (
                          <tr key={cn.credit_note_number} className={`hover:bg-[var(--ember-surface-raised)] transition-colors ${cn.is_deleted ? "opacity-60 bg-red-500/[0.03]" : ""}`}>
                            <td className="p-4 font-mono font-bold text-[var(--ember-primary)] flex items-center gap-1.5">
                              {cn.credit_note_number}
                              {cn.is_deleted && <span className="text-[10px] text-red-500 font-sans font-bold uppercase tracking-wider">(Deleted)</span>}
                            </td>
                            <td className="p-4 font-mono text-[var(--ember-text-muted)]">{cn.invoice_number}</td>
                            <td className="p-4 font-mono text-[var(--ember-text-secondary)]">{cn.credit_note_date}</td>
                            <td className="p-4 text-right font-mono text-[var(--ember-text-primary)]">₹{cn.total_taxable.toLocaleString("en-IN", { minimumFractionDigits: 2 })}</td>
                            <td className="p-4 text-right font-mono font-bold text-rose-600 dark:text-rose-400">₹{cn.total_value.toLocaleString("en-IN", { minimumFractionDigits: 2 })}</td>
                            <td className="p-4 text-center">
                              {cn.is_deleted ? (
                                <span className="px-2.5 py-1 ember-chip bg-red-500/15 text-red-700 dark:text-red-300 border border-red-500/30 font-bold uppercase tracking-wider">
                                  🔴 Deleted
                                </span>
                              ) : cn.status === "Draft" ? (
                                <span className="px-2.5 py-1 ember-chip bg-amber-500/15 text-amber-700 dark:text-amber-300 border border-amber-500/30 font-bold uppercase tracking-wider">
                                  🟡 Draft
                                </span>
                              ) : cn.status === "Review" ? (
                                <span className="px-2.5 py-1 ember-chip bg-blue-500/15 text-blue-700 dark:text-blue-300 border border-blue-500/30 font-bold uppercase tracking-wider">
                                  🔵 Review
                                </span>
                              ) : cn.status === "Approved" ? (
                                <span className="px-2.5 py-1 ember-chip bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border border-emerald-500/30 font-bold uppercase tracking-wider">
                                  🟢 Approved
                                </span>
                              ) : (
                                <span className="px-2.5 py-1 ember-chip bg-slate-500/15 text-slate-700 dark:text-slate-300 border border-slate-500/30 font-bold uppercase tracking-wider">
                                  ⚫ Exported
                                </span>
                              )}
                            </td>
                            <td className="p-4 text-center flex items-center justify-center gap-2.5">
                              {/* 👁 View details */}
                              <button
                                onClick={() => handleViewCreditNote(cn.credit_note_number)}
                                title="View Details"
                                className="p-1 hover:text-[var(--ember-primary)] text-slate-400 cursor-pointer transition-colors"
                              >
                                <Eye className="w-4 h-4" />
                              </button>

                              {/* ✏ Edit */}
                              <button
                                onClick={() => handleEditCreditNote(cn.credit_note_number)}
                                disabled={cn.is_deleted || cn.status !== "Draft"}
                                title={cn.is_deleted ? "Deleted note cannot be edited" : cn.status !== "Draft" ? "Only Draft notes can be edited" : "Edit Credit Note"}
                                className={`p-1 transition-colors ${
                                  cn.is_deleted || cn.status !== "Draft"
                                    ? "text-slate-700 dark:text-slate-800 cursor-not-allowed opacity-40"
                                    : "hover:text-[var(--ember-primary)] text-slate-400 cursor-pointer"
                                }`}
                              >
                                <Edit2 className="w-3.5 h-3.5" />
                              </button>

                              {/* 🖨 Print */}
                              <button
                                onClick={() => handlePrintCreditNote(cn.credit_note_number)}
                                disabled={cn.is_deleted}
                                title={cn.is_deleted ? "Deleted note cannot be printed" : "Print Preview"}
                                className={`p-1 transition-colors ${
                                  cn.is_deleted
                                    ? "text-slate-700 dark:text-slate-800 cursor-not-allowed opacity-40"
                                    : "hover:text-[var(--ember-primary)] text-slate-400 cursor-pointer"
                                }`}
                              >
                                <Printer className="w-3.5 h-3.5" />
                              </button>

                              {/* 🗑 Delete / 🔄 Restore */}
                              {cn.is_deleted ? (
                                <button
                                  onClick={() => handleRestoreCreditNote(cn.credit_note_number)}
                                  title="Restore Credit Note"
                                  className="p-1 hover:text-emerald-500 text-slate-400 cursor-pointer transition-colors animate-pulse"
                                >
                                  <RotateCcw className="w-3.5 h-3.5" />
                                </button>
                              ) : (
                                <button
                                  onClick={() => handleDeleteCreditNote(cn.credit_note_number)}
                                  disabled={cn.status === "Approved" || cn.status === "Exported"}
                                  title={cn.status === "Approved" || cn.status === "Exported" ? "Approved/Exported note cannot be deleted" : "Delete Credit Note"}
                                  className={`p-1 transition-colors ${
                                    cn.status === "Approved" || cn.status === "Exported"
                                      ? "text-slate-700 dark:text-slate-800 cursor-not-allowed opacity-40"
                                      : "hover:text-red-500 text-slate-400 cursor-pointer"
                                  }`}
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                </button>
                              )}

                              {/* Quick Transition Actions */}
                              {!cn.is_deleted && (
                                <div className="border-l border-slate-700 pl-2.5 ml-1">
                                  {cn.status === "Draft" && (
                                    <button
                                      onClick={() => handleSubmitCreditNote(cn.credit_note_number)}
                                      className="px-2.5 py-1 bg-blue-600 hover:bg-blue-700 text-white rounded text-[10px] font-bold cursor-pointer transition-all active:scale-[0.96]"
                                    >
                                      Submit
                                    </button>
                                  )}
                                  {cn.status === "Review" && (
                                    <div className="flex gap-1">
                                      <button
                                        onClick={() => handleApproveCreditNote(cn.credit_note_number)}
                                        className="px-2 py-0.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded text-[9px] font-bold cursor-pointer transition-all"
                                      >
                                        Approve
                                      </button>
                                      <button
                                        onClick={() => handleRejectCreditNote(cn.credit_note_number)}
                                        className="px-2 py-0.5 bg-rose-600 hover:bg-rose-700 text-white rounded text-[9px] font-bold cursor-pointer transition-all"
                                      >
                                        Reject
                                      </button>
                                    </div>
                                  )}
                                  {cn.status === "Approved" && (
                                    <button
                                      onClick={() => handleExportCreditNoteRecord(cn.credit_note_number)}
                                      className="px-2.5 py-1 bg-purple-600 hover:bg-purple-700 text-white rounded text-[10px] font-bold cursor-pointer transition-all"
                                    >
                                      Export
                                    </button>
                                  )}
                                </div>
                              )}
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
                <h3 className="text-sm font-bold font-serif text-[var(--ember-primary)] mb-6 uppercase tracking-wider">Configure Import Job</h3>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
                  <div>
                    <label className="block text-xs font-semibold text-[var(--ember-text-secondary)] mb-2">Selected Mapping Template</label>
                    <select
                      value={selectedTemplateId || ""}
                      onChange={(e) => setSelectedTemplateId(Number(e.target.value))}
                      className="w-full ember-input p-2.5 text-xs font-semibold"
                    >
                      {templates.map((t) => (
                        <option key={t.id?.toString()} value={t.id?.toString()}>
                          {t.template_name} ({t.source_type})
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-[var(--ember-text-secondary)] mb-2">Excel File Source Path</label>
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
                        className="flex-1 ember-input p-2.5 text-xs font-mono"
                      />
                      <button
                        onClick={handleSelectFile}
                        className="ember-btn-primary px-4 py-2.5 text-xs flex items-center gap-1.5"
                      >
                        <FileSpreadsheet className="w-4 h-4" /> Browse
                      </button>
                    </div>
                  </div>
                </div>

                <div className="flex justify-end gap-3 border-t border-[var(--ember-border)] pt-6">
                  {selectedFilePath && (
                    <button
                      onClick={handleRunPreview}
                      disabled={isPreviewing}
                      className="ember-btn-secondary px-5 py-2.5 text-xs flex items-center gap-1.5 disabled:opacity-50"
                    >
                      {isPreviewing ? <RefreshCw className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
                      Run Validation Preview
                    </button>
                  )}

                  {previewData && previewData.errors.length === 0 && (
                    <button
                      onClick={handleCommitImport}
                      disabled={importStatus === "importing"}
                      className="ember-btn-primary px-5 py-2.5 text-xs flex items-center gap-1.5 cursor-pointer"
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
                <div className="bg-emerald-500/10 border border-emerald-500/30 rounded-xl p-4 flex gap-4 text-emerald-800 dark:text-emerald-200">
                  <CheckCircle className="w-5 h-5 flex-shrink-0 mt-0.5 text-emerald-600 dark:text-emerald-400" />
                  <div>
                    <h4 className="font-bold text-sm text-[var(--ember-text-primary)]">Import Completed Successfully</h4>
                    <p className="text-xs text-[var(--ember-text-secondary)] mt-1">{statusMessage}</p>
                  </div>
                </div>
              )}
              {importStatus === "error" && (
                <div className="bg-rose-500/10 border border-rose-500/30 rounded-xl p-4 flex gap-4 text-rose-800 dark:text-rose-200">
                  <XCircle className="w-5 h-5 flex-shrink-0 mt-0.5 text-rose-600 dark:text-rose-400" />
                  <div>
                    <h4 className="font-bold text-sm text-[var(--ember-text-primary)]">Import Failed</h4>
                    <p className="text-xs text-[var(--ember-text-secondary)] mt-1">{statusMessage}</p>
                  </div>
                </div>
              )}

              {/* Preview Analysis Panel */}
              {previewData && (
                <div className="ember-card p-6 space-y-6">
                  <div className="flex items-center justify-between border-b border-[var(--ember-border)] pb-4">
                    <div>
                      <h4 className="text-sm font-bold font-serif text-[var(--ember-primary)]">Validation Results Summary</h4>
                      <p className="text-[10px] text-[var(--ember-text-muted)] font-mono mt-0.5">SHA256 File Signature: {previewData.batch_hash}</p>
                    </div>
                    <div className="flex gap-4 text-xs font-semibold font-mono">
                      <span className="text-[var(--ember-primary)]">{previewData.row_count - 1} rows parsed</span>
                      <span className="text-emerald-700 dark:text-emerald-400">+{previewData.proposed_inserts} new</span>
                      <span className="text-blue-700 dark:text-blue-400">*{previewData.proposed_updates} updates</span>
                      <span className="text-rose-700 dark:text-rose-400">{previewData.errors.length} errors</span>
                      <span className="text-amber-700 dark:text-amber-400">{previewData.warnings.length} warnings</span>
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
                                      This file has already been imported into your database in a previous batch. Double importing identical files is blocked to prevent data duplication.
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
                              <th className="p-3">Field Key</th>
                              <th className="p-3">Warning Type</th>
                              <th className="p-3">Description</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-[var(--ember-border-subtle)]">
                            {previewData.warnings.map((wrn, i) => (
                              <tr key={i} className="hover:bg-[var(--ember-surface)] text-amber-800 dark:text-amber-200">
                                <td className="p-3 font-mono">{wrn.row_no}</td>
                                <td className="p-3 font-mono text-[var(--ember-text-muted)]">{wrn.invoice_no || "N/A"}</td>
                                <td className="p-3 font-semibold text-[var(--ember-text-secondary)] font-mono">{wrn.field_name}</td>
                                <td className="p-3 font-mono">{wrn.warning_type}</td>
                                <td className="p-3">
                                  {wrn.warning_type === "ERR_VALIDATION_004" ? (
                                    <span className="flex items-center gap-1">
                                      Unrecognized code: <strong className="text-[var(--ember-primary)] font-mono">{wrn.actual_value}</strong>. Auto-creates registry in review queue.
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
              <div className="flex items-center justify-between border-b border-[var(--ember-border)] pb-4">
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setReportSubTab("export")}
                    className={`px-4 py-2 rounded-lg text-xs font-semibold transition-colors flex items-center gap-2 cursor-pointer ${
                      reportSubTab === "export"
                        ? "ember-btn-primary shadow-sm"
                        : "ember-btn-secondary"
                    }`}
                  >
                    <Download className="w-3.5 h-3.5" />
                    Tally & Data Exporter
                  </button>
                  <button
                    onClick={() => setReportSubTab("monthly")}
                    className={`px-4 py-2 rounded-lg text-xs font-semibold transition-colors flex items-center gap-2 cursor-pointer ${
                      reportSubTab === "monthly"
                        ? "ember-btn-primary shadow-sm"
                        : "ember-btn-secondary"
                    }`}
                  >
                    <BarChart3 className="w-3.5 h-3.5" />
                    Monthly Performance
                  </button>
                  <button
                    onClick={() => setReportSubTab("gst")}
                    className={`px-4 py-2 rounded-lg text-xs font-semibold transition-colors flex items-center gap-2 cursor-pointer ${
                      reportSubTab === "gst"
                        ? "ember-btn-primary shadow-sm"
                        : "ember-btn-secondary"
                    }`}
                  >
                    <PieChart className="w-3.5 h-3.5" />
                    GST Tax Breakdown
                  </button>
                  <button
                    onClick={() => setReportSubTab("customers")}
                    className={`px-4 py-2 rounded-lg text-xs font-semibold transition-colors flex items-center gap-2 cursor-pointer ${
                      reportSubTab === "customers"
                        ? "ember-btn-primary shadow-sm"
                        : "ember-btn-secondary"
                    }`}
                  >
                    <Building className="w-3.5 h-3.5" />
                    Top Customers
                  </button>
                  <button
                    onClick={() => setReportSubTab("items")}
                    className={`px-4 py-2 rounded-lg text-xs font-semibold transition-colors flex items-center gap-2 cursor-pointer ${
                      reportSubTab === "items"
                        ? "ember-btn-primary shadow-sm"
                        : "ember-btn-secondary"
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
                    className="ember-input px-3 py-1.5 text-xs font-mono"
                  />
                  <span className="text-xs text-[var(--ember-text-muted)]">to</span>
                  <input
                    type="date"
                    value={reportDateTo}
                    onChange={(e) => setReportDateTo(e.target.value)}
                    className="ember-input px-3 py-1.5 text-xs font-mono"
                  />
                  <button
                    onClick={loadReportData}
                    className="ember-btn-secondary px-3 py-1.5 text-xs"
                  >
                    Filter
                  </button>
                </div>
              </div>

              {/* Sub-Tab 1: Export Generator */}
              {reportSubTab === "export" && (
                <div className="grid grid-cols-3 gap-6">
                  <div className="col-span-2 ember-card p-6 space-y-6">
                    <div>
                      <h3 className="text-sm font-bold font-serif text-[var(--ember-primary)] uppercase tracking-wider">
                        Export Format Options
                      </h3>
                      <p className="text-xs text-[var(--ember-text-secondary)] mt-1">
                        Select the destination layout format to compile outward sales invoices into downloadable files.
                      </p>
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                      <div
                        onClick={() => setExportFormat("tally")}
                        className={`cursor-pointer p-4 rounded-xl border transition-all ${
                          exportFormat === "tally"
                            ? "bg-[var(--ember-primary-light)] border-[var(--ember-primary)] text-[var(--ember-primary)]"
                            : "bg-[var(--ember-surface-raised)] border-[var(--ember-border)] text-[var(--ember-text-secondary)] hover:border-[var(--ember-primary)]"
                        }`}
                      >
                        <FileSpreadsheet className="w-6 h-6 mb-2 text-[var(--ember-primary)]" />
                        <h4 className="font-bold text-xs text-[var(--ember-text-primary)]">Tally Excel (Multi-Rate Split)</h4>
                        <p className="text-[10px] text-[var(--ember-text-muted)] mt-1">
                          Splits multi-tax rate invoices into separate voucher lines (e.g. 372076 → 372076, 372076A) for seamless Tally Prime import.
                        </p>
                      </div>

                      <div
                        onClick={() => setExportFormat("excel")}
                        className={`cursor-pointer p-4 rounded-xl border transition-all ${
                          exportFormat === "excel"
                            ? "bg-[var(--ember-primary-light)] border-[var(--ember-primary)] text-[var(--ember-primary)]"
                            : "bg-[var(--ember-surface-raised)] border-[var(--ember-border)] text-[var(--ember-text-secondary)] hover:border-[var(--ember-primary)]"
                        }`}
                      >
                        <FileText className="w-6 h-6 mb-2 text-emerald-600 dark:text-emerald-400" />
                        <h4 className="font-bold text-xs text-[var(--ember-text-primary)]">Standard Flat Excel</h4>
                        <p className="text-[10px] text-[var(--ember-text-muted)] mt-1">
                          Consolidated flat spreadsheet listing all invoice items with complete tax breakdown columns.
                        </p>
                      </div>

                      <div
                        onClick={() => setExportFormat("csv")}
                        className={`cursor-pointer p-4 rounded-xl border transition-all ${
                          exportFormat === "csv"
                            ? "bg-[var(--ember-primary-light)] border-[var(--ember-primary)] text-[var(--ember-primary)]"
                            : "bg-[var(--ember-surface-raised)] border-[var(--ember-border)] text-[var(--ember-text-secondary)] hover:border-[var(--ember-primary)]"
                        }`}
                      >
                        <Download className="w-6 h-6 mb-2 text-blue-600 dark:text-blue-400" />
                        <h4 className="font-bold text-xs text-[var(--ember-text-primary)]">CSV Raw Stream</h4>
                        <p className="text-[10px] text-[var(--ember-text-muted)] mt-1">
                          Ultra-fast plaintext CSV output for downstream data processing, Python pipelines, or custom ERP integration.
                        </p>
                      </div>

                      <div
                        onClick={() => setExportFormat("einvoice_json")}
                        className={`cursor-pointer p-4 rounded-xl border transition-all ${
                          exportFormat === "einvoice_json"
                            ? "bg-[var(--ember-primary-light)] border-[var(--ember-primary)] text-[var(--ember-primary)]"
                            : "bg-[var(--ember-surface-raised)] border-[var(--ember-border)] text-[var(--ember-text-secondary)] hover:border-[var(--ember-primary)]"
                        }`}
                      >
                        <FileJson className="w-6 h-6 mb-2 text-amber-600 dark:text-amber-400" />
                        <h4 className="font-bold text-xs text-[var(--ember-text-primary)]">E-Invoice JSON (Credit Notes)</h4>
                        <p className="text-[10px] text-[var(--ember-text-muted)] mt-1">
                          Generates hierarchical JSON upload files matching the GST portal standard v1.1 schema specifically for Credit Notes.
                        </p>
                      </div>
                    </div>

                    <div className="pt-4 border-t border-[var(--ember-border)] flex items-center justify-between">
                      <div className="text-xs text-[var(--ember-text-muted)]">
                        <span>Range: </span>
                        <span className="font-semibold font-mono text-[var(--ember-text-primary)]">
                          {reportDateFrom || "All Dates"} to {reportDateTo || "Latest"}
                        </span>
                      </div>
                      <button
                        onClick={handleExport}
                        disabled={isExporting}
                        className="ember-btn-primary px-6 py-2.5 text-xs flex items-center gap-2 cursor-pointer"
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
                      <div className="bg-emerald-500/10 border border-emerald-500/30 rounded-xl p-4 flex gap-4 text-emerald-800 dark:text-emerald-200 text-xs">
                        <CheckCircle className="w-5 h-5 flex-shrink-0 text-emerald-600 dark:text-emerald-400 mt-0.5" />
                        <div>
                          <h4 className="font-bold text-[var(--ember-text-primary)]">{exportResult.format} Generation Complete</h4>
                          <p className="text-[var(--ember-text-secondary)] mt-0.5">{exportResult.message}</p>
                          <p className="font-mono text-[10px] text-emerald-700 dark:text-emerald-400 mt-1">Saved to: {exportResult.output_path}</p>
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Rules & Export Help Card */}
                  <div className="ember-card p-6 space-y-4">
                    <h4 className="text-xs font-bold font-serif text-[var(--ember-primary)] uppercase tracking-wider">Tally Rate-Split Export Rules</h4>
                    <div className="space-y-3 text-xs text-[var(--ember-text-secondary)] leading-relaxed">
                      <div className="bg-[var(--ember-surface-raised)] p-3 rounded-lg border border-[var(--ember-border)]">
                        <p className="font-semibold text-[var(--ember-text-primary)] mb-1">Rule 1: Invoice Number Preservation</p>
                        <p className="text-[11px] text-[var(--ember-text-muted)]">The primary GST rate item group preserves the exact invoice number exported from your ERP system.</p>
                      </div>
                      <div className="bg-[var(--ember-surface-raised)] p-3 rounded-lg border border-[var(--ember-border)]">
                        <p className="font-semibold text-[var(--ember-text-primary)] mb-1">Rule 2: Alphabetical Suffix Allocation</p>
                        <p className="text-[11px] text-[var(--ember-text-muted)]">Subsequent rate groups append uppercase alphabetical labels (A, B, C...) to ensure voucher line integrity in Tally Prime.</p>
                      </div>
                      <div className="bg-[var(--ember-surface-raised)] p-3 rounded-lg border border-[var(--ember-border)]">
                        <p className="font-semibold text-[var(--ember-text-primary)] mb-1">Rule 3: Cancelled Invoice Shield</p>
                        <p className="text-[11px] text-[var(--ember-text-muted)]">Invoices flagged as Draft or Cancelled are automatically excluded from Tally exports.</p>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* Sub-Tab 2: Monthly Sales Performance */}
              {reportSubTab === "monthly" && (
                <div className="ember-card p-6 space-y-6">
                  <div className="flex items-center justify-between border-b border-[var(--ember-border)] pb-4">
                    <h3 className="text-sm font-bold font-serif text-[var(--ember-primary)] uppercase tracking-wider">
                      Monthly Outward Sales Register Summary
                    </h3>
                    <button
                      onClick={loadMonthlySales}
                      className="text-xs text-[var(--ember-primary)] hover:underline font-semibold flex items-center gap-1 cursor-pointer"
                    >
                      <RefreshCw className="w-3.5 h-3.5" /> Refresh Data
                    </button>
                  </div>

                  {loadingReports ? (
                    <div className="p-8 text-center text-[var(--ember-text-muted)] text-xs flex justify-center items-center gap-2">
                      <RefreshCw className="w-4 h-4 animate-spin text-[var(--ember-primary)]" />
                      Loading monthly aggregates...
                    </div>
                  ) : (
                    <div className="border border-[var(--ember-border)] rounded-lg overflow-hidden bg-[var(--ember-surface-raised)] text-xs">
                      <table className="w-full text-left border-collapse">
                        <thead>
                          <tr className="bg-[var(--ember-surface)] text-[var(--ember-text-secondary)] font-bold border-b border-[var(--ember-border)]">
                            <th className="p-3">Month</th>
                            <th className="p-3 text-right">Invoice Count</th>
                            <th className="p-3 text-right">Taxable Value (₹)</th>
                            <th className="p-3 text-right">CGST (₹)</th>
                            <th className="p-3 text-right">SGST (₹)</th>
                            <th className="p-3 text-right">IGST (₹)</th>
                            <th className="p-3 text-right">Gross Total (₹)</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-[var(--ember-border-subtle)]">
                          {monthlySales.map((row, idx) => (
                            <tr key={idx} className="hover:bg-[var(--ember-surface)] text-[var(--ember-text-secondary)] transition-colors">
                              <td className="p-3 font-semibold text-[var(--ember-text-primary)] font-mono">{row.month_label}</td>
                              <td className="p-3 text-right font-mono text-[var(--ember-text-muted)]">{row.invoice_count}</td>
                              <td className="p-3 text-right font-mono text-[var(--ember-text-primary)]">₹{row.total_taxable.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td>
                              <td className="p-3 text-right font-mono text-emerald-700 dark:text-emerald-400">₹{row.total_cgst.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td>
                              <td className="p-3 text-right font-mono text-emerald-700 dark:text-emerald-400">₹{row.total_sgst.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td>
                              <td className="p-3 text-right font-mono text-blue-700 dark:text-blue-400">₹{row.total_igst.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td>
                              <td className="p-3 text-right font-mono font-bold text-[var(--ember-primary)]">₹{row.total_value.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td>
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
                <div className="ember-card p-6 space-y-6">
                  <h3 className="text-sm font-bold font-serif text-[var(--ember-primary)] uppercase tracking-wider border-b border-[var(--ember-border)] pb-4">
                    GST Tax Liability Breakdown by Rate Tier
                  </h3>

                  <div className="border border-[var(--ember-border)] rounded-lg overflow-hidden bg-[var(--ember-surface-raised)] text-xs">
                    <table className="w-full text-left border-collapse">
                      <thead>
                        <tr className="bg-[var(--ember-surface)] text-[var(--ember-text-secondary)] font-bold border-b border-[var(--ember-border)]">
                          <th className="p-3">GST Rate Tier</th>
                          <th className="p-3 text-right">Invoices</th>
                          <th className="p-3 text-right">Assessable Value (₹)</th>
                          <th className="p-3 text-right">CGST (₹)</th>
                          <th className="p-3 text-right">SGST (₹)</th>
                          <th className="p-3 text-right">IGST (₹)</th>
                          <th className="p-3 text-right">Total Tax (₹)</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-[var(--ember-border-subtle)]">
                        {gstRateSummary.length === 0 ? (
                          <tr>
                            <td colSpan={7} className="p-6 text-center text-[var(--ember-text-muted)]">
                              No GST data found for date range filter. Select dates above and click Filter.
                            </td>
                          </tr>
                        ) : (
                          gstRateSummary.map((row, idx) => (
                            <tr key={idx} className="hover:bg-[var(--ember-surface)] text-[var(--ember-text-secondary)] transition-colors">
                              <td className="p-3 font-semibold text-[var(--ember-text-primary)] flex items-center gap-2">
                                <span className="w-2 h-2 rounded-full bg-[var(--ember-primary)]"></span>
                                {row.gst_rate}% GST Tier
                              </td>
                              <td className="p-3 text-right font-mono text-[var(--ember-text-muted)]">{row.invoice_count}</td>
                              <td className="p-3 text-right font-mono text-[var(--ember-text-primary)]">₹{row.taxable_amount.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td>
                              <td className="p-3 text-right font-mono text-emerald-700 dark:text-emerald-400">₹{row.cgst_amount.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td>
                              <td className="p-3 text-right font-mono text-emerald-700 dark:text-emerald-400">₹{row.sgst_amount.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td>
                              <td className="p-3 text-right font-mono text-blue-700 dark:text-blue-400">₹{row.igst_amount.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td>
                              <td className="p-3 text-right font-mono font-bold text-[var(--ember-primary)]">₹{row.total_tax.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td>
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
                <div className="ember-card p-6 space-y-6">
                  <h3 className="text-sm font-bold font-serif text-[var(--ember-primary)] uppercase tracking-wider border-b border-[var(--ember-border)] pb-4">
                    Top 10 Customers Revenue Ranking
                  </h3>

                  <div className="border border-[var(--ember-border)] rounded-lg overflow-hidden bg-[var(--ember-surface-raised)] text-xs">
                    <table className="w-full text-left border-collapse">
                      <thead>
                        <tr className="bg-[var(--ember-surface)] text-[var(--ember-text-secondary)] font-bold border-b border-[var(--ember-border)]">
                          <th className="p-3 w-16 text-center">Rank</th>
                          <th className="p-3">Customer Code</th>
                          <th className="p-3">Customer Name</th>
                          <th className="p-3 text-right">Invoices Billed</th>
                          <th className="p-3 text-right">Total Revenue (₹)</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-[var(--ember-border-subtle)]">
                        {topCustomers.length === 0 ? (
                          <tr>
                            <td colSpan={5} className="p-6 text-center text-[var(--ember-text-muted)]">
                              No customer revenue data for selected date range filter.
                            </td>
                          </tr>
                        ) : (
                          topCustomers.map((row) => (
                            <tr key={row.rank} className="hover:bg-[var(--ember-surface)] text-[var(--ember-text-secondary)] transition-colors">
                              <td className="p-3 text-center font-bold font-mono text-[var(--ember-primary)]">#{row.rank}</td>
                              <td className="p-3 font-mono font-semibold text-[var(--ember-text-primary)]">{row.code}</td>
                              <td className="p-3 text-[var(--ember-text-primary)] font-medium">{row.name}</td>
                              <td className="p-3 text-right font-mono text-[var(--ember-text-muted)]">{row.invoice_count}</td>
                              <td className="p-3 text-right font-mono font-bold text-emerald-700 dark:text-emerald-400">
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
                <div className="ember-card p-6 space-y-6">
                  <h3 className="text-sm font-bold font-serif text-[var(--ember-primary)] uppercase tracking-wider border-b border-[var(--ember-border)] pb-4">
                    Top Part Numbers Sales Matrix
                  </h3>

                  <div className="border border-[var(--ember-border)] rounded-lg overflow-hidden bg-[var(--ember-surface-raised)] text-xs">
                    <table className="w-full text-left border-collapse">
                      <thead>
                        <tr className="bg-[var(--ember-surface)] text-[var(--ember-text-secondary)] font-bold border-b border-[var(--ember-border)]">
                          <th className="p-3 w-16 text-center">Rank</th>
                          <th className="p-3">Part Code</th>
                          <th className="p-3">Part Description</th>
                          <th className="p-3 text-right">Quantity Sold</th>
                          <th className="p-3 text-right">Invoices</th>
                          <th className="p-3 text-right">Total Revenue (₹)</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-[var(--ember-border-subtle)]">
                        {topItems.length === 0 ? (
                          <tr>
                            <td colSpan={6} className="p-6 text-center text-[var(--ember-text-muted)]">
                              No part sales data for selected date range filter.
                            </td>
                          </tr>
                        ) : (
                          topItems.map((row) => (
                            <tr key={row.rank} className="hover:bg-[var(--ember-surface)] text-[var(--ember-text-secondary)] transition-colors">
                              <td className="p-3 text-center font-bold font-mono text-[var(--ember-primary)]">#{row.rank}</td>
                              <td className="p-3 font-mono font-semibold text-[var(--ember-text-primary)]">{row.code}</td>
                              <td className="p-3 text-[var(--ember-text-primary)] font-medium">{row.name}</td>
                              <td className="p-3 text-right font-mono text-[var(--ember-text-muted)]">{row.total_qty.toLocaleString()}</td>
                              <td className="p-3 text-right font-mono text-[var(--ember-text-muted)]">{row.invoice_count}</td>
                              <td className="p-3 text-right font-mono font-bold text-emerald-700 dark:text-emerald-400">
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
            <div className="space-y-4 w-full">
              {/* Settings Customization Header Bar */}
              <div className="flex items-center justify-between text-xs px-1">
                <div className="flex items-center gap-2 text-[var(--ember-text-secondary)]">
                  <LayoutGrid className="w-4 h-4 text-[var(--ember-primary)]" />
                  <span className="font-semibold text-[var(--ember-text-primary)]">Customizable Settings Grid</span>
                  <span className="text-[10px] text-[var(--ember-text-muted)] italic">
                    (Drag handle to reorder cards • Click 1x/2x/Full to resize)
                  </span>
                </div>

                <button
                  onClick={resetSettingsLayout}
                  className="ember-btn-secondary px-3 py-1.5 text-xs flex items-center gap-1.5 cursor-pointer"
                  title="Restore default settings arrangement"
                >
                  <RotateCcw className="w-3.5 h-3.5" /> Reset Settings Layout
                </button>
              </div>

              {/* Dynamic Settings Grid */}
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {settingsLayout.map((item) => {
                  const idx = settingsLayout.findIndex((l) => l.id === item.id);
                  const canMovePrev = idx > 0;
                  const canMoveNext = idx < settingsLayout.length - 1;

                  switch (item.id) {
                    case "company_profile":
                      return (
                        <DraggableCard
                          key={item.id}
                          id={item.id}
                          title="Company Profile Master"
                          colSpan={item.colSpan}
                          onColSpanChange={handleSettingsColSpanChange}
                          onDragStart={handleSettingsDragStart}
                          onDragOver={(_e, _id) => {}}
                          onDrop={handleSettingsDrop}
                          onDragEnd={handleSettingsDragEnd}
                          onMove={handleMoveSettingsCard}
                          canMovePrev={canMovePrev}
                          canMoveNext={canMoveNext}
                          positionIndex={idx}
                          totalCards={settingsLayout.length}
                          isDragging={draggedSettingsId === item.id}
                        >
                          <CompanyProfileForm />
                        </DraggableCard>
                      );

                    case "db_switcher":
                      return (
                        <DraggableCard
                          key={item.id}
                          id={item.id}
                          title="Database Connection Switcher"
                          colSpan={item.colSpan}
                          onColSpanChange={handleSettingsColSpanChange}
                          onDragStart={handleSettingsDragStart}
                          onDragOver={(_e, _id) => {}}
                          onDrop={handleSettingsDrop}
                          onDragEnd={handleSettingsDragEnd}
                          onMove={handleMoveSettingsCard}
                          canMovePrev={canMovePrev}
                          canMoveNext={canMoveNext}
                          positionIndex={idx}
                          totalCards={settingsLayout.length}
                          isDragging={draggedSettingsId === item.id}
                        >
                          <div className="space-y-4 flex flex-col justify-between flex-1">
                            <div>
                              <p className="text-xs text-[var(--ember-text-muted)] mb-4">
                                Authenticate and switch encrypted SQLite connection profiles.
                              </p>
                              <div className="space-y-3">
                                <div>
                                  <label className="block text-xs font-semibold text-[var(--ember-text-secondary)] mb-1">
                                    Company Code Profile
                                  </label>
                                  <input
                                    type="text"
                                    value={companyCode}
                                    onChange={(e) => setCompanyCode(e.target.value.trim().toUpperCase())}
                                    disabled={isConnected}
                                    className="w-full ember-input p-2.5 text-xs font-mono disabled:opacity-50"
                                  />
                                </div>
                                <div>
                                  <label className="block text-xs font-semibold text-[var(--ember-text-secondary)] mb-1">
                                    SQLCipher Encryption Password
                                  </label>
                                  <input
                                    type="password"
                                    value={encryptionKey}
                                    onChange={(e) => setEncryptionKey(e.target.value)}
                                    disabled={isConnected}
                                    className="w-full ember-input p-2.5 text-xs font-mono disabled:opacity-50"
                                  />
                                </div>
                              </div>
                            </div>
                            <div className="pt-4 border-t border-[var(--ember-border)] space-y-2">
                              {!isConnected && (
                                <button
                                  type="button"
                                  onClick={handleConnectDemo}
                                  className="w-full bg-emerald-700/20 hover:bg-emerald-700/40 text-emerald-300 border border-emerald-600/40 font-semibold text-xs py-2 px-3 rounded-lg transition-colors flex items-center justify-center gap-1.5 cursor-pointer shadow-sm"
                                >
                                  <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
                                  Quick Login to DEMO Account
                                </button>
                              )}
                              {isConnected ? (
                                <button
                                  onClick={handleDisconnect}
                                  className="bg-rose-600 hover:bg-rose-500 text-white font-semibold text-xs px-5 py-2.5 rounded-lg transition-colors flex items-center justify-center gap-1.5 cursor-pointer w-full"
                                >
                                  Disconnect Profile Connection
                                </button>
                              ) : (
                                <button
                                  onClick={() => handleConnect()}
                                  className="ember-btn-primary px-5 py-2.5 text-xs cursor-pointer w-full justify-center"
                                >
                                  Connect & Authenticate Profile
                                </button>
                              )}
                            </div>
                          </div>
                        </DraggableCard>
                      );

                    case "tally_code":
                      return (
                        <DraggableCard
                          key={item.id}
                          id={item.id}
                          title="Tally Register Code Setting"
                          colSpan={item.colSpan}
                          onColSpanChange={handleSettingsColSpanChange}
                          onDragStart={handleSettingsDragStart}
                          onDragOver={(_e, _id) => {}}
                          onDrop={handleSettingsDrop}
                          onDragEnd={handleSettingsDragEnd}
                          onMove={handleMoveSettingsCard}
                          canMovePrev={canMovePrev}
                          canMoveNext={canMoveNext}
                          positionIndex={idx}
                          totalCards={settingsLayout.length}
                          isDragging={draggedSettingsId === item.id}
                        >
                          <div className="space-y-4 flex flex-col justify-between flex-1">
                            <div>
                              <h5 className="text-xs font-bold font-mono text-[var(--ember-primary)]">tally_register_code</h5>
                              <p className="text-xs text-[var(--ember-text-muted)] mt-1">
                                Register code (RE) written on every generated Tally export row — unconfirmed upstream constant.
                              </p>
                            </div>
                            <div className="flex items-center gap-3 pt-2">
                              <input
                                type="text"
                                value={tallyRegisterCode}
                                onChange={(e) => setTallyRegisterCode(e.target.value.toUpperCase())}
                                placeholder="TF"
                                className="w-36 ember-input p-2.5 text-sm font-mono font-bold"
                              />
                              <button
                                onClick={handleSaveTallyRegisterCode}
                                disabled={isSavingRegisterCode}
                                className="ember-btn-secondary px-5 py-2.5 text-xs cursor-pointer flex-1 justify-center"
                              >
                                {isSavingRegisterCode ? "Saving..." : "Save"}
                              </button>
                            </div>
                          </div>
                        </DraggableCard>
                      );

                    case "db_maintenance":
                      return (
                        <DraggableCard
                          key={item.id}
                          id={item.id}
                          title="Database File Maintenance"
                          colSpan={item.colSpan}
                          onColSpanChange={handleSettingsColSpanChange}
                          onDragStart={handleSettingsDragStart}
                          onDragOver={(_e, _id) => {}}
                          onDrop={handleSettingsDrop}
                          onDragEnd={handleSettingsDragEnd}
                          onMove={handleMoveSettingsCard}
                          canMovePrev={canMovePrev}
                          canMoveNext={canMoveNext}
                          positionIndex={idx}
                          totalCards={settingsLayout.length}
                          isDragging={draggedSettingsId === item.id}
                        >
                          <div className="space-y-4 flex flex-col justify-between flex-1">
                            <p className="text-xs text-[var(--ember-text-muted)]">
                              SQLite integrity verification and VACUUM defragmentation.
                            </p>
                            <div className="space-y-3">
                              <div className="bg-[var(--ember-surface-raised)] p-3 rounded-xl border border-[var(--ember-border)] space-y-2">
                                <h5 className="text-xs font-bold text-[var(--ember-text-primary)] flex items-center gap-1.5">
                                  <CheckCircle className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" /> Integrity Check
                                </h5>
                                <button
                                  onClick={handleCheckIntegrity}
                                  disabled={isCheckingIntegrity}
                                  className="w-full ember-btn-secondary py-1.5 text-xs cursor-pointer flex items-center justify-center gap-2"
                                >
                                  {isCheckingIntegrity ? "Verifying..." : "Run PRAGMA Integrity Check"}
                                </button>
                              </div>
                              <div className="bg-[var(--ember-surface-raised)] p-3 rounded-xl border border-[var(--ember-border)] space-y-2">
                                <h5 className="text-xs font-bold text-[var(--ember-text-primary)] flex items-center gap-1.5">
                                  <RefreshCw className="w-3.5 h-3.5 text-[var(--ember-primary)]" /> Storage Defrag
                                </h5>
                                <button
                                  onClick={handleVacuumDb}
                                  disabled={isVacuuming}
                                  className="w-full ember-btn-primary py-1.5 text-xs cursor-pointer flex items-center justify-center gap-2"
                                >
                                  {isVacuuming ? "Optimizing..." : "Execute VACUUM & ANALYZE"}
                                </button>
                              </div>
                            </div>
                            {maintenanceResult && (
                              <div className={`p-3 rounded-xl border text-[11px] ${
                                maintenanceResult.status === "HEALTHY" || maintenanceResult.status === "OPTIMIZED"
                                  ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-800 dark:text-emerald-200"
                                  : "bg-rose-500/10 border-rose-500/30 text-rose-800 dark:text-rose-200"
                              }`}>
                                <div className="font-bold">{maintenanceResult.routine} [{maintenanceResult.status}]</div>
                                <p className="mt-0.5">{maintenanceResult.details}</p>
                              </div>
                            )}
                          </div>
                        </DraggableCard>
                      );

                    case "backup_manager":
                      return (
                        <DraggableCard
                          key={item.id}
                          id={item.id}
                          title="Backup & Recovery Manager"
                          colSpan={item.colSpan}
                          onColSpanChange={handleSettingsColSpanChange}
                          onDragStart={handleSettingsDragStart}
                          onDragOver={(_e, _id) => {}}
                          onDrop={handleSettingsDrop}
                          onDragEnd={handleSettingsDragEnd}
                          onMove={handleMoveSettingsCard}
                          canMovePrev={canMovePrev}
                          canMoveNext={canMoveNext}
                          positionIndex={idx}
                          totalCards={settingsLayout.length}
                          isDragging={draggedSettingsId === item.id}
                        >
                          <div className="space-y-4 flex flex-col justify-between flex-1">
                            <p className="text-xs text-[var(--ember-text-muted)]">
                              Export encrypted database backups for disaster recovery.
                            </p>

                            {backupStatus && backupStatus.is_backup_due && (
                              <div className="bg-amber-500/10 border border-amber-500/30 rounded-xl p-3 flex gap-2 text-amber-800 dark:text-amber-200 text-xs">
                                <AlertTriangle className="w-4 h-4 flex-shrink-0 text-amber-600 dark:text-amber-400 mt-0.5" />
                                <div>
                                  <h5 className="font-bold">Backup Recommended</h5>
                                  <p className="text-[11px] mt-0.5">
                                    {backupStatus.days_since_backup} days since last recorded backup.
                                  </p>
                                </div>
                              </div>
                            )}

                            <div className="bg-[var(--ember-surface-raised)] p-3 rounded-xl border border-[var(--ember-border)] space-y-2">
                              <div className="text-[11px] text-[var(--ember-text-muted)] font-mono">
                                <p>Profile: {companyCode}</p>
                                <p>Last: {backupStatus?.last_backup_at ? new Date(backupStatus.last_backup_at).toLocaleDateString() : "Never"}</p>
                              </div>
                              <button
                                onClick={handleCreateBackup}
                                disabled={isBackingUp}
                                className="ember-btn-primary px-4 py-2 text-xs flex items-center justify-center gap-2 cursor-pointer w-full"
                              >
                                {isBackingUp ? "Compiling Backup..." : "Create Instant Backup"}
                              </button>
                            </div>
                          </div>
                        </DraggableCard>
                      );

                    case "app_updater":
                      return (
                        <DraggableCard
                          key={item.id}
                          id={item.id}
                          title="Application Updater"
                          colSpan={item.colSpan}
                          onColSpanChange={handleSettingsColSpanChange}
                          onDragStart={handleSettingsDragStart}
                          onDragOver={(_e, _id) => {}}
                          onDrop={handleSettingsDrop}
                          onDragEnd={handleSettingsDragEnd}
                          onMove={handleMoveSettingsCard}
                          canMovePrev={canMovePrev}
                          canMoveNext={canMoveNext}
                          positionIndex={idx}
                          totalCards={settingsLayout.length}
                          isDragging={draggedSettingsId === item.id}
                        >
                          <UpdateCard />
                        </DraggableCard>
                      );

                    default:
                      return null;
                  }
                })}
              </div>
            </div>
          )}
        </div>

        {/* Invoice Details Inspect Modal */}
        {isDetailOpen && (
          <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex justify-center items-center p-2 sm:p-4 overflow-y-auto">
            <div
              className={`bg-[var(--ember-surface)] border border-[var(--ember-border)] w-full rounded-2xl shadow-2xl overflow-hidden flex flex-col transition-all duration-200 text-xs font-sans ${
                inspectWindowSize === "1x"
                  ? "max-w-7xl max-h-[95vh]"
                  : inspectWindowSize === "2x"
                  ? "w-[90vw] max-w-[90vw] max-h-[95vh]"
                  : "w-[98vw] max-w-none h-[96vh] max-h-[96vh]"
              }`}
            >
              {loadingDetails ? (
                <div className="flex-1 flex flex-col items-center justify-center p-12 text-[var(--ember-text-muted)]">
                  <RefreshCw className="w-8 h-8 animate-spin text-[var(--ember-primary)] mb-3" />
                  <span>Loading invoice record and lines...</span>
                </div>
              ) : selectedInvoice ? (
                <div className="flex-1 flex flex-col justify-between overflow-hidden">
                  {/* Modal Header */}
                  <div className="px-6 py-3.5 border-b border-[var(--ember-border)] flex justify-between items-center bg-[var(--ember-surface-raised)] select-none">
                    <div className="flex items-center gap-3">
                      <div className="p-2 bg-[var(--ember-primary-light)] text-[var(--ember-primary)] rounded-lg">
                        <FileText className="w-5 h-5" />
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <h2 className="text-base font-bold font-serif text-[var(--ember-text-primary)]">
                            Inspect Sales Invoice
                          </h2>
                          <span className="px-2 py-0.5 rounded bg-[var(--ember-surface)] border border-[var(--ember-border)] font-mono text-[10px] text-[var(--ember-primary)]">
                            v{selectedInvoice.version || 1}
                          </span>
                        </div>
                        <p className="text-[11px] text-[var(--ember-text-muted)] font-mono mt-0.5">
                          Invoice No: <span className="font-bold text-[var(--ember-text-primary)]">{selectedInvoice.invoice_number}</span> | Date: {selectedInvoice.invoice_date}
                        </p>
                      </div>
                    </div>

                    <div className="flex items-center gap-3">
                      {/* 1x | 2x | Full Size Switcher Segmented Control */}
                      <div className="flex items-center gap-1 bg-[var(--ember-surface)] p-1 rounded-xl border border-[var(--ember-border)] select-none">
                        <button
                          type="button"
                          onClick={() => setInspectWindowSize("1x")}
                          className={`px-2.5 py-1 rounded-lg text-[11px] font-mono font-bold transition-all cursor-pointer ${
                            inspectWindowSize === "1x"
                              ? "bg-[var(--ember-primary)] text-white shadow-xs"
                              : "text-[var(--ember-text-muted)] hover:text-[var(--ember-text-primary)] hover:bg-[var(--ember-surface-raised)]"
                          }`}
                          title="Standard Mode (1x)"
                        >
                          1x
                        </button>

                        <button
                          type="button"
                          onClick={() => setInspectWindowSize("2x")}
                          className={`px-2.5 py-1 rounded-lg text-[11px] font-mono font-bold transition-all cursor-pointer ${
                            inspectWindowSize === "2x"
                              ? "bg-[var(--ember-primary)] text-white shadow-xs"
                              : "text-[var(--ember-text-muted)] hover:text-[var(--ember-text-primary)] hover:bg-[var(--ember-surface-raised)]"
                          }`}
                          title="Widescreen Mode (2x)"
                        >
                          2x
                        </button>

                        <button
                          type="button"
                          onClick={() => setInspectWindowSize("full")}
                          className={`px-2.5 py-1 rounded-lg text-[11px] font-mono font-bold transition-all cursor-pointer flex items-center gap-1 ${
                            inspectWindowSize === "full"
                              ? "bg-[var(--ember-primary)] text-white shadow-xs"
                              : "text-[var(--ember-text-muted)] hover:text-[var(--ember-text-primary)] hover:bg-[var(--ember-surface-raised)]"
                          }`}
                          title="Full Screen Mode"
                        >
                          <Maximize2 className="w-3 h-3" /> Full
                        </button>
                      </div>

                      <button
                        onClick={() => setIsDetailOpen(false)}
                        className="p-1.5 rounded-lg hover:bg-[var(--ember-surface)] text-[var(--ember-text-muted)] hover:text-[var(--ember-text-primary)] transition-colors cursor-pointer"
                        title="Close Inspector (Esc)"
                      >
                        <X className="w-5 h-5" />
                      </button>
                    </div>
                  </div>

                  {/* Modal Scrollable Body */}
                  <div className="p-6 flex-1 overflow-y-auto space-y-6">
                    <div className="grid grid-cols-3 gap-6 bg-[var(--ember-surface-raised)] p-4 rounded-xl border border-[var(--ember-border)]">
                      <div>
                        <span className="text-[10px] text-[var(--ember-text-muted)] font-semibold block">Invoice Date</span>
                        <span className="text-xs text-[var(--ember-text-primary)] font-mono mt-1 inline-flex items-center gap-1">
                          <Calendar className="w-3.5 h-3.5 text-[var(--ember-text-muted)]" /> {selectedInvoice.invoice_date}
                        </span>
                      </div>
                      <div>
                        <span className="text-[10px] text-[var(--ember-text-muted)] font-semibold block">Supply Destination</span>
                        <span className="text-xs text-[var(--ember-text-primary)] mt-1 block truncate">
                          {selectedInvoice.place_of_supply || "Not Specified"}
                        </span>
                      </div>
                      <div>
                        <span className="text-[10px] text-[var(--ember-text-muted)] font-semibold block">Active Status</span>
                        <span
                          className={`mt-1 inline-block px-2.5 py-1 ember-chip ${
                            selectedInvoice.status === "Verified"
                              ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border border-emerald-500/30"
                              : selectedInvoice.status === "Cancelled"
                              ? "bg-rose-500/15 text-rose-700 dark:text-rose-300 border border-rose-500/30"
                              : "bg-orange-500/15 text-[var(--ember-primary)] border border-orange-500/30"
                          }`}
                        >
                          {selectedInvoice.status}
                        </span>
                      </div>
                    </div>

                    <div className="grid grid-cols-4 gap-4 bg-[var(--ember-surface-raised)] p-4 rounded-xl border border-[var(--ember-border)]">
                      <div>
                        <span className="text-[10px] text-[var(--ember-text-muted)] block">Taxable Total</span>
                        <span className="text-sm font-bold text-[var(--ember-text-primary)] font-mono">
                          ₹{selectedInvoice.total_taxable.toLocaleString("en-IN", { minimumFractionDigits: 2 })}
                        </span>
                      </div>
                      <div>
                        <span className="text-[10px] text-[var(--ember-text-muted)] block">CGST Total</span>
                        <span className="text-sm font-mono text-[var(--ember-text-secondary)]">
                          ₹{selectedInvoice.total_cgst.toLocaleString("en-IN", { minimumFractionDigits: 2 })}
                        </span>
                      </div>
                      <div>
                        <span className="text-[10px] text-[var(--ember-text-muted)] block">SGST Total</span>
                        <span className="text-sm font-mono text-[var(--ember-text-secondary)]">
                          ₹{selectedInvoice.total_sgst.toLocaleString("en-IN", { minimumFractionDigits: 2 })}
                        </span>
                      </div>
                      <div>
                        <span className="text-[10px] text-[var(--ember-text-muted)] block">Total Value</span>
                        <span className="text-sm font-bold text-[var(--ember-primary)] font-mono">
                          ₹{selectedInvoice.total_value.toLocaleString("en-IN", { minimumFractionDigits: 2 })}
                        </span>
                      </div>
                    </div>

                    <div className="space-y-2">
                      <h4 className="text-xs font-bold font-serif text-[var(--ember-text-primary)] uppercase tracking-wider">Invoice Line Items</h4>
                      <div className="border border-[var(--ember-border)] rounded-lg overflow-hidden bg-[var(--ember-surface-raised)] text-xs">
                        <table className="w-full text-left border-collapse">
                          <thead>
                            <tr className="bg-[var(--ember-surface)] text-[var(--ember-text-secondary)] font-bold border-b border-[var(--ember-border)]">
                              <th className="p-3">Part Details</th>
                              <th className="p-3 text-right">Qty</th>
                              <th className="p-3 text-right">Rate</th>
                              <th className="p-3 text-right">Taxable</th>
                              <th className="p-3 text-right">Gross</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-[var(--ember-border-subtle)]">
                            {selectedInvoiceItems.map((item, idx) => (
                              <tr key={idx} className="hover:bg-[var(--ember-surface)] transition-colors">
                                <td className="p-3">
                                  <div className="font-semibold text-[var(--ember-text-primary)]">{item.part_code}</div>
                                </td>
                                <td className="p-3 text-right font-mono text-[var(--ember-text-secondary)]">{item.quantity}</td>
                                <td className="p-3 text-right font-mono text-[var(--ember-text-muted)]">₹{item.rate_pre_unit.toFixed(2)}</td>
                                <td className="p-3 text-right font-mono text-[var(--ember-text-secondary)]">₹{item.assessable_value.toFixed(2)}</td>
                                <td className="p-3 text-right font-mono font-bold text-[var(--ember-primary)]">₹{item.total_value.toFixed(2)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>

                    <div className="space-y-2">
                      <h4 className="text-xs font-bold font-serif text-[var(--ember-text-primary)] uppercase tracking-wider flex items-center gap-1.5">
                        <Clock className="w-4 h-4 text-[var(--ember-primary)]" /> Audit Log History
                      </h4>
                      {selectedInvoiceAuditLogs.length === 0 ? (
                        <p className="text-[10px] text-[var(--ember-text-muted)] italic bg-[var(--ember-surface-raised)] p-3 rounded-lg border border-[var(--ember-border)]">
                          No modification logs found for this invoice.
                        </p>
                      ) : (
                        <div className="border border-[var(--ember-border)] rounded-lg overflow-hidden bg-[var(--ember-surface-raised)] text-[10px]">
                          <table className="w-full text-left border-collapse">
                            <thead>
                              <tr className="bg-[var(--ember-surface)] text-[var(--ember-text-secondary)] font-bold border-b border-[var(--ember-border)]">
                                <th className="p-3">Timestamp</th>
                                <th className="p-3">User Action</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-[var(--ember-border-subtle)]">
                              {selectedInvoiceAuditLogs.map((log, idx) => (
                                <tr key={idx} className="hover:bg-[var(--ember-surface)] text-[var(--ember-text-secondary)] transition-colors">
                                  <td className="p-3 text-[var(--ember-text-muted)] font-mono">{log.timestamp}</td>
                                  <td className="p-3 font-medium">{log.user_action}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Modal Footer */}
                  <div className="p-6 border-t border-[var(--ember-border)] bg-[var(--ember-surface-raised)] flex justify-between gap-4">
                    <button
                      onClick={handleDeleteRecord}
                      className="bg-rose-500/10 text-rose-600 dark:text-rose-400 border border-rose-500/30 hover:bg-rose-500/20 font-semibold text-xs px-4 py-2 rounded-lg flex items-center gap-1.5 cursor-pointer"
                    >
                      <Trash2 className="w-4 h-4" /> Delete Record
                    </button>

                    <div className="flex gap-2">
                      <button
                        onClick={() => handleStartEditInspector(selectedInvoice.invoice_number)}
                        className="ember-btn-secondary px-4 py-2 text-xs flex items-center gap-1.5 cursor-pointer text-[var(--ember-primary)] font-semibold"
                      >
                        <Edit2 className="w-4 h-4" /> Edit Record
                      </button>
                      {selectedInvoice.status === "Cancelled" && (
                        <button
                          onClick={handleAutoGenerateCreditNote}
                          className="ember-btn-primary px-4 py-2 text-xs flex items-center gap-1.5 cursor-pointer"
                        >
                          <PlusCircle className="w-4 h-4" /> Auto-generate Credit Note
                        </button>
                      )}
                      {selectedInvoice.status !== "Cancelled" && selectedInvoice.status !== "Credit Note Generated" && (
                        <button
                          onClick={() => handleUpdateStatus("Cancelled")}
                          className="ember-btn-secondary px-4 py-2 text-xs cursor-pointer"
                        >
                          Cancel Invoice
                        </button>
                      )}
                      {selectedInvoice.status !== "Verified" && selectedInvoice.status !== "Credit Note Generated" && (
                        <button
                          onClick={() => handleUpdateStatus("Verified")}
                          className="ember-btn-primary px-5 py-2 text-xs flex items-center gap-1.5 cursor-pointer"
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

        {/* Global Invoice Edit Modal */}
        {editingInvoiceNumber && (
          <InvoiceEditModal
            invoiceNumber={editingInvoiceNumber}
            onClose={() => setEditingInvoiceNumber(null)}
            onSaved={handleSavedEditInspector}
          />
        )}

        {/* Record New Revision Dialog Modal */}
        {isRevisionModalOpen && (
          <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
            <div className="w-full max-w-lg ember-card p-6 shadow-2xl relative">
              <h3 className="text-sm font-bold font-serif text-[var(--ember-primary)] uppercase tracking-wider mb-6">
                Record Supplier Price Revision
              </h3>

              <form onSubmit={handleCreateRevision} className="space-y-4 text-xs">
                <div>
                  <label className="block text-[var(--ember-text-secondary)] mb-1.5 font-semibold">Select Supplier</label>
                  <select
                    required
                    value={revSupplierId}
                    onChange={(e) => setRevSupplierId(Number(e.target.value))}
                    className="w-full ember-input p-2.5"
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
                  <label className="block text-[var(--ember-text-secondary)] mb-1.5 font-semibold">Part / Item Code</label>
                  <input
                    required
                    type="text"
                    placeholder="e.g. 8708.99.00"
                    value={revPartCode}
                    onChange={(e) => setRevPartCode(e.target.value)}
                    className="w-full ember-input p-2.5 font-mono"
                  />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-[var(--ember-text-secondary)] mb-1.5 font-semibold">Old Rate (₹)</label>
                    <input
                      required
                      type="number"
                      step="0.01"
                      placeholder="0.00"
                      value={revOldPrice}
                      onChange={(e) => setRevOldPrice(e.target.value === "" ? "" : Number(e.target.value))}
                      className="w-full ember-input p-2.5 font-mono"
                    />
                  </div>

                  <div>
                    <label className="block text-[var(--ember-text-secondary)] mb-1.5 font-semibold">New Rate (₹)</label>
                    <input
                      required
                      type="number"
                      step="0.01"
                      placeholder="0.00"
                      value={revNewPrice}
                      onChange={(e) => setRevNewPrice(e.target.value === "" ? "" : Number(e.target.value))}
                      className="w-full ember-input p-2.5 font-mono"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-[var(--ember-text-secondary)] mb-1.5 font-semibold">Effective Date</label>
                  <input
                    required
                    type="date"
                    value={revEffectiveDate}
                    onChange={(e) => setRevEffectiveDate(e.target.value)}
                    className="w-full ember-input p-2.5 font-mono"
                  />
                </div>

                <div>
                  <label className="block text-[var(--ember-text-secondary)] mb-1.5 font-semibold">Remarks</label>
                  <input
                    type="text"
                    placeholder="Enter revision reason..."
                    value={revRemarks}
                    onChange={(e) => setRevRemarks(e.target.value)}
                    className="w-full ember-input p-2.5"
                  />
                </div>

                <div className="flex justify-end gap-3 pt-4 border-t border-[var(--ember-border)]">
                  <button
                    type="button"
                    onClick={() => setIsRevisionModalOpen(false)}
                    className="ember-btn-secondary px-4 py-2.5 text-xs cursor-pointer"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="ember-btn-primary px-4 py-2.5 text-xs cursor-pointer"
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

      {/* Credit Note Lifecycle Modals & Print Overlays */}
      {showViewCreditNoteModal && currentCreditNoteDetails && (
        <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-md overflow-y-auto p-4 sm:p-6 flex justify-center items-start pt-6 sm:pt-10 print:hidden">
          <div className="ember-card bg-[var(--ember-surface)] border border-[var(--ember-border)] text-[var(--ember-text-primary)] w-full max-w-4xl rounded-2xl shadow-2xl overflow-hidden flex flex-col my-auto">
            {/* Modal Header */}
            <div className="px-6 py-4 border-b border-[var(--ember-border)] flex justify-between items-center bg-[var(--ember-surface-raised)]">
              <div className="flex items-center gap-3">
                <div className="p-2.5 bg-[var(--ember-primary-light)] text-[var(--ember-primary)] rounded-xl">
                  <FileText className="w-5 h-5" />
                </div>
                <div>
                  <h2 className="text-lg font-bold font-serif text-[var(--ember-text-primary)] tracking-wide flex items-center gap-2">
                    Credit Note Details: <span className="font-mono text-[var(--ember-primary)]">{selectedCreditNoteNo}</span>
                  </h2>
                  <p className="text-xs text-[var(--ember-text-muted)] font-sans mt-0.5">Audit Trail, Items & Tax Breakdown</p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => handlePrintCreditNote(selectedCreditNoteNo!)}
                  className="px-3.5 py-1.5 bg-[var(--ember-primary)] hover:bg-[var(--ember-primary-hover)] text-white text-xs font-bold rounded-lg shadow-sm cursor-pointer inline-flex items-center gap-1.5 transition-all"
                >
                  <Printer className="w-3.5 h-3.5" /> View Voucher
                </button>
                <button
                  onClick={() => setShowViewCreditNoteModal(false)}
                  className="p-1.5 text-[var(--ember-text-muted)] hover:text-[var(--ember-text-primary)] hover:bg-[var(--ember-surface-raised)] rounded-lg transition-colors cursor-pointer"
                  title="Close modal"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>
            
            {/* Modal Content */}
            <div className="p-6 space-y-6 flex-1 overflow-y-auto max-h-[75vh]">
              {/* Metadata Cards */}
              <div className="grid grid-cols-3 gap-4 text-xs font-sans">
                <div className="bg-[var(--ember-bg)] border border-[var(--ember-border)] rounded-xl p-4 space-y-1.5 shadow-xs">
                  <span className="text-[11px] font-bold uppercase tracking-wider text-[var(--ember-primary)] block mb-1">Document Info</span>
                  <div><span className="font-semibold text-[var(--ember-text-secondary)]">Invoice:</span> <span className="font-mono font-bold text-[var(--ember-text-primary)]">{currentCreditNoteDetails.header.invoice_number}</span></div>
                  <div><span className="font-semibold text-[var(--ember-text-secondary)]">Date:</span> <span className="font-mono text-[var(--ember-text-primary)]">{currentCreditNoteDetails.header.credit_note_date}</span></div>
                  <div><span className="font-semibold text-[var(--ember-text-secondary)]">Revision:</span> <span className="font-mono text-[var(--ember-text-primary)]">#{currentCreditNoteDetails.header.revision_no}</span></div>
                  <div><span className="font-semibold text-[var(--ember-text-secondary)]">Created:</span> <span className="text-[var(--ember-text-muted)]">{currentCreditNoteDetails.header.created_at}</span></div>
                </div>
                
                <div className="bg-[var(--ember-bg)] border border-[var(--ember-border)] rounded-xl p-4 space-y-1.5 shadow-xs">
                  <span className="text-[11px] font-bold uppercase tracking-wider text-[var(--ember-primary)] block mb-1">Workflow / Prints</span>
                  <div className="flex items-center gap-1.5">
                    <span className="font-semibold text-[var(--ember-text-secondary)]">Status:</span> 
                    <span className={`font-bold uppercase px-2 py-0.5 rounded text-[10px] ${
                      currentCreditNoteDetails.header.status === "Approved" ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border border-emerald-500/30" : "bg-amber-500/15 text-amber-700 dark:text-amber-300 border border-amber-500/30"
                    }`}>
                      {currentCreditNoteDetails.header.status}
                    </span>
                  </div>
                  <div><span className="font-semibold text-[var(--ember-text-secondary)]">Print Count:</span> <span className="font-mono font-bold text-[var(--ember-text-primary)]">{currentCreditNoteDetails.header.print_count}</span></div>
                  {currentCreditNoteDetails.header.approved_by && (
                    <div><span className="font-semibold text-[var(--ember-text-secondary)]">Approved By:</span> <span className="text-[var(--ember-text-primary)]">{currentCreditNoteDetails.header.approved_by}</span></div>
                  )}
                  {currentCreditNoteDetails.header.approved_at && (
                    <div><span className="font-semibold text-[var(--ember-text-secondary)]">Approved At:</span> <span className="text-[var(--ember-text-muted)]">{currentCreditNoteDetails.header.approved_at}</span></div>
                  )}
                </div>
                
                <div className="bg-[var(--ember-bg)] border border-[var(--ember-border)] rounded-xl p-4 space-y-1.5 shadow-xs">
                  <span className="text-[11px] font-bold uppercase tracking-wider text-[var(--ember-primary)] block mb-1">Customer Snapshot</span>
                  <div className="font-bold text-[var(--ember-text-primary)] truncate">{currentCreditNoteDetails.header.frozen_customer_name}</div>
                  <div className="truncate text-[var(--ember-text-secondary)]"><span className="font-semibold">GSTIN:</span> {currentCreditNoteDetails.header.frozen_customer_gstin || "N/A"}</div>
                  <div className="truncate text-[var(--ember-text-secondary)]"><span className="font-semibold">PAN:</span> {currentCreditNoteDetails.header.frozen_customer_pan || "N/A"}</div>
                </div>
              </div>

              {/* Reasons & Remarks */}
              <div className="grid grid-cols-2 gap-4 text-xs bg-[var(--ember-bg)] border border-[var(--ember-border)] p-4 rounded-xl shadow-xs font-sans">
                <div>
                  <span className="text-[11px] font-bold uppercase tracking-wider text-[var(--ember-text-secondary)] block mb-1">Reason for Issuance</span>
                  <p className="italic text-[var(--ember-text-primary)] font-serif">{currentCreditNoteDetails.header.reason || "No reason specified"}</p>
                </div>
                <div>
                  <span className="text-[11px] font-bold uppercase tracking-wider text-[var(--ember-text-secondary)] block mb-1">Internal Remarks</span>
                  <p className="text-[var(--ember-text-secondary)]">{currentCreditNoteDetails.header.remarks || "No remarks"}</p>
                </div>
              </div>

              {/* Line Items Table */}
              <div className="space-y-2">
                <span className="text-xs font-bold uppercase tracking-wider text-[var(--ember-text-secondary)] block">Line Items</span>
                <div className="border border-[var(--ember-border)] rounded-xl overflow-hidden bg-[var(--ember-bg)] shadow-xs">
                  <table className="w-full text-left text-xs">
                    <thead>
                      <tr className="bg-[var(--ember-surface-raised)] text-[var(--ember-text-secondary)] font-bold border-b border-[var(--ember-border)] uppercase tracking-wider text-[11px]">
                        <th className="p-3">Part Code</th>
                        <th className="p-3 text-right">Credited Qty</th>
                        <th className="p-3 text-right">Unit Rate (₹)</th>
                        <th className="p-3 text-right">Taxable Value (₹)</th>
                        <th className="p-3 text-right">GST Rate</th>
                        <th className="p-3 text-right">CGST / SGST / IGST</th>
                        <th className="p-3 text-right">Total (₹)</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[var(--ember-border-subtle)] text-[var(--ember-text-secondary)] font-sans">
                      {currentCreditNoteDetails.items.map((line, idx) => (
                        <tr key={idx} className="hover:bg-[var(--ember-surface-raised)]/40 transition-colors">
                          <td className="p-3 font-mono font-bold text-[var(--ember-primary)]">{line.part_code}</td>
                          <td className="p-3 text-right font-mono font-bold text-[var(--ember-text-primary)]">{line.quantity}</td>
                          <td className="p-3 text-right font-mono">₹{line.rate_pre_unit.toFixed(2)}</td>
                          <td className="p-3 text-right font-mono">₹{line.assessable_value.toFixed(2)}</td>
                          <td className="p-3 text-right font-mono">{(line.cgst_rate + line.sgst_rate + line.igst_rate).toFixed(1)}%</td>
                          <td className="p-3 text-right font-mono text-[10px] text-[var(--ember-text-muted)]">
                            ₹{line.cgst_amount.toFixed(2)} / ₹{line.sgst_amount.toFixed(2)} / ₹{line.igst_amount.toFixed(2)}
                          </td>
                          <td className="p-3 text-right font-mono font-bold text-emerald-600 dark:text-emerald-400">₹{line.total_value.toFixed(2)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Tax Summary Totals */}
              <div className="flex justify-end font-sans">
                <div className="w-80 bg-[var(--ember-bg)] border border-[var(--ember-border)] rounded-xl p-4 space-y-2 text-xs shadow-xs">
                  <div className="flex justify-between text-[var(--ember-text-secondary)]"><span>Subtotal (Taxable):</span> <span className="font-mono font-semibold text-[var(--ember-text-primary)]">₹{currentCreditNoteDetails.tax_summary.total_taxable.toFixed(2)}</span></div>
                  <div className="flex justify-between text-[var(--ember-text-secondary)]"><span>CGST Amount:</span> <span className="font-mono text-[var(--ember-text-secondary)]">₹{currentCreditNoteDetails.tax_summary.total_cgst.toFixed(2)}</span></div>
                  <div className="flex justify-between text-[var(--ember-text-secondary)]"><span>SGST Amount:</span> <span className="font-mono text-[var(--ember-text-secondary)]">₹{currentCreditNoteDetails.tax_summary.total_sgst.toFixed(2)}</span></div>
                  <div className="flex justify-between text-[var(--ember-text-secondary)]"><span>IGST Amount:</span> <span className="font-mono text-[var(--ember-text-secondary)]">₹{currentCreditNoteDetails.tax_summary.total_igst.toFixed(2)}</span></div>
                  <div className="flex justify-between font-bold border-t border-[var(--ember-border)] pt-2 text-sm text-[var(--ember-primary)]">
                    <span>Grand Total:</span>
                    <span className="font-mono font-black text-emerald-600 dark:text-emerald-400">₹{currentCreditNoteDetails.tax_summary.total_value.toFixed(2)}</span>
                  </div>
                </div>
              </div>

              {/* Audit Timeline Log */}
              <div className="space-y-3 border-t border-[var(--ember-border)] pt-5">
                <span className="text-xs font-bold uppercase tracking-wider text-[var(--ember-text-secondary)] block">Audit Timeline Log</span>
                {currentCreditNoteDetails.audit_timeline.length === 0 ? (
                  <p className="text-xs text-[var(--ember-text-muted)] italic">No audit records found.</p>
                ) : (
                  <div className="relative border-l-2 border-[var(--ember-primary)]/40 pl-4 ml-2 space-y-4">
                    {currentCreditNoteDetails.audit_timeline.map((log) => (
                      <div key={log.id} className="relative text-xs font-sans">
                        <div className="absolute -left-[21px] top-1.5 bg-[var(--ember-primary)] rounded-full w-2.5 h-2.5"></div>
                        <div className="flex items-center gap-2 text-[var(--ember-text-secondary)] mb-0.5">
                          <span className="font-bold text-[var(--ember-text-primary)]">{log.user_action}</span>
                          <span>•</span>
                          <span className="font-mono text-[10px] text-[var(--ember-text-muted)]">{log.timestamp}</span>
                        </div>
                        {log.new_value && (
                          <div className="bg-[var(--ember-bg)] border border-[var(--ember-border)] p-2.5 rounded-lg mt-1 font-mono text-[10px] text-[var(--ember-text-secondary)] overflow-x-auto max-w-full">
                            {log.new_value}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* Modal Footer */}
            <div className="px-6 py-4 border-t border-[var(--ember-border)] bg-[var(--ember-surface-raised)] flex justify-between items-center">
              <button
                onClick={() => handlePrintCreditNote(selectedCreditNoteNo!)}
                className="ember-btn-primary px-4 py-2 text-xs flex items-center gap-1.5 cursor-pointer"
              >
                <Printer className="w-3.5 h-3.5" /> Print / Save Voucher
              </button>
              <button
                onClick={() => setShowViewCreditNoteModal(false)}
                className="ember-btn-secondary px-5 py-2 text-xs cursor-pointer"
              >
                Close View
              </button>
            </div>
          </div>
        </div>
      )}

      {showEditCreditNoteModal && selectedCreditNoteNo && (
        <CreditNoteEditModal
          creditNoteNumber={selectedCreditNoteNo}
          userName="System User"
          onClose={() => {
            setShowEditCreditNoteModal(false);
          }}
          onSaved={async (newCnNo?: string) => {
            setShowEditCreditNoteModal(false);
            if (newCnNo) {
              setSelectedCreditNoteNo(newCnNo);
            }
            await loadNotes();
          }}
        />
      )}

      {showDeleteCreditNoteModal && selectedCreditNoteNo && (
        <CreditNoteDeleteConfirmModal
          creditNoteNumber={selectedCreditNoteNo}
          userName="System User"
          onClose={() => {
            setShowDeleteCreditNoteModal(false);
            setSelectedCreditNoteNo(null);
          }}
          onDeleted={async () => {
            setShowDeleteCreditNoteModal(false);
            setSelectedCreditNoteNo(null);
            await loadNotes();
          }}
        />
      )}

      {showPrintCreditNoteModal && currentCreditNoteDetails && (
        <CreditNotePrintView
          header={currentCreditNoteDetails.header}
          items={currentCreditNoteDetails.items}
          taxSummary={currentCreditNoteDetails.tax_summary}
          userName="System User"
          onClose={() => {
            setShowPrintCreditNoteModal(false);
            setCurrentCreditNoteDetails(null);
            setSelectedCreditNoteNo(null);
          }}
          onRefresh={async () => {
            await loadNotes();
            if (selectedCreditNoteNo) {
              const res = await ApiService.getCreditNoteDetails(selectedCreditNoteNo);
              if (res) {
                setCurrentCreditNoteDetails(res);
              }
            }
          }}
        />
      )}
    </div>
  );
}

export default App;
