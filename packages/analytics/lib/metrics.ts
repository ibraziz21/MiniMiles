export type MintJobReasonCategory =
  | "Daily Quest"
  | "Partner Quest"
  | "Streak"
  | "Profile Milestone"
  | "Prosperity Pass"
  | "Raffle"
  | "Game"
  | "Other";

export function dayKey(value: string | Date): string {
  const date = value instanceof Date ? value : new Date(value);
  return date.toISOString().split("T")[0];
}

export function isDailyQuestReason(reason: string | null | undefined): boolean {
  if (!reason) return false;
  return (
    reason.startsWith("daily-engagement:") ||
    reason.startsWith("daily-transfer:") ||
    reason.startsWith("daily-receive:") ||
    reason.startsWith("daily-5tx:") ||
    reason.startsWith("daily-10tx:") ||
    reason.startsWith("daily-20tx:") ||
    reason === "kiln-daily-hold"
  );
}

export function isStreakReason(reason: string | null | undefined): boolean {
  if (!reason) return false;
  return reason.startsWith("streak:") || reason.startsWith("seven-day-streak:");
}

export function isPartnerQuestReason(reason: string | null | undefined): boolean {
  if (!reason) return false;
  return reason.startsWith("partner-quest:") || reason === "username-quest";
}

export function mintReasonCategory(
  reason: string | null | undefined
): MintJobReasonCategory {
  if (!reason) return "Other";
  if (isDailyQuestReason(reason)) return "Daily Quest";
  if (isPartnerQuestReason(reason)) return "Partner Quest";
  if (isStreakReason(reason)) return "Streak";
  if (reason.startsWith("profile-milestone")) return "Profile Milestone";
  if (reason.includes("prosperity")) return "Prosperity Pass";
  if (reason.includes("raffle")) return "Raffle";
  if (reason.includes("dice") || reason.includes("game")) return "Game";
  return "Other";
}

export function resolveStreakName(reason: string): string {
  if (reason.startsWith("seven-day-streak:")) {
    return "7-Day Streak";
  }

  const key = reason.replace("streak:", "");

  if (key === "games-streak") return "Games Streak";
  if (key === "topup-streak") return "Top-up Streak";
  if (key === "wallet-10-streak") return "Balance $10 Streak";
  if (key === "wallet-30-streak") return "Balance $30 Streak";
  if (key === "wallet-100-streak") return "Balance $100 Streak";

  return key
    .split("-")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}
