import { KpiMetrics, StatusType } from "../types/register";
import { formatCompactINR } from "../utils/formatCurrency";
import { CheckCircle2, Clock, FileEdit, AlertCircle, RefreshCw, Layers } from "lucide-react";

interface Props {
  metrics: KpiMetrics[];
  activeStatus: StatusType;
  onSelectStatus: (status: StatusType) => void;
}

export const RegisterKpiCards: React.FC<Props> = ({
  metrics,
  activeStatus,
  onSelectStatus,
}) => {
  const getIcon = (status: StatusType) => {
    switch (status) {
      case "ALL":
        return <Layers className="w-4 h-4 text-slate-400" />;
      case "Verified":
        return <CheckCircle2 className="w-4 h-4 text-emerald-500" />;
      case "Imported":
        return <Clock className="w-4 h-4 text-amber-500" />;
      case "Draft":
        return <FileEdit className="w-4 h-4 text-sky-500" />;
      case "Cancelled":
        return <AlertCircle className="w-4 h-4 text-rose-500" />;
      case "Credit Note Generated":
        return <RefreshCw className="w-4 h-4 text-purple-500" />;
    }
  };

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 select-none">
      {metrics.map((item) => {
        const isActive = activeStatus === item.status;

        return (
          <div
            key={item.status}
            onClick={() => onSelectStatus(item.status)}
            className={`p-3 rounded-xl border transition-all cursor-pointer relative overflow-hidden group ${
              isActive
                ? "bg-[var(--ember-surface-raised)] border-[var(--ember-primary)] shadow-md ring-1 ring-[var(--ember-primary)]/40"
                : "ember-card hover:border-[var(--ember-border)] hover:bg-[var(--ember-surface-raised)]/60"
            }`}
          >
            <div className="flex items-center justify-between gap-1 mb-1">
              <span className="text-[11px] font-semibold text-[var(--ember-text-secondary)] tracking-wide">
                {item.label}
              </span>
              <div className="p-1 rounded-md bg-[var(--ember-surface)] border border-[var(--ember-border)]">
                {getIcon(item.status)}
              </div>
            </div>

            <div className="mt-1 flex items-baseline justify-between gap-1">
              <span className="text-base font-bold font-mono text-[var(--ember-text-primary)]">
                {item.count}
                <span className="text-[10px] text-[var(--ember-text-muted)] font-sans ml-1 font-normal">inv</span>
              </span>
              <span className="text-xs font-semibold font-mono text-[var(--ember-primary)]">
                {formatCompactINR(item.totalValue)}
              </span>
            </div>

            {/* Active Indicator Line */}
            {isActive && (
              <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-[var(--ember-primary)]" />
            )}
          </div>
        );
      })}
    </div>
  );
};
