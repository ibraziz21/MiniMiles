import { afterEach, describe, expect, it, vi } from "vitest";
import {
  developmentMerchantOfferSupportsReminders,
  getDevelopmentMerchantOfferFixtures,
  isDevelopmentMerchantOfferFixture,
} from "@/lib/merchants/developmentOfferFixtures";

describe("development merchant offer fixtures", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("provides varied, contract-shaped offers only in development", () => {
    vi.stubEnv("NODE_ENV", "development");
    const offers = getDevelopmentMerchantOfferFixtures();

    expect(offers).toHaveLength(10);
    expect(offers.every((offer) => offer.id.startsWith("dev-offer-"))).toBe(true);
    expect(offers.every((offer) => offer.requiresAkibaMiles === false)).toBe(true);
    expect(offers.some((offer) => offer.schedule === "weekly")).toBe(true);
    expect(offers.some((offer) => offer.imageUrl === null)).toBe(true);
    expect(offers.some((offer) => !offer.remindersEnabled)).toBe(true);
    expect(offers.some((offer) => offer.startsOn !== null)).toBe(true);
  });

  it("can be disabled while running the local development server", () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("AKIBA_TEST_OFFERS", "false");

    expect(getDevelopmentMerchantOfferFixtures()).toEqual([]);
    expect(isDevelopmentMerchantOfferFixture("dev-offer-coffee-pairing")).toBe(false);
  });

  it("does not expose fixtures outside development", () => {
    vi.stubEnv("NODE_ENV", "production");

    expect(getDevelopmentMerchantOfferFixtures()).toEqual([]);
  });

  it("recognizes fixture reminder capability", () => {
    vi.stubEnv("NODE_ENV", "development");

    expect(developmentMerchantOfferSupportsReminders("dev-offer-coffee-pairing")).toBe(true);
    expect(developmentMerchantOfferSupportsReminders("dev-offer-no-reminders")).toBe(false);
    expect(isDevelopmentMerchantOfferFixture("offer-from-the-database")).toBe(false);
  });
});
