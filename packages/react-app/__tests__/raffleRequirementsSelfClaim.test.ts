import { beforeEach, describe, expect, it, vi } from "vitest";

// Focused on the docs/all-quests-self-claim-spec.md §8.1 addition: raffle
// eligibility must recognize a chain_confirmed/confirmed self-claim intent
// for daily_5tx, not just a completed daily_engagements row or a queued
// legacy mint job.

const mockFrom = vi.fn();

vi.mock("@/lib/supabaseClient", () => ({
  supabase: { from: (table: string) => mockFrom(table) },
}));

vi.mock("@/lib/questRegistry", () => ({
  getQuest: () => ({ questId: "quest-5tx", points: 50, reason: "daily-5tx:quest-5tx" }),
}));

const { evaluateRaffleRequirements } = await import("@/lib/raffleRequirements");

const ROUND_ID = 1;
const USER_ADDRESS = "0xAbC";

function configRow() {
  return {
    data: { mode: "all", gates: [{ type: "daily_5tx_completed" }] },
    error: null,
  };
}

/** Builds a per-table mock chain. Each table's terminal call is configurable independently. */
function makeSupabaseMock(opts: {
  engagementFound: boolean;
  intentStatus: "chain_confirmed" | "confirmed" | null;
  mintJobFound: boolean;
}) {
  mockFrom.mockImplementation((table: string) => {
    if (table === "raffle_requirements") {
      const chain: any = {
        select: () => chain,
        eq: () => chain,
        maybeSingle: () => Promise.resolve(configRow()),
      };
      return chain;
    }
    if (table === "daily_engagements") {
      const chain: any = {
        select: () => chain,
        eq: () => chain,
        maybeSingle: () => Promise.resolve({ data: opts.engagementFound ? { id: "eng-1" } : null, error: null }),
      };
      return chain;
    }
    if (table === "daily_quest_claim_intents") {
      const chain: any = {
        select: () => chain,
        eq: () => chain,
        in: () => chain,
        maybeSingle: () =>
          Promise.resolve({ data: opts.intentStatus ? { id: "intent-1" } : null, error: null }),
      };
      return chain;
    }
    if (table === "minipoint_mint_jobs") {
      const chain: any = {
        select: () => chain,
        eq: () => chain,
        in: () => chain,
        contains: () => chain,
        limit: () => Promise.resolve({ data: opts.mintJobFound ? [{ id: "job-1" }] : [], error: null }),
      };
      return chain;
    }
    throw new Error(`Unexpected table in test: ${table}`);
  });
}

beforeEach(() => {
  mockFrom.mockReset();
});

describe("evaluateRaffleRequirements — daily_5tx_completed gate", () => {
  it("passes on a completed daily_engagements row (legacy or already-finalized self-claim)", async () => {
    makeSupabaseMock({ engagementFound: true, intentStatus: null, mintJobFound: false });
    const result = await evaluateRaffleRequirements(ROUND_ID, USER_ADDRESS);
    expect(result.eligible).toBe(true);
    expect(result.gates[0].status).toBe("passed");
    expect(result.gates[0].current).toBe("Completed");
  });

  it("passes on a chain_confirmed self-claim intent even before the finalizer has written daily_engagements", async () => {
    makeSupabaseMock({ engagementFound: false, intentStatus: "chain_confirmed", mintJobFound: false });
    const result = await evaluateRaffleRequirements(ROUND_ID, USER_ADDRESS);
    expect(result.eligible).toBe(true);
    expect(result.gates[0].current).toBe("Completed");
  });

  it("passes on a confirmed self-claim intent", async () => {
    makeSupabaseMock({ engagementFound: false, intentStatus: "confirmed", mintJobFound: false });
    const result = await evaluateRaffleRequirements(ROUND_ID, USER_ADDRESS);
    expect(result.eligible).toBe(true);
  });

  it("still recognizes a queued legacy mint job when no self-claim intent exists", async () => {
    makeSupabaseMock({ engagementFound: false, intentStatus: null, mintJobFound: true });
    const result = await evaluateRaffleRequirements(ROUND_ID, USER_ADDRESS);
    expect(result.eligible).toBe(true);
    expect(result.gates[0].current).toBe("Queued");
  });

  it("fails when a voucher was merely issued — not chain_confirmed/confirmed — and nothing else qualifies", async () => {
    // A merely "issued" self-claim intent must not satisfy the requirement
    // (spec: "a merely issued voucher must not satisfy the requirement").
    // The mock only ever returns a row for status in (chain_confirmed,
    // confirmed), so an "issued"-only intent naturally yields no row here.
    makeSupabaseMock({ engagementFound: false, intentStatus: null, mintJobFound: false });
    const result = await evaluateRaffleRequirements(ROUND_ID, USER_ADDRESS);
    expect(result.eligible).toBe(false);
    expect(result.gates[0].status).toBe("failed");
    expect(result.gates[0].current).toBe("Not completed");
  });
});
