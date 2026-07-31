import { StatusType } from "../types/register";

export interface StatusStyle {
  label: string;
  bgClass: string;
  textClass: string;
  borderClass: string;
  dotColor: string;
  badgeClass: string;
}

export const STATUS_STYLES: Record<StatusType, StatusStyle> = {
  ALL: {
    label: "All Invoices",
    bgClass: "bg-slate-500/10",
    textClass: "text-slate-700 dark:text-slate-300",
    borderClass: "border-slate-500/30",
    dotColor: "bg-slate-500",
    badgeClass: "bg-slate-500/15 text-slate-700 dark:text-slate-300 border border-slate-500/30",
  },
  Verified: {
    label: "Verified",
    bgClass: "bg-emerald-500/10",
    textClass: "text-emerald-700 dark:text-emerald-300",
    borderClass: "border-emerald-500/30",
    dotColor: "bg-emerald-500",
    badgeClass: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border border-emerald-500/30",
  },
  Imported: {
    label: "Imported",
    bgClass: "bg-amber-500/10",
    textClass: "text-amber-700 dark:text-amber-300",
    borderClass: "border-amber-500/30",
    dotColor: "bg-amber-500",
    badgeClass: "bg-amber-500/15 text-amber-700 dark:text-amber-300 border border-amber-500/30",
  },
  Draft: {
    label: "Draft",
    bgClass: "bg-sky-500/10",
    textClass: "text-sky-700 dark:text-sky-300",
    borderClass: "border-sky-500/30",
    dotColor: "bg-sky-500",
    badgeClass: "bg-sky-500/15 text-sky-700 dark:text-sky-300 border border-sky-500/30",
  },
  Cancelled: {
    label: "Cancelled",
    bgClass: "bg-rose-500/10",
    textClass: "text-rose-700 dark:text-rose-300",
    borderClass: "border-rose-500/30",
    dotColor: "bg-rose-500",
    badgeClass: "bg-rose-500/15 text-rose-700 dark:text-rose-300 border border-rose-500/30",
  },
  "Credit Note Generated": {
    label: "Credit Note",
    bgClass: "bg-purple-500/10",
    textClass: "text-purple-700 dark:text-purple-300",
    borderClass: "border-purple-500/30",
    dotColor: "bg-purple-500",
    badgeClass: "bg-purple-500/15 text-purple-700 dark:text-purple-300 border border-purple-500/30",
  },
};
