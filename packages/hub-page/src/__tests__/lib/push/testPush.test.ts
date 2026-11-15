import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { sendTestPush } from "@/lib/push/testPush";

function fakeAdmin(devices: unknown[]) {
  const retired: { id: string; token: string }[] = [];
  const recorded: Record<string, unknown>[] = [];
  const select = {
    eq: () => select,
    not: async () => ({ data: devices, error: null }),
  };
  const admin = {
    from: (table: string) => ({
      select: () => select,
      update: () => {
        const filters: Record<string, string> = {};
        const chain = {
          eq(column: string, value: string) {
            filters[column] = value;
            return chain;
          },
          then(resolve: (value: unknown) => void) {
            retired.push({ id: filters.id, token: filters.expo_push_token });
            resolve({ error: null });
          },
        };
        return chain;
      },
      insert: async (rows: Record<string, unknown>[]) => {
        if (table === "native_push_deliveries") recorded.push(...rows);
        return { error: null };
      },
    }),
  };
  return { admin: admin as never, retired, recorded };
}

const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  vi.stubEnv("NATIVE_PUSH_ENABLED", "true");
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

const ANDROID = { id: "dev-a", expo_push_token: "ExponentPushToken[a]", platform: "android" };
const IOS = { id: "dev-i", expo_push_token: "ExponentPushToken[i]", platform: "ios" };

describe("sendTestPush", () => {
  it("says so when native push is switched off on the server", async () => {
    vi.stubEnv("NATIVE_PUSH_ENABLED", "false");
    expect(await sendTestPush(fakeAdmin([ANDROID]).admin, "user-1")).toEqual({ status: "push_disabled" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("says so when the member has no registered device", async () => {
    expect(await sendTestPush(fakeAdmin([]).admin, "user-1")).toEqual({ status: "no_devices" });
  });

  it("sends to every device, on Android's channel, and reports acceptance", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ data: [{ status: "ok", id: "t1" }, { status: "ok", id: "t2" }] }),
    });

    const { admin, recorded } = fakeAdmin([ANDROID, IOS]);
    const result = await sendTestPush(admin, "user-1");

    expect(result).toEqual({ status: "sent", devices: 2, accepted: 2, errors: [] });
    // Recorded as test deliveries with their tickets, so receipts get checked.
    expect(recorded).toEqual([
      expect.objectContaining({ purpose: "test", job_id: null, device_id: "dev-a", push_token: ANDROID.expo_push_token, status: "accepted", provider_ticket: "t1" }),
      expect.objectContaining({ purpose: "test", job_id: null, device_id: "dev-i", push_token: IOS.expo_push_token, status: "accepted", provider_ticket: "t2" }),
    ]);
    const messages = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(messages[0]).toMatchObject({ to: ANDROID.expo_push_token, channelId: "default" });
    expect(messages[1]).not.toHaveProperty("channelId");
  });

  it("retires an uninstalled device and reports Expo's reason", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ data: [{ status: "error", message: "gone", details: { error: "DeviceNotRegistered" } }] }),
    });
    const { admin, retired } = fakeAdmin([ANDROID]);

    const result = await sendTestPush(admin, "user-1");

    expect(result).toEqual({ status: "failed", devices: 1, errors: ["DeviceNotRegistered: gone"] });
    // Only while it still holds the token Expo rejected.
    expect(retired).toEqual([{ id: "dev-a", token: ANDROID.expo_push_token }]);
  });
});
