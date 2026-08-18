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
    getCustomerDebitNoteDetails: vi.fn(),
    updateCustomerDebitNoteLines: vi.fn(),
    updateCustomerDebitNoteStatus: vi.fn(),
    cancelCustomerDebitNote: vi.fn(),
  },
}));

vi.mock("@tauri-apps/plugin-dialog", () => ({
  open: vi.fn(),
  save: vi.fn(),
}));

describe("CustomerDebitNotesTab - History Edit Integration", () => {
  const sampleDebitNotes = [
    {
      id: 1,
      debit_note_no: "CDN00001",
      annexure_no: "CDN00001-A",
      frozen_customer_name: "Acme Customer",
      debit_note_date: "2026-05-10",
      total_taxable: 3000.0,
      total_value: 3540.0,
      outstanding_amount: 3540.0,
      status: "Created",
    },
    {
      id: 2,
      debit_note_no: "CDN00002",
      annexure_no: "CDN00002-A",
      frozen_customer_name: "Beta Industries",
      debit_note_date: "2026-05-11",
      total_taxable: 1000.0,
      total_value: 1180.0,
      outstanding_amount: 1180.0,
      status: "Verified",
    },
    {
      id: 3,
      debit_note_no: "CDN00003",
      annexure_no: "CDN00003-A",
      frozen_customer_name: "Gamma Corp",
      debit_note_date: "2026-05-12",
      total_taxable: 2000.0,
      total_value: 2360.0,
      outstanding_amount: 2360.0,
      status: "Approved",
    },
    {
      id: 4,
      debit_note_no: "CDN00004",
      annexure_no: "CDN00004-A",
      frozen_customer_name: "Delta Auto",
      debit_note_date: "2026-05-13",
      total_taxable: 5000.0,
      total_value: 5900.0,
      outstanding_amount: 5900.0,
      status: "Posted",
    },
    {
      id: 5,
      debit_note_no: "CDN00005",
      annexure_no: "CDN00005-A",
      frozen_customer_name: "Epsilon Tech",
      debit_note_date: "2026-05-14",
      total_taxable: 4000.0,
      total_value: 4720.0,
      outstanding_amount: 0.0,
      status: "Locked",
    },
    {
      id: 6,
      debit_note_no: "CDN00006",
      annexure_no: "CDN00006-A",
      frozen_customer_name: "Zeta Motors",
      debit_note_date: "2026-05-15",
      total_taxable: 1500.0,
      total_value: 1770.0,
      outstanding_amount: 0.0,
      status: "Cancelled",
    },
  ];

  const sampleDN1Details = [
    sampleDebitNotes[0],
    [
      {
        id: 101,
        debit_note_id: 1,
        invoice_number: "INV-001",
        invoice_date: "2026-05-01",
        part_code: "PART-A",
        recovered_qty: 100.0,
        rate_pre_unit: 100.0,
        new_price: 110.0,
        difference: 10.0,
        assessable_difference: 1000.0,
        total_difference: 1180.0,
        status: "Draft",
        frozen_part_number: "PART-A",
      },
      {
        id: 102,
        debit_note_id: 1,
        invoice_number: "INV-002",
        invoice_date: "2026-05-02",
        part_code: "PART-B",
        recovered_qty: 50.0,
        rate_pre_unit: 200.0,
        new_price: 220.0,
        difference: 20.0,
        assessable_difference: 1000.0,
        total_difference: 1180.0,
        status: "Draft",
        frozen_part_number: "PART-B",
      },
    ],
    [], // events
  ];

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(ApiService.getCustomerMaster).mockResolvedValue([]);
    vi.mocked(ApiService.listCustomerDebitNotes).mockResolvedValue(sampleDebitNotes as any);
    vi.mocked(ApiService.getCustomerDebitNoteDetails).mockResolvedValue(sampleDN1Details as any);
  });

  async function openHistoryTab() {
    const onNotify = vi.fn();
    render(<CustomerDebitNotesTab onNotify={onNotify} />);

    // Switch to HISTORY tab
    const historyTabBtn = screen.getByRole("button", { name: /Debit Note History/i });
    fireEvent.click(historyTabBtn);

    await waitFor(() => {
      expect(screen.getByText("CDN00001")).toBeInTheDocument();
      expect(screen.getByText("CDN00004")).toBeInTheDocument();
    });

    return { onNotify };
  }

  it("1. Edit action button appears only for editable statuses (Created, Verified, Approved)", async () => {
    await openHistoryTab();

    // Table should render 6 notes
    const editButtons = screen.getAllByTitle("Edit Debit Note lines");
    // Notes 1 (Created), 2 (Verified), 3 (Approved) are editable -> 3 Edit buttons
    expect(editButtons.length).toBe(3);

    // Notes 4 (Posted), 5 (Locked), 6 (Cancelled) have no Edit button in their row
    const rows = screen.getAllByRole("row");
    // Row 0 is header, Rows 1..6 are data
    expect(rows.length).toBe(7);

    // Note 4 (Posted): View Voucher, Details, Cancel (no Edit)
    expect(rows[4]).toHaveTextContent("Posted");
    expect(rows[4]).not.toHaveTextContent("Edit");

    // Note 5 (Locked): View Voucher, Details, Cancel (no Edit)
    expect(rows[5]).toHaveTextContent("Locked");
    expect(rows[5]).not.toHaveTextContent("Edit");

    // Note 6 (Cancelled): View Voucher, Details (no Edit, no Cancel)
    expect(rows[6]).toHaveTextContent("Cancelled");
    expect(rows[6]).not.toHaveTextContent("Edit");
  });

  it("2. Clicking Edit loads persisted Debit Note details and opens EditDebitNoteModal", async () => {
    await openHistoryTab();

    const editButtons = screen.getAllByTitle("Edit Debit Note lines");
    // Click edit on CDN00001 (id: 1)
    fireEvent.click(editButtons[0]);

    await waitFor(() => {
      expect(ApiService.getCustomerDebitNoteDetails).toHaveBeenCalledWith(1);
      // Edit modal title is visible
      expect(screen.getByText("Edit Debit Note Lines")).toBeInTheDocument();
      // Mapped invoice lines from backend are displayed
      expect(screen.getByText("INV-001")).toBeInTheDocument();
      expect(screen.getByText("INV-002")).toBeInTheDocument();
    });
  });

  it("3. Details drawer also provides Edit Lines action for editable notes", async () => {
    await openHistoryTab();

    // Click Details button for CDN00001
    const detailsButtons = screen.getAllByRole("button", { name: "Details" });
    fireEvent.click(detailsButtons[0]);

    await waitFor(() => {
      // Details drawer header visible
      expect(screen.getByText(/CDN00001 \(CDN00001-A\)/i)).toBeInTheDocument();
      // "Edit Lines" button in drawer header
      expect(screen.getByRole("button", { name: /Edit Lines/i })).toBeInTheDocument();
    });

    // Click "Edit Lines" from drawer header
    const editLinesBtn = screen.getByRole("button", { name: /Edit Lines/i });
    fireEvent.click(editLinesBtn);

    await waitFor(() => {
      expect(screen.getByText("Edit Debit Note Lines")).toBeInTheDocument();
    });
  });

  it("4. Successful save reloads History, selected Details, and refreshed Voucher data", async () => {
    const updatedDN = {
      ...sampleDebitNotes[0],
      total_taxable: 2000.0,
      total_value: 2360.0,
      outstanding_amount: 2360.0,
    };
    vi.mocked(ApiService.updateCustomerDebitNoteLines).mockResolvedValueOnce(updatedDN as any);

    await openHistoryTab();

    // Open Details drawer for CDN00001
    const detailsButtons = screen.getAllByRole("button", { name: "Details" });
    fireEvent.click(detailsButtons[0]);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /Edit Lines/i })).toBeInTheDocument();
    });

    // Open Edit modal from Details drawer
    fireEvent.click(screen.getByRole("button", { name: /Edit Lines/i }));

    await waitFor(() => {
      expect(screen.getByText("Edit Debit Note Lines")).toBeInTheDocument();
    });

    // Exclude INV-002 (item id 102), retaining INV-001 (item id 101)
    const removeButtons = screen.getAllByRole("button", { name: /Remove/i });
    fireEvent.click(removeButtons[1]);

    // Save changes
    const saveBtn = screen.getByRole("button", { name: /Save & Recalculate Totals/i });
    fireEvent.click(saveBtn);

    await waitFor(() => {
      // 1. Saved to backend
      expect(ApiService.updateCustomerDebitNoteLines).toHaveBeenCalledWith(
        1,
        [101],
        null,
        "Admin User"
      );
      // 2. Reloaded History
      expect(ApiService.listCustomerDebitNotes).toHaveBeenCalledTimes(2);
      // 3. Refreshed Details drawer
      expect(ApiService.getCustomerDebitNoteDetails).toHaveBeenCalledWith(1);
      // 4. Modal closed
      expect(screen.queryByText("Edit Debit Note Lines")).not.toBeInTheDocument();
    });
  });

  it("5. API error on loading details shows error notification", async () => {
    vi.mocked(ApiService.getCustomerDebitNoteDetails).mockRejectedValueOnce(
      new Error("Network connection dropped")
    );

    const { onNotify } = await openHistoryTab();

    const editButtons = screen.getAllByTitle("Edit Debit Note lines");
    fireEvent.click(editButtons[0]);

    await waitFor(() => {
      expect(onNotify).toHaveBeenCalledWith(
        "Failed to load Debit Note for editing: Network connection dropped",
        "error"
      );
      // Modal should not open on failure
      expect(screen.queryByText("Edit Debit Note Lines")).not.toBeInTheDocument();
    });
  });
});
