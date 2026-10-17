import {
  merchantOfferFeedSchema,
  ownedVouchersListSchema,
  voucherCatalogueSchema,
  voucherStateSchema,
  type MerchantOfferFeed,
  type MobileHome,
  type OwnedVouchersList,
  type VoucherCatalogue,
  type VoucherState,
} from '@/contracts';

import rawFixture from './screenshot-commerce.json';

const offers = merchantOfferFeedSchema.parse({ offers: rawFixture.offers });
const catalogue = voucherCatalogueSchema.parse(rawFixture.catalogue);
const voucherState = voucherStateSchema.parse(rawFixture.voucherState);
const ownedVouchers = ownedVouchersListSchema.parse(rawFixture.ownedVouchers);

export function isScreenshotModeEnabled(): boolean {
  return process.env.EXPO_PUBLIC_SCREENSHOT_MODE === 'true';
}

export function isScreenshotOfferId(offerId: string): boolean {
  return offerId.startsWith('screenshot-offer-');
}

export function getScreenshotMerchantOffers(): MerchantOfferFeed {
  return offers;
}

export function getScreenshotVoucherCatalogue(): VoucherCatalogue {
  return catalogue;
}

export function getScreenshotVoucherState(): VoucherState {
  return voucherState;
}

export function getScreenshotOwnedVouchers(): OwnedVouchersList {
  return ownedVouchers;
}

export function withScreenshotHomeFixtures(home: MobileHome): MobileHome {
  return {
    ...home,
    feed: {
      ...home.feed,
      businessOffers: offers.offers,
      rewards: home.feed.rewards
        ? { ...home.feed.rewards, milesBalance: voucherState.balance ?? home.feed.rewards.milesBalance }
        : { milesBalance: voucherState.balance ?? 0, continueVoucher: null },
    },
  };
}
