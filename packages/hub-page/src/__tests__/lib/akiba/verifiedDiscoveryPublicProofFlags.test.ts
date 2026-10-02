import { describe, expect, it } from "vitest";
import {
  isCustomerPhotosPublicEnabled,
  isDiscoverySpotlightEnabled,
  isVerifiedVisitsPublicEnabled,
} from "@/lib/akiba/verifiedDiscoveryPublicProofFlags";

describe("verifiedDiscoveryPublicProofFlags", () => {
  it("defaults every surface to enabled with no env configured", () => {
    expect(isDiscoverySpotlightEnabled({})).toBe(true);
    expect(isVerifiedVisitsPublicEnabled({})).toBe(true);
    expect(isCustomerPhotosPublicEnabled({})).toBe(true);
  });

  it("kills only the spotlight when only its flag is set", () => {
    const env = { HUB_DISCOVERY_SPOTLIGHT_ENABLED: "false" };
    expect(isDiscoverySpotlightEnabled(env)).toBe(false);
    expect(isVerifiedVisitsPublicEnabled(env)).toBe(true);
    expect(isCustomerPhotosPublicEnabled(env)).toBe(true);
  });

  it("kills only verified visits when only its flag is set", () => {
    const env = { HUB_DISCOVERY_VERIFIED_VISITS_PUBLIC_ENABLED: "off" };
    expect(isVerifiedVisitsPublicEnabled(env)).toBe(false);
    expect(isDiscoverySpotlightEnabled(env)).toBe(true);
  });

  it("kills only customer photos when only its flag is set", () => {
    const env = { HUB_DISCOVERY_CUSTOMER_PHOTOS_PUBLIC_ENABLED: "0" };
    expect(isCustomerPhotosPublicEnabled(env)).toBe(false);
    expect(isVerifiedVisitsPublicEnabled(env)).toBe(true);
  });

  it("treats an unrecognized value as not falsy (fails open to enabled, not closed)", () => {
    expect(isDiscoverySpotlightEnabled({ HUB_DISCOVERY_SPOTLIGHT_ENABLED: "disabled-typo" })).toBe(true);
  });
});
