/**
 * Old-build protection on the owned-voucher list, and the line it must not
 * cross.
 *
 * A released build renders one merchant per voucher. A multi-merchant voucher
 * claimed on web would therefore read as usable at only its primary, which
 * sends the member to the wrong stall — so while the compatibility flag is
 * off those vouchers are withheld from this contract.
 *
 * But this endpoint also serves redeemed and expired vouchers. Withholding
 * those would delete the member's own history from their app, and a spent
 * voucher cannot misdirect anyone. So the filter applies to still-usable
 * vouchers only. An earlier version filtered on the participant count alone
 * and did hide history; these tests exist because of that.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

process.env.NEXT_PUBLIC_SUPABASE_URL = "https://x.supabase.co";
process.env.SUPABASE_SERVICE_KEY = "key";

type Voucher = { id: string; status: string; participantCount: number };

const state = vi.hoisted(() => ({
  vouchers: [] as Voucher[],
}));

vi.mock("@/lib/auth/requestActor", () => ({
  requireActor: async () => ({ userId: "user-1", email: "a@example.com", authMode: "bearer", accessToken: "t" }),
  UnauthorizedError: class extends Error {},
}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({}) }));
vi.mock("@/lib/akiba/myVouchers", () => ({ getLinkedWalletAddresses: async () => [] }));
vi.mock("@/lib/vouchers/ownedVouchers.server", () => ({
  listOwnedVouchers: async () => ({ vouchers: state.vouchers, nextCursor: null }),
  InvalidOwnedVoucherCursorError: class extends Error {},
  OwnedVouchersUnavailableError: class extends Error {},
}));

const { GET } = await import("@/app/api/v1/me/vouchers/route");

function req(url = "https://hub.test/api/v1/me/vouchers") {
  return new Request(url, { headers: { Authorization: "Bearer t" } });
}

async function listedIds(): Promise<string[]> {
  const res = await GET(req());
  const body = await res.json();
  return (body.data.vouchers as Voucher[]).map((v) => v.id);
}

describe("GET /api/v1/me/vouchers — multi-merchant compatibility", () => {
  beforeEach(() => {
    delete process.env.MULTI_MERCHANT_FUNDED_OFFERS_V1_ENABLED;
    state.vouchers = [
      { id: "single-active", status: "issued", participantCount: 1 },
      { id: "legacy-active", status: "issued", participantCount: 0 },
      { id: "multi-active", status: "issued", participantCount: 3 },
      { id: "multi-pending", status: "pending", participantCount: 3 },
      { id: "multi-redeemed", status: "redeemed", participantCount: 3 },
      { id: "multi-expired", status: "expired", participantCount: 3 },
      { id: "multi-void", status: "void", participantCount: 3 },
    ];
  });

  afterEach(() => {
    delete process.env.MULTI_MERCHANT_FUNDED_OFFERS_V1_ENABLED;
  });

  it("withholds still-usable multi-merchant vouchers while the flag is off", async () => {
    const ids = await listedIds();
    expect(ids).not.toContain("multi-active");
    expect(ids).not.toContain("multi-pending");
  });

  it("keeps redeemed, expired and void multi-merchant vouchers — that is history", async () => {
    // The regression this file was written for: a spent voucher cannot
    // misdirect anyone, and removing it deletes the member's own record.
    const ids = await listedIds();
    expect(ids).toContain("multi-redeemed");
    expect(ids).toContain("multi-expired");
    expect(ids).toContain("multi-void");
  });

  it("never touches single-merchant or legacy vouchers", async () => {
    const ids = await listedIds();
    expect(ids).toContain("single-active");
    expect(ids).toContain("legacy-active");
  });

  it("serves everything once the flag is on", async () => {
    process.env.MULTI_MERCHANT_FUNDED_OFFERS_V1_ENABLED = "true";
    expect(await listedIds()).toHaveLength(state.vouchers.length);
  });
});
