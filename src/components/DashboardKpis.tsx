import { useState } from "react";
import {
  TrendingUp,
  TrendingDown,
  FileWarning,
  Tag,
  Receipt,
  RotateCcw,
  LayoutGrid,
} from "lucide-react";
import { DashboardMetrics } from "../types/bindings/DashboardMetrics";
import DraggableCard, { CardLayoutConfig } from "./DraggableCard";

interface DashboardKpisProps {
  metrics: DashboardMetrics | null;
}

function formatCurrency(value: number): string {
  return `₹${value.toLocaleString("en-IN", { minimumFractionDigits: 2 })}`;
}

const STORAGE_KEY = "ember-dashboard-layout";

const DEFAULT_LAYOUT: CardLayoutConfig[] = [
  { id: "kpi_metrics", colSpan: 3 },
  { id: "gst_summary", colSpan: 1 },
  { id: "recent_activity", colSpan: 2 },
  { id: "top_customers", colSpan: 1 },
  { id: "top_suppliers", colSpan: 1 },
  { id: "top_parts", colSpan: 1 },
];

export default function DashboardKpis({ metrics }: DashboardKpisProps) {
  const growth = metrics?.comparative_growth_percent ?? 0;
  const isPositiveGrowth = growth >= 0;

  // Layout state with localStorage persistence
  const [layout, setLayout] = useState<CardLayoutConfig[]>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length > 0) return parsed;
      }
    } catch (e) {
      console.error(e);
    }
    return DEFAULT_LAYOUT;
  });

  const [draggedId, setDraggedId] = useState<string | null>(null);

  const saveLayout = (newLayout: CardLayoutConfig[]) => {
    setLayout(newLayout);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(newLayout));
    } catch (e) {
      console.error(e);
    }
  };

  const resetLayout = () => {
    saveLayout(DEFAULT_LAYOUT);
  };

  const handleColSpanChange = (id: string, newSpan: 1 | 2 | 3) => {
    const updated = layout.map((item) => (item.id === id ? { ...item, colSpan: newSpan } : item));
    saveLayout(updated);
  };

  const handleDragStart = (id: string) => {
    setDraggedId(id);
  };

  const handleDragOver = (_e: React.DragEvent, _targetId: string) => {
    // Handled visually in DraggableCard
  };

  const handleDrop = (targetId: string) => {
    if (!draggedId || draggedId === targetId) {
      setDraggedId(null);
      return;
    }

    const draggedIdx = layout.findIndex((item) => item.id === draggedId);
    const targetIdx = layout.findIndex((item) => item.id === targetId);

    if (draggedIdx !== -1 && targetIdx !== -1) {
      const newLayout = [...layout];
      const [removed] = newLayout.splice(draggedIdx, 1);
      newLayout.splice(targetIdx, 0, removed);
      saveLayout(newLayout);
    }
    setDraggedId(null);
  };

  // Render individual card by ID
  const renderCard = (item: CardLayoutConfig) => {
    switch (item.id) {
      case "kpi_metrics":
        return (
          <DraggableCard
            key={item.id}
            id={item.id}
            title="Executive Summary Metrics"
            colSpan={item.colSpan}
            onColSpanChange={handleColSpanChange}
            onDragStart={handleDragStart}
            onDragOver={handleDragOver}
            onDrop={handleDrop}
            isDragging={draggedId === item.id}
          >
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              <div className="ember-card ember-card-hover p-4 relative overflow-hidden bg-[var(--ember-surface-raised)]">
                <div className="absolute top-0 right-0 w-24 h-24 bg-[var(--ember-primary-light)] rounded-full translate-x-8 -translate-y-8 blur-xl pointer-events-none" />
                <p className="text-[10px] font-bold uppercase tracking-wider text-[var(--ember-text-muted)]">Total Sales (YTD)</p>
                <h3 className="text-xl font-bold font-serif text-[var(--ember-text-primary)] mt-1">{formatCurrency(metrics?.ytd_sales ?? 0)}</h3>
                <div className="flex items-center gap-1 text-[var(--ember-text-secondary)] text-[11px] mt-2">
                  {isPositiveGrowth ? (
                    <TrendingUp className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
                  ) : (
                    <TrendingDown className="w-3.5 h-3.5 text-rose-600 dark:text-rose-400" />
                  )}
                  <span className={`font-semibold ${isPositiveGrowth ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400"}`}>
                    {growth.toFixed(1)}% Growth
                  </span>{" "}
                  vs last year
                </div>
              </div>

              <div className="ember-card ember-card-hover p-4 relative overflow-hidden bg-[var(--ember-surface-raised)]">
                <div className="absolute top-0 right-0 w-24 h-24 bg-amber-500/10 rounded-full translate-x-8 -translate-y-8 blur-xl pointer-events-none" />
                <p className="text-[10px] font-bold uppercase tracking-wider text-[var(--ember-text-muted)]">Active Sales Invoices (FY)</p>
                <h3 className="text-xl font-bold font-serif text-[var(--ember-text-primary)] mt-1">{metrics?.active_invoices_count ?? 0}</h3>
                <div className="flex items-center gap-1 text-[var(--ember-text-secondary)] text-[11px] mt-2">
                  <FileWarning className="w-3.5 h-3.5 text-amber-500" />
                  <span className="text-amber-600 dark:text-amber-400 font-semibold">{metrics?.import_errors_count ?? 0}</span> import errors pending
                </div>
              </div>

              <div className="ember-card ember-card-hover p-4 relative overflow-hidden bg-[var(--ember-surface-raised)]">
                <div className="absolute top-0 right-0 w-24 h-24 bg-amber-500/10 rounded-full translate-x-8 -translate-y-8 blur-xl pointer-events-none" />
                <p className="text-[10px] font-bold uppercase tracking-wider text-[var(--ember-text-muted)]">Debit Notes Pending</p>
                <h3 className="text-xl font-bold font-serif text-[var(--ember-text-primary)] mt-1">{metrics?.pending_debit_notes_count ?? 0}</h3>
                <div className="flex items-center gap-1 text-[var(--ember-text-secondary)] text-[11px] mt-2">
                  <Tag className="w-3.5 h-3.5 text-amber-500" />
                  <span className="text-amber-600 dark:text-amber-400 font-semibold">awaiting approval</span>
                </div>
              </div>

              <div className="ember-card ember-card-hover p-4 relative overflow-hidden bg-[var(--ember-surface-raised)]">
                <div className="absolute top-0 right-0 w-24 h-24 bg-[var(--ember-primary-light)] rounded-full translate-x-8 -translate-y-8 blur-xl pointer-events-none" />
                <p className="text-[10px] font-bold uppercase tracking-wider text-[var(--ember-text-muted)]">Credit Notes Pending</p>
                <h3 className="text-xl font-bold font-serif text-[var(--ember-text-primary)] mt-1">{metrics?.pending_credit_notes_count ?? 0}</h3>
                <div className="flex items-center gap-1 text-[var(--ember-text-secondary)] text-[11px] mt-2">
                  <Receipt className="w-3.5 h-3.5 text-rose-500" />
                  <span className="text-rose-600 dark:text-rose-400 font-semibold">{metrics?.cancelled_invoices_count ?? 0}</span> cancelled invoices (FY)
                </div>
              </div>
            </div>
          </DraggableCard>
        );

      case "gst_summary":
        return (
          <DraggableCard
            key={item.id}
            id={item.id}
            title="GST Payable Summary (FY)"
            colSpan={item.colSpan}
            onColSpanChange={handleColSpanChange}
            onDragStart={handleDragStart}
            onDragOver={handleDragOver}
            onDrop={handleDrop}
            isDragging={draggedId === item.id}
          >
            <div className="space-y-3 text-xs flex-1 justify-between flex flex-col">
              <div className="space-y-2.5">
                <div className="flex justify-between">
                  <span className="text-[var(--ember-text-secondary)]">Taxable Value</span>
                  <span className="font-mono text-[var(--ember-text-primary)]">{formatCurrency(metrics?.gst_payable_summary.total_taxable ?? 0)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-[var(--ember-text-secondary)]">CGST</span>
                  <span className="font-mono text-[var(--ember-text-primary)]">{formatCurrency(metrics?.gst_payable_summary.total_cgst ?? 0)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-[var(--ember-text-secondary)]">SGST</span>
                  <span className="font-mono text-[var(--ember-text-primary)]">{formatCurrency(metrics?.gst_payable_summary.total_sgst ?? 0)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-[var(--ember-text-secondary)]">IGST</span>
                  <span className="font-mono text-[var(--ember-text-primary)]">{formatCurrency(metrics?.gst_payable_summary.total_igst ?? 0)}</span>
                </div>
              </div>
              <div className="flex justify-between border-t border-[var(--ember-border)] pt-3 font-bold">
                <span className="text-[var(--ember-text-primary)]">Total Gross Liability</span>
                <span className="font-mono text-[var(--ember-primary)]">{formatCurrency(metrics?.gst_payable_summary.total_gross ?? 0)}</span>
              </div>
            </div>
          </DraggableCard>
        );

      case "recent_activity":
        return (
          <DraggableCard
            key={item.id}
            id={item.id}
            title="Recent System Activity Log"
            colSpan={item.colSpan}
            onColSpanChange={handleColSpanChange}
            onDragStart={handleDragStart}
            onDragOver={handleDragOver}
            onDrop={handleDrop}
            isDragging={draggedId === item.id}
          >
            {!metrics || metrics.recent_activity.length === 0 ? (
              <p className="text-xs text-[var(--ember-text-muted)] text-center py-8">No recent activity recorded.</p>
            ) : (
              <div className="space-y-2 max-h-60 overflow-y-auto pr-1">
                {metrics.recent_activity.map((entry, idx) => (
                  <div key={idx} className="text-[11px] text-[var(--ember-text-secondary)] border-b border-[var(--ember-border-subtle)] pb-2 font-mono">
                    {entry}
                  </div>
                ))}
              </div>
            )}
          </DraggableCard>
        );

      case "top_customers":
        return (
          <DraggableCard
            key={item.id}
            id={item.id}
            title="Top Customers Revenue (FY)"
            colSpan={item.colSpan}
            onColSpanChange={handleColSpanChange}
            onDragStart={handleDragStart}
            onDragOver={handleDragOver}
            onDrop={handleDrop}
            isDragging={draggedId === item.id}
          >
            {(!metrics || metrics.top_10_customers.length === 0) ? (
              <p className="text-xs text-[var(--ember-text-muted)] text-center py-6">No customer data for active FY.</p>
            ) : (
              <div className="space-y-2 text-xs">
                {metrics.top_10_customers.slice(0, 8).map(([name, value], idx) => (
                  <div key={idx} className="flex justify-between items-center">
                    <span className="text-[var(--ember-text-secondary)] truncate max-w-[60%]">{name}</span>
                    <span className="font-mono text-[var(--ember-text-primary)] font-semibold">{formatCurrency(value)}</span>
                  </div>
                ))}
              </div>
            )}
          </DraggableCard>
        );

      case "top_suppliers":
        return (
          <DraggableCard
            key={item.id}
            id={item.id}
            title="Top Suppliers (FY)"
            colSpan={item.colSpan}
            onColSpanChange={handleColSpanChange}
            onDragStart={handleDragStart}
            onDragOver={handleDragOver}
            onDrop={handleDrop}
            isDragging={draggedId === item.id}
          >
            {(!metrics || metrics.top_10_suppliers.length === 0) ? (
              <p className="text-xs text-[var(--ember-text-muted)] text-center py-6">No supplier data for active FY.</p>
            ) : (
              <div className="space-y-2 text-xs">
                {metrics.top_10_suppliers.slice(0, 8).map(([name, value], idx) => (
                  <div key={idx} className="flex justify-between items-center">
                    <span className="text-[var(--ember-text-secondary)] truncate max-w-[60%]">{name}</span>
                    <span className="font-mono text-[var(--ember-text-primary)] font-semibold">{formatCurrency(value)}</span>
                  </div>
                ))}
              </div>
            )}
          </DraggableCard>
        );

      case "top_parts":
        return (
          <DraggableCard
            key={item.id}
            id={item.id}
            title="Top Part Numbers Matrix (FY)"
            colSpan={item.colSpan}
            onColSpanChange={handleColSpanChange}
            onDragStart={handleDragStart}
            onDragOver={handleDragOver}
            onDrop={handleDrop}
            isDragging={draggedId === item.id}
          >
            {(!metrics || metrics.top_20_parts.length === 0) ? (
              <p className="text-xs text-[var(--ember-text-muted)] text-center py-6">No part sales data for active FY.</p>
            ) : (
              <div className="space-y-2 text-xs">
                {metrics.top_20_parts.slice(0, 8).map(([name, value], idx) => (
                  <div key={idx} className="flex justify-between items-center">
                    <span className="text-[var(--ember-text-secondary)] truncate max-w-[60%] font-mono">{name}</span>
                    <span className="font-mono text-[var(--ember-text-primary)] font-semibold">{formatCurrency(value)}</span>
                  </div>
                ))}
              </div>
            )}
          </DraggableCard>
        );

      default:
        return null;
    }
  };

  return (
    <div className="space-y-4">
      {/* Dashboard Customization Header Bar */}
      <div className="flex items-center justify-between text-xs px-1">
        <div className="flex items-center gap-2 text-[var(--ember-text-secondary)]">
          <LayoutGrid className="w-4 h-4 text-[var(--ember-primary)]" />
          <span className="font-semibold text-[var(--ember-text-primary)]">Customizable Dashboard Grid</span>
          <span className="text-[10px] text-[var(--ember-text-muted)] italic">
            (Drag handle to reorder blocks • Click 1x/2x/Full to resize)
          </span>
        </div>

        <button
          onClick={resetLayout}
          className="ember-btn-secondary px-3 py-1.5 text-xs flex items-center gap-1.5 cursor-pointer"
          title="Restore default dashboard arrangement"
        >
          <RotateCcw className="w-3.5 h-3.5" /> Reset Layout
        </button>
      </div>

      {/* Dynamic Draggable Grid Container */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {layout.map((item) => renderCard(item))}
      </div>
    </div>
  );
}
