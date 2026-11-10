export function fundReturnPath(
  value?: string,
  fallback = "/vouchers/funds"
): string {
  if (!value?.startsWith("/") || value.startsWith("//")) return fallback;
  try {
    const u = new URL(value, "https://admin.invalid");
    return u.origin === "https://admin.invalid" &&
      u.pathname === "/vouchers/funds"
      ? u.pathname + u.search
      : fallback;
  } catch {
    return fallback;
  }
}
export function allocationQuantity(
  budgetKes: number,
  ceilingKes: number
): number {
  const budget = Math.round(budgetKes * 100),
    ceiling = Math.round(ceilingKes * 100);
  return Number.isSafeInteger(budget) &&
    Number.isSafeInteger(ceiling) &&
    budget > 0 &&
    ceiling > 0
    ? Math.floor(budget / ceiling)
    : 0;
}

export function fundDate(value: string): string {
  return new Date(value).toLocaleDateString("en-KE", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: "Africa/Nairobi",
  });
}
export function fundMoney(minor: number, currency = "KES"): string {
  return `${currency} ${new Intl.NumberFormat("en-KE", {
    minimumFractionDigits: Number(minor) % 100 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(Number(minor) / 100)}`;
}
