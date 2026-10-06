import { beforeEach, describe, expect, it, vi } from "vitest";

type FixtureRow = {
  id: string;
  status: string;
  created_at: string;
  expires_at: string | null;
  redeemed_at: string | null;
  spend_voucher_templates: {
    title: string;
    voucher_type: string;
    miles_cost: number;
    discount_percent: number | null;
    discount_cusd: number | null;
    retail_value_cusd: number | null;
    partners: { name: string; slug: string; image_url: string | null };
  };
  voucher_programs: { name: string };
};

const state = vi.hoisted(() => ({ rows: [] as FixtureRow[] }));

function makeQueryBuilder(rows: FixtureRow[]) {
  const orCalls: string[] = [];
  const inCalls: Array<{ col: string; vals: string[] }> = [];
  let limit = Infinity;

  const builder = {
    select: () => builder,
    order: () => builder,
    or: (expr: string) => {
      orCalls.push(expr);
      return builder;
    },
    eq: () => builder,
    in: (col: string, vals: string[]) => {
      inCalls.push({ col, vals });
      return builder;
    },
    limit: (n: number) => {
      limit = n;
      return builder;
    },
    then(resolve: (value: { data: FixtureRow[]; error: null }) => void) {
      let result = [...rows];

      const statusIn = inCalls.find((c) => c.col === "status");
      if (statusIn) result = result.filter((r) => statusIn.vals.includes(r.status));

      const cursorOr = orCalls.find((expr) => expr.startsWith("created_at.lt."));
      if (cursorOr) {
        const match = /created_at\.lt\.([^,]+),and\(created_at\.eq\.([^,]+),id\.lt\.([^)]+)\)/.exec(cursorOr);
        if (match) {
          const [, ltCreatedAt, eqCreatedAt, ltId] = match;
          result = result.filter((r) => r.created_at < ltCreatedAt || (r.created_at === eqCreatedAt && r.id < ltId));
        }
      }

      result = result
        .slice()
        .sort((a, b) => b.created_at.localeCompare(a.created_at) || b.id.localeCompare(a.id));
      if (Number.isFinite(limit)) result = result.slice(0, limit);

      resolve({ data: result, error: null });
    },
  };
  return builder;
}

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({ from: () => makeQueryBuilder(state.rows) }),
}));

const { listOwnedVouchers, InvalidOwnedVoucherCursorError } = await import("@/lib/vouchers/ownedVouchers.server");

function template(title: string) {
  return {
    title,
    voucher_type: "percent_off",
    miles_cost: 100,
    discount_percent: 10,
    discount_cusd: null,
    retail_value_cusd: null,
    partners: { name: "Acme", slug: "acme", image_url: null },
  };
}

describe("listOwnedVouchers", () => {
  beforeEach(() => {
    state.rows = [
      { id: "v0", status: "void", created_at: "2025-12-31T00:00:00Z", expires_at: null, redeemed_at: null, spend_voucher_templates: template("V0"), voucher_programs: { name: "Program" } },
      { id: "v1", status: "redeemed", created_at: "2026-01-01T00:00:00Z", expires_at: null, redeemed_at: "2026-01-05T00:00:00Z", spend_voucher_templates: template("V1"), voucher_programs: { name: "Program" } },
      { id: "v2", status: "issued", created_at: "2026-01-02T00:00:00Z", expires_at: null, redeemed_at: null, spend_voucher_templates: template("V2"), voucher_programs: { name: "Program" } },
      { id: "v3", status: "issued", created_at: "2026-01-03T00:00:00Z", expires_at: null, redeemed_at: null, spend_voucher_templates: template("V3"), voucher_programs: { name: "Program" } },
    ];
  });

  it("maps status=active to issued/pending/claiming", async () => {
    const result = await listOwnedVouchers({ userId: "u1", walletAddresses: [], status: "active" });
    expect(result.vouchers.map((v) => v.id)).toEqual(["v3", "v2"]);
  });

  it("maps status=redeemed to redeemed only", async () => {
    const result = await listOwnedVouchers({ userId: "u1", walletAddresses: [], status: "redeemed" });
    expect(result.vouchers.map((v) => v.id)).toEqual(["v1"]);
  });

  it("maps status=expired to expired/void", async () => {
    const result = await listOwnedVouchers({ userId: "u1", walletAddresses: [], status: "expired" });
    expect(result.vouchers.map((v) => v.id)).toEqual(["v0"]);
  });

  it("returns every status when no status filter is given", async () => {
    const result = await listOwnedVouchers({ userId: "u1", walletAddresses: [] });
    expect(result.vouchers.map((v) => v.id)).toEqual(["v3", "v2", "v1", "v0"]);
  });

  it("paginates with no overlap and no gaps across a full cursor round-trip", async () => {
    const page1 = await listOwnedVouchers({ userId: "u1", walletAddresses: [], limit: 1 });
    expect(page1.vouchers.map((v) => v.id)).toEqual(["v3"]);
    expect(page1.next_cursor).not.toBeNull();

    const page2 = await listOwnedVouchers({ userId: "u1", walletAddresses: [], limit: 1, cursor: page1.next_cursor! });
    expect(page2.vouchers.map((v) => v.id)).toEqual(["v2"]);
    expect(page2.next_cursor).not.toBeNull();

    const page3 = await listOwnedVouchers({ userId: "u1", walletAddresses: [], limit: 1, cursor: page2.next_cursor! });
    expect(page3.vouchers.map((v) => v.id)).toEqual(["v1"]);
    expect(page3.next_cursor).not.toBeNull();

    const page4 = await listOwnedVouchers({ userId: "u1", walletAddresses: [], limit: 1, cursor: page3.next_cursor! });
    expect(page4.vouchers.map((v) => v.id)).toEqual(["v0"]);
    expect(page4.next_cursor).toBeNull();
  });

  it("rejects a cursor minted under a different status scope", async () => {
    const page1 = await listOwnedVouchers({ userId: "u1", walletAddresses: [], status: "active", limit: 1 });
    await expect(
      listOwnedVouchers({ userId: "u1", walletAddresses: [], status: "redeemed", cursor: page1.next_cursor! }),
    ).rejects.toBeInstanceOf(InvalidOwnedVoucherCursorError);
  });

  it("rejects a malformed cursor", async () => {
    await expect(
      listOwnedVouchers({ userId: "u1", walletAddresses: [], cursor: "not-a-real-cursor" }),
    ).rejects.toBeInstanceOf(InvalidOwnedVoucherCursorError);
  });

  it("never includes ownership or raw snapshot fields in the DTO", async () => {
    const result = await listOwnedVouchers({ userId: "u1", walletAddresses: [] });
    for (const voucher of result.vouchers) {
      expect(voucher).not.toHaveProperty("hub_user_id");
      expect(voucher).not.toHaveProperty("user_address");
      expect(voucher).not.toHaveProperty("rules_snapshot");
      expect(voucher).not.toHaveProperty("code");
    }
  });
});
