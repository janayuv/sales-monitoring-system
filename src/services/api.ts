import { invoke } from "@tauri-apps/api/core";
import { ImportPreview } from "../types/bindings/ImportPreview";
import { ImportTemplateRow } from "../types/bindings/ImportTemplateRow";
import { InvoiceSummary } from "../types/bindings/InvoiceSummary";
import { InvoiceRow } from "../types/bindings/InvoiceRow";
import { InvoiceItemRow } from "../types/bindings/InvoiceItemRow";
import { AuditLogRow } from "../types/bindings/AuditLogRow";
import { SupplierPriceRevisionRow } from "../types/bindings/SupplierPriceRevisionRow";
import { DebitNoteRow } from "../types/bindings/DebitNoteRow";
import { DebitNoteItemRow } from "../types/bindings/DebitNoteItemRow";
import { CreditNoteRow } from "../types/bindings/CreditNoteRow";
import { SupplierRow } from "../types/bindings/SupplierRow";
import { CustomerRow } from "../types/bindings/CustomerRow";
// Phase 5: Export & Report types
import { TallyExportRow } from "../types/bindings/TallyExportRow";
import { ExportResult } from "../types/bindings/ExportResult";
import { MonthlySalesRow } from "../types/bindings/MonthlySalesRow";
import { GstRateSummaryRow } from "../types/bindings/GstRateSummaryRow";
import { RankingRow } from "../types/bindings/RankingRow";
import { DashboardMetrics } from "../types/bindings/DashboardMetrics";
import { FinancialYearRow } from "../types/bindings/FinancialYearRow";
// Phase 6: Maintenance & Backup types
import { MaintenanceResult } from "../types/bindings/MaintenanceResult";
import { BackupMetadata } from "../types/bindings/BackupMetadata";
import { BackupStatus } from "../types/bindings/BackupStatus";
import { CustomerCategoryRow } from "../types/bindings/CustomerCategoryRow";
import { CustomerMasterRow } from "../types/bindings/CustomerMasterRow";
import { CustomerImportPreview } from "../types/bindings/CustomerImportPreview";
import { CustomerImportResult } from "../types/bindings/CustomerImportResult";

export type { CustomerCategoryRow };
export type { CustomerMasterRow };
export type { CustomerImportPreview, CustomerImportResult };

export interface CustomerMasterPayload {
  id: number | null;
  customer_code: string;
  report_name: string;
  tally_name: string | null;
  legal_name: string | null;
  gstin: string | null;
  address1: string | null;
  address2: string | null;
  location: string | null;
  pincode: string | null;
  state_code: string | null;
  place_of_supply: string | null;
  phone: string | null;
  email: string | null;
  category_name: string | null;
  remarks: string | null;
  status: "Approved" | "Pending_Review";
}

export class ApiService {
  /**
   * Switch the active database connection to another company db file.
   */
  static async switchCompanyProfile(companyCode: string, encryptionKey: string): Promise<void> {
    await invoke("switch_company_profile", { companyCode, encryptionKey });
  }

  /**
   * Close the active database connection pool.
   */
  static async closeActiveProfile(): Promise<void> {
    await invoke("close_active_profile");
  }

  /**
   * Fetch all configured templates in the database.
   */
  static async getImportTemplates(): Promise<ImportTemplateRow[]> {
    return await invoke<ImportTemplateRow[]>("get_import_templates");
  }

  /**
   * Preview a selected Excel file against a template before committing.
   */
  static async previewImportFile(
    filePath: string,
    templateId: number,
    userName: string
  ): Promise<ImportPreview> {
    return await invoke<ImportPreview>("preview_import_file", {
      filePath,
      templateId,
      userName,
    });
  }

  /**
   * Commit a previewed import file into database transactions.
   */
  static async commitImportBatch(
    filePath: string,
    templateId: number,
    userName: string,
    userRemarks?: string
  ): Promise<number> {
    return await invoke<number>("commit_import_batch", {
      filePath,
      templateId,
      userName,
      userRemarks: userRemarks || null,
    });
  }

  /**
   * Fetch invoices paginated using index-friendly cursor pagination.
   */
  static async listInvoices(
    cursorDate?: string | null,
    cursorNo?: string | null,
    limit: number = 50
  ): Promise<InvoiceSummary[]> {
    return await invoke<InvoiceSummary[]>("list_invoices_paginated", {
      cursorDate: cursorDate || null,
      cursorNo: cursorNo || null,
      limit,
    });
  }

  /**
   * Fetch details (header + line items) of a single invoice.
   */
  static async getInvoiceDetails(invoiceNumber: string): Promise<[InvoiceRow, InvoiceItemRow[]]> {
    return await invoke<[InvoiceRow, InvoiceItemRow[]]>("get_invoice_details", { invoiceNumber });
  }

  /**
   * Update the status of an invoice (e.g. Cancelled, Verified).
   */
  static async updateInvoiceStatus(invoiceNumber: string, status: string, userName: string): Promise<void> {
    await invoke("update_invoice_status", { invoiceNumber, status, userName });
  }

  /**
   * Permanently delete an invoice record and its lines, logging audit info.
   */
  static async deleteInvoiceRecord(invoiceNumber: string, userName: string): Promise<void> {
    await invoke("delete_invoice_record", { invoiceNumber, userName });
  }

  /**
   * Fetch audit logs history for a specific database record.
   */
  static async getRecordAuditLogs(tableName: string, recordId: string): Promise<AuditLogRow[]> {
    return await invoke<AuditLogRow[]>("get_record_audit_logs", { tableName, recordId });
  }

  /**
   * Retrieve the list of suppliers from the database.
   */
  static async getSuppliers(): Promise<SupplierRow[]> {
    return await invoke<SupplierRow[]>("get_suppliers_list");
  }

  /**
   * Retrieve the list of customers from the database.
   */
  static async getCustomers(): Promise<CustomerRow[]> {
    return await invoke<CustomerRow[]>("get_customers_list");
  }

  /**
   * Fetch all customers as full master records.
   */
  static async getCustomerMaster(): Promise<CustomerMasterRow[]> {
    return await invoke<CustomerMasterRow[]>("get_customer_master");
  }

  /**
   * Fetch all customer categories.
   */
  static async getCustomerCategories(): Promise<CustomerCategoryRow[]> {
    return await invoke<CustomerCategoryRow[]>("get_customer_categories");
  }

  /**
   * Create a new customer category.
   */
  static async createCustomerCategory(name: string, description?: string): Promise<CustomerCategoryRow> {
    return await invoke<CustomerCategoryRow>("create_customer_category", {
      name,
      description: description || null,
    });
  }

  /**
   * Delete a customer category by ID.
   */
  static async deleteCustomerCategory(categoryId: number): Promise<void> {
    await invoke("delete_customer_category", { categoryId });
  }

  /**
   * Create a new customer master record. Returns the new row id.
   */
  static async createCustomerMaster(payload: CustomerMasterPayload): Promise<number> {
    return await invoke<number>("create_customer_master", { payload });
  }

  /**
   * Update an existing customer master record (identified by id).
   */
  static async updateCustomerMaster(payload: CustomerMasterPayload): Promise<void> {
    await invoke("update_customer_master", { payload });
  }

  /**
   * Preview a customer master Excel/xlsx file against the DB without writing anything.
   */
  static async previewCustomerMasterImport(filePath: string): Promise<CustomerImportPreview> {
    return await invoke<CustomerImportPreview>("preview_customer_master_import", { filePath });
  }

  /**
   * Commit a customer master import: upserts valid rows inside one auditable transaction.
   */
  static async commitCustomerMasterImport(filePath: string, user: string): Promise<CustomerImportResult> {
    return await invoke<CustomerImportResult>("commit_customer_master_import", { filePath, user });
  }

  // --- Phase 4: Price Revisions & Recovery Notes ---

  /**
   * Create a new price revision record for a supplier's item.
   */
  static async createPriceRevision(
    supplierId: number,
    partCode: string,
    oldPrice: number,
    newPrice: number,
    effectiveDate: string,
    remarks?: string
  ): Promise<number> {
    return await invoke<number>("create_price_revision", {
      supplierId,
      partCode,
      oldPrice,
      newPrice,
      effectiveDate,
      remarks: remarks || null,
    });
  }

  /**
   * Retrieve all price revisions entered.
   */
  static async getPriceRevisions(): Promise<SupplierPriceRevisionRow[]> {
    return await invoke<SupplierPriceRevisionRow[]>("get_price_revisions");
  }

  /**
   * Preview the debit note recovery items before generating the debit note.
   */
  static async previewRevisionRecovery(revisionId: number): Promise<DebitNoteItemRow[]> {
    return await invoke<DebitNoteItemRow[]>("preview_revision_recovery", { revisionId });
  }

  /**
   * Generate a debit note and its details for a revision ID.
   */
  static async generateDebitNote(
    revisionId: number,
    debitNoteNumber: string,
    remarks?: string
  ): Promise<void> {
    await invoke("generate_debit_note", {
      revisionId,
      debitNoteNumber,
      remarks: remarks || null,
    });
  }

  /**
   * Fetch all debit notes from the database.
   */
  static async listDebitNotes(): Promise<DebitNoteRow[]> {
    return await invoke<DebitNoteRow[]>("list_debit_notes");
  }

  /**
   * Approve a debit note, changing its state to Approved.
   */
  static async approveDebitNote(debitNoteNumber: string, userName: string): Promise<void> {
    await invoke("approve_debit_note", { debitNoteNumber, userName });
  }

  /**
   * Auto-generate a Credit Note for a cancelled invoice.
   */
  static async autoGenerateCreditNote(invoiceNumber: string, remarks?: string): Promise<string> {
    return await invoke<string>("auto_generate_credit_note", {
      invoiceNumber,
      remarks: remarks || null,
    });
  }

  /**
   * Fetch all credit notes from the database.
   */
  static async listCreditNotes(): Promise<CreditNoteRow[]> {
    return await invoke<CreditNoteRow[]>("list_credit_notes");
  }

  // --- Phase 5: Exporters & Report Center ---

  /**
   * Query raw Tally export rows for a date range (before export).
   */
  static async queryTallyExportRows(
    dateFrom: string,
    dateTo: string,
    statusFilter?: string
  ): Promise<TallyExportRow[]> {
    return await invoke<TallyExportRow[]>("query_tally_export_rows", {
      dateFrom,
      dateTo,
      statusFilter: statusFilter || null,
    });
  }

  /**
   * Export invoices to Tally-format Excel with multi-rate splitting.
   */
  static async exportTallyExcel(
    dateFrom: string,
    dateTo: string,
    outputPath: string
  ): Promise<ExportResult> {
    return await invoke<ExportResult>("export_tally_excel", {
      dateFrom,
      dateTo,
      outputPath,
    });
  }

  /**
   * Export invoices to standard flat Excel.
   */
  static async exportStandardExcel(
    dateFrom: string,
    dateTo: string,
    outputPath: string
  ): Promise<ExportResult> {
    return await invoke<ExportResult>("export_standard_excel", {
      dateFrom,
      dateTo,
      outputPath,
    });
  }

  /**
   * Export invoices to CSV.
   */
  static async exportCsv(
    dateFrom: string,
    dateTo: string,
    outputPath: string
  ): Promise<ExportResult> {
    return await invoke<ExportResult>("export_csv", {
      dateFrom,
      dateTo,
      outputPath,
    });
  }

  /**
   * Export invoices to a print-layout PDF report.
   */
  static async exportPdf(
    dateFrom: string,
    dateTo: string,
    outputPath: string
  ): Promise<ExportResult> {
    return await invoke<ExportResult>("export_pdf", {
      dateFrom,
      dateTo,
      outputPath,
    });
  }

  /**
   * Get monthly sales summary for charts.
   */
  static async getMonthlySalesSummary(
    financialYearId?: number | null
  ): Promise<MonthlySalesRow[]> {
    return await invoke<MonthlySalesRow[]>("get_monthly_sales_summary", {
      financialYearId: financialYearId || null,
    });
  }

  /**
   * Get GST breakdown by rate tier for a date range.
   */
  static async getGstRateSummary(
    dateFrom: string,
    dateTo: string
  ): Promise<GstRateSummaryRow[]> {
    return await invoke<GstRateSummaryRow[]>("get_gst_rate_summary", {
      dateFrom,
      dateTo,
    });
  }

  /**
   * Get top-N customers by total invoice value.
   */
  static async getTopCustomers(
    dateFrom: string,
    dateTo: string,
    limit: number = 10
  ): Promise<RankingRow[]> {
    return await invoke<RankingRow[]>("get_top_customers", {
      dateFrom,
      dateTo,
      limit,
    });
  }

  /**
   * Get top-N items by total sales value.
   */
  static async getTopItems(
    dateFrom: string,
    dateTo: string,
    limit: number = 20
  ): Promise<RankingRow[]> {
    return await invoke<RankingRow[]>("get_top_items", {
      dateFrom,
      dateTo,
      limit,
    });
  }

  /**
   * Load aggregated dashboard metrics.
   */
  static async getDashboardMetrics(): Promise<DashboardMetrics> {
    return await invoke<DashboardMetrics>("get_dashboard_metrics");
  }

  /**
   * Get financial years list for dropdowns.
   */
  static async getFinancialYears(): Promise<FinancialYearRow[]> {
    return await invoke<FinancialYearRow[]>("get_financial_years_list");
  }

  // --- Phase 6: Maintenance & Backup ---

  /**
   * Run SQLite PRAGMA integrity_check.
   */
  static async checkDbIntegrity(): Promise<MaintenanceResult> {
    return await invoke<MaintenanceResult>("check_db_integrity");
  }

  /**
   * Run VACUUM & ANALYZE to defragment database storage.
   */
  static async vacuumDatabase(): Promise<MaintenanceResult> {
    return await invoke<MaintenanceResult>("vacuum_database");
  }

  /**
   * Create database backup file with metadata header.
   */
  static async createDbBackup(
    companyCode: string,
    financialYear: string,
    outputPath: string
  ): Promise<BackupMetadata> {
    return await invoke<BackupMetadata>("create_db_backup", {
      companyCode,
      financialYear,
      outputPath,
    });
  }

  /**
   * Fetch backup status & check if backup is due.
   */
  static async getBackupStatus(companyCode: string): Promise<BackupStatus> {
    return await invoke<BackupStatus>("get_backup_status", { companyCode });
  }

  /**
   * Fetch an app setting value by key.
   */
  static async getAppSetting(settingKey: string, defaultVal?: string): Promise<string> {
    return await invoke<string>("get_app_setting", { settingKey, defaultVal: defaultVal || null });
  }

  /**
   * Set an app setting value by key.
   */
  static async setAppSetting(settingKey: string, settingValue: string): Promise<void> {
    await invoke("set_app_setting", { settingKey, settingValue });
  }
}
