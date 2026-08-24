import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { ImportWizardTab } from "../ImportWizardTab";
import { ApiService } from "../../../services/api";
import { ImportTemplateRow } from "../../../types/bindings/ImportTemplateRow";
import { ImportPreview } from "../../../types/bindings/ImportPreview";

vi.mock("@tauri-apps/plugin-dialog", () => ({
  open: vi.fn(),
}));

vi.mock("../../../services/api", () => ({
  ApiService: {
    previewImportFile: vi.fn(),
    commitImportBatch: vi.fn(),
  },
}));

describe("ImportWizardTab Frontend ReSync & Append Workflow", () => {
  const mockTemplates: ImportTemplateRow[] = [
    {
      id: 1n,
      template_name: "Standard Sales Template",
      source_type: "Excel",
      is_active: 1,
    },
  ];

  const duplicatePreview: ImportPreview = {
    batch_hash: "abcd1234efgh5678",
    file_name: "Sales_Report_July.xlsx",
    row_count: 51,
    mapped_template_name: "Standard Sales Template",
    errors: [],
    warnings: [
      {
        row_no: 0,
        invoice_no: null,
        field_name: "file_hash",
        warning_type: "WARN_DUPLICATE_BATCH",
        expected_value: "New File",
        actual_value: "Duplicate File",
      },
    ],
    proposed_inserts: 2,
    proposed_updates: 48,
    is_duplicate: true,
    existing_batch_id: 42 as any,
    existing_batch_imported_at: "2026-08-15 10:30:00",
  };

  const newFilePreview: ImportPreview = {
    batch_hash: "1122334455667788",
    file_name: "Sales_Report_August.xlsx",
    row_count: 101,
    mapped_template_name: "Standard Sales Template",
    errors: [],
    warnings: [],
    proposed_inserts: 100,
    proposed_updates: 0,
    is_duplicate: false,
    existing_batch_id: null,
    existing_batch_imported_at: null,
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("1. Renders file selection and inputs correctly", () => {
    render(<ImportWizardTab templates={mockTemplates} />);

    expect(screen.getByText("Click to Browse or Drag & Drop Sales Spreadsheet")).toBeInTheDocument();
    expect(screen.getByText("Configure Import Job")).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/Browse or paste file path/i)).toBeInTheDocument();
    expect(screen.getByText("Standard Sales Template (Excel)")).toBeInTheDocument();
  });

  it("2. When previewing a duplicate file: displays informational ReSync banner, metrics, and Re-sync button", async () => {
    vi.mocked(ApiService.previewImportFile).mockResolvedValueOnce(duplicatePreview);

    render(<ImportWizardTab templates={mockTemplates} />);

    const input = screen.getByPlaceholderText(/Browse or paste file path/i);
    fireEvent.change(input, { target: { value: "C:\\Reports\\Sales_Report_July.xlsx" } });

    const previewBtn = screen.getByRole("button", { name: /Run Validation Preview/i });
    fireEvent.click(previewBtn);

    await waitFor(() => {
      expect(screen.getByText("Previously Imported File Detected")).toBeInTheDocument();
    });

    // Check batch metadata & counts
    expect(screen.getByText("Batch #42")).toBeInTheDocument();
    expect(screen.getByText("48 to Update")).toBeInTheDocument();
    expect(screen.getByText("+2 New")).toBeInTheDocument();
    expect(screen.getByText("Never Deleted")).toBeInTheDocument();

    // Verify Re-sync action button is shown instead of standard commit
    expect(screen.getByRole("button", { name: /Re-sync & Update Batch/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Commit Import Batch/i })).not.toBeInTheDocument();
  });

  it("3. ReSync flow: clicking button opens confirmation modal with guarantees, and confirming executes ReSync mode", async () => {
    vi.mocked(ApiService.previewImportFile).mockResolvedValueOnce(duplicatePreview);
    vi.mocked(ApiService.commitImportBatch).mockResolvedValueOnce(42);

    const onImportSuccess = vi.fn();
    render(<ImportWizardTab templates={mockTemplates} onImportSuccess={onImportSuccess} />);

    const input = screen.getByPlaceholderText(/Browse or paste file path/i);
    fireEvent.change(input, { target: { value: "C:\\Reports\\Sales_Report_July.xlsx" } });

    fireEvent.click(screen.getByRole("button", { name: /Run Validation Preview/i }));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /Re-sync & Update Batch/i })).toBeInTheDocument();
    });

    // Click Re-sync button to open modal
    fireEvent.click(screen.getByRole("button", { name: /Re-sync & Update Batch/i }));

    // Verify confirmation modal content
    expect(screen.getByText("Confirm Batch Re-Synchronization")).toBeInTheDocument();
    expect(screen.getByText(/In-Place Updates:/i)).toBeInTheDocument();
    expect(screen.getByText(/Preserve Mappings:/i)).toBeInTheDocument();
    expect(screen.getByText(/Zero Deletions:/i)).toBeInTheDocument();

    // Confirm ReSync in modal
    const confirmBtn = screen.getByRole("button", { name: /Confirm & Re-sync Batch/i });
    fireEvent.click(confirmBtn);

    await waitFor(() => {
      expect(ApiService.commitImportBatch).toHaveBeenCalledWith(
        "C:\\Reports\\Sales_Report_July.xlsx",
        1,
        "System User",
        "Batch ReSync and transaction HSN synchronization",
        "ReSync"
      );
      expect(onImportSuccess).toHaveBeenCalled();
      expect(screen.getByText(/Successfully re-synchronized Batch ID: 42/i)).toBeInTheDocument();
    });
  });

  it("4. When previewing a normal new file: uses standard Append behavior without modal", async () => {
    vi.mocked(ApiService.previewImportFile).mockResolvedValueOnce(newFilePreview);
    vi.mocked(ApiService.commitImportBatch).mockResolvedValueOnce(105);

    const onImportSuccess = vi.fn();
    render(<ImportWizardTab templates={mockTemplates} onImportSuccess={onImportSuccess} />);

    const input = screen.getByPlaceholderText(/Browse or paste file path/i);
    fireEvent.change(input, { target: { value: "C:\\Reports\\Sales_Report_August.xlsx" } });

    fireEvent.click(screen.getByRole("button", { name: /Run Validation Preview/i }));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /Commit Import Batch/i })).toBeInTheDocument();
    });

    // Duplicate banner should NOT appear
    expect(screen.queryByText("Previously Imported File Detected")).not.toBeInTheDocument();

    // Click Commit Import Batch
    fireEvent.click(screen.getByRole("button", { name: /Commit Import Batch/i }));

    await waitFor(() => {
      expect(ApiService.commitImportBatch).toHaveBeenCalledWith(
        "C:\\Reports\\Sales_Report_August.xlsx",
        1,
        "System User",
        "Standard batch outward sales upload",
        "Append"
      );
      expect(onImportSuccess).toHaveBeenCalled();
      expect(screen.getByText(/Successfully imported new batch ID: 105/i)).toBeInTheDocument();
    });
  });

  it("5. Displays HSN and Tax synchronization guidance in preview", async () => {
    vi.mocked(ApiService.previewImportFile).mockResolvedValueOnce(duplicatePreview);

    render(<ImportWizardTab templates={mockTemplates} />);

    const input = screen.getByPlaceholderText(/Browse or paste file path/i);
    fireEvent.change(input, { target: { value: "C:\\Reports\\Sales_Report_July.xlsx" } });

    fireEvent.click(screen.getByRole("button", { name: /Run Validation Preview/i }));

    await waitFor(() => {
      expect(screen.getByText("Transaction HSN & Tax Rate Synchronization")).toBeInTheDocument();
      expect(screen.getByText(/Authoritative transaction HSN codes and GST rates/i)).toBeInTheDocument();
    });
  });

  it("6. Handles backend failure gracefully with error alert and rollback notice", async () => {
    vi.mocked(ApiService.previewImportFile).mockResolvedValueOnce(duplicatePreview);
    vi.mocked(ApiService.commitImportBatch).mockRejectedValueOnce(
      new Error("ERR_DB_003: Database lock contention during ReSync")
    );

    render(<ImportWizardTab templates={mockTemplates} />);

    const input = screen.getByPlaceholderText(/Browse or paste file path/i);
    fireEvent.change(input, { target: { value: "C:\\Reports\\Sales_Report_July.xlsx" } });

    fireEvent.click(screen.getByRole("button", { name: /Run Validation Preview/i }));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /Re-sync & Update Batch/i })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: /Re-sync & Update Batch/i }));
    fireEvent.click(screen.getByRole("button", { name: /Confirm & Re-sync Batch/i }));

    await waitFor(() => {
      expect(screen.getByText("Import / ReSync Failed")).toBeInTheDocument();
      expect(screen.getByText(/ERR_DB_003: Database lock contention during ReSync/i)).toBeInTheDocument();
      expect(screen.getByText(/All database changes have been rolled back safely/i)).toBeInTheDocument();
    });
  });
});
