import { beforeEach, describe, expect, it, vi } from "vitest";

type Actor = { userId: string; email: string | null; authMode: "cookie" | "bearer" } | null;

const state = vi.hoisted(() => ({
  actor: null as Actor,
  nativePush: true,
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

vi.mock("@/lib/push/expo", () => ({
  nativePushConfigured: () => state.nativePush,
}));

const registerDeviceMock = vi.fn();
const revokeDeviceMock = vi.fn();
vi.mock("@/lib/push/devices", async (importOriginal) => {
  // The real parser is kept — its validation is part of what this route
  // promises — while the two database calls are doubled.
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    registerDevice: (...args: unknown[]) => registerDeviceMock(...args),
    revokeDevice: (...args: unknown[]) => revokeDeviceMock(...args),
  };
});

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({}) }));

const { POST, DELETE } = await import("@/app/api/v1/me/devices/route");

const INSTALLATION = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";
const TOKEN = "ExponentPushToken[xxxxxxxxxxxxxxxxxxxxxx]";

function request(
  method: "POST" | "DELETE",
  body: unknown = { installationId: INSTALLATION, platform: "ios", expoPushToken: TOKEN },
  opts: { origin?: string; contentType?: string | null } = {},
) {
  const headers: Record<string, string> = {};
  if (opts.contentType !== null) headers["content-type"] = opts.contentType ?? "application/json";
  if (opts.origin) headers.origin = opts.origin;
  return new Request("http://localhost/api/v1/me/devices", {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

describe("POST /api/v1/me/devices", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.actor = null;
    state.nativePush = true;
    registerDeviceMock.mockResolvedValue({ ok: true, deviceId: "device-1" });
    revokeDeviceMock.mockResolvedValue({ ok: true, revoked: 1 });
  });

  it("requires authentication", async () => {
    expect((await POST(request("POST"))).status).toBe(401);
  });

  it("rejects a bearer mutation that is not JSON", async () => {
    state.actor = { userId: "user-1", email: null, authMode: "bearer" };
    const response = await POST(request("POST", undefined, { contentType: "text/plain" }));
    expect(response.status).toBe(415);
  });

  it("rejects a cross-origin cookie mutation", async () => {
    state.actor = { userId: "user-1", email: null, authMode: "cookie" };
    const response = await POST(request("POST", undefined, { origin: "https://evil.example" }));
    expect(response.status).toBe(403);
  });

  it("refuses registration when the deployment cannot send native push", async () => {
    // Collecting tokens a deployment will never send to is how you end up
    // asking members for a permission you cannot honour.
    state.actor = { userId: "user-1", email: null, authMode: "bearer" };
    state.nativePush = false;

    const response = await POST(request("POST"));

    expect(response.status).toBe(503);
    expect(registerDeviceMock).not.toHaveBeenCalled();
  });

  it("files the device under the authenticated actor, never a body-supplied id", async () => {
    state.actor = { userId: "user-1", email: null, authMode: "bearer" };

    const response = await POST(
      request("POST", {
        installationId: INSTALLATION,
        platform: "ios",
        expoPushToken: TOKEN,
        hubUserId: "user-2",
        hub_user_id: "user-2",
      }),
    );

    expect(response.status).toBe(200);
    expect(registerDeviceMock).toHaveBeenCalledWith({}, "user-1", expect.objectContaining({ platform: "ios" }));
  });

  it.each([
    [{ installationId: "nope", platform: "ios", expoPushToken: TOKEN }, "INVALID_INSTALLATION_ID"],
    [{ installationId: INSTALLATION, platform: "web", expoPushToken: TOKEN }, "INVALID_PLATFORM"],
    [{ installationId: INSTALLATION, platform: "ios", expoPushToken: "junk" }, "INVALID_PUSH_TOKEN"],
  ])("rejects an invalid body with a stable code", async (body, code) => {
    state.actor = { userId: "user-1", email: null, authMode: "bearer" };

    const response = await POST(request("POST", body));
    const payload = (await response.json()) as { error: { code: string } };

    expect(response.status).toBe(400);
    expect(payload.error.code).toBe(code);
  });

  it("is idempotent: the same registration twice is two successes", async () => {
    state.actor = { userId: "user-1", email: null, authMode: "bearer" };

    const first = await POST(request("POST"));
    const second = await POST(request("POST"));

    expect([first.status, second.status]).toEqual([200, 200]);
    expect(registerDeviceMock).toHaveBeenCalledTimes(2);
  });

  it("does not leak the database error to the caller", async () => {
    state.actor = { userId: "user-1", email: null, authMode: "bearer" };
    registerDeviceMock.mockResolvedValue({ ok: false, error: 'duplicate key value violates "idx_x"' });

    const response = await POST(request("POST"));
    const payload = (await response.json()) as { error: { code: string; message: string } };

    expect(response.status).toBe(500);
    expect(payload.error.code).toBe("DEVICE_REGISTRATION_FAILED");
    expect(payload.error.message).not.toContain("duplicate key");
  });

  it("never caches a registration response", async () => {
    state.actor = { userId: "user-1", email: null, authMode: "bearer" };
    const response = await POST(request("POST"));
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
  });
});

describe("DELETE /api/v1/me/devices", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.actor = { userId: "user-1", email: null, authMode: "bearer" };
    state.nativePush = true;
    revokeDeviceMock.mockResolvedValue({ ok: true, revoked: 1 });
  });

  it("requires authentication", async () => {
    state.actor = null;
    expect((await DELETE(request("DELETE", { installationId: INSTALLATION }))).status).toBe(401);
  });

  it("revokes by installation id from the body", async () => {
    const response = await DELETE(request("DELETE", { installationId: INSTALLATION }));
    expect(response.status).toBe(200);
    expect(revokeDeviceMock).toHaveBeenCalledWith({}, "user-1", INSTALLATION);
  });

  it("accepts the installation id as a query parameter too", async () => {
    const response = await DELETE(
      new Request(`http://localhost/api/v1/me/devices?installation_id=${INSTALLATION}`, {
        method: "DELETE",
        headers: { "content-type": "application/json" },
      }),
    );

    expect(response.status).toBe(200);
    expect(revokeDeviceMock).toHaveBeenCalledWith({}, "user-1", INSTALLATION);
  });

  it("rejects a missing or malformed installation id", async () => {
    expect((await DELETE(request("DELETE", {}))).status).toBe(400);
    expect((await DELETE(request("DELETE", { installationId: "nope" }))).status).toBe(400);
  });

  it("succeeds when nothing was registered, so a retry is safe", async () => {
    // A dropped response must not leave the app unable to finish signing out.
    revokeDeviceMock.mockResolvedValue({ ok: true, revoked: 0 });

    const response = await DELETE(request("DELETE", { installationId: INSTALLATION }));
    const payload = (await response.json()) as { data: { registered: boolean; revoked: number } };

    expect(response.status).toBe(200);
    expect(payload.data).toEqual({ registered: false, revoked: 0 });
  });

  it("still works while native push is disabled, so a token can always be released", async () => {
    state.nativePush = false;
    expect((await DELETE(request("DELETE", { installationId: INSTALLATION }))).status).toBe(200);
  });
});
