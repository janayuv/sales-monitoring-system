import { useEffect, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import {
  Building2,
  FileCheck2,
  MapPin,
  Phone,
  Mail,
  Upload,
  Trash2,
  Save,
  ShieldCheck,
  Image as ImageIcon,
  Sparkles,
  CheckCircle,
} from "lucide-react";
import { ApiService, CompanyProfilePayload } from "../../services/api";
import { CompanyProfileRow } from "../../types/bindings/CompanyProfileRow";

const EMPTY: CompanyProfilePayload = {
  company_name: null,
  legal_name: null,
  gstin: null,
  pan: null,
  address1: null,
  address2: null,
  location: null,
  pincode: null,
  state_code: null,
  phone: null,
  email: null,
  logo: null,
};

function toPayload(r: CompanyProfileRow): CompanyProfilePayload {
  return {
    company_name: r.company_name,
    legal_name: r.legal_name,
    gstin: r.gstin,
    pan: r.pan,
    address1: r.address1,
    address2: r.address2,
    location: r.location,
    pincode: r.pincode,
    state_code: r.state_code,
    phone: r.phone,
    email: r.email,
    logo: r.logo,
  };
}

export default function CompanyProfileForm() {
  const [form, setForm] = useState<CompanyProfilePayload>(EMPTY);
  const [saving, setSaving] = useState(false);
  const [savedSuccess, setSavedSuccess] = useState(false);

  const load = async () => {
    try {
      setForm(toPayload(await ApiService.getCompanyProfile()));
    } catch (err) {
      console.error(err);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const set = (k: keyof CompanyProfilePayload, v: string) => {
    setForm((f) => ({ ...f, [k]: v === "" ? null : v }));
    setSavedSuccess(false);
  };

  const chooseLogo = async () => {
    const sel = await open({
      multiple: false,
      filters: [{ name: "Image", extensions: ["png", "jpg", "jpeg", "gif", "webp", "svg"] }],
    });
    if (!sel) return;
    const p = (Array.isArray(sel) ? sel[0] : sel) as string;
    try {
      const dataUrl = await ApiService.readLogoAsDataUrl(p);
      setForm((f) => ({ ...f, logo: dataUrl }));
      setSavedSuccess(false);
    } catch (err: any) {
      alert(`Could not load logo: ${err.message || err}`);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    setSavedSuccess(false);
    try {
      await ApiService.saveCompanyProfile(form);
      setSavedSuccess(true);
    } catch (err: any) {
      alert(`Save failed: ${err.message || err}`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header Banner Card */}
      <div className="ember-card p-6 relative overflow-hidden">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="flex items-start gap-4">
            <div className="p-3 bg-[var(--ember-primary-light)] text-[var(--ember-primary)] rounded-2xl border border-[var(--ember-primary)]/20 shadow-sm">
              <Building2 className="w-7 h-7" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-base font-bold font-serif text-[var(--ember-text-primary)]">
                  Company Profile & Tax Identity
                </h3>
                <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold font-mono bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border border-emerald-500/30 flex items-center gap-1">
                  <ShieldCheck className="w-3 h-3" /> GST Active
                </span>
              </div>
              <p className="text-xs text-[var(--ember-text-secondary)] mt-1">
                Official enterprise taxpayer credentials embedded across outward invoices, credit notes, and Tally Prime exports.
              </p>
            </div>
          </div>

          <button
            onClick={handleSave}
            disabled={saving}
            className="ember-btn-primary px-6 py-2.5 text-xs flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50 shadow-md"
          >
            {saving ? (
              <>
                <Sparkles className="w-4 h-4 animate-spin" />
                Saving Profile...
              </>
            ) : savedSuccess ? (
              <>
                <CheckCircle className="w-4 h-4 text-emerald-300" />
                Saved Successfully
              </>
            ) : (
              <>
                <Save className="w-4 h-4" />
                Save Changes
              </>
            )}
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left 2 Columns: Form Input Sections */}
        <div className="lg:col-span-2 space-y-6">
          {/* Section 1: Legal Registration */}
          <div className="ember-card p-6 space-y-4">
            <div className="flex items-center gap-2 border-b border-[var(--ember-border)] pb-3">
              <FileCheck2 className="w-4 h-4 text-[var(--ember-primary)]" />
              <h4 className="text-xs font-bold uppercase tracking-wider font-serif text-[var(--ember-text-primary)]">
                Legal & Tax Registration Details
              </h4>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-[var(--ember-text-secondary)]">Trade / Operating Name</label>
                <input
                  value={form.company_name ?? ""}
                  onChange={(e) => set("company_name", e.target.value)}
                  placeholder="e.g. Acme Industrial Solutions"
                  className="ember-input px-3.5 py-2 text-xs w-full"
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-[var(--ember-text-secondary)]">Legal Registered Name</label>
                <input
                  value={form.legal_name ?? ""}
                  onChange={(e) => set("legal_name", e.target.value)}
                  placeholder="e.g. Acme Industrial Solutions Private Limited"
                  className="ember-input px-3.5 py-2 text-xs w-full"
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-[var(--ember-text-secondary)]">GSTIN Registration</label>
                <input
                  value={form.gstin ?? ""}
                  onChange={(e) => set("gstin", e.target.value.toUpperCase())}
                  placeholder="e.g. 33AAAAA0000A1Z5"
                  className="ember-input px-3.5 py-2 text-xs font-mono font-semibold text-[var(--ember-primary)] w-full uppercase"
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-[var(--ember-text-secondary)]">PAN (Permanent Account No)</label>
                <input
                  value={form.pan ?? ""}
                  onChange={(e) => set("pan", e.target.value.toUpperCase())}
                  placeholder="e.g. AAAAA0000A"
                  className="ember-input px-3.5 py-2 text-xs font-mono w-full uppercase"
                />
              </div>
            </div>
          </div>

          {/* Section 2: Address & Location */}
          <div className="ember-card p-6 space-y-4">
            <div className="flex items-center gap-2 border-b border-[var(--ember-border)] pb-3">
              <MapPin className="w-4 h-4 text-[var(--ember-primary)]" />
              <h4 className="text-xs font-bold uppercase tracking-wider font-serif text-[var(--ember-text-primary)]">
                Registered Business Location & Address
              </h4>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="md:col-span-2 space-y-1.5">
                <label className="text-xs font-semibold text-[var(--ember-text-secondary)]">Address Line 1</label>
                <input
                  value={form.address1 ?? ""}
                  onChange={(e) => set("address1", e.target.value)}
                  placeholder="Door / Plot / Street Address..."
                  className="ember-input px-3.5 py-2 text-xs w-full"
                />
              </div>

              <div className="md:col-span-2 space-y-1.5">
                <label className="text-xs font-semibold text-[var(--ember-text-secondary)]">Address Line 2 (Optional)</label>
                <input
                  value={form.address2 ?? ""}
                  onChange={(e) => set("address2", e.target.value)}
                  placeholder="Industrial Area / Landmark..."
                  className="ember-input px-3.5 py-2 text-xs w-full"
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-[var(--ember-text-secondary)] font-mono">Location / City</label>
                <input
                  value={form.location ?? ""}
                  onChange={(e) => set("location", e.target.value)}
                  placeholder="e.g. Chennai"
                  className="ember-input px-3.5 py-2 text-xs w-full"
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-[var(--ember-text-secondary)]">Pincode</label>
                <input
                  value={form.pincode ?? ""}
                  onChange={(e) => set("pincode", e.target.value)}
                  placeholder="e.g. 600001"
                  className="ember-input px-3.5 py-2 text-xs font-mono w-full"
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-[var(--ember-text-secondary)]">GST State Code</label>
                <input
                  value={form.state_code ?? ""}
                  onChange={(e) => set("state_code", e.target.value)}
                  placeholder="e.g. 33 (Tamil Nadu)"
                  className="ember-input px-3.5 py-2 text-xs font-mono w-full"
                />
              </div>
            </div>
          </div>

          {/* Section 3: Contact Channels */}
          <div className="ember-card p-6 space-y-4">
            <div className="flex items-center gap-2 border-b border-[var(--ember-border)] pb-3">
              <Phone className="w-4 h-4 text-[var(--ember-primary)]" />
              <h4 className="text-xs font-bold uppercase tracking-wider font-serif text-[var(--ember-text-primary)]">
                Official Communication Channels
              </h4>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-[var(--ember-text-secondary)] flex items-center gap-1.5">
                  <Phone className="w-3 h-3 text-[var(--ember-text-muted)]" /> Telephone / Phone
                </label>
                <input
                  value={form.phone ?? ""}
                  onChange={(e) => set("phone", e.target.value)}
                  placeholder="e.g. +91 44 2800 0000"
                  className="ember-input px-3.5 py-2 text-xs font-mono w-full"
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-[var(--ember-text-secondary)] flex items-center gap-1.5">
                  <Mail className="w-3 h-3 text-[var(--ember-text-muted)]" /> Official Email
                </label>
                <input
                  value={form.email ?? ""}
                  onChange={(e) => set("email", e.target.value)}
                  placeholder="e.g. accounts@acme.com"
                  className="ember-input px-3.5 py-2 text-xs font-mono w-full"
                />
              </div>
            </div>
          </div>
        </div>

        {/* Right 1 Column: Logo Asset & Live Invoice Header Preview */}
        <div className="space-y-6">
          {/* Logo Asset Card */}
          <div className="ember-card p-6 space-y-4">
            <div className="flex items-center gap-2 border-b border-[var(--ember-border)] pb-3">
              <ImageIcon className="w-4 h-4 text-[var(--ember-primary)]" />
              <h4 className="text-xs font-bold uppercase tracking-wider font-serif text-[var(--ember-text-primary)]">
                Brand Logo Asset
              </h4>
            </div>

            <div className="flex flex-col items-center justify-center p-6 bg-[var(--ember-surface-raised)] border-2 border-dashed border-[var(--ember-border)] rounded-xl text-center space-y-3">
              {form.logo ? (
                <div className="relative group">
                  <img
                    src={form.logo}
                    alt="Company Logo Preview"
                    className="max-h-24 max-w-full object-contain p-2 bg-white rounded-lg shadow-sm"
                  />
                  <button
                    onClick={() => setForm((f) => ({ ...f, logo: null }))}
                    className="absolute -top-2 -right-2 p-1.5 bg-rose-600 text-white rounded-full hover:bg-rose-700 transition-colors shadow-md cursor-pointer"
                    title="Remove Logo"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              ) : (
                <div className="space-y-2">
                  <div className="p-3 bg-[var(--ember-primary-light)] text-[var(--ember-primary)] rounded-full w-10 h-10 flex items-center justify-center mx-auto">
                    <Upload className="w-5 h-5" />
                  </div>
                  <p className="text-xs font-semibold text-[var(--ember-text-primary)]">No Logo File Uploaded</p>
                  <p className="text-[10px] text-[var(--ember-text-muted)]">PNG, JPG, WEBP, SVG up to 512 KB</p>
                </div>
              )}

              <button
                onClick={chooseLogo}
                className="ember-btn-secondary px-4 py-2 text-xs flex items-center gap-1.5 cursor-pointer w-full justify-center"
              >
                <Upload className="w-3.5 h-3.5 text-[var(--ember-primary)]" />
                {form.logo ? "Replace Logo File..." : "Choose Logo File..."}
              </button>
            </div>
          </div>

          {/* Live Mini Header Preview Mockup */}
          <div className="ember-card p-6 space-y-4">
            <div className="flex items-center justify-between border-b border-[var(--ember-border)] pb-3">
              <span className="text-[10px] font-bold uppercase tracking-wider text-[var(--ember-text-muted)]">
                Live Document Header Preview
              </span>
              <span className="text-[9px] font-mono font-bold uppercase bg-[var(--ember-primary-light)] text-[var(--ember-primary)] px-2 py-0.5 rounded">
                Mock Invoice
              </span>
            </div>

            <div className="bg-[var(--ember-surface-raised)] border border-[var(--ember-border)] p-4 rounded-xl space-y-3">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h5 className="font-bold text-xs font-serif text-[var(--ember-text-primary)]">
                    {form.company_name || "YOUR COMPANY NAME"}
                  </h5>
                  <p className="text-[10px] text-[var(--ember-text-secondary)] mt-0.5">
                    {form.legal_name || "Legal Name Not Set"}
                  </p>
                </div>
                {form.logo && (
                  <img
                    src={form.logo}
                    alt="Mini Logo Preview"
                    className="w-10 h-10 object-contain p-1 bg-white rounded border border-gray-200"
                  />
                )}
              </div>

              <div className="text-[10px] space-y-1 text-[var(--ember-text-muted)] font-mono border-t border-[var(--ember-border-subtle)] pt-2">
                <p>GSTIN: <strong className="text-[var(--ember-primary)]">{form.gstin || "NOT SPECIFIED"}</strong></p>
                <p>PAN: {form.pan || "—"}</p>
                <p className="truncate">
                  {[form.address1, form.location, form.pincode].filter(Boolean).join(", ") || "Address not fully set"}
                </p>
                <p>{form.phone ? `Ph: ${form.phone}` : ""} {form.email ? `• ${form.email}` : ""}</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
