import { describe, expect, it } from "vitest";
import {
  isCustomerPhotosPublicEnabled,
  isDiscoverySpotlightEnabled,
  isDiscoverySnapshotReadEnabled,
  isVerifiedVisitsPublicEnabled,
} from "@/lib/akiba/verifiedDiscoveryPublicProofFlags";

describe("verifiedDiscoveryPublicProofFlags", () => {
  it("fails closed in production when flags are missing", () => {
    const env = { NODE_ENV: "production" };
    expect(isDiscoverySpotlightEnabled(env)).toBe(false);
    expect(isVerifiedVisitsPublicEnabled(env)).toBe(false);
    expect(isCustomerPhotosPublicEnabled(env)).toBe(false);
  });

  it("keeps local development enabled by default", () => {
    expect(isDiscoverySpotlightEnabled({ NODE_ENV: "development" })).toBe(true);
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

  it("fails closed for an unrecognized value", () => {
    expect(isDiscoverySpotlightEnabled({ HUB_DISCOVERY_SPOTLIGHT_ENABLED: "disabled-typo" })).toBe(false);
  });

  it("keeps the full-corpus snapshot read explicitly opt-in in every environment", () => {
    expect(isDiscoverySnapshotReadEnabled({ NODE_ENV: "development" })).toBe(false);
    expect(isDiscoverySnapshotReadEnabled({ HUB_DISCOVERY_SNAPSHOT_READ_ENABLED: "true" })).toBe(true);
    expect(isDiscoverySnapshotReadEnabled({ HUB_DISCOVERY_SNAPSHOT_READ_ENABLED: "typo" })).toBe(false);
  });
});
