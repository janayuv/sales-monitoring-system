export type AuditStatus =
  | "MATCHED"
  | "VALUE_MISMATCH"
  | "GST_MISMATCH"
  | "BOOKS_ONLY"
  | "GSTR1_ONLY"
  | "CANCELLED_MISMATCH"
  | "DUPLICATE";

export interface Gstr1InvoiceRecord {
  id?: string;
  invoice_number: string;
  invoice_date: string;
  customer_gstin?: string;
  customer_name?: string;
  place_of_supply?: string;
  reverse_charge?: string;
  invoice_type?: string;
  taxable_value: number;
  igst_value: number;
  cgst_value: number;
  sgst_value: number;
  cess_value: number;
  total_tax: number;
  total_value: number;
  section: "b2b" | "b2cl" | "b2cs" | "cdnr" | "exp" | "other";
  is_auto_populated?: boolean;
  is_deleted?: boolean;
  irn?: string;
}

export interface BooksInvoiceRecord {
  id?: string;
  invoice_number: string;
  invoice_date: string;
  customer_code?: string;
  customer_name?: string;
  customer_gstin?: string;
  place_of_supply?: string;
  taxable_value: number;
  igst_value: number;
  cgst_value: number;
  sgst_value: number;
  cess_value: number;
  total_tax: number;
  total_value: number;
  status: "Active" | "Cancelled" | "Deleted" | "Draft" | string;
  irn?: string;
}

export interface AuditReconItem {
  key: string;
  normalized_invoice_number: string;
  status: AuditStatus;
  status_label: string;
  status_severity: "success" | "warning" | "error" | "info" | "purple";
  
  // Internal Books Data
  books?: BooksInvoiceRecord;

  // GSTR-1 Portal Data
  gstr1?: Gstr1InvoiceRecord;

  // Variances (Books - GSTR-1)
  diff_taxable: number;
  diff_igst: number;
  diff_cgst: number;
  diff_sgst: number;
  diff_cess: number;
  diff_tax: number;
  diff_total: number;

  // Flags & Audit findings
  is_auto_populated: boolean;
  is_deleted_in_books: boolean;
  is_deleted_in_gstr1: boolean;
  has_rate_mismatch: boolean;
  is_within_tolerance: boolean;
  audit_diagnosis: string;
  recommended_action: string;
  user_notes?: string;
}

export interface AuditSummaryMetrics {
  total_records: number;
  matched_count: number;
  matched_percent: number;
  value_mismatch_count: number;
  gst_mismatch_count: number;
  books_only_count: number;
  gstr1_only_count: number;
  cancelled_mismatch_count: number;
  duplicate_count: number;

  // Totals in Books
  books_total_taxable: number;
  books_total_tax: number;
  books_total_value: number;

  // Totals in GSTR-1
  gstr1_total_taxable: number;
  gstr1_total_tax: number;
  gstr1_total_value: number;

  // Net Variances (Books - GSTR-1)
  net_diff_taxable: number;
  net_diff_tax: number;
  net_diff_total: number;

  // Risk exposure
  unfiled_liability_tax: number;
  excess_portal_liability_tax: number;
  potential_tax_risk: number;
}

export interface AuditFilterConfig {
  selected_status: AuditStatus | "ALL";
  search_query: string;
  tolerance_amount: number; // e.g. 0, 1, 2, 5
  date_from?: string;
  date_to?: string;
  section_filter?: string;
  hide_tolerated_matches?: boolean;
}
