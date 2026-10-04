import { describe, expect, it } from "vitest";
import { akibaFundedVouchersHubFlag } from "@/lib/featureFlags.server";

const CONFIGURED = { NEXT_PUBLIC_SUPABASE_URL: "https://x.supabase.co", SUPABASE_SERVICE_KEY: "key" };

describe("akibaFundedVouchersHubFlag", () => {
  it("defaults to disabled when unset, even outside production", () => {
    const result = akibaFundedVouchersHubFlag({ ...CONFIGURED });
    expect(result.enabled).toBe(false);
  });

  it("stays disabled on an explicit false", () => {
    const result = akibaFundedVouchersHubFlag({ ...CONFIGURED, AKIBA_FUNDED_VOUCHERS_HUB_ENABLED: "false" });
    expect(result.enabled).toBe(false);
  });

  it("enables only on an explicit truthy value with Supabase config present", () => {
    const result = akibaFundedVouchersHubFlag({ ...CONFIGURED, AKIBA_FUNDED_VOUCHERS_HUB_ENABLED: "true" });
    expect(result.enabled).toBe(true);
  });

  it("stays disabled when enabled but Supabase config is missing", () => {
    const result = akibaFundedVouchersHubFlag({ AKIBA_FUNDED_VOUCHERS_HUB_ENABLED: "true" });
    expect(result.enabled).toBe(false);
    expect(result.reason).toMatch(/supabase/i);
  });
});
