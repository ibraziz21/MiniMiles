import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  cookieUser: null as { id: string; email: string | null } | null,
  cookieAccessToken: null as string | null,
  // token -> resolved user, or "error" to simulate an invalid/expired/wrong-project token
  bearerUsers: new Map<string, { id: string; email: string | null } | "error" | "unavailable">(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: {
      getUser: async () => ({ data: { user: state.cookieUser } }),
      getSession: async () => ({
        data: {
          session: state.cookieUser && state.cookieAccessToken ? { access_token: state.cookieAccessToken } : null,
        },
      }),
    },
  }),
}));

vi.mock("@/lib/env.server", () => ({
  getServerEnv: () => ({
    supabase: { url: "https://test.supabase.co", anonKey: "anon-key", serviceKey: "service-key" },
    siteUrl: "http://localhost:3003",
  }),
}));

vi.mock("@supabase/supabase-js", () => ({
  createClient: () => ({
    auth: {
      getUser: async (token: string) => {
        const resolved = state.bearerUsers.get(token);
        if (resolved === "unavailable") {
          const error = new Error("fetch failed") as Error & { status: number };
          error.name = "AuthRetryableFetchError";
          error.status = 0;
          return { data: { user: null }, error };
        }
        if (!resolved || resolved === "error") {
          return { data: { user: null }, error: resolved ? new Error("invalid token") : new Error("not found") };
        }
        return { data: { user: resolved }, error: null };
      },
    },
  }),
}));

const { requireActor, optionalActor, UnauthorizedError, AuthServiceUnavailableError } = await import("@/lib/auth/requestActor");

function reqWithBearer(token: string) {
  return new Request("http://localhost/api/v1/me/bootstrap", {
    headers: { authorization: `Bearer ${token}` },
  });
}

function reqWithoutAuth() {
  return new Request("http://localhost/api/v1/me/bootstrap");
}

describe("optionalActor / requireActor", () => {
  beforeEach(() => {
    state.cookieUser = null;
    state.cookieAccessToken = null;
    state.bearerUsers.clear();
  });

  it("resolves a bearer actor from a valid token, authMode 'bearer'", async () => {
    state.bearerUsers.set("valid-token", { id: "user-1", email: "a@example.com" });
    const actor = await optionalActor(reqWithBearer("valid-token"));
    expect(actor).toEqual({ userId: "user-1", email: "a@example.com", authMode: "bearer", accessToken: "valid-token" });
  });

  it("returns null for an invalid/expired/wrong-project bearer token — never falls back to cookie", async () => {
    state.bearerUsers.set("bad-token", "error");
    state.cookieUser = { id: "cookie-user", email: "cookie@example.com" };
    state.cookieAccessToken = "cookie-session-token";
    const actor = await optionalActor(reqWithBearer("bad-token"));
    expect(actor).toBeNull();
  });

  it("does not misreport a retryable Auth transport failure as an invalid session", async () => {
    state.bearerUsers.set("temporarily-unverifiable", "unavailable");
    await expect(requireActor(reqWithBearer("temporarily-unverifiable"))).rejects.toBeInstanceOf(AuthServiceUnavailableError);
    await expect(requireActor(reqWithBearer("temporarily-unverifiable"))).rejects.toMatchObject({
      status: 503,
      code: "AUTH_SERVICE_UNAVAILABLE",
    });
  });

  it("resolves a cookie actor when no Authorization header is present, authMode 'cookie'", async () => {
    state.cookieUser = { id: "user-2", email: "b@example.com" };
    state.cookieAccessToken = "cookie-session-token";
    const actor = await optionalActor(reqWithoutAuth());
    expect(actor).toEqual({
      userId: "user-2",
      email: "b@example.com",
      authMode: "cookie",
      accessToken: "cookie-session-token",
    });
  });

  it("returns null when neither a bearer token nor a cookie session resolves a user", async () => {
    const actor = await optionalActor(reqWithoutAuth());
    expect(actor).toBeNull();
  });

  it("requireActor throws UnauthorizedError (401) when unauthenticated", async () => {
    await expect(requireActor(reqWithoutAuth())).rejects.toBeInstanceOf(UnauthorizedError);
    await expect(requireActor(reqWithoutAuth())).rejects.toMatchObject({ status: 401, code: "UNAUTHORIZED" });
  });

  it("requireActor returns the same actor requireActor/optionalActor would for a valid token", async () => {
    state.bearerUsers.set("valid-token", { id: "user-3", email: null });
    const actor = await requireActor(reqWithBearer("valid-token"));
    expect(actor).toEqual({ userId: "user-3", email: null, authMode: "bearer", accessToken: "valid-token" });
  });

  it("bearer actor's accessToken is the parsed token verbatim", async () => {
    state.bearerUsers.set("exact-token-value", { id: "user-4", email: "d@example.com" });
    const actor = await optionalActor(reqWithBearer("exact-token-value"));
    expect(actor?.accessToken).toBe("exact-token-value");
  });

  it("cookie actor's accessToken comes from getSession(), not a derived value", async () => {
    state.cookieUser = { id: "user-5", email: "e@example.com" };
    state.cookieAccessToken = "session-access-token";
    const actor = await optionalActor(reqWithoutAuth());
    expect(actor?.accessToken).toBe("session-access-token");
  });
});
