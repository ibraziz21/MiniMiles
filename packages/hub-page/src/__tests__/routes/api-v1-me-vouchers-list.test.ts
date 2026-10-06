import { beforeEach, describe, expect, it, vi } from "vitest";

type Actor = { userId: string; email: string | null; authMode: "cookie" | "bearer" } | null;

const state = vi.hoisted(() => ({ actor: null as Actor }));

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

const listOwnedVouchersMock = vi.fn();
class MockInvalidOwnedVoucherCursorError extends Error {}
class MockOwnedVouchersUnavailableError extends Error {}
vi.mock("@/lib/vouchers/ownedVouchers.server", () => ({
  listOwnedVouchers: (...args: unknown[]) => listOwnedVouchersMock(...args),
  InvalidOwnedVoucherCursorError: MockInvalidOwnedVoucherCursorError,
  OwnedVouchersUnavailableError: MockOwnedVouchersUnavailableError,
}));

const { GET } = await import("@/app/api/v1/me/vouchers/route");

function req(query = "") {
  return new Request(`http://localhost/api/v1/me/vouchers${query}`);
}

describe("GET /api/v1/me/vouchers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.actor = null;
    getLinkedWalletAddressesMock.mockResolvedValue(["0xabc"]);
    listOwnedVouchersMock.mockResolvedValue({ vouchers: [], next_cursor: null });
  });

  it("returns 401 when unauthenticated", async () => {
    const res = await GET(req());
    expect(res.status).toBe(401);
  });

  it("rejects an invalid status value", async () => {
    state.actor = { userId: "u1", email: "a@example.com", authMode: "bearer" };
    const res = await GET(req("?status=bogus"));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe("INVALID_STATUS");
  });

  it("passes the resolved wallet addresses and query params through", async () => {
    state.actor = { userId: "u1", email: "a@example.com", authMode: "bearer" };
    await GET(req("?status=active&cursor=abc&limit=5"));
    expect(getLinkedWalletAddressesMock).toHaveBeenCalledWith("u1");
    expect(listOwnedVouchersMock).toHaveBeenCalledWith({
      userId: "u1",
      walletAddresses: ["0xabc"],
      status: "active",
      cursor: "abc",
      limit: 5,
    });
  });

  it("maps InvalidOwnedVoucherCursorError to 400 INVALID_CURSOR", async () => {
    state.actor = { userId: "u1", email: "a@example.com", authMode: "bearer" };
    listOwnedVouchersMock.mockRejectedValue(new MockInvalidOwnedVoucherCursorError());
    const res = await GET(req("?cursor=garbage"));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe("INVALID_CURSOR");
  });

  it("maps OwnedVouchersUnavailableError to a retryable 503", async () => {
    state.actor = { userId: "u1", email: "a@example.com", authMode: "bearer" };
    listOwnedVouchersMock.mockRejectedValue(new MockOwnedVouchersUnavailableError());
    const res = await GET(req());
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.error.code).toBe("VOUCHERS_UNAVAILABLE");
    expect(body.error.retryable).toBe(true);
  });

  it("is private, no-store", async () => {
    state.actor = { userId: "u1", email: "a@example.com", authMode: "bearer" };
    const res = await GET(req());
    expect(res.headers.get("cache-control")).toBe("private, no-store");
  });
});
