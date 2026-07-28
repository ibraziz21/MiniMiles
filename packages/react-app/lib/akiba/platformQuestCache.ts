// 60s-per-wallet cache for the Platform quest-status BFF (discovery-quests-
// spec.md §5.1). No existing cache pattern to reuse in this app — routes
// generally set Cache-Control: no-store instead. In-memory per-instance
// cache is a deliberately modest scope here: it just spares a burst of
// re-renders/polling from re-doing the (list quests × N completions × N
// rewards) fan-out on every request; it is NOT a substitute for the claim
// route's own invalidation call after a successful claim.
export type PlatformQuestStatus = "locked" | "pending" | "claimable" | "claimed";

export type PlatformQuestDto = {
  questId: string;
  name: string;
  description: string | null;
  rewardAmount: number;
  frequency: string;
  status: PlatformQuestStatus;
  rewardId: string | null;
};

const TTL_MS = 60_000;
const cache = new Map<string, { expiresAt: number; quests: PlatformQuestDto[] }>();

export function getCachedQuests(wallet: string): PlatformQuestDto[] | null {
  const entry = cache.get(wallet.toLowerCase());
  if (!entry || entry.expiresAt < Date.now()) return null;
  return entry.quests;
}

export function setCachedQuests(wallet: string, quests: PlatformQuestDto[]): void {
  cache.set(wallet.toLowerCase(), { expiresAt: Date.now() + TTL_MS, quests });
}

export function invalidateCachedQuests(wallet: string): void {
  cache.delete(wallet.toLowerCase());
}
