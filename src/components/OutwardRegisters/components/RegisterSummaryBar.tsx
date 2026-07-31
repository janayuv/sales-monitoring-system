import React from "react";
import { TableSummary } from "../types/register";
import { formatINR } from "../utils/formatCurrency";
import { Calculator } from "lucide-react";

interface Props {
  summary: TableSummary;
  isTopSticky?: boolean;
}

export const RegisterSummaryBar: React.FC<Props> = ({
  summary,
  isTopSticky = false,
}) => {
  return (
    <div
      className={`bg-[var(--ember-surface-raised)] border-y border-[var(--ember-border)] px-4 py-2.5 flex flex-wrap items-center justify-between gap-4 text-xs font-mono select-none ${
        isTopSticky ? "sticky top-0 z-20 shadow-sm backdrop-blur-md bg-[var(--ember-surface-raised)]/95" : ""
      }`}
    >
      <div className="flex items-center gap-2 font-sans font-semibold text-[var(--ember-text-secondary)]">
        <Calculator className="w-4 h-4 text-[var(--ember-primary)]" />
        <span>Filtered Dataset Totals:</span>
        <span className="bg-[var(--ember-surface)] border border-[var(--ember-border)] px-2 py-0.5 rounded text-[var(--ember-primary)] font-mono font-bold">
          {summary.totalCount} invoices
        </span>
      </div>

      <div className="flex items-center gap-6 flex-wrap">
        <div>
          <span className="text-[var(--ember-text-muted)] text-[11px] font-sans mr-1">Taxable:</span>
          <span className="font-bold text-[var(--ember-text-primary)]">
            ₹{formatINR(summary.totalTaxable)}
          </span>
        </div>

        <div>
          <span className="text-[var(--ember-text-muted)] text-[11px] font-sans mr-1">GST Tax:</span>
          <span className="font-bold text-[var(--ember-text-secondary)]">
            ₹{formatINR(summary.totalTax)}
          </span>
        </div>

        <div className="border-l border-[var(--ember-border)] pl-4">
          <span className="text-[var(--ember-text-muted)] text-[11px] font-sans mr-1">Grand Total:</span>
          <span className="font-extrabold text-[var(--ember-primary)] text-sm">
            ₹{formatINR(summary.totalValue)}
          </span>
        </div>
      </div>
    </div>
  );
};
