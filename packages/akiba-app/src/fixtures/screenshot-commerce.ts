import { merchantDetailSchema, merchantStateDetailSchema } from '@/contracts/merchant-detail';
import { voucherDetailSchema, type VoucherDetail } from '@/contracts/owned-vouchers';
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

export function getScreenshotVoucherDetail(id: string): VoucherDetail {
  const voucher = ownedVouchers.vouchers.find((item) => item.id === id);
  if (!voucher) throw new Error('Screenshot voucher not found');
  return voucherDetailSchema.parse({ ...voucher, applicableCategory: null, entitlement: {
    title: voucher.title, voucherType: voucher.voucherType, discountPercent: voucher.discountPercent,
    discountKes: null, discountCusd: voucher.discountCusd, retailValueKes: null, retailValueCusd: voucher.retailValueCusd,
    maximumDiscountKes: null, minimumSpendKes: null, terms: 'Present this voucher at checkout. One use per voucher.',
    applicableCategory: null, linkedProductId: null, redemptionSchedule: null,
    merchants: [{ id: 'screenshot-merchant', name: voucher.merchantName ?? 'Akiba Store', slug: voucher.merchantSlug ?? '', imageUrl: null }],
    merchantCount: 1, merchantsIncomplete: false, timing: { kind: 'issued', expiresAt: voucher.expiresAt },
  } });
}

// One consistent fictional commerce profile for local capture sessions only.
export function getScreenshotMerchantDetail() {
  const photo = offers.offers[0].imageUrl;
  return merchantDetailSchema.parse({ merchant: {
    id: offers.offers[0].partner.id, slug: 'akiba-store', name: 'Akiba Store',
    shortDescription: 'Coffee, good food and a reason to come back.',
    description: 'Fresh coffee, pastries and weekly specials. Visit us in Nairobi.',
    logoUrl: null, bannerUrl: photo, websiteUrl: null,
    primaryCategory: { slug: 'food-drink', name: 'Food & Drink' }, categories: [{ slug: 'food-drink', name: 'Food & Drink' }],
    operatingModel: 'physical', primaryLocation: { id: 'screenshot-location', locality: 'Nairobi', city: 'Nairobi', latitude: null, longitude: null },
    branchCount: 1, voucherCount: 1, contacts: { phone: null, email: null, whatsapp: null, instagram: null, facebook: null },
    locations: [{ id: 'screenshot-location', name: 'Akiba Store', locationType: 'store', addressLine1: 'Nairobi', addressLine2: null,
      building: null, floorOrUnit: null, landmark: null, locality: null, city: 'Nairobi', countyOrRegion: null, postalCode: null,
      countryCode: 'KE', latitude: null, longitude: null, mapsUrl: null, publicPhone: null, publicEmail: null, publicWhatsapp: null,
      timezone: 'Africa/Nairobi', openingHours: { monday: [{ opens: '08:00', closes: '18:00' }], tuesday: [{ opens: '08:00', closes: '18:00' }], wednesday: [{ opens: '08:00', closes: '18:00' }], thursday: [{ opens: '08:00', closes: '18:00' }], friday: [{ opens: '08:00', closes: '18:00' }], saturday: [{ opens: '09:00', closes: '17:00' }], sunday: [{ opens: '09:00', closes: '17:00' }] },
      isPrimary: true, acceptsAkibaPass: true, acceptsVouchers: true }],
    coreOfferings: [{ id: 'coffee', name: 'Coffee & pastries', description: 'House coffee and fresh pastries.' }],
    merchantMedia: photo ? [{ id: 'screenshot-media', kind: 'business', imageUrl: photo, thumbnailUrl: photo, altText: 'Coffee selection', title: 'Coffee & pastries' }] : [],
    offers: offers.offers, verifiedVisits: [], verifiedVisitFavoriteProduct: null, approvedCustomerPhotos: [],
  }, vouchers: [], fundedOffers: [] });
}
export function getScreenshotMerchantStateDetail() {
  return merchantStateDetailSchema.parse({ balance: voucherState.balance, saved: false, claimedFundedAllocationIds: [],
    verifiedVisit: null, openContributionRequest: false, helpfulVisitIds: [], offerReminderIds: [] });
}
