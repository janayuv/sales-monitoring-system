import { describe, it, expect } from "vitest";
import { Gstr1AuditService } from "../services/gstr1AuditService";
import { BooksInvoiceRecord, Gstr1InvoiceRecord } from "../types/gstr1AuditTypes";

describe("Gstr1AuditService", () => {
  it("normalizes invoice numbers consistently", () => {
    expect(Gstr1AuditService.normalizeInvoiceNo("INV-2025/001")).toBe("INV2025001");
    expect(Gstr1AuditService.normalizeInvoiceNo("inv_2025-001 ")).toBe("INV2025001");
    expect(Gstr1AuditService.normalizeInvoiceNo(" INV.2025.001 ")).toBe("INV2025001");
    expect(Gstr1AuditService.normalizeInvoiceNo("")).toBe("");
  });

  it("reconciles exact matches correctly", () => {
    const books: BooksInvoiceRecord[] = [
      {
        invoice_number: "INV-001",
        invoice_date: "2025-04-01",
        customer_name: "Test Corp",
        taxable_value: 10000,
        cgst_value: 900,
        sgst_value: 900,
        igst_value: 0,
        cess_value: 0,
        total_tax: 1800,
        total_value: 11800,
        status: "Active",
      },
    ];

    const gstr1: Gstr1InvoiceRecord[] = [
      {
        invoice_number: "INV-001",
        invoice_date: "2025-04-01",
        customer_name: "Test Corp",
        taxable_value: 10000,
        cgst_value: 900,
        sgst_value: 900,
        igst_value: 0,
        cess_value: 0,
        total_tax: 1800,
        total_value: 11800,
        section: "b2b",
      },
    ];

    const { items, metrics } = Gstr1AuditService.reconcile(books, gstr1, 1.0);
    expect(items.length).toBe(1);
    expect(items[0].status).toBe("MATCHED");
    expect(items[0].diff_taxable).toBe(0);
    expect(items[0].diff_tax).toBe(0);
    expect(metrics.matched_count).toBe(1);
    expect(metrics.matched_percent).toBe(100);
    expect(metrics.value_mismatch_count).toBe(0);
  });

  it("detects value mismatches and variance amounts", () => {
    const books: BooksInvoiceRecord[] = [
      {
        invoice_number: "INV-002",
        invoice_date: "2025-04-02",
        taxable_value: 20000,
        cgst_value: 1800,
        sgst_value: 1800,
        igst_value: 0,
        cess_value: 0,
        total_tax: 3600,
        total_value: 23600,
        status: "Active",
      },
    ];

    const gstr1: Gstr1InvoiceRecord[] = [
      {
        invoice_number: "INV-002",
        invoice_date: "2025-04-02",
        taxable_value: 18000, // 2000 difference
        cgst_value: 1620,
        sgst_value: 1620,
        igst_value: 0,
        cess_value: 0,
        total_tax: 3240,
        total_value: 21240,
        section: "b2b",
      },
    ];

    const { items, metrics } = Gstr1AuditService.reconcile(books, gstr1, 1.0);
    expect(items[0].status).toBe("VALUE_MISMATCH");
    expect(items[0].diff_taxable).toBe(2000);
    expect(items[0].diff_tax).toBe(360);
    expect(metrics.value_mismatch_count).toBe(1);
  });

  it("detects GST head mismatch (IGST vs CGST+SGST)", () => {
    const books: BooksInvoiceRecord[] = [
      {
        invoice_number: "INV-003",
        invoice_date: "2025-04-03",
        taxable_value: 10000,
        cgst_value: 0,
        sgst_value: 0,
        igst_value: 1800,
        cess_value: 0,
        total_tax: 1800,
        total_value: 11800,
        status: "Active",
      },
    ];

    const gstr1: Gstr1InvoiceRecord[] = [
      {
        invoice_number: "INV-003",
        invoice_date: "2025-04-03",
        taxable_value: 10000,
        cgst_value: 900,
        sgst_value: 900,
        igst_value: 0,
        cess_value: 0,
        total_tax: 1800,
        total_value: 11800,
        section: "b2b",
      },
    ];

    const { items, metrics } = Gstr1AuditService.reconcile(books, gstr1, 1.0);
    expect(items[0].status).toBe("GST_MISMATCH");
    expect(metrics.gst_mismatch_count).toBe(1);
  });

  it("identifies auto-populated invoices missing in books", () => {
    const books: BooksInvoiceRecord[] = [];
    const gstr1: Gstr1InvoiceRecord[] = [
      {
        invoice_number: "INV-AUTO-99",
        invoice_date: "2025-04-10",
        customer_name: "Auto Client",
        taxable_value: 50000,
        cgst_value: 4500,
        sgst_value: 4500,
        igst_value: 0,
        cess_value: 0,
        total_tax: 9000,
        total_value: 59000,
        section: "b2b",
        is_auto_populated: true,
      },
    ];

    const { items, metrics } = Gstr1AuditService.reconcile(books, gstr1, 1.0);
    expect(items[0].status).toBe("GSTR1_ONLY");
    expect(items[0].is_auto_populated).toBe(true);
    expect(metrics.gstr1_only_count).toBe(1);
  });

  it("identifies cancelled/deleted invoice mismatches", () => {
    const books: BooksInvoiceRecord[] = [
      {
        invoice_number: "INV-CAN-01",
        invoice_date: "2025-04-04",
        taxable_value: 10000,
        cgst_value: 900,
        sgst_value: 900,
        igst_value: 0,
        cess_value: 0,
        total_tax: 1800,
        total_value: 11800,
        status: "Cancelled", // Cancelled in Books
      },
    ];

    const gstr1: Gstr1InvoiceRecord[] = [
      {
        invoice_number: "INV-CAN-01",
        invoice_date: "2025-04-04",
        taxable_value: 10000,
        cgst_value: 900,
        sgst_value: 900,
        igst_value: 0,
        cess_value: 0,
        total_tax: 1800,
        total_value: 11800,
        section: "b2b",
        is_deleted: false, // Active in portal
      },
    ];

    const { items, metrics } = Gstr1AuditService.reconcile(books, gstr1, 1.0);
    expect(items[0].status).toBe("CANCELLED_MISMATCH");
    expect(metrics.cancelled_mismatch_count).toBe(1);
  });

  it("parses GSTR-1 JSON correctly", () => {
    const sampleJson = JSON.stringify({
      gstin: "33AAAAA0000A1Z5",
      fp: "042025",
      b2b: [
        {
          ctin: "33BBBBB1111B1Z2",
          cpty: "Test Buyer",
          inv: [
            {
              inum: "TEST-INV-101",
              idt: "05-04-2025",
              val: 11800,
              pos: "33",
              itms: [
                {
                  itm_det: {
                    txval: 10000,
                    camt: 900,
                    samt: 900,
                    iamt: 0,
                    csamt: 0,
                  },
                },
              ],
            },
          ],
        },
      ],
    });

    const parsed = Gstr1AuditService.parseGstr1Json(sampleJson);
    expect(parsed.length).toBe(1);
    expect(parsed[0].invoice_number).toBe("TEST-INV-101");
    expect(parsed[0].taxable_value).toBe(10000);
    expect(parsed[0].cgst_value).toBe(900);
    expect(parsed[0].sgst_value).toBe(900);
    expect(parsed[0].total_tax).toBe(1800);
  });
});
