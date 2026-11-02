import type { RoleCategory } from "./types";

export const ROLE_CATEGORY_LABELS: Record<RoleCategory, string> = {
  software_technical: "Software / Technical",
  technical_support_it_ops: "Technical Support / IT Operations",
  digital_marketing: "Digital Marketing",
  sales: "Sales",
  operations_business: "Operations and Business Roles",
};

export interface RoleCategoryStyle {
  readonly bg: string;
  readonly text: string;
  readonly border: string;
  readonly dot: string;
  readonly badgeClass: string;
}

export const ROLE_CATEGORY_STYLES: Record<RoleCategory, RoleCategoryStyle> = {
  software_technical: {
    bg: "bg-violet-50",
    text: "text-violet-700",
    border: "border-violet-200/80",
    dot: "bg-violet-500",
    badgeClass: "bg-violet-50 text-violet-700 border-violet-200/80",
  },
  technical_support_it_ops: {
    bg: "bg-sky-50",
    text: "text-sky-700",
    border: "border-sky-200/80",
    dot: "bg-sky-500",
    badgeClass: "bg-sky-50 text-sky-700 border-sky-200/80",
  },
  digital_marketing: {
    bg: "bg-fuchsia-50",
    text: "text-fuchsia-700",
    border: "border-fuchsia-200/80",
    dot: "bg-fuchsia-500",
    badgeClass: "bg-fuchsia-50 text-fuchsia-700 border-fuchsia-200/80",
  },
  sales: {
    bg: "bg-amber-50",
    text: "text-amber-800",
    border: "border-amber-200/80",
    dot: "bg-amber-500",
    badgeClass: "bg-amber-50 text-amber-800 border-amber-200/80",
  },
  operations_business: {
    bg: "bg-emerald-50",
    text: "text-emerald-700",
    border: "border-emerald-200/80",
    dot: "bg-emerald-500",
    badgeClass: "bg-emerald-50 text-emerald-700 border-emerald-200/80",
  },
};

const FALLBACK_STYLE: RoleCategoryStyle = {
  bg: "bg-slate-50",
  text: "text-slate-700",
  border: "border-slate-200/80",
  dot: "bg-slate-500",
  badgeClass: "bg-slate-50 text-slate-700 border-slate-200/80",
};

export function roleCategoryLabel(category: string | null | undefined): string {
  if (!category) return "";
  return ROLE_CATEGORY_LABELS[category as RoleCategory] ?? category.replaceAll("_", " ");
}

export function roleCategoryStyle(category: string | null | undefined): RoleCategoryStyle {
  if (!category) return FALLBACK_STYLE;
  return ROLE_CATEGORY_STYLES[category as RoleCategory] ?? FALLBACK_STYLE;
}
