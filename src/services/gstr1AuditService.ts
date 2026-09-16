import { save } from "@tauri-apps/plugin-dialog";
import { writeTextFile } from "@tauri-apps/plugin-fs";
import {
  AuditFilterConfig,
  AuditReconItem,
  AuditStatus,
  AuditSummaryMetrics,
  BooksInvoiceRecord,
  Gstr1InvoiceRecord,
} from "../types/gstr1AuditTypes";
import { InvoiceSummary } from "../types/bindings/InvoiceSummary";

export class Gstr1AuditService {
  /**
   * Normalizes invoice number for resilient matching across ERP formats and GST portal formats
   * Strips spaces, uniform uppercase, removes noise characters
   */
  static normalizeInvoiceNo(invNo: string | null | undefined): string {
    if (!invNo) return "";
    return invNo
      .toString()
      .trim()
      .toUpperCase()
      .replace(/[\s\-_/.]/g, "");
  }

  /**
   * Parse official GST Portal GSTR-1 Download JSON
   */
  static parseGstr1Json(jsonText: string): Gstr1InvoiceRecord[] {
    try {
      const data = typeof jsonText === "string" ? JSON.parse(jsonText) : jsonText;
      const records: Gstr1InvoiceRecord[] = [];

      // Helper to process standard B2B/B2CL/CDNR/EXP arrays
      const processInvoiceGroup = (
        groupList: any[],
        section: "b2b" | "b2cl" | "b2cs" | "cdnr" | "exp"
      ) => {
        if (!Array.isArray(groupList)) return;

        for (const recipient of groupList) {
          const ctin = recipient.ctin || recipient.buyer_gstin || "";
          const cpty = recipient.cpty || recipient.trade_name || recipient.legal_name || "";
          const invList = recipient.inv || recipient.nt || [recipient];

          for (const inv of invList) {
            const inum = (inv.inum || inv.nt_num || inv.invoice_number || "").toString().trim();
            if (!inum) continue;

            const idt = inv.idt || inv.nt_dt || inv.invoice_date || "";
            const val = Number(inv.val || inv.invoice_val || 0);
            const pos = (inv.pos || inv.place_of_supply || "").toString();
            const rchrg = (inv.rchrg || inv.reverse_charge || "N").toString();
            const invTyp = (inv.inv_typ || inv.type || "R").toString();
            const irn = inv.irn || null;
            const isAuto = Boolean(inv.auto_drafted || inv.is_auto_populated || inv.flag === "A" || irn);
            const isDeleted = Boolean(inv.is_deleted || inv.flag === "D" || inv.status === "CANCELLED");

            let txval = 0;
            let iamt = 0;
            let camt = 0;
            let samt = 0;
            let csamt = 0;

            if (Array.isArray(inv.itms)) {
              for (const itm of inv.itms) {
                const det = itm.itm_det || itm;
                txval += Number(det.txval || 0);
                iamt += Number(det.iamt || 0);
                camt += Number(det.camt || 0);
                samt += Number(det.samt || 0);
                csamt += Number(det.csamt || 0);
              }
            } else {
              txval = Number(inv.txval || inv.taxable_value || 0);
              iamt = Number(inv.iamt || inv.igst || 0);
              camt = Number(inv.camt || inv.cgst || 0);
              samt = Number(inv.samt || inv.sgst || 0);
              csamt = Number(inv.csamt || inv.cess || 0);
            }

            const totalTax = iamt + camt + samt + csamt;

            records.push({
              invoice_number: inum,
              invoice_date: idt,
              customer_gstin: ctin,
              customer_name: cpty,
              place_of_supply: pos,
              reverse_charge: rchrg,
              invoice_type: invTyp,
              taxable_value: Math.round(txval * 100) / 100,
              igst_value: Math.round(iamt * 100) / 100,
              cgst_value: Math.round(camt * 100) / 100,
              sgst_value: Math.round(samt * 100) / 100,
              cess_value: Math.round(csamt * 100) / 100,
              total_tax: Math.round(totalTax * 100) / 100,
              total_value: Math.round((val || (txval + totalTax)) * 100) / 100,
              section,
              is_auto_populated: isAuto,
              is_deleted: isDeleted,
              irn: irn || undefined,
            });
          }
        }
      };

      if (data.b2b) processInvoiceGroup(data.b2b, "b2b");
      if (data.b2cl) processInvoiceGroup(data.b2cl, "b2cl");
      if (data.b2cs) processInvoiceGroup(data.b2cs, "b2cs");
      if (data.cdnr) processInvoiceGroup(data.cdnr, "cdnr");
      if (data.exp) processInvoiceGroup(data.exp, "exp");

      // Direct array fallback if file is a list of invoices
      if (Array.isArray(data)) {
        processInvoiceGroup([{ inv: data }], "b2b");
      }

      return records;
    } catch (err) {
      console.error("Failed to parse GSTR-1 JSON:", err);
      throw new Error(`Invalid GSTR-1 JSON structure: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  /**
   * Parse CSV lines into array of string arrays handling quoted values
   */
  static parseCsvRows(csvText: string): string[][] {
    const rows: string[][] = [];
    let currentRow: string[] = [];
    let currentField = "";
    let insideQuotes = false;

    for (let i = 0; i < csvText.length; i++) {
      const char = csvText[i];
      const nextChar = csvText[i + 1];

      if (char === '"') {
        if (insideQuotes && nextChar === '"') {
          currentField += '"';
          i++; // skip escaped quote
        } else {
          insideQuotes = !insideQuotes;
        }
      } else if (char === "," && !insideQuotes) {
        currentRow.push(currentField.trim());
        currentField = "";
      } else if ((char === "\r" || char === "\n") && !insideQuotes) {
        if (char === "\r" && nextChar === "\n") i++;
        currentRow.push(currentField.trim());
        if (currentRow.some((cell) => cell.length > 0)) {
          rows.push(currentRow);
        }
        currentRow = [];
        currentField = "";
      } else {
        currentField += char;
      }
    }

    if (currentField.length > 0 || currentRow.length > 0) {
      currentRow.push(currentField.trim());
      if (currentRow.some((cell) => cell.length > 0)) {
        rows.push(currentRow);
      }
    }

    return rows;
  }

  /**
   * Parse GSTR-1 CSV (e.g. standard GST Offline Tool or ClearTax CSV)
   */
  static parseGstr1Csv(csvText: string): Gstr1InvoiceRecord[] {
    const rows = this.parseCsvRows(csvText);
    if (rows.length < 2) return [];

    // Find header index
    let headerRowIdx = -1;
    for (let r = 0; r < Math.min(10, rows.length); r++) {
      const lineStr = rows[r].map((c) => c.toLowerCase()).join(" ");
      if (lineStr.includes("invoice") || lineStr.includes("taxable") || lineStr.includes("gstin")) {
        headerRowIdx = r;
        break;
      }
    }

    if (headerRowIdx === -1) headerRowIdx = 0;
    const headers = rows[headerRowIdx].map((h) => h.toLowerCase().trim());

    // Map column indices
    const colIdx = {
      gstin: headers.findIndex((h) => h.includes("gstin") || h.includes("uin")),
      name: headers.findIndex((h) => h.includes("name") || h.includes("receiver")),
      invNo: headers.findIndex((h) => h.includes("invoice number") || h.includes("invoice no") || h === "inum" || h.includes("doc no")),
      invDate: headers.findIndex((h) => h.includes("invoice date") || h.includes("inv date") || h === "idt" || h.includes("date")),
      invVal: headers.findIndex((h) => h.includes("invoice value") || h.includes("inv val") || h.includes("total invoice") || h.includes("total value")),
      pos: headers.findIndex((h) => h.includes("place of supply") || h.includes("pos")),
      taxable: headers.findIndex((h) => h.includes("taxable value") || h.includes("taxable amt") || h.includes("taxable")),
      igst: headers.findIndex((h) => h.includes("integrated") || h.includes("igst")),
      cgst: headers.findIndex((h) => h.includes("central") || h.includes("cgst")),
      sgst: headers.findIndex((h) => h.includes("state") || h.includes("sgst") || h.includes("ut tax")),
      cess: headers.findIndex((h) => h.includes("cess")),
      status: headers.findIndex((h) => h.includes("status") || h.includes("flag")),
    };

    const aggregated = new Map<string, Gstr1InvoiceRecord>();

    for (let r = headerRowIdx + 1; r < rows.length; r++) {
      const row = rows[r];
      if (!row || row.length === 0) continue;

      const rawInvNo = colIdx.invNo >= 0 ? row[colIdx.invNo] : "";
      if (!rawInvNo) continue;

      const norm = this.normalizeInvoiceNo(rawInvNo);
      if (!norm) continue;

      const parseNum = (idx: number) => {
        if (idx < 0 || idx >= row.length) return 0;
        const val = parseFloat(row[idx].replace(/[^0-9.-]/g, ""));
        return isNaN(val) ? 0 : val;
      };

      const txval = parseNum(colIdx.taxable);
      const igst = parseNum(colIdx.igst);
      const cgst = parseNum(colIdx.cgst);
      const sgst = parseNum(colIdx.sgst);
      const cess = parseNum(colIdx.cess);
      const val = parseNum(colIdx.invVal);
      const invDate = colIdx.invDate >= 0 ? row[colIdx.invDate] : "";
      const gstin = colIdx.gstin >= 0 ? row[colIdx.gstin] : "";
      const name = colIdx.name >= 0 ? row[colIdx.name] : "";
      const pos = colIdx.pos >= 0 ? row[colIdx.pos] : "";
      const rawStatus = (colIdx.status >= 0 ? row[colIdx.status] : "").toUpperCase();

      const isDeleted = rawStatus.includes("DEL") || rawStatus.includes("CAN");
      const isAuto = rawStatus.includes("AUTO") || rawStatus.includes("IRP") || rawStatus === "A";

      if (aggregated.has(norm)) {
        // Multi-rate line item aggregation
        const existing = aggregated.get(norm)!;
        existing.taxable_value = Math.round((existing.taxable_value + txval) * 100) / 100;
        existing.igst_value = Math.round((existing.igst_value + igst) * 100) / 100;
        existing.cgst_value = Math.round((existing.cgst_value + cgst) * 100) / 100;
        existing.sgst_value = Math.round((existing.sgst_value + sgst) * 100) / 100;
        existing.cess_value = Math.round((existing.cess_value + cess) * 100) / 100;
        existing.total_tax = Math.round((existing.igst_value + existing.cgst_value + existing.sgst_value + existing.cess_value) * 100) / 100;
        if (val > existing.total_value) existing.total_value = val;
      } else {
        const totalTax = igst + cgst + sgst + cess;
        aggregated.set(norm, {
          invoice_number: rawInvNo,
          invoice_date: invDate,
          customer_gstin: gstin,
          customer_name: name,
          place_of_supply: pos,
          taxable_value: Math.round(txval * 100) / 100,
          igst_value: Math.round(igst * 100) / 100,
          cgst_value: Math.round(cgst * 100) / 100,
          sgst_value: Math.round(sgst * 100) / 100,
          cess_value: Math.round(cess * 100) / 100,
          total_tax: Math.round(totalTax * 100) / 100,
          total_value: Math.round((val || (txval + totalTax)) * 100) / 100,
          section: "b2b",
          is_auto_populated: isAuto,
          is_deleted: isDeleted,
        });
      }
    }

    return Array.from(aggregated.values());
  }

  /**
   * Convert existing system InvoiceSummary records into BooksInvoiceRecord
   */
  static convertInvoiceSummariesToBooksRecords(summaries: InvoiceSummary[]): BooksInvoiceRecord[] {
    return summaries.map((inv) => ({
      invoice_number: inv.invoice_number,
      invoice_date: inv.invoice_date,
      customer_code: inv.customer_code,
      customer_name: inv.customer_name,
      taxable_value: Math.round((inv.total_taxable || 0) * 100) / 100,
      total_tax: Math.round((inv.total_tax || 0) * 100) / 100,
      total_value: Math.round((inv.total_value || 0) * 100) / 100,
      // Default standard 50-50 split or general tax heads if individual items are not supplied
      igst_value: 0,
      cgst_value: Math.round(((inv.total_tax || 0) / 2) * 100) / 100,
      sgst_value: Math.round(((inv.total_tax || 0) / 2) * 100) / 100,
      cess_value: 0,
      status: inv.status || "Active",
    }));
  }

  /**
   * Parse Books outward sales register CSV (if uploaded as an external file)
   */
  static parseBooksCsv(csvText: string): BooksInvoiceRecord[] {
    const rows = this.parseCsvRows(csvText);
    if (rows.length < 2) return [];

    let headerIdx = 0;
    for (let r = 0; r < Math.min(10, rows.length); r++) {
      const rowStr = rows[r].map((c) => c.toLowerCase()).join(" ");
      if (rowStr.includes("invoice") || rowStr.includes("customer") || rowStr.includes("taxable")) {
        headerIdx = r;
        break;
      }
    }

    const headers = rows[headerIdx].map((h) => h.toLowerCase().trim());
    const colIdx = {
      invNo: headers.findIndex((h) => h.includes("invoice no") || h.includes("invoice number") || h === "inum" || h.includes("bill no")),
      invDate: headers.findIndex((h) => h.includes("date")),
      custName: headers.findIndex((h) => h.includes("customer") || h.includes("buyer") || h.includes("party")),
      gstin: headers.findIndex((h) => h.includes("gstin")),
      taxable: headers.findIndex((h) => h.includes("taxable")),
      cgst: headers.findIndex((h) => h.includes("cgst")),
      sgst: headers.findIndex((h) => h.includes("sgst")),
      igst: headers.findIndex((h) => h.includes("igst")),
      cess: headers.findIndex((h) => h.includes("cess")),
      totalTax: headers.findIndex((h) => h.includes("total tax") || h.includes("tax amount")),
      totalVal: headers.findIndex((h) => h.includes("total") || h.includes("invoice value") || h.includes("gross")),
      status: headers.findIndex((h) => h.includes("status")),
    };

    const aggregated = new Map<string, BooksInvoiceRecord>();

    for (let r = headerIdx + 1; r < rows.length; r++) {
      const row = rows[r];
      if (!row || row.length === 0) continue;

      const rawInvNo = colIdx.invNo >= 0 ? row[colIdx.invNo] : "";
      if (!rawInvNo) continue;

      const norm = this.normalizeInvoiceNo(rawInvNo);
      if (!norm) continue;

      const parseNum = (idx: number) => {
        if (idx < 0 || idx >= row.length) return 0;
        const v = parseFloat(row[idx].replace(/[^0-9.-]/g, ""));
        return isNaN(v) ? 0 : v;
      };

      const txval = parseNum(colIdx.taxable);
      const cgst = parseNum(colIdx.cgst);
      const sgst = parseNum(colIdx.sgst);
      const igst = parseNum(colIdx.igst);
      const cess = parseNum(colIdx.cess);
      const totalTaxCol = parseNum(colIdx.totalTax);
      const totalVal = parseNum(colIdx.totalVal);
      const date = colIdx.invDate >= 0 ? row[colIdx.invDate] : "";
      const cust = colIdx.custName >= 0 ? row[colIdx.custName] : "";
      const gstin = colIdx.gstin >= 0 ? row[colIdx.gstin] : "";
      const rawStatus = (colIdx.status >= 0 ? row[colIdx.status] : "Active").trim();

      const computedTax = totalTaxCol > 0 ? totalTaxCol : (cgst + sgst + igst + cess);

      if (aggregated.has(norm)) {
        const existing = aggregated.get(norm)!;
        existing.taxable_value = Math.round((existing.taxable_value + txval) * 100) / 100;
        existing.cgst_value = Math.round((existing.cgst_value + cgst) * 100) / 100;
        existing.sgst_value = Math.round((existing.sgst_value + sgst) * 100) / 100;
        existing.igst_value = Math.round((existing.igst_value + igst) * 100) / 100;
        existing.cess_value = Math.round((existing.cess_value + cess) * 100) / 100;
        existing.total_tax = Math.round((existing.total_tax + computedTax) * 100) / 100;
        existing.total_value = Math.round((existing.total_value + (totalVal || (txval + computedTax))) * 100) / 100;
      } else {
        aggregated.set(norm, {
          invoice_number: rawInvNo,
          invoice_date: date,
          customer_name: cust,
          customer_gstin: gstin,
          taxable_value: Math.round(txval * 100) / 100,
          cgst_value: Math.round(cgst * 100) / 100,
          sgst_value: Math.round(sgst * 100) / 100,
          igst_value: Math.round(igst * 100) / 100,
          cess_value: Math.round(cess * 100) / 100,
          total_tax: Math.round(computedTax * 100) / 100,
          total_value: Math.round((totalVal || (txval + computedTax)) * 100) / 100,
          status: rawStatus,
        });
      }
    }

    return Array.from(aggregated.values());
  }

  /**
   * Primary Audit & Reconciliation Engine
   * Compares Books vs GSTR-1, calculates exact variances, applies tolerance, categorizes status
   */
  static reconcile(
    books: BooksInvoiceRecord[],
    gstr1: Gstr1InvoiceRecord[],
    tolerance: number = 1.0
  ): { items: AuditReconItem[]; metrics: AuditSummaryMetrics } {
    const booksMap = new Map<string, BooksInvoiceRecord>();
    const gstr1Map = new Map<string, Gstr1InvoiceRecord>();
    const duplicateBooksKeys = new Set<string>();
    const duplicateGstr1Keys = new Set<string>();

    // Index Books
    for (const b of books) {
      const norm = this.normalizeInvoiceNo(b.invoice_number);
      if (!norm) continue;
      if (booksMap.has(norm)) {
        duplicateBooksKeys.add(norm);
      } else {
        booksMap.set(norm, b);
      }
    }

    // Index GSTR-1
    for (const g of gstr1) {
      const norm = this.normalizeInvoiceNo(g.invoice_number);
      if (!norm) continue;
      if (gstr1Map.has(norm)) {
        duplicateGstr1Keys.add(norm);
      } else {
        gstr1Map.set(norm, g);
      }
    }

    const allKeys = new Set([...Array.from(booksMap.keys()), ...Array.from(gstr1Map.keys())]);
    const items: AuditReconItem[] = [];

    // Counters for metrics
    let matchedCount = 0;
    let valueMismatchCount = 0;
    let gstMismatchCount = 0;
    let booksOnlyCount = 0;
    let gstr1OnlyCount = 0;
    let cancelledMismatchCount = 0;
    let duplicateCount = duplicateBooksKeys.size + duplicateGstr1Keys.size;

    let booksTotalTaxable = 0;
    let booksTotalTax = 0;
    let booksTotalValue = 0;

    let gstr1TotalTaxable = 0;
    let gstr1TotalTax = 0;
    let gstr1TotalValue = 0;

    let unfiledLiabilityTax = 0;
    let excessPortalLiabilityTax = 0;

    for (const key of Array.from(allKeys)) {
      const b = booksMap.get(key);
      const g = gstr1Map.get(key);

      if (b) {
        booksTotalTaxable += b.taxable_value;
        booksTotalTax += b.total_tax;
        booksTotalValue += b.total_value;
      }

      if (g) {
        gstr1TotalTaxable += g.taxable_value;
        gstr1TotalTax += g.total_tax;
        gstr1TotalValue += g.total_value;
      }

      // Check Duplicates
      const isDuplicate = duplicateBooksKeys.has(key) || duplicateGstr1Keys.has(key);

      // Check Cancelled / Deleted
      const isDeletedInBooks = b ? (b.status === "Cancelled" || b.status === "Deleted") : false;
      const isDeletedInGstr1 = g ? Boolean(g.is_deleted) : false;
      const isAutoPopulated = g ? Boolean(g.is_auto_populated) : false;

      // Calculate Variances (Books - GSTR-1)
      const bTaxable = b ? b.taxable_value : 0;
      const gTaxable = g ? g.taxable_value : 0;
      const diffTaxable = Math.round((bTaxable - gTaxable) * 100) / 100;

      const bIgst = b ? b.igst_value : 0;
      const gIgst = g ? g.igst_value : 0;
      const diffIgst = Math.round((bIgst - gIgst) * 100) / 100;

      const bCgst = b ? b.cgst_value : 0;
      const gCgst = g ? g.cgst_value : 0;
      const diffCgst = Math.round((bCgst - gCgst) * 100) / 100;

      const bSgst = b ? b.sgst_value : 0;
      const gSgst = g ? g.sgst_value : 0;
      const diffSgst = Math.round((bSgst - gSgst) * 100) / 100;

      const bCess = b ? b.cess_value : 0;
      const gCess = g ? g.cess_value : 0;
      const diffCess = Math.round((bCess - gCess) * 100) / 100;

      const bTax = b ? b.total_tax : 0;
      const gTax = g ? g.total_tax : 0;
      const diffTax = Math.round((bTax - gTax) * 100) / 100;

      const bTotal = b ? b.total_value : 0;
      const gTotal = g ? g.total_value : 0;
      const diffTotal = Math.round((bTotal - gTotal) * 100) / 100;

      // Status classification
      let status: AuditStatus = "MATCHED";
      let statusLabel = "Matched (Reconciled)";
      let statusSeverity: AuditReconItem["status_severity"] = "success";
      let diagnosis = "";
      let action = "";
      let isWithinTolerance = false;
      let hasRateMismatch = false;

      if (isDuplicate) {
        status = "DUPLICATE";
        statusLabel = "Duplicate Invoice Ref";
        statusSeverity = "error";
        diagnosis = `Duplicate reference found for invoice '${key}' across batches or register lines.`;
        action = "Review ERP export or portal upload files to eliminate duplicated voucher numbers.";
      } else if (!g && b) {
        // Books Only
        status = "BOOKS_ONLY";
        statusLabel = "In Books Only (Unreported)";
        statusSeverity = "info";
        booksOnlyCount++;
        unfiledLiabilityTax += b.total_tax;
        diagnosis = `Invoice is recorded in internal ERP books (Tax: ₹${b.total_tax.toFixed(2)}), but is entirely missing in GSTR-1 return.`;
        action = "Upload to GST portal before return filing cut-off so recipient can claim ITC in GSTR-2B.";
      } else if (g && !b) {
        // GSTR-1 Only
        status = "GSTR1_ONLY";
        statusLabel = isAutoPopulated ? "Auto-Populated (Missing in Books)" : "In GSTR-1 Only (Missing in Books)";
        statusSeverity = "purple";
        gstr1OnlyCount++;
        excessPortalLiabilityTax += g.total_tax;
        diagnosis = isAutoPopulated
          ? `Invoice was auto-drafted into GSTR-1 (from e-Invoice / e-Way Bill IRN), but does not exist in ERP sales register.`
          : `Invoice exists in GSTR-1 return (Tax: ₹${g.total_tax.toFixed(2)}), but has no matching entry in ERP books.`;
        action = "Check if sales entry was omitted in internal ERP or if an erroneous e-Invoice / e-Way bill was generated.";
      } else if (isDeletedInBooks !== isDeletedInGstr1) {
        // Cancelled / Deleted Mismatch
        status = "CANCELLED_MISMATCH";
        statusLabel = "Cancelled / Voided Mismatch";
        statusSeverity = "error";
        cancelledMismatchCount++;
        if (isDeletedInBooks && !isDeletedInGstr1) {
          diagnosis = `Invoice was marked Cancelled/Deleted in internal Books, but remains active in GSTR-1 return. Results in excess tax payment.`;
          action = "Cancel IRN on portal or report credit note / cancellation in Table 9B of GSTR-1.";
        } else {
          diagnosis = `Invoice is active in Books, but was deleted/cancelled in GSTR-1 return. Recipient will lose ITC.`;
          action = "Re-upload invoice to GSTR-1 or clarify cancellation status with the recipient.";
        }
      } else {
        // Present in both - compare values
        const taxableAbsDiff = Math.abs(diffTaxable);
        const taxAbsDiff = Math.abs(diffTax);
        isWithinTolerance = taxableAbsDiff <= tolerance && taxAbsDiff <= tolerance;

        // Check head mismatch (e.g. IGST vs CGST/SGST)
        const hasHeadMismatch = (bIgst > 0 && gIgst === 0 && gCgst > 0) || (gIgst > 0 && bIgst === 0 && bCgst > 0);
        hasRateMismatch = Math.abs(diffTax) > tolerance && taxableAbsDiff <= tolerance;

        if (isWithinTolerance && !hasHeadMismatch) {
          status = "MATCHED";
          statusLabel = "Matched (Reconciled)";
          statusSeverity = "success";
          matchedCount++;
          diagnosis = taxableAbsDiff === 0 && taxAbsDiff === 0
            ? "Exact match across Invoice No, Taxable Turnover, and GST Tax heads."
            : `Matched within allowed tolerance of ±₹${tolerance.toFixed(2)} (Taxable diff: ₹${diffTaxable.toFixed(2)}, Tax diff: ₹${diffTax.toFixed(2)}).`;
          action = "No action required. Audit passed.";
        } else if (taxableAbsDiff > tolerance) {
          status = "VALUE_MISMATCH";
          statusLabel = "Taxable Value Mismatch";
          statusSeverity = "warning";
          valueMismatchCount++;
          diagnosis = `Taxable turnover discrepancy of ₹${diffTaxable.toFixed(2)} (Books: ₹${bTaxable.toFixed(2)}, GSTR-1: ₹${gTaxable.toFixed(2)}). Net tax difference: ₹${diffTax.toFixed(2)}.`;
          action = "Inspect rate or item discounts. Amend in GSTR-1 Table 9A if portal was under/over reported.";
        } else {
          status = "GST_MISMATCH";
          statusLabel = "GST Tax Value Mismatch";
          statusSeverity = "warning";
          gstMismatchCount++;
          if (hasHeadMismatch) {
            diagnosis = `Tax Head Classification Error: Books has ${bIgst > 0 ? "Interstate IGST" : "Intrastate CGST+SGST"}, whereas GSTR-1 has ${gIgst > 0 ? "Interstate IGST" : "Intrastate CGST+SGST"}.`;
            action = "Verify Place of Supply (POS) and recipient GSTIN state code. Amend tax heads in Table 9A.";
          } else {
            diagnosis = `Tax amount variance of ₹${diffTax.toFixed(2)} despite matching taxable value. Possible GST rate slab mismatch.`;
            action = "Verify GST rate percentage applied on invoice lines and file Table 9A rate amendment.";
          }
        }
      }

      items.push({
        key,
        normalized_invoice_number: key,
        status,
        status_label: statusLabel,
        status_severity: statusSeverity,
        books: b,
        gstr1: g,
        diff_taxable: diffTaxable,
        diff_igst: diffIgst,
        diff_cgst: diffCgst,
        diff_sgst: diffSgst,
        diff_cess: diffCess,
        diff_tax: diffTax,
        diff_total: diffTotal,
        is_auto_populated: isAutoPopulated,
        is_deleted_in_books: isDeletedInBooks,
        is_deleted_in_gstr1: isDeletedInGstr1,
        has_rate_mismatch: hasRateMismatch,
        is_within_tolerance: isWithinTolerance,
        audit_diagnosis: diagnosis,
        recommended_action: action,
      });
    }

    // Sort items: Critical errors first (Cancelled, Mismatch, Missing), then Matched
    const severityOrder: Record<AuditStatus, number> = {
      CANCELLED_MISMATCH: 1,
      DUPLICATE: 2,
      VALUE_MISMATCH: 3,
      GST_MISMATCH: 4,
      BOOKS_ONLY: 5,
      GSTR1_ONLY: 6,
      MATCHED: 7,
    };

    items.sort((a, b) => {
      const orderA = severityOrder[a.status] || 99;
      const orderB = severityOrder[b.status] || 99;
      if (orderA !== orderB) return orderA - orderB;
      return a.normalized_invoice_number.localeCompare(b.normalized_invoice_number);
    });

    const totalRecords = items.length;
    const matchedPercent = totalRecords > 0 ? Math.round((matchedCount / totalRecords) * 1000) / 10 : 0;
    const netDiffTaxable = Math.round((booksTotalTaxable - gstr1TotalTaxable) * 100) / 100;
    const netDiffTax = Math.round((booksTotalTax - gstr1TotalTax) * 100) / 100;
    const netDiffTotal = Math.round((booksTotalValue - gstr1TotalValue) * 100) / 100;
    const potentialTaxRisk = Math.round((unfiledLiabilityTax + excessPortalLiabilityTax) * 100) / 100;

    const metrics: AuditSummaryMetrics = {
      total_records: totalRecords,
      matched_count: matchedCount,
      matched_percent: matchedPercent,
      value_mismatch_count: valueMismatchCount,
      gst_mismatch_count: gstMismatchCount,
      books_only_count: booksOnlyCount,
      gstr1_only_count: gstr1OnlyCount,
      cancelled_mismatch_count: cancelledMismatchCount,
      duplicate_count: duplicateCount,
      books_total_taxable: Math.round(booksTotalTaxable * 100) / 100,
      books_total_tax: Math.round(booksTotalTax * 100) / 100,
      books_total_value: Math.round(booksTotalValue * 100) / 100,
      gstr1_total_taxable: Math.round(gstr1TotalTaxable * 100) / 100,
      gstr1_total_tax: Math.round(gstr1TotalTax * 100) / 100,
      gstr1_total_value: Math.round(gstr1TotalValue * 100) / 100,
      net_diff_taxable: netDiffTaxable,
      net_diff_tax: netDiffTax,
      net_diff_total: netDiffTotal,
      unfiled_liability_tax: Math.round(unfiledLiabilityTax * 100) / 100,
      excess_portal_liability_tax: Math.round(excessPortalLiabilityTax * 100) / 100,
      potential_tax_risk: potentialTaxRisk,
    };

    return { items, metrics };
  }

  /**
   * Filter reconciled items according to current filter configuration
   */
  static filterItems(items: AuditReconItem[], config: AuditFilterConfig): AuditReconItem[] {
    return items.filter((item) => {
      // Status filter
      if (config.selected_status !== "ALL" && item.status !== config.selected_status) {
        return false;
      }

      // Hide tolerated matches if requested
      if (config.hide_tolerated_matches && item.status === "MATCHED" && item.is_within_tolerance && (item.diff_taxable !== 0 || item.diff_tax !== 0)) {
        return false;
      }

      // Date range filter
      const itemDate = item.books?.invoice_date || item.gstr1?.invoice_date || "";
      if (config.date_from && itemDate && itemDate < config.date_from) {
        return false;
      }
      if (config.date_to && itemDate && itemDate > config.date_to) {
        return false;
      }

      // Search term
      if (config.search_query && config.search_query.trim()) {
        const query = config.search_query.toLowerCase().trim();
        const invNo = (item.books?.invoice_number || item.gstr1?.invoice_number || "").toLowerCase();
        const custName = (item.books?.customer_name || item.gstr1?.customer_name || "").toLowerCase();
        const gstin = (item.books?.customer_gstin || item.gstr1?.customer_gstin || "").toLowerCase();
        const diag = item.audit_diagnosis.toLowerCase();

        if (!invNo.includes(query) && !custName.includes(query) && !gstin.includes(query) && !diag.includes(query)) {
          return false;
        }
      }

      return true;
    });
  }

  /**
   * Generate realistic demonstration dataset with varied audit test cases
   */
  static getSampleAuditDataset(): { books: BooksInvoiceRecord[]; gstr1: Gstr1InvoiceRecord[] } {
    const books: BooksInvoiceRecord[] = [
      {
        invoice_number: "INV-2025-001",
        invoice_date: "2025-04-02",
        customer_name: "Apex Precision Engineering Ltd",
        customer_gstin: "33AAACA1234F1Z1",
        customer_code: "CUST-001",
        taxable_value: 125000.0,
        cgst_value: 11250.0,
        sgst_value: 11250.0,
        igst_value: 0.0,
        cess_value: 0.0,
        total_tax: 22500.0,
        total_value: 147500.0,
        status: "Active",
      },
      {
        invoice_number: "INV-2025-002",
        invoice_date: "2025-04-05",
        customer_name: "Bharat Metal Works Pvt Ltd",
        customer_gstin: "29AABCB4567M1Z5",
        customer_code: "CUST-002",
        taxable_value: 85400.0,
        cgst_value: 0.0,
        sgst_value: 0.0,
        igst_value: 15372.0,
        cess_value: 0.0,
        total_tax: 15372.0,
        total_value: 100772.0,
        status: "Active",
      },
      {
        invoice_number: "INV-2025-003",
        invoice_date: "2025-04-08",
        customer_name: "Dynamic Automotive Spares",
        customer_gstin: "33AABCD7890K1Z9",
        customer_code: "CUST-003",
        taxable_value: 46250.8,
        cgst_value: 4162.57,
        sgst_value: 4162.57,
        igst_value: 0.0,
        cess_value: 0.0,
        total_tax: 8325.14,
        total_value: 54575.94,
        status: "Active",
      },
      {
        invoice_number: "INV-2025-004",
        invoice_date: "2025-04-10",
        customer_name: "Southern Hydraulic Systems",
        customer_gstin: "33AABCE1122D1Z2",
        customer_code: "CUST-004",
        taxable_value: 210000.0,
        cgst_value: 18900.0,
        sgst_value: 18900.0,
        igst_value: 0.0,
        cess_value: 0.0,
        total_tax: 37800.0,
        total_value: 247800.0,
        status: "Active",
      },
      {
        invoice_number: "INV-2025-005",
        invoice_date: "2025-04-12",
        customer_name: "Titan Castings Limited",
        customer_gstin: "27AABCT9988P1Z8",
        customer_code: "CUST-005",
        taxable_value: 150000.0,
        cgst_value: 0.0,
        sgst_value: 0.0,
        igst_value: 27000.0,
        cess_value: 0.0,
        total_tax: 27000.0,
        total_value: 177000.0,
        status: "Active",
      },
      {
        invoice_number: "INV-2025-006",
        invoice_date: "2025-04-15",
        customer_name: "Matrix Fasteners Inc",
        customer_gstin: "33AACCM5544B1Z3",
        customer_code: "CUST-006",
        taxable_value: 64000.0,
        cgst_value: 5760.0,
        sgst_value: 5760.0,
        igst_value: 0.0,
        cess_value: 0.0,
        total_tax: 11520.0,
        total_value: 75520.0,
        status: "Active",
      },
      {
        invoice_number: "INV-2025-007",
        invoice_date: "2025-04-18",
        customer_name: "Vanguard Tech Corp",
        customer_gstin: "33AABCV3322L1Z4",
        customer_code: "CUST-007",
        taxable_value: 98000.0,
        cgst_value: 8820.0,
        sgst_value: 8820.0,
        igst_value: 0.0,
        cess_value: 0.0,
        total_tax: 17640.0,
        total_value: 115640.0,
        status: "Cancelled", // Voided in books, but still active in GSTR-1
      },
      {
        invoice_number: "INV-2025-008",
        invoice_date: "2025-04-20",
        customer_name: "Zenith Rubber Solutions",
        customer_gstin: "33AABCZ7788Q1Z6",
        customer_code: "CUST-008",
        taxable_value: 112000.0,
        cgst_value: 10080.0,
        sgst_value: 10080.0,
        igst_value: 0.0,
        cess_value: 0.0,
        total_tax: 20160.0,
        total_value: 132160.0,
        status: "Active", // In books only (unreported in GSTR-1)
      },
      {
        invoice_number: "INV-2025-009",
        invoice_date: "2025-04-22",
        customer_name: "Kalyani Industrial Supply",
        customer_gstin: "33AABCK2211N1Z0",
        customer_code: "CUST-009",
        taxable_value: 73500.0,
        cgst_value: 6615.0,
        sgst_value: 6615.0,
        igst_value: 0.0,
        cess_value: 0.0,
        total_tax: 13230.0,
        total_value: 86730.0,
        status: "Active",
      },
    ];

    const gstr1: Gstr1InvoiceRecord[] = [
      {
        invoice_number: "INV-2025-001", // Exact match
        invoice_date: "2025-04-02",
        customer_gstin: "33AAACA1234F1Z1",
        customer_name: "Apex Precision Engineering Ltd",
        taxable_value: 125000.0,
        cgst_value: 11250.0,
        sgst_value: 11250.0,
        igst_value: 0.0,
        cess_value: 0.0,
        total_tax: 22500.0,
        total_value: 147500.0,
        section: "b2b",
      },
      {
        invoice_number: "INV-2025-002", // Exact match
        invoice_date: "2025-04-05",
        customer_gstin: "29AABCB4567M1Z5",
        customer_name: "Bharat Metal Works Pvt Ltd",
        taxable_value: 85400.0,
        cgst_value: 0.0,
        sgst_value: 0.0,
        igst_value: 15372.0,
        cess_value: 0.0,
        total_tax: 15372.0,
        total_value: 100772.0,
        section: "b2b",
      },
      {
        invoice_number: "INV-2025-003", // Rounding match (± 0.50)
        invoice_date: "2025-04-08",
        customer_gstin: "33AABCD7890K1Z9",
        customer_name: "Dynamic Automotive Spares",
        taxable_value: 46251.0,
        cgst_value: 4162.59,
        sgst_value: 4162.59,
        igst_value: 0.0,
        cess_value: 0.0,
        total_tax: 8325.18,
        total_value: 54576.18,
        section: "b2b",
      },
      {
        invoice_number: "INV-2025-004", // Value Mismatch (Portal has 200,000 instead of 210,000)
        invoice_date: "2025-04-10",
        customer_gstin: "33AABCE1122D1Z2",
        customer_name: "Southern Hydraulic Systems",
        taxable_value: 200000.0,
        cgst_value: 18000.0,
        sgst_value: 18000.0,
        igst_value: 0.0,
        cess_value: 0.0,
        total_tax: 36000.0,
        total_value: 236000.0,
        section: "b2b",
      },
      {
        invoice_number: "INV-2025-005", // GST Head Mismatch (Filed as CGST+SGST instead of IGST)
        invoice_date: "2025-04-12",
        customer_gstin: "27AABCT9988P1Z8",
        customer_name: "Titan Castings Limited",
        taxable_value: 150000.0,
        cgst_value: 13500.0,
        sgst_value: 13500.0,
        igst_value: 0.0,
        cess_value: 0.0,
        total_tax: 27000.0,
        total_value: 177000.0,
        section: "b2b",
      },
      {
        invoice_number: "INV-2025-006", // Rate mismatch (Filed at 12% instead of 18%)
        invoice_date: "2025-04-15",
        customer_gstin: "33AACCM5544B1Z3",
        customer_name: "Matrix Fasteners Inc",
        taxable_value: 64000.0,
        cgst_value: 3840.0,
        sgst_value: 3840.0,
        igst_value: 0.0,
        cess_value: 0.0,
        total_tax: 7680.0,
        total_value: 71680.0,
        section: "b2b",
      },
      {
        invoice_number: "INV-2025-007", // Active in portal, cancelled in books!
        invoice_date: "2025-04-18",
        customer_gstin: "33AABCV3322L1Z4",
        customer_name: "Vanguard Tech Corp",
        taxable_value: 98000.0,
        cgst_value: 8820.0,
        sgst_value: 8820.0,
        igst_value: 0.0,
        cess_value: 0.0,
        total_tax: 17640.0,
        total_value: 115640.0,
        section: "b2b",
        is_deleted: false,
      },
      {
        invoice_number: "INV-2025-010", // In GSTR-1 Only (Auto-Populated from e-invoice IRN)
        invoice_date: "2025-04-25",
        customer_gstin: "33AABCO4433R1Z7",
        customer_name: "Omni Industrial Automations",
        taxable_value: 180000.0,
        cgst_value: 16200.0,
        sgst_value: 16200.0,
        igst_value: 0.0,
        cess_value: 0.0,
        total_tax: 32400.0,
        total_value: 212400.0,
        section: "b2b",
        is_auto_populated: true,
        irn: "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08",
      },
    ];

    return { books, gstr1 };
  }

  /**
   * Export comprehensive reconciliation workpaper to CSV with save dialog
   */
  static async exportReconciliationCsv(
    items: AuditReconItem[],
    metrics: AuditSummaryMetrics,
    companyName: string = "Sales Monitoring System"
  ): Promise<boolean> {
    try {
      const lines: string[] = [];

      // Header Block
      lines.push(`"GSTR-1 VS BOOKS OUTWARD SALES RECONCILIATION AUDIT REPORT"`);
      lines.push(`"Company Name: ${companyName}"`);
      lines.push(`"Audit Execution Date: ${new Date().toLocaleString()}"`);
      lines.push(`"Reconciliation Health Score: ${metrics.matched_percent}%"`);
      lines.push(`"Total Invoices Examined: ${metrics.total_records}"`);
      lines.push(`"Matched Invoices: ${metrics.matched_count}"`);
      lines.push(`"Value Mismatches: ${metrics.value_mismatch_count}"`);
      lines.push(`"GST Value / Head Mismatches: ${metrics.gst_mismatch_count}"`);
      lines.push(`"In Books Only (Unreported): ${metrics.books_only_count}"`);
      lines.push(`"In GSTR-1 Only (Auto-Populated): ${metrics.gstr1_only_count}"`);
      lines.push(`"Cancelled / Voided Mismatches: ${metrics.cancelled_mismatch_count}"`);
      lines.push(`"Books Total Taxable (INR): ${metrics.books_total_taxable}"`);
      lines.push(`"GSTR-1 Total Taxable (INR): ${metrics.gstr1_total_taxable}"`);
      lines.push(`"Net Tax Liability Variance (INR): ${metrics.net_diff_tax}"`);
      lines.push(""); // Spacer

      // Table Header
      const headers = [
        "Audit Status",
        "Invoice Number (Books)",
        "Invoice Number (GSTR-1)",
        "Invoice Date",
        "Customer Name",
        "Customer GSTIN",
        "Books Taxable (INR)",
        "GSTR-1 Taxable (INR)",
        "Diff Taxable (INR)",
        "Books CGST (INR)",
        "GSTR-1 CGST (INR)",
        "Books SGST (INR)",
        "GSTR-1 SGST (INR)",
        "Books IGST (INR)",
        "GSTR-1 IGST (INR)",
        "Books Total Tax (INR)",
        "GSTR-1 Total Tax (INR)",
        "Diff Total Tax (INR)",
        "Books Total Value (INR)",
        "GSTR-1 Total Value (INR)",
        "Diff Total Value (INR)",
        "Auto-Populated in GSTR-1",
        "Deleted in Books",
        "Audit Diagnosis & Findings",
        "Recommended Action",
      ];
      lines.push(headers.map((h) => `"${h}"`).join(","));

      // Data rows
      for (const itm of items) {
        const row = [
          itm.status_label,
          itm.books?.invoice_number || "",
          itm.gstr1?.invoice_number || "",
          itm.books?.invoice_date || itm.gstr1?.invoice_date || "",
          itm.books?.customer_name || itm.gstr1?.customer_name || "",
          itm.books?.customer_gstin || itm.gstr1?.customer_gstin || "",
          itm.books?.taxable_value != null ? itm.books.taxable_value.toFixed(2) : "",
          itm.gstr1?.taxable_value != null ? itm.gstr1.taxable_value.toFixed(2) : "",
          itm.diff_taxable.toFixed(2),
          itm.books?.cgst_value != null ? itm.books.cgst_value.toFixed(2) : "",
          itm.gstr1?.cgst_value != null ? itm.gstr1.cgst_value.toFixed(2) : "",
          itm.books?.sgst_value != null ? itm.books.sgst_value.toFixed(2) : "",
          itm.gstr1?.sgst_value != null ? itm.gstr1.sgst_value.toFixed(2) : "",
          itm.books?.igst_value != null ? itm.books.igst_value.toFixed(2) : "",
          itm.gstr1?.igst_value != null ? itm.gstr1.igst_value.toFixed(2) : "",
          itm.books?.total_tax != null ? itm.books.total_tax.toFixed(2) : "",
          itm.gstr1?.total_tax != null ? itm.gstr1.total_tax.toFixed(2) : "",
          itm.diff_tax.toFixed(2),
          itm.books?.total_value != null ? itm.books.total_value.toFixed(2) : "",
          itm.gstr1?.total_value != null ? itm.gstr1.total_value.toFixed(2) : "",
          itm.diff_total.toFixed(2),
          itm.is_auto_populated ? "YES" : "NO",
          itm.is_deleted_in_books ? "YES" : "NO",
          itm.audit_diagnosis.replace(/"/g, '""'),
          itm.recommended_action.replace(/"/g, '""'),
        ];
        lines.push(row.map((c) => `"${c}"`).join(","));
      }

      const csvContent = lines.join("\n");
      const filename = `GSTR1_Audit_Reconciliation_${new Date().toISOString().split("T")[0]}.csv`;

      try {
        const selectedPath = await save({
          defaultPath: filename,
          filters: [{ name: "CSV Spreadsheets", extensions: ["csv"] }],
        });

        if (selectedPath) {
          await writeTextFile(selectedPath, csvContent);
          return true;
        }
        return false;
      } catch {
        // Web fallback (blob download)
        const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.setAttribute("download", filename);
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        return true;
      }
    } catch (err) {
      console.error("Export audit failed:", err);
      alert(`Export failed: ${err instanceof Error ? err.message : String(err)}`);
      return false;
    }
  }
}
