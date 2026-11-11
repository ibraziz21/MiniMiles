import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));

import { anyVoucherStillUsable, queueVoucherExpiryReminders } from "@/lib/push/voucherExpiry";

const NOW = Date.parse("2026-11-10T09:00:00Z");

function vouchersAdmin(result: { data: unknown; error: unknown }) {
  const query = { select: () => query, in: async () => result };
  return { from: () => query } as never;
}

describe("anyVoucherStillUsable", () => {
  it("is true while one voucher is unused and unexpired", async () => {
    const admin = vouchersAdmin({
      data: [
        { status: "redeemed", expires_at: "2026-11-11T09:00:00Z", redeemed_at: "2026-11-10T08:00:00Z" },
        { status: "issued", expires_at: "2026-11-11T09:00:00Z", redeemed_at: null },
      ],
      error: null,
    });
    expect(await anyVoucherStillUsable(admin, ["a", "b"], NOW)).toBe(true);
  });

  it("is false once every voucher is used or expired", async () => {
    const admin = vouchersAdmin({
      data: [
        { status: "redeemed", expires_at: "2026-11-11T09:00:00Z", redeemed_at: "2026-11-10T08:00:00Z" },
        { status: "issued", expires_at: "2026-11-10T08:59:00Z", redeemed_at: null },
      ],
      error: null,
    });
    expect(await anyVoucherStillUsable(admin, ["a", "b"], NOW)).toBe(false);
  });

  it("is false with no voucher ids, and sends when the lookup fails", async () => {
    expect(await anyVoucherStillUsable(vouchersAdmin({ data: [], error: null }), undefined, NOW)).toBe(false);
    expect(await anyVoucherStillUsable(vouchersAdmin({ data: null, error: { message: "x" } }), ["a"], NOW)).toBe(true);
  });
});

describe("queueVoucherExpiryReminders", () => {
  it("returns how many notifications the database queued", async () => {
    const admin = { rpc: async () => ({ data: 4, error: null }) } as never;
    expect(await queueVoucherExpiryReminders(admin)).toEqual({ queued: 4 });
  });

  it("returns the error instead of throwing", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const admin = { rpc: async () => ({ data: null, error: { message: "boom" } }) } as never;
    expect(await queueVoucherExpiryReminders(admin)).toEqual({ error: "boom" });
  });
});
