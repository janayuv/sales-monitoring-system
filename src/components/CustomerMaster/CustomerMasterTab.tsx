import { useEffect, useState } from "react";
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

  useEffect(() => { load(); }, []);

  const filtered = rows.filter((r) =>
    r.customer_code.toLowerCase().includes(search.toLowerCase()) ||
    r.report_name.toLowerCase().includes(search.toLowerCase())
  );

  const pill = (s: string) =>
    s === "Complete" ? "bg-emerald-500/10 text-emerald-400"
    : s === "Incomplete" ? "bg-amber-500/10 text-amber-400"
    : "bg-rose-500/10 text-rose-400";

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4 bg-slate-900 border border-slate-800 p-4 rounded-xl">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search code or name…"
          className="bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-xs text-slate-200 w-72 focus:outline-none focus:border-indigo-500"
        />
        <div className="flex gap-2">
          <button onClick={() => setShowImport(true)} className="bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold px-4 py-2 rounded-lg">Import Customer Master</button>
          <button onClick={() => setEditing(null)} className="bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold px-4 py-2 rounded-lg">+ Add Customer</button>
        </div>
      </div>

      <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden">
        <table className="w-full text-left text-xs">
          <thead>
            <tr className="bg-slate-950 text-slate-400 font-bold border-b border-slate-800">
              <th className="p-3">Code</th><th className="p-3">Report Name</th><th className="p-3">Tally Name</th>
              <th className="p-3">GSTIN</th><th className="p-3">Location</th><th className="p-3">Status</th><th className="p-3"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800/60">
            {loading ? (
              <tr><td colSpan={7} className="p-8 text-center text-slate-500">Loading…</td></tr>
            ) : filtered.length === 0 ? (
              <tr><td colSpan={7} className="p-8 text-center text-slate-500">No customers.</td></tr>
            ) : filtered.map((r) => (
              <tr key={r.id} className="hover:bg-slate-800/35 cursor-pointer" onDoubleClick={() => setEditing(r)}>
                <td className="p-3 font-mono text-indigo-400">{r.customer_code}</td>
                <td className="p-3 text-slate-200">{r.report_name}</td>
                <td className="p-3 text-slate-300">{r.tally_name ?? "—"}</td>
                <td className="p-3 text-slate-400">{r.gstin ?? "—"}</td>
                <td className="p-3 text-slate-400">{r.location ?? "—"}</td>
                <td className="p-3"><span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold ${pill(r.match_status)}`}>{r.match_status}</span></td>
                <td className="p-3 text-right"><button onClick={() => setEditing(r)} className="text-slate-400 hover:text-slate-100">Edit</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {editing !== undefined && (
        <CustomerDetailForm initial={editing} categories={categories} onClose={() => setEditing(undefined)} onSaved={load} />
      )}
      {showImport && <CustomerImportPanel onClose={() => setShowImport(false)} onImported={load} />}
    </div>
  );
}
