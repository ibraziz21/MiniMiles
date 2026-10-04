import { afterEach, describe, expect, it, vi } from "vitest";
import { akibaFundedVouchersAdminFlag, akibaFundedVouchersFinanceFlag } from "@/lib/featureFlags";

describe("akibaFundedVouchersAdminFlag / akibaFundedVouchersFinanceFlag", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("both default to disabled when unset", () => {
    vi.stubEnv("AKIBA_FUNDED_VOUCHERS_ADMIN_ENABLED", "");
    vi.stubEnv("AKIBA_FUNDED_VOUCHERS_FINANCE_ENABLED", "");

    expect(akibaFundedVouchersAdminFlag()).toBe(false);
    expect(akibaFundedVouchersFinanceFlag()).toBe(false);
  });

  it("enable independently of each other", () => {
    vi.stubEnv("AKIBA_FUNDED_VOUCHERS_ADMIN_ENABLED", "true");
    vi.stubEnv("AKIBA_FUNDED_VOUCHERS_FINANCE_ENABLED", "");

    expect(akibaFundedVouchersAdminFlag()).toBe(true);
    expect(akibaFundedVouchersFinanceFlag()).toBe(false);
  });

  it("require the exact string 'true', not any other truthy-looking value", () => {
    vi.stubEnv("AKIBA_FUNDED_VOUCHERS_ADMIN_ENABLED", "1");

    expect(akibaFundedVouchersAdminFlag()).toBe(false);
  });
});
