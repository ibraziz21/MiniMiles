import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  listResult: { merchants: [] as Array<{ id: string; slug: string }>, next_cursor: null as string | null, applied: { category: null, city: null, nearby: false } },
  listShouldThrowInvalidCursor: false,
  listShouldThrowOther: false,
}));

class MockInvalidMerchantCursorError extends Error {}

const listPublicMerchantsMock = vi.fn();
const getCanonicalVoucherCountsMock = vi.fn();
vi.mock("@/lib/merchants/queries", () => ({
  InvalidMerchantCursorError: MockInvalidMerchantCursorError,
  listPublicMerchants: (...args: unknown[]) => listPublicMerchantsMock(...args),
  getCanonicalVoucherCounts: (...args: unknown[]) => getCanonicalVoucherCountsMock(...args),
}));

const getTopOffersMock = vi.fn();
const toMerchantValueSummaryMock = vi.fn();
const getSignedInBalanceMock = vi.fn();
vi.mock("@/lib/merchants/enrich", () => ({
  getTopOffers: (...args: unknown[]) => getTopOffersMock(...args),
  toMerchantValueSummary: (...args: unknown[]) => toMerchantValueSummaryMock(...args),
  getSignedInBalance: (...args: unknown[]) => getSignedInBalanceMock(...args),
}));

const { GET } = await import("@/app/api/v1/merchants/route");

function req(query = "") {
  return new Request(`http://localhost/api/v1/merchants${query}`);
}

describe("GET /api/v1/merchants", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.listResult = { merchants: [], next_cursor: null, applied: { category: null, city: null, nearby: false } };
    state.listShouldThrowInvalidCursor = false;
    state.listShouldThrowOther = false;

    listPublicMerchantsMock.mockImplementation(async () => {
      if (state.listShouldThrowInvalidCursor) throw new MockInvalidMerchantCursorError("bad cursor");
      if (state.listShouldThrowOther) throw new Error("db exploded");
      return state.listResult;
    });
    getCanonicalVoucherCountsMock.mockResolvedValue({});
    getTopOffersMock.mockResolvedValue({});
    toMerchantValueSummaryMock.mockImplementation((m) => ({ id: m.id, slug: m.slug }));
  });

  it("never calls any actor-scoped balance resolution — this route is identity-independent", async () => {
    state.listResult.merchants = [{ id: "m1", slug: "acme" }];
    await GET(req());
    expect(getSignedInBalanceMock).not.toHaveBeenCalled();
    expect(getCanonicalVoucherCountsMock).toHaveBeenCalledWith(["m1"], null);
    expect(getTopOffersMock).toHaveBeenCalledWith(["m1"], null);
    expect(toMerchantValueSummaryMock).toHaveBeenCalledWith(
      expect.objectContaining({ id: "m1" }),
      undefined,
      null,
      null,
      0,
    );
  });

  it("returns an empty merchants array without enrichment calls when the list is empty", async () => {
    const res = await GET(req());
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.data.merchants).toEqual([]);
    expect(getCanonicalVoucherCountsMock).not.toHaveBeenCalled();
  });

  it("rejects an invalid mode", async () => {
    const res = await GET(req("?mode=bogus"));
    expect(res.status).toBe(400);
  });

  it("requires lat and lng together", async () => {
    const res = await GET(req("?lat=1.2"));
    expect(res.status).toBe(400);
  });

  it("rejects out-of-range coordinates", async () => {
    const res = await GET(req("?lat=999&lng=0"));
    expect(res.status).toBe(400);
  });

  it("maps InvalidMerchantCursorError to 400 INVALID_CURSOR", async () => {
    state.listShouldThrowInvalidCursor = true;
    const res = await GET(req("?cursor=garbage"));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe("INVALID_CURSOR");
  });

  it("maps any other failure to 503 DIRECTORY_UNAVAILABLE without leaking the raw error", async () => {
    state.listShouldThrowOther = true;
    const res = await GET(req());
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.error.code).toBe("DIRECTORY_UNAVAILABLE");
    expect(JSON.stringify(body)).not.toContain("db exploded");
  });

  it("is publicly cacheable", async () => {
    const res = await GET(req());
    expect(res.headers.get("cache-control")).toContain("public");
  });
});
