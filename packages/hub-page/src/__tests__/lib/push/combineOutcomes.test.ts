import { describe, expect, it } from "vitest";

import { combineOutcomes } from "@/lib/push/dispatch";
import { NO_TARGETS, type AdapterResult } from "@/lib/push/adapters/types";

function result(overrides: Partial<AdapterResult> = {}): AdapterResult {
  return { targets: 1, accepted: 1, anyRetryable: false, configError: false, lastError: null, ...overrides };
}

describe("combineOutcomes", () => {
  it("completes a job for a member with no registration anywhere", () => {
    // Not a failure: retrying would never find a target.
    expect(combineOutcomes(NO_TARGETS, NO_TARGETS).outcome).toBe("no_active_subscriptions");
  });

  it("accepts when every transport that had targets succeeded", () => {
    expect(combineOutcomes(result(), result()).outcome).toBe("accepted");
  });

  it("retries when any transport has a retryable target", () => {
    const outcome = combineOutcomes(result(), result({ accepted: 0, anyRetryable: true, lastError: "throttled" }));
    expect(outcome.outcome).toBe("retry");
    expect(outcome.error).toBe("throttled");
  });

  it("reports a configuration error only when nothing got through", () => {
    const broken = result({ accepted: 0, configError: true, anyRetryable: true, lastError: "bad credentials" });
    expect(combineOutcomes(broken, NO_TARGETS).outcome).toBe("config_error");
  });

  it("does not let one broken transport mask another's success", () => {
    // Web delivered; native's credentials are wrong. The member got the
    // notification, so the job must not be re-armed as a config error — the
    // broken transport is visible in its own delivery rows instead.
    const web = result({ accepted: 1 });
    const native = result({ accepted: 0, configError: true, anyRetryable: true, lastError: "InvalidCredentials" });

    expect(combineOutcomes(web, native).outcome).toBe("retry");
  });

  describe("reduces to the previous web-only behaviour", () => {
    // These four cases are exactly what the single-transport dispatcher did,
    // and are the regression guard for having split it in two.
    it("no subscriptions -> no_active_subscriptions", () => {
      expect(combineOutcomes(NO_TARGETS, NO_TARGETS).outcome).toBe("no_active_subscriptions");
    });

    it("uniform auth failure -> config_error", () => {
      const web = result({ accepted: 0, configError: true, anyRetryable: true, lastError: "rejected all sends with 401" });
      expect(combineOutcomes(web, NO_TARGETS)).toEqual({
        outcome: "config_error",
        error: "rejected all sends with 401",
      });
    });

    it("any retryable endpoint -> retry", () => {
      const web = result({ accepted: 0, anyRetryable: true });
      expect(combineOutcomes(web, NO_TARGETS).outcome).toBe("retry");
    });

    it("all delivered -> accepted", () => {
      expect(combineOutcomes(result({ targets: 2, accepted: 2 }), NO_TARGETS).outcome).toBe("accepted");
    });
  });

  it("counts targets across transports, so one side having none is not 'no registration'", () => {
    expect(combineOutcomes(NO_TARGETS, result()).outcome).toBe("accepted");
  });
});
