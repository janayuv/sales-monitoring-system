import { useState } from "react";
import { CustomerMasterRow } from "../../types/bindings/CustomerMasterRow";
import { CustomerCategoryRow } from "../../types/bindings/CustomerCategoryRow";
import { ApiService, CustomerMasterPayload } from "../../services/api";

interface Props {
  initial: CustomerMasterRow | null; // null = create mode
  categories: CustomerCategoryRow[];
  onClose: () => void;
  onSaved: () => void;
}

const EMPTY: CustomerMasterPayload = {
  id: null, customer_code: "", report_name: "", tally_name: null, legal_name: null,
  gstin: null, address1: null, address2: null, location: null, pincode: null,
  state_code: null, place_of_supply: null, phone: null, email: null,
  category_name: null, remarks: null, status: "Approved",
};

function toPayload(r: CustomerMasterRow): CustomerMasterPayload {
  return {
    id: Number(r.id), customer_code: r.customer_code, report_name: r.report_name,
    tally_name: r.tally_name, legal_name: r.legal_name, gstin: r.gstin,
    address1: r.address1, address2: r.address2, location: r.location, pincode: r.pincode,
    state_code: r.state_code, place_of_supply: r.place_of_supply, phone: r.phone,
    email: r.email, category_name: r.category_name, remarks: r.remarks,
    status: r.status === "Pending_Review" ? "Pending_Review" : "Approved",
  };
}

export default function CustomerDetailForm({ initial, categories, onClose, onSaved }: Props) {
  const [form, setForm] = useState<CustomerMasterPayload>(initial ? toPayload(initial) : EMPTY);
  const [saving, setSaving] = useState(false);
  const isCreate = initial === null;

  const set = (k: keyof CustomerMasterPayload, v: string) =>
    setForm((f) => ({ ...f, [k]: v === "" ? (k === "customer_code" || k === "report_name" || k === "status" ? v : null) : v }));

  const handleSave = async () => {
    setSaving(true);
    try {
      if (isCreate) await ApiService.createCustomerMaster(form);
      else await ApiService.updateCustomerMaster(form);
      onSaved();
      onClose();
    } catch (err: any) {
      alert(`Save failed: ${err.message || err}`);
    } finally {
      setSaving(false);
    }
  };

  const field = (label: string, k: keyof CustomerMasterPayload, required = false) => (
    <label className="flex flex-col gap-1 text-xs">
      <span className="text-slate-400">{label}{required && <span className="text-rose-400"> *</span>}</span>
      <input
        value={(form[k] as string | null) ?? ""}
        onChange={(e) => set(k, e.target.value)}
        className="bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-slate-200 focus:outline-none focus:border-indigo-500"
      />
    </label>
  );

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex justify-end" onClick={onClose}>
      <div className="w-[560px] h-full bg-slate-900 border-l border-slate-800 overflow-y-auto p-6 space-y-6" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-lg font-bold text-slate-100">{isCreate ? "Add Customer" : `Edit ${form.customer_code}`}</h3>

        <section className="space-y-3">
          <h4 className="text-[11px] uppercase tracking-wide text-indigo-400 font-bold">Identity</h4>
          {field("Customer Code", "customer_code", true)}
          {field("Report Name", "report_name", true)}
          {field("Tally Name", "tally_name")}
          {field("Legal Name", "legal_name")}
          {field("GSTIN", "gstin")}
        </section>

        <section className="space-y-3">
          <h4 className="text-[11px] uppercase tracking-wide text-indigo-400 font-bold">Address</h4>
          {field("Address 1", "address1")}
          {field("Address 2", "address2")}
          {field("Location", "location")}
          {field("Pincode", "pincode")}
          {field("State Code (GST)", "state_code")}
          {field("Place of Supply (GST)", "place_of_supply")}
        </section>

        <section className="space-y-3">
          <h4 className="text-[11px] uppercase tracking-wide text-indigo-400 font-bold">Contact</h4>
          {field("Phone", "phone")}
          {field("Email", "email")}
        </section>

        <section className="space-y-3">
          <h4 className="text-[11px] uppercase tracking-wide text-indigo-400 font-bold">Meta</h4>
          <label className="flex flex-col gap-1 text-xs">
            <span className="text-slate-400">Category</span>
            <select
              value={form.category_name ?? ""}
              onChange={(e) => set("category_name", e.target.value)}
              className="bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-slate-200"
            >
              <option value="">Uncategorized</option>
              {categories.map((c) => <option key={c.id} value={c.name}>{c.name}</option>)}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-xs">
            <span className="text-slate-400">Status</span>
            <select
              value={form.status}
              onChange={(e) => setForm((f) => ({ ...f, status: e.target.value === "Pending_Review" ? "Pending_Review" : "Approved" }))}
              className="bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-slate-200"
            >
              <option value="Approved">Approved</option>
              <option value="Pending_Review">Pending Review</option>
            </select>
          </label>
          {field("Remarks", "remarks")}
        </section>

        <div className="flex gap-3 pt-2">
          <button onClick={handleSave} disabled={saving} className="bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold px-5 py-2 rounded-lg disabled:opacity-50">
            {saving ? "Saving…" : "Save"}
          </button>
          <button onClick={onClose} className="bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold px-5 py-2 rounded-lg">Cancel</button>
        </div>
      </div>
    </div>
  );
}
