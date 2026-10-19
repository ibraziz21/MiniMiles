import Constants from 'expo-constants';
import { Platform } from 'react-native';
import type { z } from 'zod';

import {
  mobileBootstrapSchema,
  mobileConfigSchema,
  mobileHomeSchema,
  mobilePassSchema,
  passPresentationSchema,
  mobileSettingsSchema,
  settingsUpdateSchema,
  deviceRegistrationSchema,
  notificationPreferencesSchema,
  merchantDirectoryResponseSchema,
  voucherCatalogueSchema,
  voucherStateSchema,
  mobileOverviewSchema,
  merchantStateSchema,
  saveMerchantResponseSchema,
  merchantDetailSchema,
  merchantStateDetailSchema,
  verifiedVisitHelpfulResponseSchema,
  verifiedVisitPhotoUploadIntentSchema,
  verifiedVisitPhotoCompletionSchema,
  verifiedVisitPhotoWithdrawalSchema,
  offerReminderStateSchema,
  merchantOfferFeedSchema,
  ownedVouchersListSchema,
  voucherDetailSchema,
  voucherQuoteSchema,
  voucherRedemptionSchema,
  fundedEligibilitySchema,
  fundedClaimResultSchema,
  loyaltyClaimResultSchema,
  onboardingCompletionSchema,
  accountDeletionSummarySchema,
  accountDeletionChallengeSchema,
  accountDeletionReceiptSchema,
  type MobileBootstrap,
  type MobileConfig,
  type MobileHome,
  type MobilePass,
  type PassPresentation,
  type MobileSettings,
  type SettingsUpdate,
  type DeviceRegistration,
  type NotificationPreferences,
  type NotificationCategory,
  type MerchantDirectoryResponse,
  type VoucherCatalogue,
  type VoucherState,
  type MobileOverview,
  type MerchantState,
  type SaveMerchantResponse,
  type MerchantDetail,
  type MerchantStateDetail,
  type VerifiedVisitHelpfulResponse,
  type VerifiedVisitPhotoUploadIntent,
  type VerifiedVisitPhotoCompletion,
  type VerifiedVisitPhotoWithdrawal,
  type OfferReminderState,
  type MerchantOfferFeed,
  type OwnedVouchersList,
  type VoucherDetail,
  type VoucherQuote,
  type VoucherRedemption,
  type FundedEligibility,
  type FundedClaimResult,
  type LoyaltyClaimResult,
  type VoucherUsePlan,
  type OnboardingCompletion,
  type AccountDeletionSummary,
  type AccountDeletionChallenge,
  type AccountDeletionReceipt,
} from '@/contracts';

import { ApiRequestError } from './errors';
import {
  getScreenshotMerchantOffers,
  getScreenshotOwnedVouchers,
  getScreenshotVoucherCatalogue,
  getScreenshotVoucherState,
  isScreenshotModeEnabled,
  isScreenshotOfferId,
  withScreenshotHomeFixtures,
} from '@/fixtures/screenshot-commerce';

type ApiClientOptions = {
  accessToken?: string | null;
};

function getApiBaseUrl() {
  const value = process.env.EXPO_PUBLIC_API_BASE_URL?.trim();
  if (!value) {
    throw new Error('EXPO_PUBLIC_API_BASE_URL is not configured');
  }
  return value.replace(/\/$/, '');
}

function getNativePlatform(): 'ios' | 'android' {
  if (Platform.OS === 'ios' || Platform.OS === 'android') {
    return Platform.OS;
  }
  throw new Error('The Akiba API client is only available on iOS and Android');
}

function createRequestId() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (character) => {
    const random = Math.floor(Math.random() * 16);
    const value = character === 'x' ? random : (random & 0x3) | 0x8;
    return value.toString(16);
  });
}

function toQueryString(params: Record<string, string | number | undefined>): string {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) query.set(key, String(value));
  }
  const serialized = query.toString();
  return serialized ? `?${serialized}` : '';
}

function getBuildNumber() {
  const expoConfig = Constants.expoConfig;
  if (Platform.OS === 'ios') {
    return expoConfig?.ios?.buildNumber ?? '1';
  }
  return String(expoConfig?.android?.versionCode ?? 1);
}

export function createApiClient({ accessToken }: ApiClientOptions = {}) {
  async function get<T>(path: string, schema: z.ZodType<T, z.ZodTypeDef, unknown>): Promise<T> {
    const headers: Record<string, string> = {
      Accept: 'application/json',
      'X-Akiba-Platform': getNativePlatform(),
      'X-Akiba-App-Version': Constants.expoConfig?.version ?? '0.0.0',
      'X-Akiba-Build': getBuildNumber(),
      'X-Request-Id': createRequestId(),
    };

    if (accessToken) {
      headers.Authorization = `Bearer ${accessToken}`;
    }

    const response = await fetch(`${getApiBaseUrl()}${path}`, { headers });
    const body: unknown = await response.json().catch(() => null);

    if (!response.ok) {
      const serverMessage =
        body && typeof body === 'object' && 'error' in body
          ? (body as { error?: { message?: unknown } }).error?.message
          : null;
      throw new ApiRequestError(
        typeof serverMessage === 'string' ? serverMessage : `Akiba API request failed with ${response.status}`,
        response.status,
        body,
      );
    }

    // Phase 1 may apply the plan's standard { data, meta } envelope. Accept
    // that envelope while keeping the two domain contracts exact and local.
    const payload =
      body && typeof body === 'object' && 'data' in body
        ? (body as { data: unknown }).data
        : body;

    return schema.parse(payload);
  }

  // Mutations are always bearer-authenticated; Content-Type: application/json
  // is sent regardless of whether a body is present (the mutation guard's
  // contract on the hub-page side requires it either way).
  async function mutate<T>(
    method: 'POST' | 'PUT' | 'DELETE' | 'PATCH',
    path: string,
    schema: z.ZodType<T, z.ZodTypeDef, unknown>,
    requestBody?: unknown,
  ): Promise<T> {
    if (!accessToken) {
      return Promise.reject(new Error(`${method} ${path} requires an authenticated access token`));
    }

    const headers: Record<string, string> = {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'X-Akiba-Platform': getNativePlatform(),
      'X-Akiba-App-Version': Constants.expoConfig?.version ?? '0.0.0',
      'X-Akiba-Build': getBuildNumber(),
      'X-Request-Id': createRequestId(),
      Authorization: `Bearer ${accessToken}`,
    };

    const response = await fetch(`${getApiBaseUrl()}${path}`, {
      method,
      headers,
      body: requestBody !== undefined ? JSON.stringify(requestBody) : undefined,
    });
    const body: unknown = await response.json().catch(() => null);

    if (!response.ok) {
      throw new ApiRequestError(`Akiba API request failed with ${response.status}`, response.status, body);
    }

    const payload =
      body && typeof body === 'object' && 'data' in body ? (body as { data: unknown }).data : body;

    return schema.parse(payload);
  }

  return {
    getConfig(): Promise<MobileConfig> {
      return get('/api/v1/config', mobileConfigSchema);
    },
    getBootstrap(): Promise<MobileBootstrap> {
      if (!accessToken) {
        return Promise.reject(new Error('getBootstrap requires an authenticated access token'));
      }
      return get('/api/v1/me/bootstrap', mobileBootstrapSchema);
    },
    // Idempotent on the server: a repeat call returns the first
    // completion's timestamp rather than recording a new one, so a retry
    // after a dropped response is always safe.
    completeOnboarding(): Promise<OnboardingCompletion> {
      return mutate('POST', '/api/v1/me/onboarding/complete', onboardingCompletionSchema);
    },
    // ── Account deletion (AKIBA-MOB-002 §7) ──────────────────────────
    getAccountDeletionSummary(): Promise<AccountDeletionSummary> {
      if (!accessToken) {
        return Promise.reject(new Error('getAccountDeletionSummary requires an authenticated access token'));
      }
      return get('/api/v1/me/account-deletion-summary', accountDeletionSummarySchema);
    },
    requestAccountDeletionChallenge(): Promise<AccountDeletionChallenge> {
      return mutate('POST', '/api/v1/me/account-deletion/challenge', accountDeletionChallengeSchema, {});
    },
    // Idempotent and first-request-wins on the server: a retry after a
    // dropped response returns the original receipt rather than creating a
    // second request or needing a second code.
    submitAccountDeletionRequest(input: {
      challengeId: string;
      otp: string;
      policyVersion: string;
    }): Promise<AccountDeletionReceipt> {
      return mutate('POST', '/api/v1/me/account-deletion-request', accountDeletionReceiptSchema, {
        challengeId: input.challengeId,
        otp: input.otp,
        acknowledgement: true,
        policyVersion: input.policyVersion,
      });
    },
    async getHome(params: { lat?: number; lng?: number; intent?: string } = {}): Promise<MobileHome> {
      const home = await get(`/api/v1/home${toQueryString(params)}`, mobileHomeSchema);
      return isScreenshotModeEnabled() ? withScreenshotHomeFixtures(home) : home;
    },
    getMerchantOffers(): Promise<MerchantOfferFeed> {
      if (isScreenshotModeEnabled()) return Promise.resolve(getScreenshotMerchantOffers());
      return get('/api/v1/merchant-offers', merchantOfferFeedSchema);
    },
    getMerchants(
      params: {
        q?: string;
        category?: string;
        city?: string;
        mode?: 'physical' | 'online' | 'all';
        lat?: number;
        lng?: number;
        radius_km?: number;
      } = {},
    ): Promise<MerchantDirectoryResponse> {
      return get(`/api/v1/merchants${toQueryString(params)}`, merchantDirectoryResponseSchema);
    },
    getPass(): Promise<MobilePass> {
      if (!accessToken) {
        return Promise.reject(new Error('getPass requires an authenticated access token'));
      }
      return get('/api/v1/me/pass', mobilePassSchema);
    },
    getPassPresentation(): Promise<PassPresentation> {
      return mutate('POST', '/api/v1/me/pass/token', passPresentationSchema);
    },
    // ── Native push (migration plan P1 "Native push") ────────────────
    // Registration is idempotent on the server: the same installation
    // re-registering after a token rotation updates its row rather than
    // adding one, so retrying after a dropped response is always safe.
    registerDevice(input: {
      installationId: string;
      platform: 'ios' | 'android';
      expoPushToken: string;
      appVersion?: string | null;
      buildNumber?: string | null;
      locale?: string | null;
      timezone?: string | null;
    }): Promise<DeviceRegistration> {
      return mutate('POST', '/api/v1/me/devices', deviceRegistrationSchema, input);
    },
    // Also idempotent: unregistering an installation that is already revoked
    // (or was never registered) succeeds rather than erroring.
    unregisterDevice(installationId: string): Promise<DeviceRegistration> {
      return mutate('DELETE', '/api/v1/me/devices', deviceRegistrationSchema, { installationId });
    },
    getNotificationPreferences(): Promise<NotificationPreferences> {
      if (!accessToken) {
        return Promise.reject(new Error('getNotificationPreferences requires an authenticated access token'));
      }
      return get('/api/v1/me/notification-preferences', notificationPreferencesSchema);
    },
    updateNotificationPreferences(patch: Partial<Record<NotificationCategory, boolean>>): Promise<NotificationPreferences> {
      return mutate('PATCH', '/api/v1/me/notification-preferences', notificationPreferencesSchema, patch);
    },
    getSettings(): Promise<MobileSettings> {
      if (!accessToken) {
        return Promise.reject(new Error('getSettings requires an authenticated access token'));
      }
      return get('/api/v1/me/settings', mobileSettingsSchema);
    },
    updateSettings(input: { username?: string; phone?: string; country?: string; city?: string }): Promise<SettingsUpdate> {
      return mutate('PATCH', '/api/v1/me/settings', settingsUpdateSchema, input);
    },
    getVouchers(): Promise<VoucherCatalogue> {
      if (isScreenshotModeEnabled()) return Promise.resolve(getScreenshotVoucherCatalogue());
      return get('/api/v1/vouchers', voucherCatalogueSchema);
    },
    getVoucherState(): Promise<VoucherState> {
      if (!accessToken) {
        return Promise.reject(new Error('getVoucherState requires an authenticated access token'));
      }
      if (isScreenshotModeEnabled()) return Promise.resolve(getScreenshotVoucherState());
      return get('/api/v1/me/voucher-state', voucherStateSchema);
    },
    getOverview(): Promise<MobileOverview> {
      if (!accessToken) {
        return Promise.reject(new Error('getOverview requires an authenticated access token'));
      }
      return get('/api/v1/me/overview', mobileOverviewSchema);
    },
    getMerchantState(ids: string[]): Promise<MerchantState> {
      if (!accessToken) {
        return Promise.reject(new Error('getMerchantState requires an authenticated access token'));
      }
      return get(`/api/v1/me/merchant-state${toQueryString({ ids: ids.join(',') })}`, merchantStateSchema);
    },
    saveMerchant(slug: string): Promise<SaveMerchantResponse> {
      return mutate('POST', `/api/v1/merchants/${slug}/save`, saveMerchantResponseSchema);
    },
    unsaveMerchant(slug: string): Promise<SaveMerchantResponse> {
      return mutate('DELETE', `/api/v1/merchants/${slug}/save`, saveMerchantResponseSchema);
    },
    getMerchantDetail(slug: string, options: { freshPhotos?: boolean } = {}): Promise<MerchantDetail> {
      // Customer photos use short-lived signed storage URLs. A unique query
      // key bypasses any browser/CDN response that can outlive those URLs.
      return get(
        `/api/v1/merchants/${slug}${toQueryString({ photo_refresh: options.freshPhotos ? Date.now() : undefined })}`,
        merchantDetailSchema,
      );
    },
    getMerchantStateDetail(slug: string): Promise<MerchantStateDetail> {
      if (!accessToken) {
        return Promise.reject(new Error('getMerchantStateDetail requires an authenticated access token'));
      }
      return get(`/api/v1/me/merchant-state/${slug}`, merchantStateDetailSchema);
    },
    markVerifiedVisitHelpful(slug: string, visitId: string): Promise<VerifiedVisitHelpfulResponse> {
      return mutate(
        'POST',
        `/api/v1/merchants/${encodeURIComponent(slug)}/verified-visits/${encodeURIComponent(visitId)}/helpful`,
        verifiedVisitHelpfulResponseSchema,
        {},
      );
    },
    unmarkVerifiedVisitHelpful(slug: string, visitId: string): Promise<VerifiedVisitHelpfulResponse> {
      return mutate(
        'DELETE',
        `/api/v1/merchants/${encodeURIComponent(slug)}/verified-visits/${encodeURIComponent(visitId)}/helpful`,
        verifiedVisitHelpfulResponseSchema,
      );
    },
    createVerifiedVisitPhotoUploadIntent(
      contributionId: string,
      contentType: string,
    ): Promise<VerifiedVisitPhotoUploadIntent> {
      return mutate(
        'POST',
        `/api/v1/me/discovery-contributions/${encodeURIComponent(contributionId)}/photos/upload-intent`,
        verifiedVisitPhotoUploadIntentSchema,
        { contentType, consentVersion: 'v1' },
      );
    },
    completeVerifiedVisitPhotoUpload(
      contributionId: string,
      photoId: string,
    ): Promise<VerifiedVisitPhotoCompletion> {
      return mutate(
        'POST',
        `/api/v1/me/discovery-contributions/${encodeURIComponent(contributionId)}/photos/${encodeURIComponent(photoId)}/complete`,
        verifiedVisitPhotoCompletionSchema,
        {},
      );
    },
    withdrawVerifiedVisitPhoto(
      contributionId: string,
      photoId: string,
    ): Promise<VerifiedVisitPhotoWithdrawal> {
      return mutate(
        'DELETE',
        `/api/v1/me/discovery-contributions/${encodeURIComponent(contributionId)}/photos/${encodeURIComponent(photoId)}`,
        verifiedVisitPhotoWithdrawalSchema,
      );
    },
    getOfferReminder(offerId: string): Promise<OfferReminderState> {
      if (!accessToken) {
        return Promise.reject(new Error('getOfferReminder requires an authenticated access token'));
      }
      if (isScreenshotModeEnabled() && isScreenshotOfferId(offerId)) {
        return Promise.resolve({ reminder: null });
      }
      return get(`/api/v1/merchant-offers/${offerId}/reminder`, offerReminderStateSchema);
    },
    setOfferReminder(offerId: string, leadMinutes: 30 | 60 | 1440): Promise<OfferReminderState> {
      if (isScreenshotModeEnabled() && isScreenshotOfferId(offerId)) {
        if (!accessToken) return Promise.reject(new Error('setOfferReminder requires an authenticated access token'));
        return Promise.resolve({ reminder: { leadMinutes } });
      }
      return mutate('PUT', `/api/v1/merchant-offers/${offerId}/reminder`, offerReminderStateSchema, { leadMinutes });
    },
    removeOfferReminder(offerId: string): Promise<OfferReminderState> {
      if (isScreenshotModeEnabled() && isScreenshotOfferId(offerId)) {
        if (!accessToken) return Promise.reject(new Error('removeOfferReminder requires an authenticated access token'));
        return Promise.resolve({ reminder: null });
      }
      return mutate('DELETE', `/api/v1/merchant-offers/${offerId}/reminder`, offerReminderStateSchema);
    },
    getOwnedVouchers(
      params: { status?: 'active' | 'redeemed' | 'expired'; cursor?: string; limit?: number } = {},
    ): Promise<OwnedVouchersList> {
      if (!accessToken) {
        return Promise.reject(new Error('getOwnedVouchers requires an authenticated access token'));
      }
      if (isScreenshotModeEnabled()) {
        const result = getScreenshotOwnedVouchers();
        const vouchers = params.status
          ? result.vouchers.filter((voucher) => voucher.status === params.status)
          : result.vouchers;
        return Promise.resolve({ vouchers, next_cursor: null });
      }
      return get(`/api/v1/me/vouchers${toQueryString(params)}`, ownedVouchersListSchema);
    },
    getVoucherDetail(id: string): Promise<VoucherDetail> {
      if (!accessToken) {
        return Promise.reject(new Error('getVoucherDetail requires an authenticated access token'));
      }
      return get(`/api/v1/me/vouchers/${id}`, voucherDetailSchema);
    },
    getVoucherQuote(templateId: string): Promise<VoucherQuote> {
      return mutate('POST', '/api/v1/vouchers/quote', voucherQuoteSchema, { template_id: templateId });
    },
    redeemVoucher(input: {
      templateId: string;
      quoteId: string;
      intentConfirmed: boolean;
      usePlan?: VoucherUsePlan;
    }): Promise<VoucherRedemption> {
      return mutate('POST', '/api/v1/vouchers/redeem', voucherRedemptionSchema, {
        template_id: input.templateId,
        quote_id: input.quoteId,
        confirmed: true,
        intent_confirmed: input.intentConfirmed,
        use_plan: input.usePlan,
      });
    },
    getFundedEligibility(allocationId: string): Promise<FundedEligibility> {
      if (!accessToken) {
        return Promise.reject(new Error('getFundedEligibility requires an authenticated access token'));
      }
      return get(`/api/v1/vouchers/funded/${allocationId}/eligibility`, fundedEligibilitySchema);
    },
    claimFundedOffer(
      allocationId: string,
      input: { intentConfirmed: boolean; usePlan?: VoucherUsePlan },
    ): Promise<FundedClaimResult> {
      return mutate('POST', `/api/v1/vouchers/funded/${allocationId}/claim`, fundedClaimResultSchema, {
        intent_confirmed: input.intentConfirmed,
        use_plan: input.usePlan,
      });
    },
    claimLoyaltyOffer(
      templateId: string,
      input: { intentConfirmed: boolean; usePlan?: VoucherUsePlan },
    ): Promise<LoyaltyClaimResult> {
      return mutate('POST', `/api/v1/vouchers/loyalty/${templateId}/claim`, loyaltyClaimResultSchema, {
        intent_confirmed: input.intentConfirmed,
        use_plan: input.usePlan,
      });
    },
  };
}
