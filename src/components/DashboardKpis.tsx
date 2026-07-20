import { TrendingUp, TrendingDown, FileWarning, Tag, Receipt, PieChart, Clock } from "lucide-react";
import { DashboardMetrics } from "../types/bindings/DashboardMetrics";

interface DashboardKpisProps {
  metrics: DashboardMetrics | null;
}

function formatCurrency(value: number): string {
  return `₹${value.toLocaleString("en-IN", { minimumFractionDigits: 2 })}`;
}

export default function DashboardKpis({ metrics }: DashboardKpisProps) {
  const growth = metrics?.comparative_growth_percent ?? 0;
  const isPositiveGrowth = growth >= 0;

  return (
    <div className="space-y-6">
      {/* KPI Summary Grid */}
      <div className="grid grid-cols-4 gap-6">
        <div className="bg-slate-900 border border-slate-800/80 rounded-xl p-6 relative overflow-hidden">
          <div className="absolute top-0 right-0 w-32 h-32 bg-indigo-500/5 rounded-full translate-x-12 -translate-y-12 blur-xl" />
          <p className="text-xs font-semibold text-slate-400">Total Sales (YTD)</p>
          <h3 className="text-2xl font-bold text-slate-100 mt-2">{formatCurrency(metrics?.ytd_sales ?? 0)}</h3>
          <div className="flex items-center gap-1.5 text-slate-400 text-xs mt-3">
            {isPositiveGrowth ? (
              <TrendingUp className="w-3.5 h-3.5 text-emerald-400" />
            ) : (
              <TrendingDown className="w-3.5 h-3.5 text-rose-400" />
            )}
            <span className={`font-semibold ${isPositiveGrowth ? "text-emerald-400" : "text-rose-400"}`}>
              {growth.toFixed(1)}% Growth
            </span>{" "}
            vs last year
          </div>
        </div>

        <div className="bg-slate-900 border border-slate-800/80 rounded-xl p-6 relative overflow-hidden">
          <div className="absolute top-0 right-0 w-32 h-32 bg-emerald-500/5 rounded-full translate-x-12 -translate-y-12 blur-xl" />
          <p className="text-xs font-semibold text-slate-400">Sales Invoices (Active, FY)</p>
          <h3 className="text-2xl font-bold text-slate-100 mt-2">{metrics?.active_invoices_count ?? 0}</h3>
          <div className="flex items-center gap-1.5 text-slate-400 text-xs mt-3">
            <FileWarning className="w-3.5 h-3.5 text-amber-400" />
            <span className="text-amber-400 font-semibold">{metrics?.import_errors_count ?? 0}</span> import errors pending
          </div>
        </div>

        <div className="bg-slate-900 border border-slate-800/80 rounded-xl p-6 relative overflow-hidden">
          <div className="absolute top-0 right-0 w-32 h-32 bg-amber-500/5 rounded-full translate-x-12 -translate-y-12 blur-xl" />
          <p className="text-xs font-semibold text-slate-400">Debit Notes Pending</p>
          <h3 className="text-2xl font-bold text-slate-100 mt-2">{metrics?.pending_debit_notes_count ?? 0}</h3>
          <div className="flex items-center gap-1.5 text-slate-400 text-xs mt-3">
            <Tag className="w-3.5 h-3.5 text-amber-400" />
            <span className="text-amber-400 font-semibold">awaiting approval</span>
          </div>
        </div>

        <div className="bg-slate-900 border border-slate-800/80 rounded-xl p-6 relative overflow-hidden">
          <div className="absolute top-0 right-0 w-32 h-32 bg-rose-500/5 rounded-full translate-x-12 -translate-y-12 blur-xl" />
          <p className="text-xs font-semibold text-slate-400">Credit Notes Pending</p>
          <h3 className="text-2xl font-bold text-slate-100 mt-2">{metrics?.pending_credit_notes_count ?? 0}</h3>
          <div className="flex items-center gap-1.5 text-slate-400 text-xs mt-3">
            <Receipt className="w-3.5 h-3.5 text-rose-400" />
            <span className="text-rose-400 font-semibold">{metrics?.cancelled_invoices_count ?? 0}</span> cancelled invoices (FY)
          </div>
        </div>
      </div>

      {/* GST Summary + Recent Activity */}
      <div className="grid grid-cols-3 gap-6">
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 col-span-1">
          <h4 className="text-xs font-bold text-slate-300 uppercase tracking-wider border-b border-slate-800 pb-3 mb-4 flex items-center gap-2">
            <PieChart className="w-4 h-4 text-indigo-400" /> GST Payable Summary (FY)
          </h4>
          <div className="space-y-3 text-xs">
            <div className="flex justify-between">
              <span className="text-slate-400">Taxable Value</span>
              <span className="font-mono text-slate-200">{formatCurrency(metrics?.gst_payable_summary.total_taxable ?? 0)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-400">CGST</span>
              <span className="font-mono text-slate-200">{formatCurrency(metrics?.gst_payable_summary.total_cgst ?? 0)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-400">SGST</span>
              <span className="font-mono text-slate-200">{formatCurrency(metrics?.gst_payable_summary.total_sgst ?? 0)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-400">IGST</span>
              <span className="font-mono text-slate-200">{formatCurrency(metrics?.gst_payable_summary.total_igst ?? 0)}</span>
            </div>
            <div className="flex justify-between border-t border-slate-800 pt-3 font-bold">
              <span className="text-slate-300">Total Value</span>
              <span className="font-mono text-indigo-400">{formatCurrency(metrics?.gst_payable_summary.total_gross ?? 0)}</span>
            </div>
          </div>
        </div>

        <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 col-span-2">
          <h4 className="text-xs font-bold text-slate-300 uppercase tracking-wider border-b border-slate-800 pb-3 mb-4 flex items-center gap-2">
            <Clock className="w-4 h-4 text-indigo-400" /> Recent Activity
          </h4>
          {!metrics || metrics.recent_activity.length === 0 ? (
            <p className="text-xs text-slate-500 text-center py-8">No recent activity recorded.</p>
          ) : (
            <div className="space-y-2 max-h-64 overflow-y-auto">
              {metrics.recent_activity.map((entry, idx) => (
                <div key={idx} className="text-[11px] text-slate-400 border-b border-slate-800/40 pb-2">
                  {entry}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Top rankings */}
      <div className="grid grid-cols-3 gap-6">
        {[
          { title: "Top Customers (FY)", data: metrics?.top_10_customers ?? [] },
          { title: "Top Suppliers (FY)", data: metrics?.top_10_suppliers ?? [] },
          { title: "Top Parts (FY)", data: metrics?.top_20_parts.slice(0, 10) ?? [] },
        ].map((panel) => (
          <div key={panel.title} className="bg-slate-900 border border-slate-800 rounded-xl p-6">
            <h4 className="text-xs font-bold text-slate-300 uppercase tracking-wider border-b border-slate-800 pb-3 mb-4">
              {panel.title}
            </h4>
            {panel.data.length === 0 ? (
              <p className="text-xs text-slate-500 text-center py-6">No data for the active financial year.</p>
            ) : (
              <div className="space-y-2 text-xs">
                {panel.data.map(([name, value], idx) => (
                  <div key={idx} className="flex justify-between">
                    <span className="text-slate-400 truncate max-w-[65%]">{name}</span>
                    <span className="font-mono text-slate-200">{formatCurrency(value)}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
