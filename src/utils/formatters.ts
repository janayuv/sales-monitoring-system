/**
 * Shared Formatting Utilities for UI Tables and Report Exporters
 */

/**
 * Format currency in Indian Rupees (INR) format (e.g. ₹1,25,400.50)
 */
export function formatCurrency(value: number | null | undefined): string {
  if (value === null || value === undefined || isNaN(value)) return "₹0.00";
  return `₹${value.toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

/**
 * Format numeric amount without currency symbol (e.g. 1,25,400.50)
 */
export function formatAmount(value: number | null | undefined): string {
  if (value === null || value === undefined || isNaN(value)) return "0.00";
  return value.toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

/**
 * Format numbers with commas according to Indian numbering system
 */
export function formatNumber(value: number | bigint | null | undefined): string {
  if (value === null || value === undefined) return "0";
  return Number(value).toLocaleString("en-IN");
}

/**
 * Format percentage with specified decimal places (default 2)
 */
export function formatPercent(value: number | null | undefined, decimals: number = 2): string {
  if (value === null || value === undefined || isNaN(value)) return "0.00%";
  return `${value.toFixed(decimals)}%`;
}

/**
 * Format date string (YYYY-MM-DD) into user-friendly display date (DD-MMM-YYYY)
 */
export function formatDate(dateStr: string | null | undefined): string {
  if (!dateStr) return "-";
  try {
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return dateStr;
    return d.toLocaleDateString("en-IN", {
      day: "2-digit",
      month: "short",
      year: "numeric",
    });
  } catch {
    return dateStr;
  }
}
