// NOTE: M-Pesa B2C (Business-to-Customer) payout credentials are NOT configured.
// This is DIFFERENT from the STK Push credentials used for customer payments.
// Required env vars: MPESA_B2C_INITIATOR_NAME, MPESA_B2C_SECURITY_CREDENTIAL,
//                    MPESA_B2C_SHORTCODE, MPESA_B2C_RESULT_URL, MPESA_B2C_TIMEOUT_URL
// Live payout execution is BLOCKED until these credentials are provisioned.

import type { IPayoutProvider } from "./interface";
import type {
  PayoutRequest,
  PayoutResult,
  PayoutStatusResult,
  ProviderCallbackPayload,
} from "./types";

const NOT_CONFIGURED = "MPESA_B2C_NOT_CONFIGURED: B2C credentials not provisioned";

export class MpesaB2CAdapter implements IPayoutProvider {
  readonly name = "mpesa_b2c";
  // Intentionally hard-coded false: credentials are not provisioned and live
  // execution must remain blocked even if the env vars are partially present.
  readonly isConfigured = false;

  async initiatePayout(_req: PayoutRequest): Promise<PayoutResult> {
    throw new Error(NOT_CONFIGURED);
  }

  async queryPayoutStatus(_providerReference: string): Promise<PayoutStatusResult> {
    throw new Error(NOT_CONFIGURED);
  }

  verifyCallback(_headers: Record<string, string>, _rawBody: string): boolean {
    throw new Error(NOT_CONFIGURED);
  }

  parseCallback(_rawBody: string, _rawBodyHash: string): ProviderCallbackPayload {
    throw new Error(NOT_CONFIGURED);
  }

  sanitizeForLog(_body: unknown): unknown {
    throw new Error(NOT_CONFIGURED);
  }
}
