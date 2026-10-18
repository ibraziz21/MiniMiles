import fixtureData from "@/data/development-merchant-offers.json";
import type { PublicMerchantOfferFeedItem } from "./types";

const FIXTURE_ID_PREFIX = "dev-offer-";

function fixturesEnabled(): boolean {
  return process.env.NODE_ENV === "development" && process.env.AKIBA_TEST_OFFERS !== "false";
}

export function getDevelopmentMerchantOfferFixtures(): PublicMerchantOfferFeedItem[] {
  if (!fixturesEnabled()) return [];
  return fixtureData.offers.map((offer) => ({
    ...offer,
    schedule: offer.schedule as PublicMerchantOfferFeedItem["schedule"],
    requiresAkibaMiles: false,
  }));
}

export function isDevelopmentMerchantOfferFixture(offerId: string): boolean {
  return fixturesEnabled()
    && offerId.startsWith(FIXTURE_ID_PREFIX)
    && fixtureData.offers.some((offer) => offer.id === offerId);
}

export function developmentMerchantOfferSupportsReminders(offerId: string): boolean {
  return isDevelopmentMerchantOfferFixture(offerId)
    && fixtureData.offers.some((offer) => offer.id === offerId && offer.remindersEnabled);
}
