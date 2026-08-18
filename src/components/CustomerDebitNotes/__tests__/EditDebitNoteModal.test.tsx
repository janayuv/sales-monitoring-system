import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { EditDebitNoteModal } from "../EditDebitNoteModal";
import { ApiService } from "../../../services/api";

vi.mock("../../../services/api", () => ({
  ApiService: {
    updateCustomerDebitNoteLines: vi.fn(),
  },
}));

describe("EditDebitNoteModal Component", () => {
  const sampleDebitNote: any = {
    id: 1,
    uuid: "cdn-1",
    case_id: 1,
    financial_year_id: 2,
    debit_note_no: "CDN00001",
    annexure_no: "CDN00001-A",
    customer_id: 101,
    debit_note_date: "2026-05-10",
    reference: null,
    total_taxable: 3000.0,
    total_cgst: 270.0,
    total_sgst: 270.0,
    total_igst: 0.0,
    total_cess: 0.0,
    total_value: 3540.0,
    currency: "INR",
    exchange_rate: 1.0,
    foreign_total_value: 3540.0,
    outstanding_amount: 3540.0,
    status: "Created",
    financial_status: "Pending",
    version: 1,
    remarks: null,
    created_by: "Tester",
    created_at: "2026-05-10",
    updated_at: "2026-05-10",
    frozen_customer_name: "Acme Customer",
    frozen_customer_code: "CUST-101",
  };

  const sampleItems: any[] = [
    {
      id: 101,
      debit_note_id: 1,
      invoice_id: 1,
      invoice_number: "INV-001",
      invoice_date: "2026-05-01",
      invoice_item_id: 1,
      part_code: "PART-A",
      quantity: 100.0,
      recovered_qty: 100.0,
      balance_qty: 0.0,
      rate_pre_unit: 100.0,
      new_price: 110.0,
      difference: 10.0,
      assessable_difference: 1000.0,
      cgst_rate: 9.0,
      cgst_amount: 90.0,
      sgst_rate: 9.0,
      sgst_amount: 90.0,
      igst_rate: 0.0,
      igst_amount: 0.0,
      cess_amount: 0.0,
      hsn_code: "84099111",
      gst_type: "CGST+SGST",
      total_difference: 1180.0,
      status: "Draft",
      frozen_part_number: "PART-A",
      frozen_part_description: "Part A Description",
    },
    {
      id: 102,
      debit_note_id: 1,
      invoice_id: 2,
      invoice_number: "INV-002",
      invoice_date: "2026-05-02",
      invoice_item_id: 2,
      part_code: "PART-B",
      quantity: 50.0,
      recovered_qty: 50.0,
      balance_qty: 0.0,
      rate_pre_unit: 200.0,
      new_price: 220.0,
      difference: 20.0,
      assessable_difference: 1000.0,
      cgst_rate: 9.0,
      cgst_amount: 90.0,
      sgst_rate: 9.0,
      sgst_amount: 90.0,
      igst_rate: 0.0,
      igst_amount: 0.0,
      cess_amount: 0.0,
      hsn_code: "84099112",
      gst_type: "CGST+SGST",
      total_difference: 1180.0,
      status: "Draft",
      frozen_part_number: "PART-B",
      frozen_part_description: "Part B Description",
    },
    {
      id: 103,
      debit_note_id: 1,
      invoice_id: 3,
      invoice_number: "INV-003",
      invoice_date: "2026-05-03",
      invoice_item_id: 3,
      part_code: "PART-C",
      quantity: 200.0,
      recovered_qty: 200.0,
      balance_qty: 0.0,
      rate_pre_unit: 50.0,
      new_price: 55.0,
      difference: 5.0,
      assessable_difference: 1000.0,
      cgst_rate: 9.0,
      cgst_amount: 90.0,
      sgst_rate: 9.0,
      sgst_amount: 90.0,
      igst_rate: 0.0,
      igst_amount: 0.0,
      cess_amount: 0.0,
      hsn_code: "84099113",
      gst_type: "CGST+SGST",
      total_difference: 1180.0,
      status: "Draft",
      frozen_part_number: "PART-C",
      frozen_part_description: "Part C Description",
    },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("1. Displays persisted invoice lines and debit note header", () => {
    render(
      <EditDebitNoteModal
        debitNote={sampleDebitNote}
        items={sampleItems}
        onClose={vi.fn()}
        onSaved={vi.fn()}
      />
    );

    expect(screen.getByText("CDN00001")).toBeInTheDocument();
    expect(screen.getByText(/CDN00001-A/)).toBeInTheDocument();
    expect(screen.getByText("Acme Customer")).toBeInTheDocument();
    expect(screen.getByText("INV-001")).toBeInTheDocument();
    expect(screen.getByText("INV-002")).toBeInTheDocument();
    expect(screen.getByText("INV-003")).toBeInTheDocument();
    expect(screen.getByText("PART-A")).toBeInTheDocument();
    expect(screen.getByText("PART-B")).toBeInTheDocument();
    expect(screen.getByText("PART-C")).toBeInTheDocument();
  });

  it("2. Remove and restore works locally with visual indicators and Restore All", () => {
    render(
      <EditDebitNoteModal
        debitNote={sampleDebitNote}
        items={sampleItems}
        onClose={vi.fn()}
        onSaved={vi.fn()}
      />
    );

    // Find Remove button for INV-002 (item id 102)
    const removeButtons = screen.getAllByRole("button", { name: /Remove/i });
    expect(removeButtons.length).toBe(3);

    // Click remove on the second item (INV-002)
    fireEvent.click(removeButtons[1]);

    // Should now show "To Remove" badge and a "Restore" button for INV-002
    expect(screen.getByText("To Remove")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Restore All \(1\)/i })).toBeInTheDocument();

    const rowRestoreBtn = screen.getByTitle("Restore this invoice line");
    expect(rowRestoreBtn).toBeInTheDocument();

    // Click Restore on row to undo exclusion
    fireEvent.click(rowRestoreBtn);

    // Restore returns row back to active
    expect(screen.queryByText("To Remove")).not.toBeInTheDocument();

    // Exclude again and test Restore All button
    const removeAgainButtons = screen.getAllByRole("button", { name: /Remove/i });
    fireEvent.click(removeAgainButtons[0]);
    expect(screen.getByText("To Remove")).toBeInTheDocument();

    const restoreAllBtn = screen.getByRole("button", { name: /Restore All \(1\)/i });
    fireEvent.click(restoreAllBtn);
    expect(screen.queryByText("To Remove")).not.toBeInTheDocument();
  });

  it("3. Original vs revised totals recalculate correctly upon line exclusion", () => {
    render(
      <EditDebitNoteModal
        debitNote={sampleDebitNote}
        items={sampleItems}
        onClose={vi.fn()}
        onSaved={vi.fn()}
      />
    );

    // Initial Grand total is ₹3540.00
    expect(screen.getByText("₹3540.00")).toBeInTheDocument();

    // Exclude INV-002 (amount: ₹1180.00, taxable: ₹1000.00)
    const removeButtons = screen.getAllByRole("button", { name: /Remove/i });
    fireEvent.click(removeButtons[1]);

    // Revised Grand total should be ₹2360.00 and crossed-out original ₹3540.00
    expect(screen.getByText("₹2360.00")).toBeInTheDocument();
    expect(screen.getByText("₹3540.00")).toBeInTheDocument();
    // Revised Taxable should be ₹2000.00 and crossed-out original ₹3000.00
    expect(screen.getByText("₹2000.00")).toBeInTheDocument();
    expect(screen.getByText("₹3000.00")).toBeInTheDocument();
  });

  it("4. Save sends only retained map IDs and remarks to ApiService", async () => {
    const mockUpdatedDN = { ...sampleDebitNote, total_value: 2360.0 };
    vi.mocked(ApiService.updateCustomerDebitNoteLines).mockResolvedValueOnce(mockUpdatedDN);

    const onSavedMock = vi.fn();
    const onNotifyMock = vi.fn();

    render(
      <EditDebitNoteModal
        debitNote={sampleDebitNote}
        items={sampleItems}
        onClose={vi.fn()}
        onSaved={onSavedMock}
        onNotify={onNotifyMock}
        userName="Admin User"
      />
    );

    // Exclude INV-002 (item id 102), retaining IDs [101, 103]
    const removeButtons = screen.getAllByRole("button", { name: /Remove/i });
    fireEvent.click(removeButtons[1]);

    // Enter remarks
    const remarksInput = screen.getByPlaceholderText(/e\.g\. Removed invoice lines per customer audit/i);
    fireEvent.change(remarksInput, { target: { value: "Exclusion of line 2" } });

    // Click Save & Recalculate Totals
    const saveButton = screen.getByRole("button", { name: /Save & Recalculate Totals/i });
    fireEvent.click(saveButton);

    await waitFor(() => {
      expect(ApiService.updateCustomerDebitNoteLines).toHaveBeenCalledWith(
        1,
        [101, 103],
        "Exclusion of line 2",
        "Admin User"
      );
      expect(onSavedMock).toHaveBeenCalledWith(mockUpdatedDN);
      expect(onNotifyMock).toHaveBeenCalledWith(
        "Debit Note CDN00001 updated successfully (2 lines retained).",
        "success"
      );
    });
  });

  it("5. Save is blocked when zero lines remain", () => {
    render(
      <EditDebitNoteModal
        debitNote={sampleDebitNote}
        items={sampleItems}
        onClose={vi.fn()}
        onSaved={vi.fn()}
      />
    );

    // Remove all 3 lines
    const removeButtons = screen.getAllByRole("button", { name: /Remove/i });
    fireEvent.click(removeButtons[0]);
    fireEvent.click(removeButtons[1]);
    fireEvent.click(removeButtons[2]);

    // Retained line counter indicates 0 lines retained and 3 excluded
    expect(screen.getByText(/3 excluded from Debit Note/i)).toBeInTheDocument();
    expect(screen.getByText(/line\(s\) retained/i)).toBeInTheDocument();

    // Save button should be disabled
    const saveButton = screen.getByRole("button", { name: /Save & Recalculate Totals/i });
    expect(saveButton).toBeDisabled();
  });

  it("6. Posted, Locked, and Cancelled notes cannot be edited", () => {
    for (const status of ["Posted", "Locked", "Cancelled"]) {
      const { unmount } = render(
        <EditDebitNoteModal
          debitNote={{ ...sampleDebitNote, status }}
          items={sampleItems}
          onClose={vi.fn()}
          onSaved={vi.fn()}
        />
      );

      // Warning banner present
      expect(screen.getByText("Editing Blocked:")).toBeInTheDocument();

      // Save button is disabled
      const saveButton = screen.getByRole("button", { name: /Save & Recalculate Totals/i });
      expect(saveButton).toBeDisabled();

      unmount();
    }
  });
});
