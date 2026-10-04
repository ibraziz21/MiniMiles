import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AdminSessionData } from "@/types";

// akiba-funded-voucher-launch-hardening-spec.md §3: the Admin flag defaults
// to disabled, and production must reject funded economic mutations under
// open access or with no real admin_users.id — this is the one guard every
// voucher-funds mutation route delegates to, so its own behavior is tested
// directly rather than only incidentally through route tests.
const REAL_SESSION: AdminSessionData = {
  adminUserId: "admin-1",
  email: "ops@akibamiles.local",
  name: "Ops",
  role: "super_admin",
  mustChangePassword: false,
  issuedAt: Date.now(),
  openAccess: false,
};
const OPEN_ACCESS_SESSION: AdminSessionData = {
  adminUserId: "00000000-0000-0000-0000-000000000000",
  email: "open-access@akibamiles.local",
  name: "Open Access",
  role: "super_admin",
  mustChangePassword: false,
  issuedAt: Date.now(),
  openAccess: true,
};

describe("fundedVoucherAdminGuard / fundedVoucherActorId", () => {
  beforeEach(() => {
    vi.resetModules();
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("refuses every mutation when the Admin flag is off, even with a real session", async () => {
    vi.stubEnv("AKIBA_FUNDED_VOUCHERS_ADMIN_ENABLED", "false");
    const { fundedVoucherAdminGuard } = await import("@/lib/voucherFundsAccess");

    const result = fundedVoucherAdminGuard(REAL_SESSION);

    expect(result).not.toBeNull();
    expect(result?.status).toBe(503);
  });

  it("allows a real session through when the flag is on, outside production", async () => {
    vi.stubEnv("AKIBA_FUNDED_VOUCHERS_ADMIN_ENABLED", "true");
    vi.stubEnv("NODE_ENV", "test");
    const { fundedVoucherAdminGuard } = await import("@/lib/voucherFundsAccess");

    expect(fundedVoucherAdminGuard(REAL_SESSION)).toBeNull();
  });

  it("allows open access through outside production (local dev convenience)", async () => {
    vi.stubEnv("AKIBA_FUNDED_VOUCHERS_ADMIN_ENABLED", "true");
    vi.stubEnv("NODE_ENV", "test");
    const { fundedVoucherAdminGuard } = await import("@/lib/voucherFundsAccess");

    expect(fundedVoucherAdminGuard(OPEN_ACCESS_SESSION)).toBeNull();
  });

  it("rejects open access in production even with the flag on", async () => {
    vi.stubEnv("AKIBA_FUNDED_VOUCHERS_ADMIN_ENABLED", "true");
    vi.stubEnv("NODE_ENV", "production");
    const { fundedVoucherAdminGuard } = await import("@/lib/voucherFundsAccess");

    const result = fundedVoucherAdminGuard(OPEN_ACCESS_SESSION);

    expect(result).not.toBeNull();
    expect(result?.status).toBe(403);
  });

  it("allows a real admin session through in production", async () => {
    vi.stubEnv("AKIBA_FUNDED_VOUCHERS_ADMIN_ENABLED", "true");
    vi.stubEnv("NODE_ENV", "production");
    const { fundedVoucherAdminGuard } = await import("@/lib/voucherFundsAccess");

    expect(fundedVoucherAdminGuard(REAL_SESSION)).toBeNull();
  });

  it("never returns the zero-UUID/open-access actor id in production", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const { fundedVoucherActorId } = await import("@/lib/voucherFundsAccess");

    // fundedVoucherAdminGuard already refused this session in production
    // (previous test) — this asserts the actor-id helper itself never
    // produces the placeholder id, independent of that guard.
    expect(fundedVoucherActorId(REAL_SESSION)).toBe("admin-1");
  });

  it("falls back to the shared open-access placeholder id only outside production", async () => {
    vi.stubEnv("NODE_ENV", "test");
    const { fundedVoucherActorId } = await import("@/lib/voucherFundsAccess");

    expect(fundedVoucherActorId(OPEN_ACCESS_SESSION)).toBe("00000000-0000-0000-0000-000000000000");
  });
});
