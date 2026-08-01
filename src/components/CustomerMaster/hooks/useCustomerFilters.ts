import { useState, useEffect, useMemo } from "react";
import { CustomerFiltersState, INITIAL_CUSTOMER_FILTERS } from "../metadata/customerFilters";
import { SEARCH_DEBOUNCE_MS } from "../../Table/constants";

export function useCustomerFilters() {
  const [filters, setFilters] = useState<CustomerFiltersState>(INITIAL_CUSTOMER_FILTERS);
  const [debouncedSearch, setDebouncedSearch] = useState("");

  // Debounce search input
  useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedSearch(filters.searchQuery.trim().toLowerCase());
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(handler);
  }, [filters.searchQuery]);

  const resetFilters = () => setFilters(INITIAL_CUSTOMER_FILTERS);

  const activeFilterCount = useMemo(() => {
    let count = 0;
    if (filters.searchQuery.trim() !== "") count++;
    if (filters.matchStatus !== "All") count++;
    if (filters.categoryName !== "All") count++;
    if (filters.approvalStatus !== "All") count++;
    if (filters.location !== "All") count++;
    return count;
  }, [filters]);

  return {
    filters,
    setFilters,
    debouncedSearch,
    resetFilters,
    activeFilterCount,
  };
}
