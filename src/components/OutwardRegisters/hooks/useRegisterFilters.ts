import { useState, useMemo } from "react";
import { InvoiceSummary } from "../../../types";
import { TableFilters, StatusType, DateRangeFilter } from "../types/register";

const INITIAL_FILTERS: TableFilters = {
  searchQuery: "",
  statusFilter: "ALL",
  customerFilter: "ALL",
  dateRange: {
    from: "",
    to: "",
    preset: "all",
  },
  valueRange: {
    min: null,
    max: null,
  },
};

export function useRegisterFilters(invoices: InvoiceSummary[]) {
  const [filters, setFilters] = useState<TableFilters>(INITIAL_FILTERS);

  // Extract unique customers list for dropdown
  const uniqueCustomers = useMemo(() => {
    const map = new Map<string, string>();
    invoices.forEach((inv) => {
      if (inv.customer_code && inv.customer_name) {
        map.set(inv.customer_code, inv.customer_name);
      }
    });
    return Array.from(map.entries()).map(([code, name]) => ({ code, name }));
  }, [invoices]);

  const filteredInvoices = useMemo(() => {
    return invoices.filter((inv) => {
      // 1. Search Query Filter (Invoice No, Customer Name, Customer Code)
      if (filters.searchQuery.trim() !== "") {
        const q = filters.searchQuery.toLowerCase();
        const matchesInvoice = inv.invoice_number.toLowerCase().includes(q);
        const matchesName = inv.customer_name.toLowerCase().includes(q);
        const matchesCode = inv.customer_code.toLowerCase().includes(q);
        if (!matchesInvoice && !matchesName && !matchesCode) {
          return false;
        }
      }

      // 2. Status Filter
      if (filters.statusFilter !== "ALL") {
        if (inv.status.toUpperCase() !== filters.statusFilter.toUpperCase()) {
          return false;
        }
      }

      // 3. Customer Filter
      if (filters.customerFilter !== "ALL") {
        if (inv.customer_code !== filters.customerFilter) {
          return false;
        }
      }

      // 4. Date Range Filter
      if (filters.dateRange.from) {
        if (inv.invoice_date < filters.dateRange.from) return false;
      }
      if (filters.dateRange.to) {
        if (inv.invoice_date > filters.dateRange.to) return false;
      }

      // 5. Value Range Filter
      if (filters.valueRange.min !== null) {
        if (inv.total_value < filters.valueRange.min) return false;
      }
      if (filters.valueRange.max !== null) {
        if (inv.total_value > filters.valueRange.max) return false;
      }

      return true;
    });
  }, [invoices, filters]);

  const setSearchQuery = (query: string) => {
    setFilters((prev) => ({ ...prev, searchQuery: query }));
  };

  const setStatusFilter = (status: StatusType) => {
    setFilters((prev) => ({ ...prev, statusFilter: status }));
  };

  const setCustomerFilter = (customerCode: string) => {
    setFilters((prev) => ({ ...prev, customerFilter: customerCode }));
  };

  const setDateRange = (range: Partial<DateRangeFilter>) => {
    setFilters((prev) => ({
      ...prev,
      dateRange: { ...prev.dateRange, ...range },
    }));
  };

  const setMinMaxValue = (min: number | null, max: number | null) => {
    setFilters((prev) => ({
      ...prev,
      valueRange: { min, max },
    }));
  };

  const resetFilters = () => {
    setFilters(INITIAL_FILTERS);
  };

  const applyPresetViewFilters = (newFilters: TableFilters) => {
    setFilters(newFilters);
  };

  return {
    filters,
    filteredInvoices,
    uniqueCustomers,
    setSearchQuery,
    setStatusFilter,
    setCustomerFilter,
    setDateRange,
    setMinMaxValue,
    resetFilters,
    applyPresetViewFilters,
  };
}
