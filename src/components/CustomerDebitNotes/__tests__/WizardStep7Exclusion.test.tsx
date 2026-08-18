import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { CustomerDebitNotesTab } from "../CustomerDebitNotesTab";
import { ApiService } from "../../../services/api";

vi.mock("../../../services/api", () => ({
  ApiService: {
    getCustomerMaster: vi.fn(),
    getCustomerParts: vi.fn(),
    getAllItems: vi.fn(),
    listCustomerDebitNotes: vi.fn(),
    simulateCustomerDebitNoteRecovery: vi.fn(),
    generateCustomerDebitNote: vi.fn(),
    getCustomerDebitNoteDetails: vi.fn(),
  },
}));

vi.mock("@tauri-apps/plugin-dialog", () => ({
  open: vi.fn(),
  save: vi.fn(),
}));

describe("CustomerDebitNotesTab - Wizard Step 7 Exclusion Workflow", () => {
  const sampleCustomers = [
    { id: 101, report_name: "Acme Automotive", customer_code: "CUST101", status: "Approved" },
  ];

  const sampleParts = [
    {
      part_number: "PART-100",
      part_description: "Gear Box",
      current_price: 100.0,
      uom: "PCS",
      source: "Manual",
    },
  ];

  const sampleSimulation = {
    total_invoices: 3,
    total_quantity: 350.0,
    total_taxable: 3000.0,
    total_cgst: 270.0,
    total_sgst: 270.0,
    total_igst: 0.0,
    total_cess: 0.0,
    grand_total: 3540.0,
    warnings: [],
    items: [
      {
        invoice_number: "INV-001",
        invoice_date: "2026-05-01",
        part_code: "PART-100",
        recovered_qty: 100.0,
        rate_pre_unit: 100.0,
        new_price: 110.0,
        difference: 10.0,
        assessable_difference: 1000.0,
        gst_type: "CGST+SGST",
        cgst_rate: 9.0,
        cgst_amount: 90.0,
        sgst_rate: 9.0,
        sgst_amount: 90.0,
        igst_rate: 0.0,
        igst_amount: 0.0,
        total_difference: 1180.0,
      },
      {
        invoice_number: "INV-002",
        invoice_date: "2026-05-02",
        part_code: "PART-100",
        recovered_qty: 50.0,
        rate_pre_unit: 100.0,
        new_price: 120.0,
        difference: 20.0,
        assessable_difference: 1000.0,
        gst_type: "CGST+SGST",
        cgst_rate: 9.0,
        cgst_amount: 90.0,
        sgst_rate: 9.0,
        sgst_amount: 90.0,
        igst_rate: 0.0,
        igst_amount: 0.0,
        total_difference: 1180.0,
      },
      {
        invoice_number: "INV-003",
        invoice_date: "2026-05-03",
        part_code: "PART-100",
        recovered_qty: 200.0,
        rate_pre_unit: 100.0,
        new_price: 105.0,
        difference: 5.0,
        assessable_difference: 1000.0,
        gst_type: "CGST+SGST",
        cgst_rate: 9.0,
        cgst_amount: 90.0,
        sgst_rate: 9.0,
        sgst_amount: 90.0,
        igst_rate: 0.0,
        igst_amount: 0.0,
        total_difference: 1180.0,
      },
    ],
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(ApiService.getCustomerMaster).mockResolvedValue(sampleCustomers as any);
    vi.mocked(ApiService.getCustomerParts).mockResolvedValue(sampleParts as any);
    vi.mocked(ApiService.getAllItems).mockResolvedValue(sampleParts as any);
    vi.mocked(ApiService.listCustomerDebitNotes).mockResolvedValue([]);
    vi.mocked(ApiService.simulateCustomerDebitNoteRecovery).mockResolvedValue(sampleSimulation as any);
  });

  async function advanceToStep7() {
    render(<CustomerDebitNotesTab onNotify={vi.fn()} />);

    // Step 1: Select Customer
    await waitFor(() => {
      expect(screen.getByText(/Acme Automotive/i)).toBeInTheDocument();
    });
    const customerSelect = screen.getAllByRole("combobox")[0];
    fireEvent.change(customerSelect, { target: { value: "101" } });

    const nextStep2Btn = screen.getByRole("button", { name: /Proceed to Price Revision Input/i });
    fireEvent.click(nextStep2Btn);

    // Step 2: Fill Revision Item
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /Next: Invoice Period/i })).toBeInTheDocument();
    });
    const partSelect = screen.getAllByRole("combobox")[0];
    fireEvent.change(partSelect, { target: { value: "PART-100" } });

    const newPriceInput = screen.getAllByRole("spinbutton")[1];
    fireEvent.change(newPriceInput, { target: { value: "110" } });

    const nextStep4Btn = screen.getByRole("button", { name: /Next: Invoice Period/i });
    fireEvent.click(nextStep4Btn);

    // Step 4-6: Run Simulation Engine
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /Run Simulation Engine/i })).toBeInTheDocument();
    });
    const simulateBtn = screen.getByRole("button", { name: /Run Simulation Engine/i });
    fireEvent.click(simulateBtn);

    // Step 7 Board loaded
    await waitFor(() => {
      expect(screen.getByText(/Step 7: Simulation Board & Metrics/i)).toBeInTheDocument();
    });
  }

  it("1. Renders Step 7 simulation with all invoice lines and initial KPIs", async () => {
    await advanceToStep7();

    // Check all invoices are present
    expect(screen.getByText("INV-001")).toBeInTheDocument();
    expect(screen.getByText("INV-002")).toBeInTheDocument();
    expect(screen.getByText("INV-003")).toBeInTheDocument();

    // Check 3 Exclude buttons
    const excludeButtons = screen.getAllByTitle("Exclude this invoice line from Debit Note");
    expect(excludeButtons.length).toBe(3);

    // Check KPI values (3 Invoices, 350 Qty, ₹3000 Taxable, ₹540 GST, ₹3540 Grand Total)
    expect(screen.getByText("350")).toBeInTheDocument();
    expect(screen.getByText("₹3000.00")).toBeInTheDocument();
    expect(screen.getByText("₹540.00")).toBeInTheDocument();
    expect(screen.getByText("₹3540.00")).toBeInTheDocument();

    // Generation button displays 3 lines
    expect(
      screen.getByRole("button", { name: /Generate Debit Note & Annexure CDN-A \(3\)/i })
    ).toBeInTheDocument();
  });

  it("2. Exclude an invoice line: updates KPIs, visual badge, and line counter immediately", async () => {
    await advanceToStep7();

    // Exclude INV-002 (idx 1: 50 qty, ₹1000 taxable, ₹180 GST, ₹1180 total)
    const excludeButtons = screen.getAllByTitle("Exclude this invoice line from Debit Note");
    fireEvent.click(excludeButtons[1]);

    // INV-002 now has Excluded badge
    expect(screen.getByText("Excluded")).toBeInTheDocument();

    // Toolbar shows 1 line excluded and active count is 2
    expect(screen.getByText(/1 line\(s\) excluded from Debit Note/i)).toBeInTheDocument();

    // KPI recalculated: Qty 300 (was 350), Taxable ₹2000.00 (was ₹3000.00), GST ₹360.00, Grand Total ₹2360.00
    expect(screen.getByText("300")).toBeInTheDocument();
    expect(screen.getByText("₹2000.00")).toBeInTheDocument();
    expect(screen.getByText("₹360.00")).toBeInTheDocument();
    expect(screen.getByText("₹2360.00")).toBeInTheDocument();

    // Generation button count updated to 2
    expect(
      screen.getByRole("button", { name: /Generate Debit Note & Annexure CDN-A \(2\)/i })
    ).toBeInTheDocument();
  });

  it("3. Restore an excluded line: returns line back to active state", async () => {
    await advanceToStep7();

    // Exclude INV-002
    const excludeButtons = screen.getAllByTitle("Exclude this invoice line from Debit Note");
    fireEvent.click(excludeButtons[1]);
    expect(screen.getByText("Excluded")).toBeInTheDocument();

    // Click Restore button on INV-002
    const restoreBtn = screen.getByTitle("Restore this line for generation");
    fireEvent.click(restoreBtn);

    // Excluded badge is removed
    expect(screen.queryByText("Excluded")).not.toBeInTheDocument();

    // KPIs restored to full values
    expect(screen.getByText("350")).toBeInTheDocument();
    expect(screen.getByText("₹3540.00")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Generate Debit Note & Annexure CDN-A \(3\)/i })
    ).toBeInTheDocument();
  });

  it("4. Restore All Excluded button restores all lines at once", async () => {
    await advanceToStep7();

    // Exclude INV-001 and INV-003
    const excludeButtons = screen.getAllByTitle("Exclude this invoice line from Debit Note");
    fireEvent.click(excludeButtons[0]);
    fireEvent.click(excludeButtons[2]);

    expect(screen.getByRole("button", { name: /Restore All Excluded \(2\)/i })).toBeInTheDocument();

    // Click Restore All Excluded
    const restoreAllBtn = screen.getByRole("button", { name: /Restore All Excluded \(2\)/i });
    fireEvent.click(restoreAllBtn);

    // All lines active again
    expect(screen.queryByText("Excluded")).not.toBeInTheDocument();
    expect(screen.getByText("350")).toBeInTheDocument();
  });

  it("5. Generation is disabled when all invoice lines are excluded", async () => {
    await advanceToStep7();

    // Exclude all 3 lines
    const excludeButtons = screen.getAllByTitle("Exclude this invoice line from Debit Note");
    fireEvent.click(excludeButtons[0]);
    fireEvent.click(excludeButtons[1]);
    fireEvent.click(excludeButtons[2]);

    // Generation button should be disabled with (0)
    const generateBtn = screen.getByRole("button", { name: /Generate Debit Note & Annexure CDN-A \(0\)/i });
    expect(generateBtn).toBeDisabled();
  });

  it("6. Generation sends only currently retained invoice lines to ApiService", async () => {
    vi.mocked(ApiService.generateCustomerDebitNote).mockResolvedValueOnce({
      id: 1,
      debit_note_no: "CDN00001",
    } as any);

    await advanceToStep7();

    // Exclude INV-002 (idx 1), retaining INV-001 and INV-003
    const excludeButtons = screen.getAllByTitle("Exclude this invoice line from Debit Note");
    fireEvent.click(excludeButtons[1]);

    // Click Generate
    const generateBtn = screen.getByRole("button", { name: /Generate Debit Note & Annexure CDN-A \(2\)/i });
    fireEvent.click(generateBtn);

    await waitFor(() => {
      expect(ApiService.generateCustomerDebitNote).toHaveBeenCalledTimes(1);
      const retainedItemsArg = vi.mocked(ApiService.generateCustomerDebitNote).mock.calls[0][11];

      // Verify retained items passed to backend contains only INV-001 and INV-003
      expect(retainedItemsArg.length).toBe(2);
      expect(retainedItemsArg.map((it: any) => it.invoice_number)).toEqual(["INV-001", "INV-003"]);
    });
  });
});
