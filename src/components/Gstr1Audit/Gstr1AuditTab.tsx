import React, { useState, useEffect, useMemo } from "react";
import {
  Download,
  Printer,
  RefreshCw,
  Scale,
} from "lucide-react";
import { Gstr1AuditService } from "../../services/gstr1AuditService";
import {
  AuditFilterConfig,
  AuditReconItem,
  AuditSummaryMetrics,
  BooksInvoiceRecord,
  Gstr1InvoiceRecord,
} from "../../types/gstr1AuditTypes";
import { InvoiceSummary } from "../../types/bindings/InvoiceSummary";
import { Gstr1AuditKpis } from "./Gstr1AuditKpis";
import { Gstr1AuditTable } from "./Gstr1AuditTable";
import { Gstr1ImportPanel } from "./Gstr1ImportPanel";
import { Gstr1DiscrepancyModal } from "./Gstr1DiscrepancyModal";
import { Gstr1PrintReportModal } from "./Gstr1PrintReportModal";

interface Props {
  invoices?: InvoiceSummary[];
  companyCode?: string;
  companyName?: string;
}

export const Gstr1AuditTab: React.FC<Props> = ({
  invoices = [],
  companyCode: _companyCode = "DEMO",
  companyName = "Sales Monitoring System",
}) => {
  // Source Data
  const [isUsingLiveBooks, setIsUsingLiveBooks] = useState(true);
  const [booksRecords, setBooksRecords] = useState<BooksInvoiceRecord[]>([]);
  const [gstr1Records, setGstr1Records] = useState<Gstr1InvoiceRecord[]>([]);
  const [gstr1SourceName, setGstr1SourceName] = useState<string>("Sample_GSTR1_Return.json");

  // Reconciled Data & Metrics
  const [reconciledItems, setReconciledItems] = useState<AuditReconItem[]>([]);
  const [metrics, setMetrics] = useState<AuditSummaryMetrics>({
    total_records: 0,
    matched_count: 0,
    matched_percent: 0,
    value_mismatch_count: 0,
    gst_mismatch_count: 0,
    books_only_count: 0,
    gstr1_only_count: 0,
    cancelled_mismatch_count: 0,
    duplicate_count: 0,
    books_total_taxable: 0,
    books_total_tax: 0,
    books_total_value: 0,
    gstr1_total_taxable: 0,
    gstr1_total_tax: 0,
    gstr1_total_value: 0,
    net_diff_taxable: 0,
    net_diff_tax: 0,
    net_diff_total: 0,
    unfiled_liability_tax: 0,
    excess_portal_liability_tax: 0,
    potential_tax_risk: 0,
  });

  // Filter Configuration
  const [filterConfig, setFilterConfig] = useState<AuditFilterConfig>({
    selected_status: "ALL",
    search_query: "",
    tolerance_amount: 1.0, // Default ± ₹1.00 tolerance
  });

  // Modals
  const [selectedItemForModal, setSelectedItemForModal] = useState<AuditReconItem | null>(null);
  const [showPrintModal, setShowPrintModal] = useState(false);
  const [isExporting, setIsExporting] = useState(false);

  // Initialize with live books or sample data
  useEffect(() => {
    if (isUsingLiveBooks && invoices && invoices.length > 0) {
      const converted = Gstr1AuditService.convertInvoiceSummariesToBooksRecords(invoices);
      setBooksRecords(converted);
    } else if (booksRecords.length === 0 && gstr1Records.length === 0) {
      // Load sample demonstration dataset by default
      loadSampleDataset();
    }
  }, [invoices, isUsingLiveBooks]);

  // Load sample demonstration dataset
  const loadSampleDataset = () => {
    const sample = Gstr1AuditService.getSampleAuditDataset();
    setBooksRecords(sample.books);
    setGstr1Records(sample.gstr1);
    setGstr1SourceName("Sample_GSTR1_Audit_Set.json");
  };

  // Reconcile on data or tolerance changes
  useEffect(() => {
    if (booksRecords.length > 0 || gstr1Records.length > 0) {
      const result = Gstr1AuditService.reconcile(
        booksRecords,
        gstr1Records,
        filterConfig.tolerance_amount
      );
      setReconciledItems(result.items);
      setMetrics(result.metrics);
    } else {
      setReconciledItems([]);
    }
  }, [booksRecords, gstr1Records, filterConfig.tolerance_amount]);

  // Filter items for display
  const filteredItems = useMemo(() => {
    return Gstr1AuditService.filterItems(reconciledItems, filterConfig);
  }, [reconciledItems, filterConfig]);

  // Handlers
  const handleLoadGstr1Data = (data: Gstr1InvoiceRecord[], sourceName: string) => {
    setGstr1Records(data);
    setGstr1SourceName(sourceName);
  };

  const handleLoadBooksData = (data: BooksInvoiceRecord[], _sourceName: string) => {
    setBooksRecords(data);
    setIsUsingLiveBooks(false);
  };

  const handleExportCsv = async () => {
    setIsExporting(true);
    try {
      await Gstr1AuditService.exportReconciliationCsv(reconciledItems, metrics, companyName);
    } finally {
      setIsExporting(false);
    }
  };

  const handleSaveAuditorNotes = (key: string, notes: string) => {
    setReconciledItems((prev) =>
      prev.map((itm) => (itm.key === key ? { ...itm, user_notes: notes } : itm))
    );
  };

  return (
    <div className="space-y-6 animate-in fade-in duration-150">
      {/* Module Title & Global Action Bar */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-[var(--ember-border)] pb-4">
        <div>
          <div className="flex items-center gap-2">
            <span className="p-2 bg-[var(--ember-primary-light)] text-[var(--ember-primary)] rounded-lg">
              <Scale className="w-5 h-5" />
            </span>
            <h2 className="text-base font-bold font-serif text-[var(--ember-primary)] uppercase tracking-wide">
              GSTR-1 Outward Return Audit & Validation Workstation
            </h2>
          </div>
          <p className="text-xs text-[var(--ember-text-secondary)] mt-1">
            Automated verification of invoice numbers, taxable turnover, and GST taxes against official GSTR-1 portal returns.
          </p>
        </div>

        {/* Global Export & Print Buttons */}
        <div className="flex items-center gap-2.5 flex-wrap">
          <button
            onClick={handleExportCsv}
            disabled={isExporting || reconciledItems.length === 0}
            className="ember-btn-secondary px-3.5 py-2 text-xs flex items-center gap-1.5 cursor-pointer font-semibold"
            title="Download formatted CSV reconciliation schedule"
          >
            {isExporting ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
            Export Workpaper (CSV)
          </button>

          <button
            onClick={() => setShowPrintModal(true)}
            disabled={reconciledItems.length === 0}
            className="ember-btn-primary px-4 py-2 text-xs flex items-center gap-1.5 cursor-pointer font-semibold shadow-sm"
            title="Print formal statutory audit reconciliation certificate"
          >
            <Printer className="w-4 h-4" />
            Print Audit Certificate
          </button>
        </div>
      </div>

      {/* Ingestion & Source Configuration */}
      <Gstr1ImportPanel
        onLoadGstr1Data={handleLoadGstr1Data}
        onLoadBooksData={handleLoadBooksData}
        onLoadSampleDataset={loadSampleDataset}
        isUsingLiveBooks={isUsingLiveBooks}
        onToggleLiveBooks={setIsUsingLiveBooks}
        liveBooksCount={invoices.length}
        gstr1LoadedCount={gstr1Records.length}
        gstr1SourceName={gstr1SourceName}
      />

      {/* Executive Audit KPI Summary */}
      <Gstr1AuditKpis
        metrics={metrics}
        companyName={companyName}
        onFilterStatus={(status) => setFilterConfig((prev) => ({ ...prev, selected_status: status }))}
      />

      {/* Reconciled Dual Comparison Table */}
      <Gstr1AuditTable
        items={filteredItems}
        metrics={metrics}
        filterConfig={filterConfig}
        onFilterChange={setFilterConfig}
        onInspectItem={(item) => setSelectedItemForModal(item)}
      />

      {/* Discrepancy Detail Modal Sheet */}
      {selectedItemForModal && (
        <Gstr1DiscrepancyModal
          item={selectedItemForModal}
          onClose={() => setSelectedItemForModal(null)}
          onSaveNotes={handleSaveAuditorNotes}
        />
      )}

      {/* Print Audit Certificate Modal */}
      {showPrintModal && (
        <Gstr1PrintReportModal
          metrics={metrics}
          items={reconciledItems}
          companyName={companyName}
          companyGstin="33AAAAA0000A1Z5"
          onClose={() => setShowPrintModal(false)}
        />
      )}
    </div>
  );
};
