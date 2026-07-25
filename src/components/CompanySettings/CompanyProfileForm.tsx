import { useEffect, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { ApiService, CompanyProfilePayload } from "../../services/api";
import { CompanyProfileRow } from "../../types/bindings/CompanyProfileRow";

const EMPTY: CompanyProfilePayload = {
  company_name: null, legal_name: null, gstin: null, pan: null,
  address1: null, address2: null, location: null, pincode: null,
  state_code: null, phone: null, email: null, logo: null,
};

function toPayload(r: CompanyProfileRow): CompanyProfilePayload {
  return {
    company_name: r.company_name, legal_name: r.legal_name, gstin: r.gstin, pan: r.pan,
    address1: r.address1, address2: r.address2, location: r.location, pincode: r.pincode,
    state_code: r.state_code, phone: r.phone, email: r.email, logo: r.logo,
  };
}

export default function CompanyProfileForm() {
  const [form, setForm] = useState<CompanyProfilePayload>(EMPTY);
  const [saving, setSaving] = useState(false);

  const load = async () => {
    try {
      setForm(toPayload(await ApiService.getCompanyProfile()));
    } catch (err) {
      // Not connected yet, or empty — leave the blank form.
      console.error(err);
    }
  };

  useEffect(() => { load(); }, []);

  const set = (k: keyof CompanyProfilePayload, v: string) =>
    setForm((f) => ({ ...f, [k]: v === "" ? null : v }));

  const chooseLogo = async () => {
    const sel = await open({ multiple: false, filters: [{ name: "Image", extensions: ["png", "jpg", "jpeg", "gif", "webp", "svg"] }] });
    if (!sel) return;
    const p = (Array.isArray(sel) ? sel[0] : sel) as string;
    try {
      const dataUrl = await ApiService.readLogoAsDataUrl(p);
      setForm((f) => ({ ...f, logo: dataUrl }));
    } catch (err: any) {
      alert(`Could not load logo: ${err.message || err}`);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await ApiService.saveCompanyProfile(form);
      alert("Company profile saved.");
    } catch (err: any) {
      alert(`Save failed: ${err.message || err}`);
    } finally {
      setSaving(false);
    }
  };

  const field = (label: string, k: keyof CompanyProfilePayload) => (
    <label className="flex flex-col gap-1 text-xs">
      <span className="text-slate-400">{label}</span>
      <input
        value={(form[k] as string | null) ?? ""}
        onChange={(e) => set(k, e.target.value)}
        className="bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-slate-200 focus:outline-none focus:border-indigo-500"
      />
    </label>
  );

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 space-y-6">
      <h3 className="text-sm font-bold uppercase tracking-wider text-indigo-400">Company Profile (GST Master)</h3>

      <div className="grid grid-cols-2 gap-4">
        {field("Company Name", "company_name")}
        {field("Legal Name", "legal_name")}
        {field("GSTIN", "gstin")}
        {field("PAN", "pan")}
        {field("Address 1", "address1")}
        {field("Address 2", "address2")}
        {field("Location", "location")}
        {field("Pincode", "pincode")}
        {field("State Code (GST)", "state_code")}
        {field("Phone", "phone")}
        {field("Email", "email")}
      </div>

      <div className="flex items-center gap-4 pt-2 border-t border-slate-800">
        {form.logo ? (
          <img src={form.logo} alt="Company logo" className="w-20 h-20 object-contain bg-slate-950 border border-slate-800 rounded-lg" />
        ) : (
          <div className="w-20 h-20 flex items-center justify-center bg-slate-950 border border-slate-800 rounded-lg text-[10px] text-slate-600">No logo</div>
        )}
        <div className="flex flex-col gap-2">
          <button onClick={chooseLogo} className="bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold px-4 py-2 rounded-lg">Choose logo…</button>
          {form.logo && (
            <button onClick={() => setForm((f) => ({ ...f, logo: null }))} className="text-rose-400 hover:text-rose-300 text-[11px] text-left">Remove logo</button>
          )}
          <span className="text-[10px] text-slate-500">PNG/JPG/SVG, under 512 KB.</span>
        </div>
      </div>

      <div className="flex justify-end pt-2 border-t border-slate-800">
        <button onClick={handleSave} disabled={saving} className="bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold px-5 py-2 rounded-lg disabled:opacity-50">
          {saving ? "Saving…" : "Save Company Profile"}
        </button>
      </div>
    </div>
  );
}
