import { useState, useMemo } from "react";
import { InvoiceSummary } from "../../../types";
import { SortConfig } from "../types/register";

export function useRegisterSorting(
  invoices: InvoiceSummary[],
  initialSortConfig?: SortConfig
) {
  const [sortConfig, setSortConfig] = useState<SortConfig>(
    initialSortConfig || { column: "invoice_date", direction: "desc" }
  );

  const sortedInvoices = useMemo(() => {
    if (!sortConfig.column || !sortConfig.direction) {
      return invoices;
    }

    const col = sortConfig.column;
    const isAsc = sortConfig.direction === "asc";

    return [...invoices].sort((a, b) => {
      const valA = a[col];
      const valB = b[col];

      if (typeof valA === "number" && typeof valB === "number") {
        return isAsc ? valA - valB : valB - valA;
      }

      const strA = String(valA ?? "").toLowerCase();
      const strB = String(valB ?? "").toLowerCase();

      if (strA < strB) return isAsc ? -1 : 1;
      if (strA > strB) return isAsc ? 1 : -1;
      return 0;
    });
  }, [invoices, sortConfig]);

  const handleSort = (columnKey: keyof InvoiceSummary) => {
    setSortConfig((prev) => {
      if (prev.column !== columnKey) {
        return { column: columnKey, direction: "desc" };
      }
      if (prev.direction === "desc") {
        return { column: columnKey, direction: "asc" };
      }
      if (prev.direction === "asc") {
        return { column: "invoice_date", direction: "desc" };
      }
      return { column: columnKey, direction: "desc" };
    });
  };

  return {
    sortConfig,
    sortedInvoices,
    handleSort,
    setSortConfig,
  };
}
