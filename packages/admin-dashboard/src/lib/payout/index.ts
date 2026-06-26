import { createHash } from "crypto";
import type { IPayoutProvider } from "./interface";
import type {
  PayoutRequest,
  PayoutResult,
  PayoutStatusResult,
  ProviderCallbackPayload,
} from "./types";
import { TestPayoutAdapter } from "./test-adapter";
import { MpesaB2CAdapter } from "./mpesa-b2c";
import { isTestProviderAllowed } from "./config";

function sha256(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

/**
 * Manual payout adapter: an operator pays out off-platform (e.g. bank transfer)
 * and confirms via the manual-confirm endpoint. Never auto-confirms.
 */
export class ManualPayoutAdapter implements IPayoutProvider {
  readonly name = "manual";
  readonly isConfigured = true;

  async initiatePayout(req: PayoutRequest): Promise<PayoutResult> {
    const reference = `MANUAL-${Date.now()}`;
    return {
      providerReference: reference,
      status: "submitted",
      requestHash: sha256(JSON.stringify({ instructionId: req.instructionId, amount: req.amount })),
      responseHash: sha256(JSON.stringify({ reference })),
    };
  }

  async queryPayoutStatus(providerReference: string): Promise<PayoutStatusResult> {
    // Manual payouts can only be resolved by a human; never auto-confirm.
    return { providerReference, status: "uncertain" };
  }

  verifyCallback(_headers: Record<string, string>, _rawBody: string): boolean {
    return false; // manual provider has no inbound webhooks
  }

  parseCallback(_rawBody: string, _rawBodyHash: string): ProviderCallbackPayload {
    throw new Error("MANUAL_PROVIDER_HAS_NO_CALLBACKS");
  }

  sanitizeForLog(body: unknown): unknown {
    return body;
  }
}

const REGISTRY: Record<string, () => IPayoutProvider> = {
  test: () => new TestPayoutAdapter(),
  manual: () => new ManualPayoutAdapter(),
  mpesa_b2c: () => new MpesaB2CAdapter(),
  // celo intentionally omitted: no signing key provisioned (blocked).
};

export function getPayoutProvider(name: string): IPayoutProvider {
  if (name === "test" && !isTestProviderAllowed()) {
    throw new Error("TEST_PROVIDER_NOT_ALLOWED_IN_PRODUCTION");
  }
  const factory = REGISTRY[name];
  if (!factory) {
    throw new Error(`UNKNOWN_PAYOUT_PROVIDER: ${name}`);
  }
  return factory();
}

export type {
  IPayoutProvider,
  PayoutRequest,
  PayoutResult,
  PayoutStatusResult,
  ProviderCallbackPayload,
};
export { TestPayoutAdapter, MpesaB2CAdapter };
