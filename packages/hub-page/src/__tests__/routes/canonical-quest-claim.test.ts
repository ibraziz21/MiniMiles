import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  user: { id: "hub-user-1", email: "member@example.com" } as { id: string; email: string | null } | null,
  claimResult: { ok: true, state: "completed", points: 20, mode: "offchain_ledger" } as any,
  lastClaim: null as any,
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ auth: { getUser: async () => ({ data: { user: state.user } }) } }),
}));

vi.mock("@/lib/akiba/hubQuestRollout", () => ({ isHubQuestsEnabledFor: () => true }));
vi.mock("@/lib/rateLimit", () => ({ checkAllRateLimits: async () => true }));
vi.mock("@/lib/akiba/questCatalog", () => ({
  getQuestCatalogEntry: (key: string) => key === "pass_activated" ? { key } : undefined,
}));
vi.mock("@/lib/akiba/canonicalPartnerQuests", () => ({
  claimHubCanonicalQuest: async (input: any) => {
    state.lastClaim = input;
    return state.claimResult;
  },
}));

function request(body: unknown) {
  return new Request("http://localhost/api/quests/claim", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/quests/claim canonical contract", () => {
  beforeEach(() => {
    state.user = { id: "hub-user-1", email: "member@example.com" };
    state.claimResult = { ok: true, state: "completed", points: 20, mode: "offchain_ledger" };
    state.lastClaim = null;
  });

  it("claims by semantic quest key for an authenticated walletless Hub account", async () => {
    const { POST } = await import("@/app/api/quests/claim/route");
    const response = await POST(request({ questKey: "pass_activated" }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(expect.objectContaining({ state: "completed", mode: "offchain_ledger" }));
    expect(state.lastClaim).toEqual({ hubUserId: "hub-user-1", email: "member@example.com", questKey: "pass_activated" });
  });

  it("does not accept a reward id or unknown client-selected quest", async () => {
    const { POST } = await import("@/app/api/quests/claim/route");
    const response = await POST(request({ rewardId: "platform-reward" }));
    expect(response.status).toBe(400);
    expect(state.lastClaim).toBeNull();
  });

  it("returns a conflict when first-party evidence is missing", async () => {
    state.claimResult = { ok: false, code: "not-eligible", reason: "pass-not-activated" };
    const { POST } = await import("@/app/api/quests/claim/route");
    const response = await POST(request({ questKey: "pass_activated" }));
    expect(response.status).toBe(409);
  });
});
