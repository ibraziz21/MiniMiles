/**
 * The distinction this client exists to preserve: a missing merchant (404 →
 * null → the page calls notFound) versus an outage (throw → the request fails
 * and is retried). Collapsing the two would make a five-minute directory blip
 * look to search engines like every profile had been deleted.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fetchMock = vi.fn();

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const { DirectoryUnavailable, getDirectoryMerchant, listDirectoryMerchants } = await import(
  "@/lib/directory/client"
);

describe("getDirectoryMerchant", () => {
  it("unwraps the merchant from the response envelope", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ merchant: { slug: "acme", name: "Acme" } }));
    await expect(getDirectoryMerchant("acme")).resolves.toMatchObject({ slug: "acme" });
  });

  it("returns null for a 404, which the page turns into a real 404", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ error: { code: "MERCHANT_NOT_FOUND" } }, 404));
    await expect(getDirectoryMerchant("nope")).resolves.toBeNull();
  });

  it("throws on a 503 rather than reporting the merchant as missing", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ error: { code: "DIRECTORY_UNAVAILABLE" } }, 503));
    await expect(getDirectoryMerchant("acme")).rejects.toBeInstanceOf(DirectoryUnavailable);
  });

  it("throws on a 500", async () => {
    fetchMock.mockResolvedValue(new Response("boom", { status: 500 }));
    await expect(getDirectoryMerchant("acme")).rejects.toBeInstanceOf(DirectoryUnavailable);
  });

  it("throws when the network fails or the request times out", async () => {
    fetchMock.mockRejectedValue(new Error("ECONNREFUSED"));
    await expect(getDirectoryMerchant("acme")).rejects.toBeInstanceOf(DirectoryUnavailable);
  });

  it("throws on a malformed body instead of rendering an empty profile", async () => {
    fetchMock.mockResolvedValue(
      new Response("not json", { status: 200, headers: { "content-type": "application/json" } })
    );
    await expect(getDirectoryMerchant("acme")).rejects.toBeInstanceOf(DirectoryUnavailable);
  });

  it("percent-encodes the slug so a crafted path can't escape the route", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ merchant: { slug: "x" } }));
    await getDirectoryMerchant("../../admin?x=1");
    const [url] = fetchMock.mock.calls[0];
    expect(url).toContain("/api/public/directory/merchants/..%2F..%2Fadmin%3Fx%3D1");
  });

  it("asks for a cached response rather than a fresh fetch per request", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ merchant: { slug: "acme" } }));
    await getDirectoryMerchant("acme");
    const [, init] = fetchMock.mock.calls[0];
    expect(init.next).toEqual({ revalidate: 300 });
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });
});

describe("listDirectoryMerchants", () => {
  it("returns the merchants and the pagination cursor", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ merchants: [{ slug: "acme" }], nextCursor: "cursor-2" })
    );
    await expect(listDirectoryMerchants()).resolves.toEqual({
      merchants: [{ slug: "acme" }],
      nextCursor: "cursor-2",
    });
  });

  it("requests no query string when given no filters", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ merchants: [], nextCursor: null }));
    await listDirectoryMerchants();
    expect(fetchMock.mock.calls[0][0]).toMatch(/\/api\/public\/directory\/merchants$/);
  });

  it("passes filters, limit and cursor through as query parameters", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ merchants: [], nextCursor: null }));
    await listDirectoryMerchants({ category: "coffee", city: "Nairobi", limit: 50, cursor: "c2" });
    const url = new URL(fetchMock.mock.calls[0][0]);
    expect(url.searchParams.get("category")).toBe("coffee");
    expect(url.searchParams.get("city")).toBe("Nairobi");
    expect(url.searchParams.get("limit")).toBe("50");
    expect(url.searchParams.get("cursor")).toBe("c2");
  });

  it("escapes a search term rather than splicing it into the URL", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ merchants: [], nextCursor: null }));
    await listDirectoryMerchants({ q: "coffee & cake" });
    const url = new URL(fetchMock.mock.calls[0][0]);
    expect(url.searchParams.get("q")).toBe("coffee & cake");
  });

  it("treats a 404 on the listing as an outage, since that path always exists", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ error: {} }, 404));
    await expect(listDirectoryMerchants()).rejects.toBeInstanceOf(DirectoryUnavailable);
  });

  it("throws when the directory is down", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ error: {} }, 503));
    await expect(listDirectoryMerchants()).rejects.toBeInstanceOf(DirectoryUnavailable);
  });

  it("does not double a slash when the configured base ends in one", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ merchants: [], nextCursor: null }));
    await listDirectoryMerchants();
    expect(fetchMock.mock.calls[0][0]).not.toContain("//api");
  });
});
