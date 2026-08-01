import React from "react";
import { Users, CheckCircle, AlertTriangle, XCircle } from "lucide-react";

interface CustomerKpiCardsProps {
  metrics: {
    total: number;
    complete: number;
    incomplete: number;
    unmapped: number;
  };
  activeMatchStatus: string;
  onSelectMatchStatus: (status: string) => void;
}

export const CustomerKpiCards: React.FC<CustomerKpiCardsProps> = ({
  metrics,
  activeMatchStatus,
  onSelectMatchStatus,
}) => {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4">
      {/* 1. Total Customers */}
      <div
        onClick={() => onSelectMatchStatus("All")}
        className={`ember-card p-4 flex items-center justify-between cursor-pointer transition-all ${
          activeMatchStatus === "All"
            ? "ring-2 ring-[var(--ember-primary)] bg-[var(--ember-surface-raised)]"
            : "hover:bg-[var(--ember-surface-raised)]"
        }`}
      >
        <div>
          <span className="text-[10px] uppercase font-bold text-[var(--ember-text-muted)] tracking-wider">
            Total Customer Records
          </span>
          <h3 className="text-xl font-bold font-serif text-[var(--ember-text-primary)] mt-0.5">
            {metrics.total}
          </h3>
        </div>
        <div className="p-2.5 bg-[var(--ember-primary-light)] text-[var(--ember-primary)] rounded-xl">
          <Users className="w-5 h-5" />
        </div>
      </div>

      {/* 2. Verified Matches (Complete) */}
      <div
        onClick={() => onSelectMatchStatus(activeMatchStatus === "Complete" ? "All" : "Complete")}
        className={`ember-card p-4 flex items-center justify-between cursor-pointer transition-all ${
          activeMatchStatus === "Complete"
            ? "ring-2 ring-emerald-500 bg-emerald-500/10"
            : "hover:bg-[var(--ember-surface-raised)]"
        }`}
      >
        <div>
          <span className="text-[10px] uppercase font-bold text-[var(--ember-text-muted)] tracking-wider">
            Verified Matches
          </span>
          <h3 className="text-xl font-bold font-serif text-emerald-600 dark:text-emerald-400 mt-0.5">
            {metrics.complete}
          </h3>
        </div>
        <div className="p-2.5 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 rounded-xl">
          <CheckCircle className="w-5 h-5" />
        </div>
      </div>

      {/* 3. Incomplete Mappings */}
      <div
        onClick={() => onSelectMatchStatus(activeMatchStatus === "Incomplete" ? "All" : "Incomplete")}
        className={`ember-card p-4 flex items-center justify-between cursor-pointer transition-all ${
          activeMatchStatus === "Incomplete"
            ? "ring-2 ring-amber-500 bg-amber-500/10"
            : "hover:bg-[var(--ember-surface-raised)]"
        }`}
      >
        <div>
          <span className="text-[10px] uppercase font-bold text-[var(--ember-text-muted)] tracking-wider">
            Incomplete Mapping
          </span>
          <h3 className="text-xl font-bold font-serif text-amber-600 dark:text-amber-400 mt-0.5">
            {metrics.incomplete}
          </h3>
        </div>
        <div className="p-2.5 bg-amber-500/10 text-amber-600 dark:text-amber-400 rounded-xl">
          <AlertTriangle className="w-5 h-5" />
        </div>
      </div>

      {/* 4. Unmapped Accounts */}
      <div
        onClick={() => onSelectMatchStatus(activeMatchStatus === "Unmapped" ? "All" : "Unmapped")}
        className={`ember-card p-4 flex items-center justify-between cursor-pointer transition-all ${
          activeMatchStatus === "Unmapped"
            ? "ring-2 ring-rose-500 bg-rose-500/10"
            : "hover:bg-[var(--ember-surface-raised)]"
        }`}
      >
        <div>
          <span className="text-[10px] uppercase font-bold text-[var(--ember-text-muted)] tracking-wider">
            Unmapped Accounts
          </span>
          <h3 className="text-xl font-bold font-serif text-rose-600 dark:text-rose-400 mt-0.5">
            {metrics.unmapped}
          </h3>
        </div>
        <div className="p-2.5 bg-rose-500/10 text-rose-600 dark:text-rose-400 rounded-xl">
          <XCircle className="w-5 h-5" />
        </div>
      </div>
    </div>
  );
};
