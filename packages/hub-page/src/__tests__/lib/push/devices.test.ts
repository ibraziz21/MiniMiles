import { describe, expect, it } from "vitest";

import { parseDeviceRegistration, registerDevice, revokeDevice } from "@/lib/push/devices";

const VALID = {
  installationId: "3f2504e0-4f89-41d3-9a0c-0305e82c3301",
  platform: "ios",
  expoPushToken: "ExponentPushToken[xxxxxxxxxxxxxxxxxxxxxx]",
  appVersion: "1.0.0",
  buildNumber: "1",
};

describe("parseDeviceRegistration", () => {
  it("accepts a well-formed registration and normalises the optional fields", () => {
    const parsed = parseDeviceRegistration({ ...VALID, locale: "  en-KE  ", timezone: undefined });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.input.locale).toBe("en-KE");
    expect(parsed.input.timezone).toBeNull();
  });

  it("rejects a missing or non-UUID installation id", () => {
    expect(parseDeviceRegistration(null)).toMatchObject({ problem: "invalid_installation_id" });
    expect(parseDeviceRegistration({ ...VALID, installationId: "nope" })).toMatchObject({
      problem: "invalid_installation_id",
    });
  });

  it("rejects a platform the sender cannot actually be", () => {
    expect(parseDeviceRegistration({ ...VALID, platform: "web" })).toMatchObject({
      problem: "invalid_platform",
    });
  });

  it.each([
    "",
    "not-a-token",
    // A raw FCM/APNs token must not land in the Expo column: it would be
    // stored happily and then fail on every send.
    "fMEP0vJQS8CZ1jP3rqYdLs:APA91bE_long_fcm_looking_value",
    "ExponentPushToken[]",
    "ExponentPushToken[has space]",
  ])("rejects %o as a push token", (token) => {
    expect(parseDeviceRegistration({ ...VALID, expoPushToken: token })).toMatchObject({
      problem: "invalid_push_token",
    });
  });

  it("accepts both Expo token spellings", () => {
    expect(parseDeviceRegistration({ ...VALID, expoPushToken: "ExpoPushToken[abc]" }).ok).toBe(true);
    expect(parseDeviceRegistration({ ...VALID, expoPushToken: "ExponentPushToken[abc]" }).ok).toBe(true);
  });

  it("rejects oversized or non-string metadata rather than truncating it", () => {
    expect(parseDeviceRegistration({ ...VALID, appVersion: "x".repeat(65) })).toMatchObject({
      problem: "invalid_metadata",
    });
    expect(parseDeviceRegistration({ ...VALID, locale: 42 })).toMatchObject({
      problem: "invalid_metadata",
    });
  });
});

/** Minimal Supabase query-builder double, recording what it was asked to do. */
function adminDouble() {
  const calls: { table: string; op: string; payload?: unknown; filters: [string, unknown][] }[] = [];

  function builder(table: string, op: string, payload?: unknown) {
    const entry = { table, op, payload, filters: [] as [string, unknown][] };
    calls.push(entry);
    const chain: Record<string, unknown> = {
      eq: (column: string, value: unknown) => {
        entry.filters.push([`eq:${column}`, value]);
        return chain;
      },
      neq: (column: string, value: unknown) => {
        entry.filters.push([`neq:${column}`, value]);
        return chain;
      },
      select: () => chain,
      maybeSingle: async () => ({ data: { id: "device-1" }, error: null }),
      then: (resolve: (value: unknown) => unknown) => resolve({ data: [{ id: "device-1" }], error: null }),
    };
    return chain;
  }

  return {
    calls,
    from: (table: string) => ({
      upsert: (payload: unknown) => builder(table, "upsert", payload),
      update: (payload: unknown) => builder(table, "update", payload),
    }),
  };
}

describe("registerDevice", () => {
  it("releases the token from any other account before claiming it", async () => {
    const admin = adminDouble();

    const parsed = parseDeviceRegistration(VALID);
    if (!parsed.ok) throw new Error("fixture should parse");
    await registerDevice(admin as never, "user-1", parsed.input);

    // The release must come first: the token column is UNIQUE, so upserting
    // while another account still holds it would be rejected outright.
    expect(admin.calls[0].op).toBe("update");
    expect(admin.calls[0].filters).toEqual([
      ["eq:expo_push_token", VALID.expoPushToken],
      ["neq:hub_user_id", "user-1"],
    ]);

    // ...and it must be scoped to *other* users, or it would clobber the row
    // the upsert is about to write.
    expect(admin.calls[1].op).toBe("upsert");
    expect(admin.calls[1].payload).toMatchObject({
      hub_user_id: "user-1",
      status: "active",
      failure_count: 0,
      revoked_at: null,
    });
  });

  it("reactivates a previously revoked installation instead of leaving it dead", async () => {
    const admin = adminDouble();
    const parsed = parseDeviceRegistration(VALID);
    if (!parsed.ok) throw new Error("fixture should parse");

    await registerDevice(admin as never, "user-1", parsed.input);

    const upsert = admin.calls.find((call) => call.op === "upsert");
    expect(upsert?.payload).toMatchObject({ status: "active", revoked_at: null });
  });
});

describe("revokeDevice", () => {
  it("revokes only this member's row for that installation", async () => {
    const admin = adminDouble();
    await revokeDevice(admin as never, "user-1", VALID.installationId);

    expect(admin.calls[0].op).toBe("update");
    expect(admin.calls[0].payload).toMatchObject({ status: "revoked" });
    expect(admin.calls[0].filters).toEqual([
      ["eq:hub_user_id", "user-1"],
      ["eq:installation_id", VALID.installationId],
      ["neq:status", "revoked"],
    ]);
  });
});

describe("token handover", () => {
  it("never sends to a token still filed under the previous account", async () => {
    // The scenario this protects: one phone, member A signs out, member B
    // signs in. Expo hands B's install the same token. Without the release
    // step, A's row keeps it and A keeps getting B's notifications.
    const admin = adminDouble();
    const parsed = parseDeviceRegistration(VALID);
    if (!parsed.ok) throw new Error("fixture should parse");

    await registerDevice(admin as never, "user-B", parsed.input);

    const release = admin.calls[0];
    expect(release.payload).toMatchObject({ expo_push_token: null, status: "revoked" });
  });
});
