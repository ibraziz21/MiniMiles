import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { classifyExpoReceipt } from "@/lib/push/expo";
import { processPushReceipts } from "@/lib/push/receipts";

const NOW = Date.parse("2026-11-10T12:00:00.000Z");
const minutesAgo = (minutes: number) => new Date(NOW - minutes * 60_000).toISOString();

type Update = { table: string; values: Record<string, unknown>; id: string };

/** Just enough of the Supabase client for the poller: one select, many updates. */
function fakeAdmin(pending: unknown[]) {
  const updates: Update[] = [];
  const admin = {
    from(table: string) {
      const select = {
        eq: () => select, not: () => select, is: () => select, lte: () => select, order: () => select,
        limit: async () => ({ data: pending, error: null }),
      };
      return {
        select: () => select,
        update(values: Record<string, unknown>) {
          const chain = {
            eq(column: string, value: string) {
              if (column === "id") updates.push({ table, values, id: value });
              return chain;
            },
            then: (resolve: (value: unknown) => void) => resolve({ error: null }),
          };
          return chain;
        },
      };
    },
  };
  return { admin: admin as never, updates };
}

const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});
afterEach(() => vi.restoreAllMocks());

function receipts(data: Record<string, unknown>) {
  fetchMock.mockResolvedValue({ ok: true, json: async () => ({ data }) });
}

describe("classifyExpoReceipt", () => {
  it("treats credential errors as ours, not the device's", () => {
    const outcome = classifyExpoReceipt({ status: "error", message: "bad key", details: { error: "InvalidCredentials" } });
    expect(outcome).toMatchObject({ ok: false, configError: true, retireDevice: false });
  });

  it("retires a device Apple or Google no longer knows", () => {
    const outcome = classifyExpoReceipt({ status: "error", message: "gone", details: { error: "DeviceNotRegistered" } });
    expect(outcome).toMatchObject({ ok: false, configError: false, retireDevice: true });
  });
});

describe("processPushReceipts", () => {
  it("records a delivered push", async () => {
    const { admin, updates } = fakeAdmin([{ id: "d1", device_id: "dev1", provider_ticket: "t1", accepted_at: minutesAgo(20) }]);
    receipts({ t1: { status: "ok" } });

    const result = await processPushReceipts(admin, NOW);

    expect(fetchMock).toHaveBeenCalledWith(
      "https://exp.host/--/api/v2/push/getReceipts",
      expect.objectContaining({ body: JSON.stringify({ ids: ["t1"] }) }),
    );
    expect(result).toMatchObject({ checked: 1, delivered: 1, failed: 0 });
    expect(updates).toEqual([
      { table: "native_push_deliveries", id: "d1", values: expect.objectContaining({ receipt_status: "ok" }) },
    ]);
  });

  it("retires an uninstalled device and marks the delivery gone", async () => {
    const { admin, updates } = fakeAdmin([{ id: "d1", device_id: "dev1", provider_ticket: "t1", accepted_at: minutesAgo(20) }]);
    receipts({ t1: { status: "error", message: "not registered", details: { error: "DeviceNotRegistered" } } });

    const result = await processPushReceipts(admin, NOW);

    expect(result).toMatchObject({ failed: 1, retiredDevices: 1, configErrors: 0 });
    expect(updates).toContainEqual({
      table: "native_push_deliveries", id: "d1",
      values: expect.objectContaining({ receipt_status: "error", status: "gone" }),
    });
    expect(updates).toContainEqual({ table: "hub_user_devices", id: "dev1", values: expect.objectContaining({ status: "invalid" }) });
  });

  it("flags a credential failure without retiring the device", async () => {
    const { admin, updates } = fakeAdmin([{ id: "d1", device_id: "dev1", provider_ticket: "t1", accepted_at: minutesAgo(20) }]);
    receipts({ t1: { status: "error", message: "no FCM key", details: { error: "InvalidCredentials" } } });

    const result = await processPushReceipts(admin, NOW);

    expect(result).toMatchObject({ failed: 1, configErrors: 1, retiredDevices: 0 });
    expect(updates.some((update) => update.table === "hub_user_devices")).toBe(false);
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining("[push-receipts] CONFIG"));
  });

  it("waits for a receipt that isn't ready, and gives up on one Expo has discarded", async () => {
    const { admin, updates } = fakeAdmin([
      { id: "fresh", device_id: "dev1", provider_ticket: "t1", accepted_at: minutesAgo(20) },
      { id: "stale", device_id: "dev2", provider_ticket: "t2", accepted_at: minutesAgo(25 * 60) },
    ]);
    receipts({});

    const result = await processPushReceipts(admin, NOW);

    expect(result).toMatchObject({ pending: 1, expired: 1 });
    expect(updates).toEqual([
      { table: "native_push_deliveries", id: "stale", values: expect.objectContaining({ receipt_status: "expired" }) },
    ]);
  });

  it("changes nothing when Expo can't be reached", async () => {
    const { admin, updates } = fakeAdmin([{ id: "d1", device_id: "dev1", provider_ticket: "t1", accepted_at: minutesAgo(20) }]);
    fetchMock.mockRejectedValue(new Error("network down"));

    const result = await processPushReceipts(admin, NOW).catch(() => null);

    expect(result).toMatchObject({ checked: 0 });
    expect(updates).toEqual([]);
  });
});
