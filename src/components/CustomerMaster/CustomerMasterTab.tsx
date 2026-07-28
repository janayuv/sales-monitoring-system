import { useEffect, useState } from "react";
import {
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  Search,
  UserPlus,
  FileSpreadsheet,
  Users,
  CheckCircle,
  AlertTriangle,
  XCircle,
} from "lucide-react";
import { ApiService, CustomerCategoryRow } from "../../services/api";
import { CustomerMasterRow } from "../../types/bindings/CustomerMasterRow";
import CustomerDetailForm from "./CustomerDetailForm";
import CustomerImportPanel from "./CustomerImportPanel";

export default function CustomerMasterTab() {
  const [rows, setRows] = useState<CustomerMasterRow[]>([]);
  const [categories, setCategories] = useState<CustomerCategoryRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState<CustomerMasterRow | null | undefined>(undefined); // undefined=closed, null=create
  const [showImport, setShowImport] = useState(false);

  // Pagination states
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  const load = async () => {
    setLoading(true);
    try {
      const [r, c] = await Promise.all([ApiService.getCustomerMaster(), ApiService.getCustomerCategories()]);
      setRows(r);
      setCategories(c);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  // Filter rows
  const filtered = rows.filter(
    (r) =>
      r.customer_code.toLowerCase().includes(search.toLowerCase()) ||
      r.report_name.toLowerCase().includes(search.toLowerCase()) ||
      (r.tally_name && r.tally_name.toLowerCase().includes(search.toLowerCase())) ||
      (r.gstin && r.gstin.toLowerCase().includes(search.toLowerCase())) ||
      (r.location && r.location.toLowerCase().includes(search.toLowerCase()))
  );

  // Reset to page 1 whenever search or pageSize changes
  useEffect(() => {
    setCurrentPage(1);
  }, [search, pageSize]);

  // Calculate pagination slice
  const totalItems = filtered.length;
  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
  const validPage = Math.min(currentPage, totalPages);
  const startIndex = (validPage - 1) * pageSize;
  const endIndex = Math.min(totalItems, startIndex + pageSize);
  const paginatedRows = filtered.slice(startIndex, endIndex);

  // Stats calculation
  const completeCount = rows.filter((r) => r.match_status === "Complete").length;
  const incompleteCount = rows.filter((r) => r.match_status === "Incomplete").length;
  const unmappedCount = rows.filter((r) => r.match_status === "Unmapped").length;

  const pill = (s: string) =>
    s === "Complete"
      ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border border-emerald-500/30"
      : s === "Incomplete"
      ? "bg-amber-500/15 text-amber-700 dark:text-amber-300 border border-amber-500/30"
      : "bg-rose-500/15 text-rose-700 dark:text-rose-300 border border-rose-500/30";

  return (
    <div className="space-y-6">
      {/* Top Header & Quick Metrics */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="ember-card p-4 flex items-center justify-between">
          <div>
            <span className="text-[10px] uppercase font-bold text-[var(--ember-text-muted)] tracking-wider">Total Customer Records</span>
            <h3 className="text-xl font-bold font-serif text-[var(--ember-text-primary)] mt-0.5">{rows.length}</h3>
          </div>
          <div className="p-2.5 bg-[var(--ember-primary-light)] text-[var(--ember-primary)] rounded-xl">
            <Users className="w-5 h-5" />
          </div>
        </div>

        <div className="ember-card p-4 flex items-center justify-between">
          <div>
            <span className="text-[10px] uppercase font-bold text-[var(--ember-text-muted)] tracking-wider">Verified Matches</span>
            <h3 className="text-xl font-bold font-serif text-emerald-600 dark:text-emerald-400 mt-0.5">{completeCount}</h3>
          </div>
          <div className="p-2.5 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 rounded-xl">
            <CheckCircle className="w-5 h-5" />
          </div>
        </div>

        <div className="ember-card p-4 flex items-center justify-between">
          <div>
            <span className="text-[10px] uppercase font-bold text-[var(--ember-text-muted)] tracking-wider">Incomplete Mapping</span>
            <h3 className="text-xl font-bold font-serif text-amber-600 dark:text-amber-400 mt-0.5">{incompleteCount}</h3>
          </div>
          <div className="p-2.5 bg-amber-500/10 text-amber-600 dark:text-amber-400 rounded-xl">
            <AlertTriangle className="w-5 h-5" />
          </div>
        </div>

        <div className="ember-card p-4 flex items-center justify-between">
          <div>
            <span className="text-[10px] uppercase font-bold text-[var(--ember-text-muted)] tracking-wider">Unmapped Accounts</span>
            <h3 className="text-xl font-bold font-serif text-rose-600 dark:text-rose-400 mt-0.5">{unmappedCount}</h3>
          </div>
          <div className="p-2.5 bg-rose-500/10 text-rose-600 dark:text-rose-400 rounded-xl">
            <XCircle className="w-5 h-5" />
          </div>
        </div>
      </div>

      {/* Control Bar: Search & Action Buttons */}
      <div className="flex flex-col sm:flex-row items-center justify-between gap-4 ember-card p-4">
        <div className="relative w-full sm:w-80">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-[var(--ember-text-muted)]" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search code, name, Tally, GSTIN, location..."
            className="ember-input pl-9 pr-3 py-2 text-xs w-full"
          />
        </div>

        <div className="flex items-center gap-3 w-full sm:w-auto justify-end">
          <button
            onClick={() => setShowImport(true)}
            className="ember-btn-secondary px-4 py-2 text-xs flex items-center gap-1.5 cursor-pointer"
          >
            <FileSpreadsheet className="w-3.5 h-3.5 text-[var(--ember-primary)]" /> Import Master File
          </button>
          <button
            onClick={() => setEditing(null)}
            className="ember-btn-primary px-4 py-2 text-xs flex items-center gap-1.5 cursor-pointer"
          >
            <UserPlus className="w-3.5 h-3.5" /> + Add Customer
          </button>
        </div>
      </div>

      {/* Customer Master Data Table */}
      <div className="ember-card overflow-hidden flex flex-col">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="bg-[var(--ember-surface-raised)] text-[var(--ember-text-secondary)] font-bold border-b border-[var(--ember-border)]">
                <th className="p-3.5">Code</th>
                <th className="p-3.5">Report Name</th>
                <th className="p-3.5">Tally Name</th>
                <th className="p-3.5 font-mono">GSTIN</th>
                <th className="p-3.5">Location</th>
                <th className="p-3.5 text-center">Match Status</th>
                <th className="p-3.5 text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--ember-border-subtle)]">
              {loading ? (
                <tr>
                  <td colSpan={7} className="p-8 text-center text-[var(--ember-text-muted)]">
                    Loading customer database...
                  </td>
                </tr>
              ) : paginatedRows.length === 0 ? (
                <tr>
                  <td colSpan={7} className="p-8 text-center text-[var(--ember-text-muted)]">
                    {search ? `No customers match search query "${search}".` : "No customer records found."}
                  </td>
                </tr>
              ) : (
                paginatedRows.map((r) => (
                  <tr
                    key={r.id}
                    className="hover:bg-[var(--ember-surface-raised)] transition-colors cursor-pointer"
                    onDoubleClick={() => setEditing(r)}
                  >
                    <td className="p-3.5 font-mono font-bold text-[var(--ember-primary)]">{r.customer_code}</td>
                    <td className="p-3.5 text-[var(--ember-text-primary)] font-medium">{r.report_name}</td>
                    <td className="p-3.5 text-[var(--ember-text-secondary)]">{r.tally_name ?? "—"}</td>
                    <td className="p-3.5 text-[var(--ember-text-muted)] font-mono">{r.gstin ?? "—"}</td>
                    <td className="p-3.5 text-[var(--ember-text-secondary)]">{r.location ?? "—"}</td>
                    <td className="p-3.5 text-center">
                      <span className={`px-2.5 py-1 ember-chip ${pill(r.match_status)}`}>{r.match_status}</span>
                    </td>
                    <td className="p-3.5 text-right">
                      <button
                        onClick={() => setEditing(r)}
                        className="text-[var(--ember-primary)] hover:underline font-semibold text-xs"
                      >
                        Edit
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination Footer */}
        <div className="p-4 border-t border-[var(--ember-border)] bg-[var(--ember-surface-raised)] flex flex-col sm:flex-row items-center justify-between gap-4 text-xs">
          {/* Item counter & Rows per page */}
          <div className="flex items-center gap-4 text-[var(--ember-text-secondary)]">
            <span>
              Showing <strong className="text-[var(--ember-text-primary)] font-mono">{totalItems > 0 ? startIndex + 1 : 0}</strong> to{" "}
              <strong className="text-[var(--ember-text-primary)] font-mono">{endIndex}</strong> of{" "}
              <strong className="text-[var(--ember-text-primary)] font-mono">{totalItems}</strong> entries
            </span>

            <div className="flex items-center gap-2">
              <span className="text-[var(--ember-text-muted)] text-[11px]">Rows per page:</span>
              <select
                value={pageSize}
                onChange={(e) => setPageSize(Number(e.target.value))}
                className="ember-input px-2 py-1 text-xs font-mono cursor-pointer"
              >
                <option value={10}>10</option>
                <option value={25}>25</option>
                <option value={50}>50</option>
                <option value={100}>100</option>
              </select>
            </div>
          </div>

          {/* Page navigation controls */}
          <div className="flex items-center gap-1.5">
            <button
              onClick={() => setCurrentPage(1)}
              disabled={validPage <= 1}
              className="ember-btn-secondary p-1.5 text-xs disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer"
              title="First Page"
            >
              <ChevronsLeft className="w-4 h-4" />
            </button>
            <button
              onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
              disabled={validPage <= 1}
              className="ember-btn-secondary p-1.5 text-xs disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer"
              title="Previous Page"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>

            <span className="px-3 py-1 bg-[var(--ember-surface)] border border-[var(--ember-border)] rounded-lg text-xs font-mono text-[var(--ember-text-primary)]">
              Page <strong className="text-[var(--ember-primary)]">{validPage}</strong> of {totalPages}
            </span>

            <button
              onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
              disabled={validPage >= totalPages}
              className="ember-btn-secondary p-1.5 text-xs disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer"
              title="Next Page"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
            <button
              onClick={() => setCurrentPage(totalPages)}
              disabled={validPage >= totalPages}
              className="ember-btn-secondary p-1.5 text-xs disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer"
              title="Last Page"
            >
              <ChevronsRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>

      {editing !== undefined && (
        <CustomerDetailForm initial={editing} categories={categories} onClose={() => setEditing(undefined)} onSaved={load} />
      )}
      {showImport && <CustomerImportPanel onClose={() => setShowImport(false)} onImported={load} />}
    </div>
  );
}
