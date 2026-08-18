import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { HsnWiseReportTab } from "../HsnWiseReportTab";
import { ApiService } from "../../../services/api";
import { ReportExportService } from "../../../services/reportExportService";

vi.mock("../../../services/api", () => ({
  ApiService: {
    getHsnReport: vi.fn(),
    getHsnItemBreakdown: vi.fn(),
    getHsnInvoiceBreakdown: vi.fn(),
  },
}));

vi.mock("../../../services/reportExportService", () => ({
  ReportExportService: {
    exportToCsv: vi.fn().mockResolvedValue(true),
    exportGstr1Table12Csv: vi.fn().mockResolvedValue(true),
    copyToClipboard: vi.fn().mockResolvedValue(true),
    printReport: vi.fn(),
  },
}));

describe("HsnWiseReportTab Component", () => {
  const sampleReportResult = {
    metadata: {
      report_name: "HSN Wise Sales & GST Summary Report",
      report_version: 1,
      generated_at: "2026-08-18T10:00:00Z",
      execution_time_ms: 12,
      filter_hash: "hash123",
      total_records: 2,
      total_pages: 1,
      page: 1,
      page_size: 100,
    },
    filter: {
      date_from: "2026-04-01",
      date_to: "2026-04-30",
      include_cancelled: false,
      search_term: null,
      show_empty_hsn: false,
      hsn_codes: null,
      financial_year_id: null,
      invoice_statuses: null,
      page: 1,
      page_size: 100,
    },
    grand_totals: {
      total_hsn_codes: 2,
      total_items: 3,
      total_customers: 2,
      total_invoices: 4,
      total_quantity: 150.0,
      total_taxable: 100000.0,
      total_cgst: 9000.0,
      total_sgst: 9000.0,
      total_igst: 0.0,
      total_tax: 18000.0,
      grand_total_value: 118000.0,
      top_hsn_code: "8708",
      top_hsn_description: "Parts and accessories of motor vehicles",
      top_hsn_share: 75.0,
    },
    rows: [
      {
        hsn_code: "8708",
        description: "Parts and accessories of motor vehicles",
        uom_code: "NOS",
        gst_rate: 18.0,
        total_quantity: 100.0,
        item_count: 2,
        customer_count: 2,
        invoice_count: 3,
        total_taxable: 75000.0,
        total_cgst: 6750.0,
        total_sgst: 6750.0,
        total_igst: 0.0,
        total_tax: 13500.0,
        total_value: 88500.0,
      },
      {
        hsn_code: "8409",
        description: "Parts for internal combustion engines",
        uom_code: "NOS",
        gst_rate: 18.0,
        total_quantity: 50.0,
        item_count: 1,
        customer_count: 1,
        invoice_count: 1,
        total_taxable: 25000.0,
        total_cgst: 2250.0,
        total_sgst: 2250.0,
        total_igst: 0.0,
        total_tax: 4500.0,
        total_value: 29500.0,
      },
    ],
  };

  const sampleItemBreakdown = [
    {
      hsn_code: "8708",
      part_code: "PART-001",
      part_name: "Front Brake Rotor",
      uom_code: "NOS",
      default_gst_rate: 18.0,
      total_quantity: 60.0,
      avg_rate: 750.0,
      customer_count: 2,
      invoice_count: 2,
      total_taxable: 45000.0,
      total_cgst: 4050.0,
      total_sgst: 4050.0,
      total_igst: 0.0,
      total_tax: 8100.0,
      total_value: 53100.0,
    },
    {
      hsn_code: "8708",
      part_code: "PART-002",
      part_name: "Rear Brake Pad Set",
      uom_code: "SET",
      default_gst_rate: 18.0,
      total_quantity: 40.0,
      avg_rate: 750.0,
      customer_count: 1,
      invoice_count: 1,
      total_taxable: 30000.0,
      total_cgst: 2700.0,
      total_sgst: 2700.0,
      total_igst: 0.0,
      total_tax: 5400.0,
      total_value: 35400.0,
    },
  ];

  const sampleInvoiceBreakdown = [
    {
      invoice_number: "INV-1001",
      invoice_date: "2026-04-10",
      customer_code: "CUST-A",
      customer_name: "Alpha Motors Ltd",
      part_code: "PART-001",
      part_name: "Front Brake Rotor",
      quantity: 40.0,
      uom_code: "NOS",
      rate_pre_unit: 750.0,
      assessable_value: 30000.0,
      cgst_rate: 9.0,
      cgst_amount: 2700.0,
      sgst_rate: 9.0,
      sgst_amount: 2700.0,
      igst_rate: 0.0,
      igst_amount: 0.0,
      total_value: 35400.0,
      status: "Posted",
    },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(ApiService.getHsnReport).mockResolvedValue(sampleReportResult as any);
    vi.mocked(ApiService.getHsnItemBreakdown).mockResolvedValue(sampleItemBreakdown as any);
    vi.mocked(ApiService.getHsnInvoiceBreakdown).mockResolvedValue(sampleInvoiceBreakdown as any);
  });

  it("1. Renders Initial Level 1 HSN Summary Table & KPI Cards", async () => {
    render(<HsnWiseReportTab dateFrom="2026-04-01" dateTo="2026-04-30" />);

    expect(screen.getByTestId("hsn-loading-state")).toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getByTestId("hsn-level1-table")).toBeInTheDocument();
    });

    // Verify KPI Cards
    expect(screen.getByTestId("kpi-total-taxable")).toHaveTextContent("1,00,000.00");
    expect(screen.getByTestId("kpi-total-gst")).toHaveTextContent("18,000.00");
    expect(screen.getByTestId("kpi-hsn-count")).toHaveTextContent("2");
    expect(screen.getByTestId("kpi-top-hsn")).toHaveTextContent("8708");
    expect(screen.getByTestId("kpi-total-quantity")).toHaveTextContent("150");

    // Verify Table Rows
    expect(screen.getByTestId("hsn-row-8708")).toBeInTheDocument();
    expect(screen.getByTestId("hsn-row-8409")).toBeInTheDocument();
  });

  it("2. Drills down into Level 2 Item Breakdown on HSN row click", async () => {
    render(<HsnWiseReportTab dateFrom="2026-04-01" dateTo="2026-04-30" />);

    await waitFor(() => {
      expect(screen.getByTestId("hsn-row-8708")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId("hsn-row-8708"));

    await waitFor(() => {
      expect(ApiService.getHsnItemBreakdown).toHaveBeenCalledWith(
        expect.anything(),
        "8708"
      );
      expect(screen.getByTestId("hsn-level2-table")).toBeInTheDocument();
    });

    expect(screen.getByTestId("hsn-item-row-PART-001")).toBeInTheDocument();
    expect(screen.getByTestId("hsn-item-row-PART-002")).toBeInTheDocument();
  });

  it("3. Drills down into Level 3 Invoices on Item row click and supports Back navigation", async () => {
    const inspectMock = vi.fn();
    render(<HsnWiseReportTab dateFrom="2026-04-01" dateTo="2026-04-30" onInspectInvoice={inspectMock} />);

    await waitFor(() => {
      expect(screen.getByTestId("hsn-row-8708")).toBeInTheDocument();
    });

    // Level 1 -> Level 2
    fireEvent.click(screen.getByTestId("hsn-row-8708"));

    await waitFor(() => {
      expect(screen.getByTestId("hsn-item-row-PART-001")).toBeInTheDocument();
    });

    // Level 2 -> Level 3
    fireEvent.click(screen.getByTestId("hsn-item-row-PART-001"));

    await waitFor(() => {
      expect(ApiService.getHsnInvoiceBreakdown).toHaveBeenCalledWith(
        expect.anything(),
        "8708",
        "PART-001"
      );
      expect(screen.getByTestId("hsn-level3-table")).toBeInTheDocument();
      expect(screen.getByText("INV-1001")).toBeInTheDocument();
    });

    // Double click invoice row
    fireEvent.doubleClick(screen.getByText("INV-1001"));
    expect(inspectMock).toHaveBeenCalledWith("INV-1001");

    // Back to Level 2
    fireEvent.click(screen.getByTestId("hsn-back-btn"));
    await waitFor(() => {
      expect(screen.getByTestId("hsn-level2-table")).toBeInTheDocument();
    });

    // Back to Level 1
    fireEvent.click(screen.getByTestId("hsn-back-btn"));
    await waitFor(() => {
      expect(screen.getByTestId("hsn-level1-table")).toBeInTheDocument();
    });
  });

  it("4. Filters table rows on text search", async () => {
    render(<HsnWiseReportTab dateFrom="2026-04-01" dateTo="2026-04-30" />);

    await waitFor(() => {
      expect(screen.getByTestId("hsn-row-8708")).toBeInTheDocument();
      expect(screen.getByTestId("hsn-row-8409")).toBeInTheDocument();
    });

    fireEvent.change(screen.getByTestId("hsn-search-input"), { target: { value: "8409" } });

    expect(screen.queryByTestId("hsn-row-8708")).not.toBeInTheDocument();
    expect(screen.getByTestId("hsn-row-8409")).toBeInTheDocument();
  });

  it("5. Triggers export actions for CSV, GSTR-1, Copy, and Print", async () => {
    render(<HsnWiseReportTab dateFrom="2026-04-01" dateTo="2026-04-30" />);

    await waitFor(() => {
      expect(screen.getByTestId("hsn-level1-table")).toBeInTheDocument();
    });

    // CSV Export
    fireEvent.click(screen.getByTestId("hsn-export-csv-btn"));
    expect(ReportExportService.exportToCsv).toHaveBeenCalled();

    // GSTR-1 Table 12 Export
    fireEvent.click(screen.getByTestId("hsn-export-gstr1-btn"));
    expect(ReportExportService.exportGstr1Table12Csv).toHaveBeenCalled();

    // Copy to clipboard
    fireEvent.click(screen.getByTestId("hsn-copy-btn"));
    expect(ReportExportService.copyToClipboard).toHaveBeenCalled();

    // Print
    fireEvent.click(screen.getByTestId("hsn-print-btn"));
    expect(ReportExportService.printReport).toHaveBeenCalled();
  });

  it("6. Displays empty state when no records are returned", async () => {
    vi.mocked(ApiService.getHsnReport).mockResolvedValueOnce({
      metadata: sampleReportResult.metadata,
      filter: sampleReportResult.filter,
      grand_totals: {
        total_hsn_codes: 0,
        total_items: 0,
        total_customers: 0,
        total_invoices: 0,
        total_quantity: 0,
        total_taxable: 0,
        total_cgst: 0,
        total_sgst: 0,
        total_igst: 0,
        total_tax: 0,
        grand_total_value: 0,
        top_hsn_code: "N/A",
        top_hsn_description: "N/A",
        top_hsn_share: 0,
      },
      rows: [],
    } as any);

    render(<HsnWiseReportTab dateFrom="2026-04-01" dateTo="2026-04-30" />);

    await waitFor(() => {
      expect(screen.getByTestId("hsn-empty-state")).toBeInTheDocument();
    });
  });
});
