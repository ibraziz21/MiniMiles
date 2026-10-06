// Dual-auth request actor resolution (hub-mobile-app-migration-plan.md
// "Authentication" section). Native requests carry a Supabase access token
// as `Authorization: Bearer <token>`; web requests keep using the existing
// SSR-cookie session. A Bearer token, when present, is authoritative — it
// never silently falls back to the cookie path.
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { createClient as createCookieClient } from "@/lib/supabase/server";
import { getServerEnv } from "@/lib/env.server";

export type RequestActor = {
  userId: string;
  email: string | null;
  authMode: "cookie" | "bearer";
  /**
   * The caller's own Supabase access token — present for both auth modes so
   * routes that must forward the caller's identity to a downstream service
   * (Akiba-Platform) never need to re-derive it per auth mode.
   */
  accessToken: string;
};

export class UnauthorizedError extends Error {
  constructor(
    message = "Unauthorized",
    readonly status = 401,
    readonly code = "UNAUTHORIZED",
  ) {
    super(message);
    this.name = "UnauthorizedError";
  }
}

/** A validated answer could not be obtained from Supabase Auth. Extending
 * UnauthorizedError keeps every existing v1 route's catch path compatible,
 * while its status/code prevent a transport outage being presented as a
 * signed-out member. */
export class AuthServiceUnavailableError extends UnauthorizedError {
  constructor() {
    super("Authentication service temporarily unavailable", 503, "AUTH_SERVICE_UNAVAILABLE");
    this.name = "AuthServiceUnavailableError";
  }
}

function parseBearerToken(request: Request): string | null {
  const header = request.headers.get("authorization");
  if (!header) return null;
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  return match ? match[1].trim() : null;
}

async function actorFromBearer(token: string): Promise<RequestActor | null> {
  const env = getServerEnv();
  const supabase = createSupabaseClient(env.supabase.url, env.supabase.anonKey);
  const { data, error } = await supabase.auth.getUser(token);
  if (error) {
    const authError = error as typeof error & { status?: number; code?: string };
    const retryable =
      authError.name === "AuthRetryableFetchError" ||
      authError.status === 0 ||
      (typeof authError.status === "number" && authError.status >= 500) ||
      authError.code === "unexpected_failure";
    if (retryable) throw new AuthServiceUnavailableError();
    return null;
  }
  if (!data.user) return null;
  return { userId: data.user.id, email: data.user.email ?? null, authMode: "bearer", accessToken: token };
}

async function actorFromCookie(): Promise<RequestActor | null> {
  const supabase = await createCookieClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;
  // getUser() already validated the session server-side; getSession() here
  // is only to read the access token string for downstream forwarding, the
  // same extra call every existing web route that forwards to Platform
  // already makes standalone.
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) return null;
  return { userId: user.id, email: user.email ?? null, authMode: "cookie", accessToken: session.access_token };
}

/**
 * Resolves the caller from a Bearer token (native) or the SSR cookie session
 * (web). Never throws — returns `null` when neither resolves a user. A
 * Bearer token is authentication only; every resource query must still be
 * scoped to `actor.userId`/`actor.email`.
 */
export async function optionalActor(request: Request): Promise<RequestActor | null> {
  const token = parseBearerToken(request);
  if (token) return actorFromBearer(token);
  return actorFromCookie();
}

/** Same resolution as {@link optionalActor}, throwing `UnauthorizedError` instead of returning `null`. */
export async function requireActor(request: Request): Promise<RequestActor> {
  const actor = await optionalActor(request);
  if (!actor) throw new UnauthorizedError();
  return actor;
}
