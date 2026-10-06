import { beforeEach, describe, expect, it, vi } from "vitest";

type Actor = { userId: string; email: string | null; authMode: "cookie" | "bearer" } | null;

const state = vi.hoisted(() => ({
  actor: null as Actor,
  // userId -> owns?
  ownsByUser: new Map<string, boolean>(),
  voucherRow: null as Record<string, unknown> | null,
}));

vi.mock("@/lib/auth/requestActor", () => {
  class MockUnauthorizedError extends Error {
    readonly status = 401;
    readonly code = "UNAUTHORIZED";
  }
  return {
    UnauthorizedError: MockUnauthorizedError,
    requireActor: async () => {
      if (!state.actor) throw new MockUnauthorizedError("Unauthorized");
      return state.actor;
    },
  };
});

const getLinkedWalletAddressesMock = vi.fn();
vi.mock("@/lib/akiba/myVouchers", () => ({
  getLinkedWalletAddresses: (...args: unknown[]) => getLinkedWalletAddressesMock(...args),
}));

const userOwnsVoucherMock = vi.fn();
vi.mock("@/lib/vouchers/issuance", () => ({
  userOwnsVoucher: (...args: unknown[]) => userOwnsVoucherMock(...args),
}));

const maybeSingleMock = vi.fn();
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: () => maybeSingleMock(),
        }),
      }),
    }),
  }),
}));

const { GET } = await import("@/app/api/v1/me/vouchers/[id]/route");

function req(id: string) {
  return { req: new Request(`http://localhost/api/v1/me/vouchers/${id}`), params: { id } };
}

function baseTemplate(overrides: Record<string, unknown> = {}) {
  return {
    title: "10% off",
    voucher_type: "percent_off",
    discount_percent: 10,
    discount_cusd: null,
    discount_kes: null,
    applicable_category: null,
    retail_value_cusd: null,
    miles_cost: 100,
    partners: { slug: "acme", name: "Acme", image_url: null },
    ...overrides,
  };
}

function baseVoucher(overrides: Record<string, unknown> = {}) {
  return {
    id: "v1",
    status: "issued",
    created_at: "2026-01-01T00:00:00Z",
    expires_at: null,
    redeemed_at: null,
    rules_snapshot: null,
    spend_voucher_templates: baseTemplate(),
    voucher_programs: { name: "Program" },
    ...overrides,
  };
}

describe("GET /api/v1/me/vouchers/[id]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.actor = null;
    state.ownsByUser = new Map();
    state.voucherRow = baseVoucher();
    getLinkedWalletAddressesMock.mockResolvedValue([]);
    userOwnsVoucherMock.mockImplementation(async (_id: string, userId: string) => state.ownsByUser.get(userId) ?? false);
    maybeSingleMock.mockImplementation(async () => ({ data: state.voucherRow, error: null }));
  });

  it("returns 401 when unauthenticated", async () => {
    const { req: r, params } = req("v1");
    const res = await GET(r, { params });
    expect(res.status).toBe(401);
  });

  it("returns 404 for a genuinely missing voucher", async () => {
    state.actor = { userId: "user-a", email: "a@example.com", authMode: "bearer" };
    state.ownsByUser.set("user-a", false);
    const { req: r, params } = req("nope");
    const res = await GET(r, { params });
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error.code).toBe("VOUCHER_NOT_FOUND");
  });

  it("returns the same 404 for a voucher owned by a different user — never 403, never enumerable", async () => {
    state.ownsByUser.set("user-a", true);
    state.ownsByUser.set("user-b", false);

    state.actor = { userId: "user-b", email: "b@example.com", authMode: "bearer" };
    const { req: r, params } = req("v1");
    const res = await GET(r, { params });
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error.code).toBe("VOUCHER_NOT_FOUND");
  });

  it("returns full detail for the owning user, with the rules-snapshot override applied", async () => {
    state.ownsByUser.set("user-a", true);
    state.voucherRow = baseVoucher({
      rules_snapshot: { title: "Snapshotted title", discount_percent: 15 },
    });
    state.actor = { userId: "user-a", email: "a@example.com", authMode: "bearer" };

    const { req: r, params } = req("v1");
    const res = await GET(r, { params });
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.data.title).toBe("Snapshotted title");
    expect(body.data.discountPercent).toBe(15);
    expect(body.data.merchantSlug).toBe("acme");
  });

  it("never includes raw ownership or snapshot fields in the response", async () => {
    state.ownsByUser.set("user-a", true);
    state.actor = { userId: "user-a", email: "a@example.com", authMode: "bearer" };
    const { req: r, params } = req("v1");
    const res = await GET(r, { params });
    const body = await res.json();
    expect(body.data).not.toHaveProperty("hub_user_id");
    expect(body.data).not.toHaveProperty("user_address");
    expect(body.data).not.toHaveProperty("rules_snapshot");
    expect(body.data).not.toHaveProperty("code");
    expect(body.data).not.toHaveProperty("sponsor");
    expect(body.data).not.toHaveProperty("acquisition_source");
  });

  it("is private, no-store", async () => {
    state.ownsByUser.set("user-a", true);
    state.actor = { userId: "user-a", email: "a@example.com", authMode: "bearer" };
    const { req: r, params } = req("v1");
    const res = await GET(r, { params });
    expect(res.headers.get("cache-control")).toBe("private, no-store");
  });
});
