import { useMemo } from "react";
import { InvoiceSummary } from "../../../types";
import { TableSummary, KpiMetrics, StatusType } from "../types/register";

export function useRegisterSummary(
  allInvoices: InvoiceSummary[],
  filteredInvoices: InvoiceSummary[]
) {
  // Live summary for currently filtered dataset
  const filteredSummary = useMemo<TableSummary>(() => {
    return filteredInvoices.reduce(
      (acc, inv) => {
        acc.totalCount += 1;
        acc.totalTaxable += inv.total_taxable || 0;
        acc.totalTax += inv.total_tax || 0;
        acc.totalValue += inv.total_value || 0;
        return acc;
      },
      { totalCount: 0, totalTaxable: 0, totalTax: 0, totalValue: 0 }
    );
  }, [filteredInvoices]);

  // KPI Card Breakdown for all invoices in current dataset
  const kpiMetrics = useMemo<KpiMetrics[]>(() => {
    const map: Record<StatusType, { count: number; totalValue: number }> = {
      ALL: { count: allInvoices.length, totalValue: 0 },
      Verified: { count: 0, totalValue: 0 },
      Imported: { count: 0, totalValue: 0 },
      Draft: { count: 0, totalValue: 0 },
      Cancelled: { count: 0, totalValue: 0 },
      "Credit Note Generated": { count: 0, totalValue: 0 },
    };

    allInvoices.forEach((inv) => {
      map.ALL.totalValue += inv.total_value || 0;
      const status = inv.status as StatusType;
      if (map[status]) {
        map[status].count += 1;
        map[status].totalValue += inv.total_value || 0;
      }
    });

    return [
      {
        status: "ALL",
        count: map.ALL.count,
        totalValue: map.ALL.totalValue,
        label: "Total Register",
        color: "slate",
      },
      {
        status: "Verified",
        count: map.Verified.count,
        totalValue: map.Verified.totalValue,
        label: "Verified",
        color: "emerald",
      },
      {
        status: "Imported",
        count: map.Imported.count,
        totalValue: map.Imported.totalValue,
        label: "Imported",
        color: "amber",
      },
      {
        status: "Draft",
        count: map.Draft.count,
        totalValue: map.Draft.totalValue,
        label: "Draft",
        color: "sky",
      },
      {
        status: "Cancelled",
        count: map.Cancelled.count,
        totalValue: map.Cancelled.totalValue,
        label: "Cancelled",
        color: "rose",
      },
      {
        status: "Credit Note Generated",
        count: map["Credit Note Generated"].count,
        totalValue: map["Credit Note Generated"].totalValue,
        label: "Credit Notes",
        color: "purple",
      },
    ];
  }, [allInvoices]);

  return {
    filteredSummary,
    kpiMetrics,
  };
}
