import { afterEach, expect, it, vi } from "vitest";

const createClient = vi.hoisted(() => vi.fn(() => ({})));
vi.mock("@supabase/supabase-js", () => ({ createClient }));
afterEach(() => vi.unstubAllGlobals());

it("forces fresh admin reads while preserving request options", async () => {
  const fetch = vi.fn().mockResolvedValue(new Response("{}"));
  vi.stubGlobal("fetch", fetch);
  await import("@/lib/supabase");
  const options = (createClient.mock.calls[0] as unknown as [string, string, { global: { fetch: typeof globalThis.fetch } }])[2];
  await options.global.fetch("http://localhost/rest/v1/partners", { cache: "force-cache", method: "GET", headers: { "x-test": "preserved" } });
  expect(fetch).toHaveBeenCalledWith("http://localhost/rest/v1/partners", { cache: "no-store", method: "GET", headers: { "x-test": "preserved" } });
});
