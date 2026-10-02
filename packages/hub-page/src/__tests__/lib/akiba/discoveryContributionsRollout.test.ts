import { describe, expect, it } from "vitest";
import {
  getDiscoveryContributionsRolloutConfig,
  isDiscoveryContributionsEnabledFor,
} from "@/lib/akiba/discoveryContributionsRollout";

const USER = "10000000-0000-4000-8000-000000000001";

describe("discoveryContributionsRollout", () => {
  it("is disabled by default with no env configured", () => {
    expect(isDiscoveryContributionsEnabledFor(USER, {})).toBe(false);
  });

  it("stays disabled even at 100% when the global kill switch is off", () => {
    const env = { HUB_DISCOVERY_CONTRIBUTIONS_ROLLOUT_PERCENT: "100" };
    expect(isDiscoveryContributionsEnabledFor(USER, env)).toBe(false);
  });

  it("enables everyone once percentage reaches 100 and the switch is on", () => {
    const env = {
      HUB_DISCOVERY_CONTRIBUTIONS_ENABLED: "true",
      HUB_DISCOVERY_CONTRIBUTIONS_ROLLOUT_PERCENT: "100",
    };
    expect(isDiscoveryContributionsEnabledFor(USER, env)).toBe(true);
  });

  it("lets an allowlisted user through even when percent is 0", () => {
    const env = {
      HUB_DISCOVERY_CONTRIBUTIONS_ENABLED: "true",
      HUB_DISCOVERY_CONTRIBUTIONS_ROLLOUT_PERCENT: "0",
      HUB_DISCOVERY_CONTRIBUTIONS_ALLOWLIST: USER,
    };
    expect(isDiscoveryContributionsEnabledFor(USER, env)).toBe(true);
  });

  it("clamps an out-of-range percentage into 0-100", () => {
    const config = getDiscoveryContributionsRolloutConfig({
      HUB_DISCOVERY_CONTRIBUTIONS_ROLLOUT_PERCENT: "150",
    });
    expect(config.percentage).toBe(100);
  });

  it("is deterministic for the same identifier across calls", () => {
    const env = {
      HUB_DISCOVERY_CONTRIBUTIONS_ENABLED: "true",
      HUB_DISCOVERY_CONTRIBUTIONS_ROLLOUT_PERCENT: "50",
    };
    const first = isDiscoveryContributionsEnabledFor(USER, env);
    const second = isDiscoveryContributionsEnabledFor(USER, env);
    expect(first).toBe(second);
  });
});
