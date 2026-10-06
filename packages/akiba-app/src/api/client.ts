import Constants from 'expo-constants';
import { Platform } from 'react-native';
import type { z } from 'zod';

import {
  mobileBootstrapSchema,
  mobileConfigSchema,
  mobileHomeSchema,
  mobilePassSchema,
  mobileSettingsSchema,
  settingsUpdateSchema,
  merchantDirectoryResponseSchema,
  voucherCatalogueSchema,
  voucherStateSchema,
  mobileOverviewSchema,
  merchantStateSchema,
  saveMerchantResponseSchema,
  merchantDetailSchema,
  merchantStateDetailSchema,
  ownedVouchersListSchema,
  voucherDetailSchema,
  voucherQuoteSchema,
  voucherRedemptionSchema,
  fundedEligibilitySchema,
  fundedClaimResultSchema,
  loyaltyClaimResultSchema,
  type MobileBootstrap,
  type MobileConfig,
  type MobileHome,
  type MobilePass,
  type MobileSettings,
  type SettingsUpdate,
  type MerchantDirectoryResponse,
  type VoucherCatalogue,
  type VoucherState,
  type MobileOverview,
  type MerchantState,
  type SaveMerchantResponse,
  type MerchantDetail,
  type MerchantStateDetail,
  type OwnedVouchersList,
  type VoucherDetail,
  type VoucherQuote,
  type VoucherRedemption,
  type FundedEligibility,
  type FundedClaimResult,
  type LoyaltyClaimResult,
  type VoucherUsePlan,
} from '@/contracts';

type ApiClientOptions = {
  accessToken?: string | null;
};

export class ApiRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body: unknown,
  ) {
    super(message);
    this.name = 'ApiRequestError';
  }
}

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
  async function get<T>(path: string, schema: z.ZodType<T>): Promise<T> {
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
    method: 'POST' | 'DELETE' | 'PATCH',
    path: string,
    schema: z.ZodType<T>,
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
    getHome(params: { lat?: number; lng?: number; intent?: string } = {}): Promise<MobileHome> {
      return get(`/api/v1/home${toQueryString(params)}`, mobileHomeSchema);
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
      return get('/api/v1/vouchers', voucherCatalogueSchema);
    },
    getVoucherState(): Promise<VoucherState> {
      if (!accessToken) {
        return Promise.reject(new Error('getVoucherState requires an authenticated access token'));
      }
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
    getMerchantDetail(slug: string): Promise<MerchantDetail> {
      return get(`/api/v1/merchants/${slug}`, merchantDetailSchema);
    },
    getMerchantStateDetail(slug: string): Promise<MerchantStateDetail> {
      if (!accessToken) {
        return Promise.reject(new Error('getMerchantStateDetail requires an authenticated access token'));
      }
      return get(`/api/v1/me/merchant-state/${slug}`, merchantStateDetailSchema);
    },
    getOwnedVouchers(
      params: { status?: 'active' | 'redeemed' | 'expired'; cursor?: string; limit?: number } = {},
    ): Promise<OwnedVouchersList> {
      if (!accessToken) {
        return Promise.reject(new Error('getOwnedVouchers requires an authenticated access token'));
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
