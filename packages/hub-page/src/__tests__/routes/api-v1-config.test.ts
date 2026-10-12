import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  actor: null as { userId: string; email: string | null; authMode: "cookie" | "bearer" } | null,
}));

vi.mock("@/lib/auth/requestActor", () => {
  class MockUnauthorizedError extends Error {
    readonly status = 401;
    readonly code = "UNAUTHORIZED";
  }
  return {
    UnauthorizedError: MockUnauthorizedError,
    optionalActor: async () => state.actor,
    requireActor: async () => {
      if (!state.actor) throw new MockUnauthorizedError("Unauthorized");
      return state.actor;
    },
  };
});

const { GET } = await import("@/app/api/v1/config/route");
const { DELETION_POLICY_VERSION } = await import("@/lib/akiba/accountDeletionPolicy");

function configReq() {
  return new Request("http://localhost/api/v1/config");
}

describe("GET /api/v1/config", () => {
  beforeEach(() => {
    state.actor = null;
  });

  it("returns 200 with version/legal/feature shape for an anonymous caller", async () => {
    const res = await GET(configReq());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data).toMatchObject({
      minimumSupportedVersion: { ios: expect.any(String), android: expect.any(String) },
      latestVersion: { ios: expect.any(String), android: expect.any(String) },
      maintenance: expect.any(Boolean),
      legal: {
        privacyUrl: expect.stringContaining("/privacy-policy"),
        termsUrl: expect.stringContaining("/terms-of-use"),
        accountDeletionUrl: expect.any(String),
        deletionPolicyVersion: expect.any(String),
      },
      storeUrl: { ios: null, android: null },
    });
    expect(body.meta.apiVersion).toBe("v1");
  });

  it("resolves rollout-gated features to false (never true/leaked) for an anonymous caller", async () => {
    const res = await GET(configReq());
    const body = await res.json();
    expect(body.data.features).toMatchObject({
      quests: false,
      discoveryContributions: false,
      milesEarnedNotifications: false,
    });
  });

  it("keeps the Gifts destination hidden unless MOBILE_GIFTS_ENABLED is set", async () => {
    const res = await GET(configReq());
    const body = await res.json();
    expect(body.data.features.gifts).toBe(false);

    process.env.MOBILE_GIFTS_ENABLED = "true";
    try {
      const enabled = await (await GET(configReq())).json();
      expect(enabled.data.features.gifts).toBe(true);
    } finally {
      delete process.env.MOBILE_GIFTS_ENABLED;
    }
  });

  it("publishes configured store URLs for the Update Akiba Pass action", async () => {
    process.env.MOBILE_STORE_URL_IOS = "https://apps.apple.com/app/id123";
    process.env.MOBILE_STORE_URL_ANDROID = "  ";
    try {
      const body = await (await GET(configReq())).json();
      expect(body.data.storeUrl).toEqual({
        ios: "https://apps.apple.com/app/id123",
        // Blank env values must resolve to null, not an empty string the
        // app would treat as a openable URL.
        android: null,
      });
    } finally {
      delete process.env.MOBILE_STORE_URL_IOS;
      delete process.env.MOBILE_STORE_URL_ANDROID;
    }
  });

  it("caches the anonymous response publicly, and the authenticated response privately", async () => {
    const anonRes = await GET(configReq());
    expect(anonRes.headers.get("cache-control")).toContain("public");

    state.actor = { userId: "u1", email: "a@example.com", authMode: "bearer" };
    const authRes = await GET(configReq());
    expect(authRes.headers.get("cache-control")).toBe("private, no-store");
  });

  it("echoes an inbound X-Request-Id and includes it on both success paths", async () => {
    const req = new Request("http://localhost/api/v1/config", {
      headers: { "x-request-id": "req-123" },
    });
    const res = await GET(req);
    const body = await res.json();
    expect(body.meta.requestId).toBe("req-123");
  });

  it("publishes the account-deletion page and the active deletion policy version", async () => {
    // §6/§7: the app reads this URL rather than hardcoding one, and echoes
    // the policy version back when submitting a deletion request.
    const body = await (await GET(configReq())).json();
    expect(body.data.legal.accountDeletionUrl).toContain("/account-deletion");
    expect(body.data.legal.deletionPolicyVersion).toBe(DELETION_POLICY_VERSION);
  });
});
