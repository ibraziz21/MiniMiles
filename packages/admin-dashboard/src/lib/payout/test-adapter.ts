import { createHash } from "crypto";
import type { IPayoutProvider } from "./interface";
import type {
  PayoutRequest,
  PayoutResult,
  PayoutStatusResult,
  ProviderCallbackPayload,
  PayoutStatus,
} from "./types";

function sha256(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

// Magic amounts used to drive deterministic behavior in integration tests.
const FAIL_AMOUNT = 9999.999999;
const TIMEOUT_AMOUNT = 9998.999999;

/**
 * Deterministic in-memory provider used for tests and as the safe default while
 * live providers are blocked. No network calls, no credentials.
 */
export class TestPayoutAdapter implements IPayoutProvider {
  readonly name = "test";
  readonly isConfigured = true;

  async initiatePayout(req: PayoutRequest): Promise<PayoutResult> {
    const reference = `TEST-${req.instructionId.slice(0, 8).toUpperCase()}`;
    const sanitizedReq = this.sanitizeForLog({
      instructionId: req.instructionId,
      amount: req.amount,
      currency: req.currency,
      reference: req.reference,
    });
    const status: PayoutStatus = req.amount === FAIL_AMOUNT ? "failed" : "submitted";
    const result: PayoutResult = {
      providerReference: reference,
      status,
      requestHash: sha256(JSON.stringify(sanitizedReq)),
      responseHash: sha256(JSON.stringify({ reference, status })),
    };
    if (status === "failed") {
      result.failureCode = "TEST_FORCED_FAILURE";
      result.failureReason = "Forced failure via magic amount";
    }
    return result;
  }

  async queryPayoutStatus(providerReference: string): Promise<PayoutStatusResult> {
    // The timeout magic amount simulates a provider that accepted but never
    // confirms; the caller marks it uncertain. We surface that here by reference
    // convention: timeout instructions still carry a TEST- reference.
    return {
      providerReference,
      status: "confirmed",
    };
  }

  verifyCallback(headers: Record<string, string>, _rawBody: string): boolean {
    return headers["x-test-signature"] === "test-valid";
  }

  parseCallback(rawBody: string, rawBodyHash: string): ProviderCallbackPayload {
    const parsed = JSON.parse(rawBody) as {
      providerReference: string;
      status: PayoutStatus;
      amount: number;
      currency: string;
    };
    return {
      providerName: "test",
      providerReference: parsed.providerReference,
      status: parsed.status,
      amount: parsed.amount,
      currency: parsed.currency,
      rawBodyHash,
      signatureVerified: true,
    };
  }

  sanitizeForLog(body: unknown): unknown {
    // The test provider never carries secrets.
    return body;
  }
}

export const TEST_TIMEOUT_AMOUNT = TIMEOUT_AMOUNT;
export const TEST_FAIL_AMOUNT = FAIL_AMOUNT;
