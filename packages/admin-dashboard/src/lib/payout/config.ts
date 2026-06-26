/**
 * Payout configuration helpers.
 *
 * Call validatePayoutConfig() once at startup (or at the top of any route
 * that performs payout operations) so misconfiguration is caught immediately
 * rather than at first use.
 *
 * Generate keys with:
 *   openssl rand -hex 32   → PAYOUT_ENCRYPTION_KEY (64-char hex)
 *   openssl rand -hex 32   → RECONCILIATION_CRON_SECRET
 */

export function validatePayoutConfig(): void {
  const key = process.env.PAYOUT_ENCRYPTION_KEY ?? "";
  if (!key) {
    throw new Error(
      "PAYOUT_ENCRYPTION_KEY is not set. Generate one with: openssl rand -hex 32",
    );
  }
  if (key.length !== 64 || !/^[0-9a-f]+$/i.test(key)) {
    throw new Error(
      "PAYOUT_ENCRYPTION_KEY must be exactly 64 hex characters [0-9a-f]. " +
      "Generate one with: openssl rand -hex 32",
    );
  }
}

export function isProductionEnv(): boolean {
  return process.env.NODE_ENV === "production";
}

/** Test provider is only allowed outside production. */
export function isTestProviderAllowed(): boolean {
  if (isProductionEnv()) return false;
  // Opt-in override for CI/staging environments that deliberately want it blocked.
  if (process.env.ALLOW_TEST_PAYOUT_PROVIDER === "false") return false;
  return true;
}
