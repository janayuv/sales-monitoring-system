import { useState } from "react";
import {
  User,
  X,
  FileText,
  MapPin,
  Phone,
  Tag,
  Save,
  Sparkles,
  Maximize2,
  Plus,
} from "lucide-react";
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
  id: null,
  customer_code: "",
  report_name: "",
  tally_name: null,
  legal_name: null,
  gstin: null,
  address1: null,
  address2: null,
  location: null,
  pincode: null,
  state_code: null,
  place_of_supply: null,
  phone: null,
  email: null,
  category_name: null,
  remarks: null,
  status: "Approved",
};

function toPayload(r: CustomerMasterRow): CustomerMasterPayload {
  return {
    id: Number(r.id),
    customer_code: r.customer_code,
    report_name: r.report_name,
    tally_name: r.tally_name,
    legal_name: r.legal_name,
    gstin: r.gstin,
    address1: r.address1,
    address2: r.address2,
    location: r.location,
    pincode: r.pincode,
    state_code: r.state_code,
    place_of_supply: r.place_of_supply,
    phone: r.phone,
    email: r.email,
    category_name: r.category_name,
    remarks: r.remarks,
    status: r.status === "Pending_Review" ? "Pending_Review" : "Approved",
  };
}

export default function CustomerDetailForm({ initial, categories, onClose, onSaved }: Props) {
  const [form, setForm] = useState<CustomerMasterPayload>(initial ? toPayload(initial) : EMPTY);
  const [saving, setSaving] = useState(false);
  const [windowSize, setWindowSize] = useState<"1x" | "2x" | "full">("1x");

  // Category creation states
  const [categoryList, setCategoryList] = useState<CustomerCategoryRow[]>(categories);
  const [showAddCategory, setShowAddCategory] = useState(false);
  const [newCategoryName, setNewCategoryName] = useState("");
  const [creatingCategory, setCreatingCategory] = useState(false);

  const isCreate = initial === null;

  const set = (k: keyof CustomerMasterPayload, v: string) =>
    setForm((f) => ({
      ...f,
      [k]: v === "" ? (k === "customer_code" || k === "report_name" || k === "status" ? v : null) : v,
    }));

  const handleSave = async () => {
    if (!form.customer_code.trim() || !form.report_name.trim()) {
      alert("Please fill in required fields: Customer Code and Report Name.");
      return;
    }
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

  const handleCreateCategory = async () => {
    if (!newCategoryName.trim()) return;
    setCreatingCategory(true);
    try {
      const created = await ApiService.createCustomerCategory(newCategoryName.trim());
      setCategoryList((prev) => [...prev, created]);
      setForm((f) => ({ ...f, category_name: created.name }));
      setNewCategoryName("");
      setShowAddCategory(false);
      onSaved(); // Refresh main tab categories list
    } catch (err: any) {
      alert(`Failed to add category: ${err.message || err}`);
    } finally {
      setCreatingCategory(false);
    }
  };

  const field = (
    label: string,
    k: keyof CustomerMasterPayload,
    required = false,
    placeholder = "",
    isMono = false
  ) => (
    <div className="space-y-1.5 text-xs">
      <label className="text-[var(--ember-text-secondary)] font-semibold flex items-center gap-1">
        {label}
        {required && <span className="text-rose-500 font-bold">*</span>}
      </label>
      <input
        value={(form[k] as string | null) ?? ""}
        onChange={(e) => set(k, e.target.value)}
        placeholder={placeholder}
        className={`ember-input px-3.5 py-2 text-xs w-full ${isMono ? "font-mono" : ""}`}
      />
    </div>
  );

  const modalSizeClass =
    windowSize === "1x"
      ? "max-w-4xl max-h-[90vh]"
      : windowSize === "2x"
      ? "w-[92vw] max-w-[92vw] max-h-[94vh]"
      : "w-[98vw] max-w-none h-[96vh] max-h-[96vh]";

  return (
    /* Modal Backdrop */
    <div className="fixed inset-0 bg-black/75 backdrop-blur-sm z-50 flex items-center justify-center p-2 sm:p-4 overflow-y-auto animate-fadeIn">
      {/* Dynamic Sized Modal Dialog Card */}
      <div
        className={`w-full bg-[var(--ember-surface)] border border-[var(--ember-border)] rounded-2xl shadow-2xl flex flex-col overflow-hidden transition-all duration-200 ${modalSizeClass}`}
      >
        {/* Modal Header */}
        <div className="p-4 sm:p-5 bg-[var(--ember-surface-raised)] border-b border-[var(--ember-border)] flex items-center justify-between flex-shrink-0 select-none">
          <div className="flex items-center gap-3">
            <div className="p-2.5 bg-[var(--ember-primary-light)] text-[var(--ember-primary)] rounded-xl border border-[var(--ember-primary)]/20">
              <User className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-base font-bold font-serif text-[var(--ember-text-primary)]">
                  {isCreate ? "Add New Customer Profile" : `Edit Customer: ${form.customer_code}`}
                </h3>
                <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold font-mono bg-[var(--ember-primary-light)] text-[var(--ember-primary)] border border-[var(--ember-primary)]/30">
                  {isCreate ? "New Record" : "Master Record"}
                </span>
              </div>
              <p className="text-xs text-[var(--ember-text-secondary)] mt-0.5">
                Configure identity, GST registration, address, and classification details.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            {/* 1x | 2x | Full Size Switcher Segmented Control */}
            <div className="flex items-center gap-1 bg-[var(--ember-surface)] p-1 rounded-xl border border-[var(--ember-border)] select-none">
              <button
                type="button"
                onClick={() => setWindowSize("1x")}
                className={`px-2.5 py-1 rounded-lg text-[11px] font-mono font-bold transition-all cursor-pointer ${
                  windowSize === "1x"
                    ? "bg-[var(--ember-primary)] text-white shadow-xs"
                    : "text-[var(--ember-text-muted)] hover:text-[var(--ember-text-primary)] hover:bg-[var(--ember-surface-raised)]"
                }`}
                title="Standard Compact Mode (1x)"
              >
                1x
              </button>

              <button
                type="button"
                onClick={() => setWindowSize("2x")}
                className={`px-2.5 py-1 rounded-lg text-[11px] font-mono font-bold transition-all cursor-pointer ${
                  windowSize === "2x"
                    ? "bg-[var(--ember-primary)] text-white shadow-xs"
                    : "text-[var(--ember-text-muted)] hover:text-[var(--ember-text-primary)] hover:bg-[var(--ember-surface-raised)]"
                }`}
                title="Large Widescreen Mode (2x)"
              >
                2x
              </button>

              <button
                type="button"
                onClick={() => setWindowSize("full")}
                className={`px-2.5 py-1 rounded-lg text-[11px] font-mono font-bold transition-all cursor-pointer flex items-center gap-1 ${
                  windowSize === "full"
                    ? "bg-[var(--ember-primary)] text-white shadow-xs"
                    : "text-[var(--ember-text-muted)] hover:text-[var(--ember-text-primary)] hover:bg-[var(--ember-surface-raised)]"
                }`}
                title="Full Screen Mode"
              >
                <Maximize2 className="w-3 h-3" /> Full
              </button>
            </div>

            <button
              onClick={onClose}
              className="p-2 text-[var(--ember-text-muted)] hover:text-[var(--ember-text-primary)] hover:bg-[var(--ember-surface)] rounded-xl transition-colors cursor-pointer"
              title="Close window (Esc)"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Scrollable Modal Content */}
        <div className="p-6 overflow-y-auto space-y-6 flex-1">
          {/* Section 1: Identity & GST Credentials */}
          <div className="bg-[var(--ember-surface-raised)] p-5 rounded-xl border border-[var(--ember-border)] space-y-4">
            <div className="flex items-center gap-2 border-b border-[var(--ember-border)] pb-3">
              <FileText className="w-4 h-4 text-[var(--ember-primary)]" />
              <h4 className="text-xs font-bold uppercase tracking-wider font-serif text-[var(--ember-text-primary)]">
                Identity & GST Info
              </h4>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {field("Customer Code", "customer_code", true, "e.g. C001", true)}
              {field("Report Name", "report_name", true, "Company name on sales report")}
              {field("Tally Ledger Name", "tally_name", false, "Matching name in Tally")}
              {field("Legal Business Name", "legal_name", false, "Official registered legal name")}
              {field("GSTIN Registration", "gstin", false, "e.g. 33AAAAA0000A1Z5", true)}
            </div>
          </div>

          {/* Section 2: Address & Location */}
          <div className="bg-[var(--ember-surface-raised)] p-5 rounded-xl border border-[var(--ember-border)] space-y-4">
            <div className="flex items-center gap-2 border-b border-[var(--ember-border)] pb-3">
              <MapPin className="w-4 h-4 text-[var(--ember-primary)]" />
              <h4 className="text-xs font-bold uppercase tracking-wider font-serif text-[var(--ember-text-primary)]">
                Registered Address & Supply Location
              </h4>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              <div className="sm:col-span-2 lg:col-span-3">
                {field("Address Line 1", "address1", false, "Door No, Building, Street...")}
              </div>
              <div className="sm:col-span-2 lg:col-span-3">
                {field("Address Line 2", "address2", false, "Area, Landmark...")}
              </div>
              {field("Location / City", "location", false, "e.g. Chennai")}
              {field("Pincode", "pincode", false, "e.g. 600001", true)}
              {field("State Code (GST)", "state_code", false, "e.g. 33", true)}
              <div className="sm:col-span-2 lg:col-span-1">
                {field("Place of Supply (GST)", "place_of_supply", false, "e.g. Tamil Nadu (33)")}
              </div>
            </div>
          </div>

          {/* Section 3: Contact & Classification Grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Contact Details */}
            <div className="bg-[var(--ember-surface-raised)] p-5 rounded-xl border border-[var(--ember-border)] space-y-4">
              <div className="flex items-center gap-2 border-b border-[var(--ember-border)] pb-3">
                <Phone className="w-4 h-4 text-[var(--ember-primary)]" />
                <h4 className="text-xs font-bold uppercase tracking-wider font-serif text-[var(--ember-text-primary)]">
                  Contact Channels
                </h4>
              </div>
              <div className="space-y-4">
                {field("Telephone / Phone", "phone", false, "e.g. +91 44 2800 0000", true)}
                {field("Official Email Address", "email", false, "e.g. accounts@client.com", true)}
              </div>
            </div>

            {/* Classification & Status */}
            <div className="bg-[var(--ember-surface-raised)] p-5 rounded-xl border border-[var(--ember-border)] space-y-4">
              <div className="flex items-center gap-2 border-b border-[var(--ember-border)] pb-3">
                <Tag className="w-4 h-4 text-[var(--ember-primary)]" />
                <h4 className="text-xs font-bold uppercase tracking-wider font-serif text-[var(--ember-text-primary)]">
                  Category & Approval Status
                </h4>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {/* Category Dropdown & Add Category Option */}
                <div className="space-y-1.5 text-xs">
                  <div className="flex items-center justify-between">
                    <label className="text-[var(--ember-text-secondary)] font-semibold">Category</label>
                    <button
                      type="button"
                      onClick={() => setShowAddCategory(!showAddCategory)}
                      className="px-2 py-0.5 rounded-md bg-[var(--ember-primary-light)] text-[var(--ember-primary)] hover:bg-[var(--ember-primary)] hover:text-white font-bold text-[11px] flex items-center gap-1 border border-[var(--ember-primary)]/30 transition-all cursor-pointer shadow-xs"
                      title="Add a new customer category"
                    >
                      <Plus className="w-3 h-3" /> Add Category
                    </button>
                  </div>

                  <select
                    value={form.category_name ?? ""}
                    onChange={(e) => {
                      if (e.target.value === "__ADD_NEW__") {
                        setShowAddCategory(true);
                      } else {
                        set("category_name", e.target.value);
                      }
                    }}
                    className="ember-input px-3.5 py-2 text-xs w-full cursor-pointer font-medium"
                  >
                    <option value="">Uncategorized</option>
                    {categoryList.map((c) => (
                      <option key={c.id} value={c.name}>
                        {c.name}
                      </option>
                    ))}
                    <option value="__ADD_NEW__" className="font-bold text-[var(--ember-primary)]">
                      + Add New Category...
                    </option>
                  </select>

                  {/* Inline Add Category Input Box */}
                  {showAddCategory && (
                    <div className="mt-2.5 p-3 bg-[var(--ember-surface)] border-2 border-[var(--ember-primary)]/40 rounded-xl shadow-lg animate-fadeIn space-y-2">
                      <span className="text-[11px] font-bold text-[var(--ember-primary)] uppercase tracking-wider block">
                        Create New Customer Category
                      </span>
                      <div className="flex items-center gap-2">
                        <input
                          value={newCategoryName}
                          onChange={(e) => setNewCategoryName(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") {
                              e.preventDefault();
                              handleCreateCategory();
                            }
                          }}
                          placeholder="e.g. Wholesale, OEM..."
                          className="ember-input px-3 py-1.5 text-xs flex-1 border-[var(--ember-primary)]/50 focus:ring-[var(--ember-primary)]"
                          autoFocus
                        />
                        <button
                          type="button"
                          onClick={handleCreateCategory}
                          disabled={creatingCategory || !newCategoryName.trim()}
                          className="ember-btn-primary px-3.5 py-1.5 text-xs cursor-pointer disabled:opacity-50 font-bold"
                        >
                          {creatingCategory ? "Saving..." : "Save Category"}
                        </button>
                        <button
                          type="button"
                          onClick={() => setShowAddCategory(false)}
                          className="p-1.5 text-[var(--ember-text-muted)] hover:text-[var(--ember-text-primary)] hover:bg-[var(--ember-surface-raised)] rounded-lg cursor-pointer"
                          title="Cancel"
                        >
                          <X className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  )}
                </div>

                <div className="space-y-1.5 text-xs">
                  <label className="text-[var(--ember-text-secondary)] font-semibold">Approval Status</label>
                  <select
                    value={form.status}
                    onChange={(e) =>
                      setForm((f) => ({
                        ...f,
                        status: e.target.value === "Pending_Review" ? "Pending_Review" : "Approved",
                      }))
                    }
                    className="ember-input px-3.5 py-2 text-xs w-full cursor-pointer font-semibold"
                  >
                    <option value="Approved">Approved</option>
                    <option value="Pending_Review">Pending Review</option>
                  </select>
                </div>
              </div>

              {field("Remarks & Notes", "remarks", false, "Internal notes or instructions...")}
            </div>
          </div>
        </div>

        {/* Modal Footer Action Bar */}
        <div className="p-5 bg-[var(--ember-surface-raised)] border-t border-[var(--ember-border)] flex items-center justify-end gap-3 flex-shrink-0">
          <button
            onClick={onClose}
            type="button"
            className="ember-btn-secondary px-5 py-2.5 text-xs cursor-pointer"
          >
            Cancel
          </button>

          <button
            onClick={handleSave}
            disabled={saving}
            type="button"
            className="ember-btn-primary px-6 py-2.5 text-xs flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50 shadow-md"
          >
            {saving ? (
              <>
                <Sparkles className="w-4 h-4 animate-spin" /> Saving Profile...
              </>
            ) : (
              <>
                <Save className="w-4 h-4" /> Save Customer Profile
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
