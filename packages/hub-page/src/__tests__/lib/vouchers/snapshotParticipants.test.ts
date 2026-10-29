/**
 * Participants of an ISSUED voucher come from its claim-time snapshot.
 *
 * Two properties matter more than the happy path:
 *
 *  - the count is the snapshot's, never the number of profiles that loaded,
 *    so an archived or renamed partner cannot quietly turn a six-merchant
 *    entitlement into a five-merchant one on the member's screen;
 *  - nothing here reads the allocation's current merchant set, because an
 *    issued voucher is judged against the merchants named when it was
 *    claimed (BDR-006 §4.2).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { snapshotParticipantIds } from "@/lib/vouchers/rulesSnapshot";

const state = vi.hoisted(() => ({
  partners: [] as Array<{ id: string; name: string; slug: string; image_url: string | null; status: string }>,
  error: null as { message: string } | null,
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: () => {
      const chain: Record<string, unknown> = {};
      chain.select = () => chain;
      chain.in = () => Promise.resolve({ data: state.partners, error: state.error });
      return chain;
    },
  }),
}));

const { resolveSnapshotParticipants } = await import("@/lib/vouchers/fundedOfferMerchants.server");

const A = { id: "11111111-1111-1111-1111-111111111111", name: "Trader A", slug: "a", image_url: null, status: "active" };
const B = { id: "22222222-2222-2222-2222-222222222222", name: "Trader B", slug: "b", image_url: null, status: "active" };

describe("snapshotParticipantIds", () => {
  it("reads the set the voucher was issued with", () => {
    expect(snapshotParticipantIds({ eligible_merchant_ids: [A.id, B.id] })).toEqual([A.id, B.id]);
  });

  it("returns none for a legacy voucher with no set", () => {
    // Callers read this as "single-merchant, use the template's partner".
    expect(snapshotParticipantIds({ title: "Old voucher" })).toEqual([]);
    expect(snapshotParticipantIds(null)).toEqual([]);
    expect(snapshotParticipantIds(undefined)).toEqual([]);
  });

  it("ignores a malformed set rather than inventing merchants", () => {
    expect(snapshotParticipantIds({ eligible_merchant_ids: "not-an-array" })).toEqual([]);
    expect(snapshotParticipantIds({ eligible_merchant_ids: [A.id, 42, "", null] })).toEqual([A.id]);
  });
});

describe("resolveSnapshotParticipants", () => {
  beforeEach(() => {
    state.partners = [A, B];
    state.error = null;
  });

  it("resolves every named merchant, in snapshot order", async () => {
    const result = await resolveSnapshotParticipants([A.id, B.id]);
    expect(result.merchants.map((m) => m.id)).toEqual([A.id, B.id]);
    expect(result.count).toBe(2);
    expect(result.incomplete).toBe(false);
  });

  it("keeps the snapshot's count when a profile is missing", async () => {
    // B has been archived out of the partners table. The member's voucher
    // still covers two merchants and must still say so.
    state.partners = [A];
    const result = await resolveSnapshotParticipants([A.id, B.id]);

    expect(result.count).toBe(2);
    expect(result.merchants).toHaveLength(1);
    expect(result.incomplete).toBe(true);
  });

  it("keeps the count even when no profile resolves at all", async () => {
    state.error = { message: "boom" };
    const result = await resolveSnapshotParticipants([A.id, B.id]);

    expect(result.count).toBe(2);
    expect(result.merchants).toEqual([]);
    expect(result.incomplete).toBe(true);
  });

  it("names an inactive merchant rather than dropping it", async () => {
    // The voucher genuinely covers them; hiding one would understate the
    // entitlement, which is the opposite of the discovery rule where an
    // unresolvable participant withholds an unclaimed offer.
    state.partners = [A, { ...B, status: "suspended" }];
    const result = await resolveSnapshotParticipants([A.id, B.id]);

    expect(result.merchants.map((m) => m.id)).toEqual([A.id, B.id]);
    expect(result.incomplete).toBe(false);
  });

  it("is a no-op for a legacy voucher", async () => {
    expect(await resolveSnapshotParticipants([])).toEqual({
      merchants: [],
      count: 0,
      incomplete: false,
    });
  });
});
