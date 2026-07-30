import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  partner: null as { id: string; partner_settings: { store_active: boolean; wallet_address: string | null } } | null,
}));

const mockFrom = vi.fn();
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({ from: mockFrom }),
}));

function setupAdmin() {
  mockFrom.mockImplementation((table: string) => {
    if (table === "partners") {
      return {
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({ data: state.partner, error: null }),
          }),
        }),
      };
    }
    throw new Error(`Unexpected table ${table}`);
  });
}

const { GET } = await import("@/app/api/shop/merchants/[slug]/wallet/route");

describe("GET /api/shop/merchants/[slug]/wallet — checkout-only, on-demand", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.partner = null;
    setupAdmin();
  });

  it("resolves the wallet address for an active store, at request time (not embedded in a public payload)", async () => {
    state.partner = { id: "merchant-1", partner_settings: { store_active: true, wallet_address: "0xabc" } };

    const res = await GET(new Request("http://localhost/api/shop/merchants/acme/wallet"), { params: { slug: "acme" } });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({ wallet_address: "0xabc" });
  });

  it("404s when the store is inactive, without exposing whether a wallet exists", async () => {
    state.partner = { id: "merchant-1", partner_settings: { store_active: false, wallet_address: "0xabc" } };

    const res = await GET(new Request("http://localhost/api/shop/merchants/acme/wallet"), { params: { slug: "acme" } });

    expect(res.status).toBe(404);
  });

  it("404s for an unknown merchant", async () => {
    state.partner = null;

    const res = await GET(new Request("http://localhost/api/shop/merchants/nope/wallet"), { params: { slug: "nope" } });

    expect(res.status).toBe(404);
  });
});
