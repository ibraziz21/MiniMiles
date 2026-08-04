/**
 * Server-only environment contract and validation.
 *
 * Every server module that reads `process.env` directly today (admin.ts,
 * pass-token.ts, mpesa.ts, middleware.ts, ...) should migrate to reading
 * from `getServerEnv()` instead. This is the single place production
 * configuration is validated — required secrets never silently fall back to
 * another credential, and production cannot boot with sandbox/localhost
 * values (production-readiness-security-spec.md §10.2).
 *
 * Import only from server code (route handlers, server components, RPC
 * wrappers, middleware). Never import from client components.
 */

export type MpesaEnvironment = "sandbox" | "production";

export type ServerEnv = {
  nodeEnv: string;
  isProduction: boolean;
  supabase: {
    url: string;
    anonKey: string;
    serviceKey: string;
  };
  siteUrl: string;
  reactAppUrl: string | null;
  celo: {
    rpcUrl: string;
    minipointsAddress: string | null;
  };
  akiba: {
    apiUrl: string | null;
    apiKey: string | null;
    partnerSlug: string | null;
    partnerKeyId: string | null;
    webhookSecret: string | null;
  };
  hubPassSecret: string | null;
  hubReferralSecret: string | null;
  internalWebhookSecret: string | null;
  cronSecret: string | null;
  directoryRevalidationSecret: string | null;
  mpesa: {
    env: MpesaEnvironment;
    consumerKey: string | null;
    consumerSecret: string | null;
    shortcode: string | null;
    passkey: string | null;
    callbackUrl: string;
    callbackSecret: string | null;
    usdToKes: number;
  };
  webPush: {
    publicKey: string | null;
    privateKey: string | null;
    subject: string | null;
  };
};

const MIN_SECRET_LENGTH = 32;

class EnvValidationError extends Error {
  constructor(problems: string[]) {
    super(
      `Invalid environment configuration:\n${problems.map((p) => `  - ${p}`).join("\n")}`
    );
    this.name = "EnvValidationError";
  }
}

function trimmedOrNull(value: string | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function isValidUrl(value: string): boolean {
  try {
    new URL(value);
    return true;
  } catch {
    return false;
  }
}

function isLocalhostUrl(value: string): boolean {
  try {
    const { hostname } = new URL(value);
    return (
      hostname === "localhost" ||
      hostname === "127.0.0.1" ||
      hostname === "0.0.0.0" ||
      hostname.endsWith(".local")
    );
  } catch {
    return true;
  }
}

let cached: ServerEnv | null = null;

/**
 * Reads and validates the process environment. Cached after the first call
 * within a process/lambda instance. Throws `EnvValidationError` when
 * required production configuration is missing or malformed — callers that
 * need a feature to fail closed instead of crashing the whole request
 * should check the relevant feature flag (see `featureFlags.server.ts`)
 * rather than calling this directly inside a hot path without a try/catch.
 */
export function getServerEnv(env: NodeJS.ProcessEnv = process.env): ServerEnv {
  if (cached) return cached;

  const nodeEnv = env.NODE_ENV ?? "development";
  const isProduction = nodeEnv === "production";
  const problems: string[] = [];

  const supabaseUrl = trimmedOrNull(env.NEXT_PUBLIC_SUPABASE_URL);
  const supabaseAnonKey = trimmedOrNull(env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
  const supabaseServiceKey = trimmedOrNull(env.SUPABASE_SERVICE_KEY);

  if (!supabaseUrl || !isValidUrl(supabaseUrl)) {
    problems.push("NEXT_PUBLIC_SUPABASE_URL must be a valid URL");
  }
  if (!supabaseAnonKey) {
    problems.push("NEXT_PUBLIC_SUPABASE_ANON_KEY is required");
  }
  if (!supabaseServiceKey) {
    problems.push("SUPABASE_SERVICE_KEY is required");
  } else if (isProduction && supabaseServiceKey.length < MIN_SECRET_LENGTH) {
    problems.push("SUPABASE_SERVICE_KEY looks too short for a production secret");
  }

  const siteUrl = trimmedOrNull(env.NEXT_PUBLIC_SITE_URL) ?? "http://localhost:3003";
  if (!isValidUrl(siteUrl)) {
    problems.push("NEXT_PUBLIC_SITE_URL must be a valid URL");
  }
  if (isProduction && isLocalhostUrl(siteUrl)) {
    problems.push("NEXT_PUBLIC_SITE_URL cannot point at localhost in production");
  }

  const reactAppUrl = trimmedOrNull(env.NEXT_PUBLIC_REACT_APP_URL);
  if (reactAppUrl && !isValidUrl(reactAppUrl)) {
    problems.push("NEXT_PUBLIC_REACT_APP_URL must be a valid URL when set");
  }
  if (isProduction && reactAppUrl && isLocalhostUrl(reactAppUrl)) {
    problems.push("NEXT_PUBLIC_REACT_APP_URL cannot point at localhost in production");
  }

  const celoRpcUrl = trimmedOrNull(env.CELO_RPC_URL) ?? "https://forno.celo.org";
  if (!isValidUrl(celoRpcUrl)) {
    problems.push("CELO_RPC_URL must be a valid URL");
  }
  if (isProduction && isLocalhostUrl(celoRpcUrl)) {
    problems.push("CELO_RPC_URL cannot point at localhost in production");
  }
  const minipointsAddress = trimmedOrNull(env.MINIPOINTS_ADDRESS);
  if (minipointsAddress && !/^0x[a-fA-F0-9]{40}$/.test(minipointsAddress)) {
    problems.push("MINIPOINTS_ADDRESS must be a 0x-prefixed 20-byte address");
  }

  const akibaApiUrl = trimmedOrNull(env.AKIBA_API_URL);
  const akibaApiKey = trimmedOrNull(env.AKIBA_API_KEY);
  if (akibaApiUrl && !isValidUrl(akibaApiUrl)) {
    problems.push("AKIBA_API_URL must be a valid URL when set");
  }
  if (isProduction && akibaApiUrl && isLocalhostUrl(akibaApiUrl)) {
    problems.push("AKIBA_API_URL cannot point at localhost in production");
  }
  if (isProduction && !akibaApiUrl) {
    problems.push("AKIBA_API_URL is required in production for Miles and referral delivery");
  }
  if (isProduction && !akibaApiKey) {
    problems.push("AKIBA_API_KEY is required in production for Miles and referral delivery");
  }

  const hubPassSecret = trimmedOrNull(env.HUB_PASS_SECRET);
  if (isProduction && !hubPassSecret) {
    problems.push(
      "HUB_PASS_SECRET is required in production (no fallback to SUPABASE_SERVICE_KEY)"
    );
  }
  if (hubPassSecret && hubPassSecret.length < MIN_SECRET_LENGTH) {
    problems.push(`HUB_PASS_SECRET must be at least ${MIN_SECRET_LENGTH} characters`);
  }
  if (hubPassSecret && supabaseServiceKey && hubPassSecret === supabaseServiceKey) {
    problems.push("HUB_PASS_SECRET must not equal SUPABASE_SERVICE_KEY");
  }

  const hubReferralSecret = trimmedOrNull(env.HUB_REFERRAL_SECRET);
  if (isProduction && !hubReferralSecret) {
    problems.push(
      "HUB_REFERRAL_SECRET is required in production (no fallback to HUB_PASS_SECRET or SUPABASE_SERVICE_KEY)"
    );
  }
  if (hubReferralSecret && hubReferralSecret.length < MIN_SECRET_LENGTH) {
    problems.push(`HUB_REFERRAL_SECRET must be at least ${MIN_SECRET_LENGTH} characters`);
  }
  if (hubReferralSecret && supabaseServiceKey && hubReferralSecret === supabaseServiceKey) {
    problems.push("HUB_REFERRAL_SECRET must not equal SUPABASE_SERVICE_KEY");
  }
  if (hubReferralSecret && hubPassSecret && hubReferralSecret === hubPassSecret) {
    problems.push("HUB_REFERRAL_SECRET must not equal HUB_PASS_SECRET");
  }

  const internalWebhookSecret = trimmedOrNull(env.INTERNAL_WEBHOOK_SECRET);
  if (isProduction && !internalWebhookSecret) {
    problems.push("INTERNAL_WEBHOOK_SECRET is required in production");
  }
  if (
    internalWebhookSecret &&
    isProduction &&
    internalWebhookSecret.length < MIN_SECRET_LENGTH
  ) {
    problems.push(`INTERNAL_WEBHOOK_SECRET must be at least ${MIN_SECRET_LENGTH} characters`);
  }

  const cronSecret = trimmedOrNull(env.CRON_SECRET);
  const directoryRevalidationSecret = trimmedOrNull(env.DIRECTORY_REVALIDATION_SECRET);

  const mpesaEnvRaw = trimmedOrNull(env.MPESA_ENV);
  let mpesaEnv: MpesaEnvironment = "sandbox";
  if (mpesaEnvRaw === "sandbox" || mpesaEnvRaw === "production") {
    mpesaEnv = mpesaEnvRaw;
  } else if (mpesaEnvRaw) {
    problems.push('MPESA_ENV must be exactly "sandbox" or "production" when set');
  }
  if (isProduction && mpesaEnv !== "production" && isMpesaConfiguredIn(env)) {
    problems.push("MPESA_ENV must be \"production\" when M-Pesa credentials are set in production");
  }

  const mpesaCallbackUrl =
    trimmedOrNull(env.MPESA_CALLBACK_URL) ??
    "https://hub.akibamiles.com/api/payments/mpesa/callback";
  if (!isValidUrl(mpesaCallbackUrl)) {
    problems.push("MPESA_CALLBACK_URL must be a valid URL");
  }
  if (isProduction && isMpesaConfiguredIn(env)) {
    if (isLocalhostUrl(mpesaCallbackUrl)) {
      problems.push("MPESA_CALLBACK_URL cannot point at localhost in production");
    }
    try {
      const callbackHost = new URL(mpesaCallbackUrl).hostname;
      const siteHost = new URL(siteUrl).hostname;
      if (callbackHost !== siteHost) {
        problems.push(
          `MPESA_CALLBACK_URL host (${callbackHost}) must match NEXT_PUBLIC_SITE_URL host (${siteHost}) in production`
        );
      }
    } catch {
      // already reported above via isValidUrl checks
    }
    if (!trimmedOrNull(env.MPESA_CALLBACK_SECRET)) {
      problems.push("MPESA_CALLBACK_SECRET is required in production when M-Pesa is configured");
    }
  }

  const usdToKesRaw = env.USD_TO_KES;
  const usdToKes = usdToKesRaw !== undefined ? Number(usdToKesRaw) : 130;
  if (!Number.isFinite(usdToKes) || usdToKes <= 0) {
    problems.push("USD_TO_KES must be a finite positive number");
  }

  const webPushPublicKey = trimmedOrNull(env.NEXT_PUBLIC_WEB_PUSH_VAPID_PUBLIC_KEY);
  const webPushPrivateKey = trimmedOrNull(env.WEB_PUSH_VAPID_PRIVATE_KEY);
  const webPushSubject = trimmedOrNull(env.WEB_PUSH_VAPID_SUBJECT);
  const webPushPartiallyConfigured =
    !!(webPushPublicKey || webPushPrivateKey || webPushSubject) &&
    !(webPushPublicKey && webPushPrivateKey && webPushSubject);
  if (webPushPartiallyConfigured) {
    problems.push(
      "Web push VAPID keys are partially configured — set NEXT_PUBLIC_WEB_PUSH_VAPID_PUBLIC_KEY, WEB_PUSH_VAPID_PRIVATE_KEY, and WEB_PUSH_VAPID_SUBJECT together or not at all"
    );
  }

  if (isProduction && problems.length > 0) {
    throw new EnvValidationError(problems);
  }
  if (problems.length > 0) {
    console.warn(
      `[env] Non-production environment has configuration issues (will fail in production):\n${problems
        .map((p) => `  - ${p}`)
        .join("\n")}`
    );
  }

  cached = {
    nodeEnv,
    isProduction,
    supabase: {
      url: supabaseUrl ?? "",
      anonKey: supabaseAnonKey ?? "",
      serviceKey: supabaseServiceKey ?? "",
    },
    siteUrl,
    reactAppUrl,
    celo: { rpcUrl: celoRpcUrl, minipointsAddress },
    akiba: {
      apiUrl: akibaApiUrl,
      apiKey: akibaApiKey,
      partnerSlug: trimmedOrNull(env.AKIBA_PARTNER_SLUG),
      partnerKeyId: trimmedOrNull(env.AKIBA_PARTNER_KEY_ID),
      webhookSecret: trimmedOrNull(env.AKIBA_WEBHOOK_SECRET),
    },
    hubPassSecret,
    hubReferralSecret,
    internalWebhookSecret,
    cronSecret,
    directoryRevalidationSecret,
    mpesa: {
      env: mpesaEnv,
      consumerKey: trimmedOrNull(env.MPESA_CONSUMER_KEY),
      consumerSecret: trimmedOrNull(env.MPESA_CONSUMER_SECRET),
      shortcode: trimmedOrNull(env.MPESA_SHORTCODE),
      passkey: trimmedOrNull(env.MPESA_PASSKEY),
      callbackUrl: mpesaCallbackUrl,
      callbackSecret: trimmedOrNull(env.MPESA_CALLBACK_SECRET),
      usdToKes: Number.isFinite(usdToKes) && usdToKes > 0 ? usdToKes : 130,
    },
    webPush: {
      publicKey: webPushPublicKey,
      privateKey: webPushPrivateKey,
      subject: webPushSubject,
    },
  };

  return cached;
}

function isMpesaConfiguredIn(env: NodeJS.ProcessEnv): boolean {
  return !!(
    trimmedOrNull(env.MPESA_CONSUMER_KEY) &&
    trimmedOrNull(env.MPESA_CONSUMER_SECRET) &&
    trimmedOrNull(env.MPESA_SHORTCODE) &&
    trimmedOrNull(env.MPESA_PASSKEY)
  );
}

/** Test-only: clears the cached env so a test can re-validate with a different process.env. */
export function __resetServerEnvCacheForTests(): void {
  cached = null;
}
