import React from "react";
import {
  ShieldCheck,
  AlertTriangle,
  FileSpreadsheet,
  TrendingDown,
  TrendingUp,
  AlertOctagon,
  Scale,
} from "lucide-react";
import { AuditSummaryMetrics } from "../../types/gstr1AuditTypes";
import { formatCurrency, formatNumber, formatPercent } from "../../utils/formatters";

interface Props {
  metrics: AuditSummaryMetrics;
  companyName?: string;
  onFilterStatus?: (status: any) => void;
}

export const Gstr1AuditKpis: React.FC<Props> = ({ metrics, onFilterStatus }) => {
  const isHealthy = metrics.matched_percent >= 95;
  const isModerate = metrics.matched_percent >= 80 && metrics.matched_percent < 95;

  return (
    <div className="space-y-4">
      {/* Top Banner if Critical Discrepancies exist */}
      {metrics.cancelled_mismatch_count > 0 && (
        <div className="bg-rose-500/10 border border-rose-500/30 rounded-xl p-3.5 flex items-center justify-between gap-4 text-xs">
          <div className="flex items-center gap-3">
            <AlertOctagon className="w-5 h-5 text-rose-500 flex-shrink-0" />
            <div>
              <span className="font-bold text-rose-700 dark:text-rose-300">
                Critical Audit Alert: {metrics.cancelled_mismatch_count} Cancelled/Deleted Invoice Mismatch(es) Detected!
              </span>
              <p className="text-[11px] text-rose-600/80 dark:text-rose-300/80 mt-0.5">
                Invoices voided in internal ERP records remain active in the GSTR-1 return, creating unjustified tax payment risk or vice-versa.
              </p>
            </div>
          </div>
          {onFilterStatus && (
            <button
              onClick={() => onFilterStatus("CANCELLED_MISMATCH")}
              className="px-3 py-1.5 bg-rose-600 hover:bg-rose-500 text-white rounded-lg font-semibold text-[11px] transition-colors shadow-sm cursor-pointer whitespace-nowrap"
            >
              Inspect Cancelled
            </button>
          )}
        </div>
      )}

      {/* Main KPI Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Card 1: Reconciliation Health Score */}
        <div className="ember-card p-5 relative overflow-hidden flex flex-col justify-between">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold uppercase tracking-wider text-[var(--ember-text-muted)]">
              Audit Match Rate
            </span>
            <div
              className={`p-2 rounded-lg ${
                isHealthy
                  ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400"
                  : isModerate
                  ? "bg-amber-500/15 text-amber-600 dark:text-amber-400"
                  : "bg-rose-500/15 text-rose-600 dark:text-rose-400"
              }`}
            >
              {isHealthy ? <ShieldCheck className="w-5 h-5" /> : <AlertTriangle className="w-5 h-5" />}
            </div>
          </div>

          <div className="my-3 flex items-baseline gap-3">
            <span className="text-3xl font-black font-mono tracking-tight text-[var(--ember-text-primary)]">
              {formatPercent(metrics.matched_percent, 1)}
            </span>
            <span
              className={`text-[11px] font-bold px-2 py-0.5 rounded-full ${
                isHealthy
                  ? "bg-emerald-500/20 text-emerald-700 dark:text-emerald-300"
                  : isModerate
                  ? "bg-amber-500/20 text-amber-700 dark:text-amber-300"
                  : "bg-rose-500/20 text-rose-700 dark:text-rose-300"
              }`}
            >
              {isHealthy ? "AUDIT READY" : isModerate ? "REVIEW REQUIRED" : "ATTENTION"}
            </span>
          </div>

          {/* Progress bar */}
          <div className="space-y-1.5">
            <div className="w-full h-2 bg-[var(--ember-surface-raised)] rounded-full overflow-hidden border border-[var(--ember-border-subtle)]">
              <div
                className={`h-full transition-all duration-500 rounded-full ${
                  isHealthy ? "bg-emerald-500" : isModerate ? "bg-amber-500" : "bg-rose-500"
                }`}
                style={{ width: `${Math.min(100, Math.max(0, metrics.matched_percent))}%` }}
              />
            </div>
            <div className="flex justify-between text-[10px] text-[var(--ember-text-muted)] font-mono">
              <span>{formatNumber(metrics.matched_count)} matched</span>
              <span>{formatNumber(metrics.total_records - metrics.matched_count)} variances</span>
            </div>
          </div>
        </div>

        {/* Card 2: Books (Internal Sales Register) */}
        <div className="ember-card p-5 flex flex-col justify-between">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold uppercase tracking-wider text-[var(--ember-text-muted)]">
              Books Sales (ERP)
            </span>
            <div className="p-2 bg-blue-500/15 text-blue-600 dark:text-blue-400 rounded-lg">
              <FileSpreadsheet className="w-5 h-5" />
            </div>
          </div>

          <div className="my-2">
            <span className="text-[10px] text-[var(--ember-text-muted)] uppercase tracking-wider block font-medium">
              Taxable Turnover
            </span>
            <span className="text-2xl font-bold font-mono text-[var(--ember-text-primary)]">
              {formatCurrency(metrics.books_total_taxable)}
            </span>
          </div>

          <div className="pt-2 border-t border-[var(--ember-border-subtle)] flex justify-between items-center text-[11px]">
            <span className="text-[var(--ember-text-secondary)]">Total GST Tax:</span>
            <span className="font-mono font-semibold text-blue-600 dark:text-blue-400">
              {formatCurrency(metrics.books_total_tax)}
            </span>
          </div>
        </div>

        {/* Card 3: GSTR-1 Portal Return */}
        <div className="ember-card p-5 flex flex-col justify-between">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold uppercase tracking-wider text-[var(--ember-text-muted)]">
              GSTR-1 Portal Return
            </span>
            <div className="p-2 bg-purple-500/15 text-purple-600 dark:text-purple-400 rounded-lg">
              <Scale className="w-5 h-5" />
            </div>
          </div>

          <div className="my-2">
            <span className="text-[10px] text-[var(--ember-text-muted)] uppercase tracking-wider block font-medium">
              Reported Taxable
            </span>
            <span className="text-2xl font-bold font-mono text-[var(--ember-text-primary)]">
              {formatCurrency(metrics.gstr1_total_taxable)}
            </span>
          </div>

          <div className="pt-2 border-t border-[var(--ember-border-subtle)] flex justify-between items-center text-[11px]">
            <span className="text-[var(--ember-text-secondary)]">Reported GST:</span>
            <span className="font-mono font-semibold text-purple-600 dark:text-purple-400">
              {formatCurrency(metrics.gstr1_total_tax)}
            </span>
          </div>
        </div>

        {/* Card 4: Net Variance & Audit Tax Exposure */}
        <div className="ember-card p-5 flex flex-col justify-between">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold uppercase tracking-wider text-[var(--ember-text-muted)]">
              Net Tax Liability Δ
            </span>
            <div
              className={`p-2 rounded-lg ${
                metrics.net_diff_tax === 0
                  ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400"
                  : metrics.net_diff_tax > 0
                  ? "bg-amber-500/15 text-amber-600 dark:text-amber-400"
                  : "bg-rose-500/15 text-rose-600 dark:text-rose-400"
              }`}
            >
              {metrics.net_diff_tax >= 0 ? <TrendingUp className="w-5 h-5" /> : <TrendingDown className="w-5 h-5" />}
            </div>
          </div>

          <div className="my-2">
            <span className="text-[10px] text-[var(--ember-text-muted)] uppercase tracking-wider block font-medium">
              {metrics.net_diff_tax > 0
                ? "Unfiled Portal Tax (Books > Portal)"
                : metrics.net_diff_tax < 0
                ? "Excess Portal Tax (Portal > Books)"
                : "Tax Reconciled"}
            </span>
            <span
              className={`text-2xl font-bold font-mono ${
                metrics.net_diff_tax === 0
                  ? "text-emerald-600 dark:text-emerald-400"
                  : metrics.net_diff_tax > 0
                  ? "text-amber-600 dark:text-amber-400"
                  : "text-rose-600 dark:text-rose-400"
              }`}
            >
              {metrics.net_diff_tax > 0 ? "+" : ""}
              {formatCurrency(metrics.net_diff_tax)}
            </span>
          </div>

          <div className="pt-2 border-t border-[var(--ember-border-subtle)] flex justify-between items-center text-[11px]">
            <span className="text-[var(--ember-text-secondary)]">Turnover Δ:</span>
            <span className="font-mono font-semibold text-[var(--ember-text-primary)]">
              {metrics.net_diff_taxable > 0 ? "+" : ""}
              {formatCurrency(metrics.net_diff_taxable)}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
};
