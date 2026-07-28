/**
 * Unit tests for buildIdentities — discovery-quests-spec.md §2's
 * `identities: [{type,value}]` builder. Every hub-emitted event needs every
 * identity known at emission time so Platform can match an email-first or
 * wallet-first quest participant.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

let mockWallets: string[] = [];
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: () => ({
      select: () => ({
        eq: async () => ({ data: mockWallets.map((address) => ({ address })), error: null }),
      }),
    }),
  }),
}));

const { buildIdentities } = await import("@/lib/akiba/identities");

beforeEach(() => {
  mockWallets = [];
});

describe("buildIdentities", () => {
  it("includes email when present", async () => {
    const identities = await buildIdentities({ userId: "u1", email: "a@b.com" });
    expect(identities).toEqual([{ type: "email", value: "a@b.com" }]);
  });

  it("omits email when null", async () => {
    const identities = await buildIdentities({ userId: "u1", email: null });
    expect(identities).toEqual([]);
  });

  it("appends every linked wallet after email, lowercased", async () => {
    mockWallets = ["0xAAA", "0xbbb"];
    const identities = await buildIdentities({ userId: "u1", email: "a@b.com" });
    expect(identities).toEqual([
      { type: "email", value: "a@b.com" },
      { type: "wallet", value: "0xaaa" },
      { type: "wallet", value: "0xbbb" },
    ]);
  });

  it("returns wallet-only identities for an email-less user", async () => {
    mockWallets = ["0xccc"];
    const identities = await buildIdentities({ userId: "u1", email: null });
    expect(identities).toEqual([{ type: "wallet", value: "0xccc" }]);
  });
});
