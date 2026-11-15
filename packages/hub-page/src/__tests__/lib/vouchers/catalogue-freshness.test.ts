import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/env.server", () => ({
  getServerEnv: () => ({ supabase: { url: "https://catalogue.example", serviceKey: "test-service-key" } }),
}));

import { getAllTemplates } from "@/lib/vouchers/catalogue.server";

describe("merchant voucher catalogue freshness", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("sees a newly published offer after an earlier empty catalogue read", async () => {
    let published = false;
    const cached = new Map<string, unknown>();
    const offer = {
      id: "new-offer", title: "Black November", voucher_type: "percent_off", miles_cost: 90,
      discount_percent: 10, discount_cusd: null, applicable_category: null, retail_value_cusd: null,
      partners: { id: "merchant", name: "Ebun", slug: "ebun", image_url: null },
    };
    // Model the server fetch cache at the transport boundary, using the real
    // Supabase client and catalogue loader rather than a mocked loader/RPC.
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const live = url.includes("/rpc/list_available_voucher_template_ids_hub")
        ? published ? [{ template_id: offer.id }] : []
        : published ? [offer] : [];
      const key = url + String(init?.body ?? "");
      if (init?.cache !== "no-store" && cached.has(key)) {
        return Response.json(cached.get(key));
      }
      if (init?.cache !== "no-store") cached.set(key, live);
      return Response.json(live);
    }));

    expect(await getAllTemplates(null)).toEqual([]);
    published = true;
    expect(await getAllTemplates(null)).toEqual([offer]);
  });
});
