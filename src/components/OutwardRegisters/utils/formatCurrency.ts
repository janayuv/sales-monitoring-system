/**
 * Formats a numeric value to Indian Currency Format (en-IN)
 * e.g., 29002691.74 => "2,90,02,691.74"
 */
export function formatINR(val: number | null | undefined, decimals = 2): string {
  if (val === null || val === undefined || isNaN(val)) return "0.00";
  return val.toLocaleString("en-IN", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

/**
 * Compact Indian Currency formatter for KPI cards
 * e.g., 24578552 => "₹2.46 Cr", 150000 => "₹1.50 Lakh"
 */
export function formatCompactINR(val: number): string {
  if (!val || val === 0) return "₹0.00";
  if (val >= 10000000) {
    return `₹${(val / 10000000).toFixed(2)} Cr`;
  }
  if (val >= 100000) {
    return `₹${(val / 100000).toFixed(2)} Lakh`;
  }
  return `₹${formatINR(val, 0)}`;
}
