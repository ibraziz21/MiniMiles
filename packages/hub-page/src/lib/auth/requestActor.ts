// Dual-auth request actor resolution (hub-mobile-app-migration-plan.md
// "Authentication" section). Native requests carry a Supabase access token
// as `Authorization: Bearer <token>`; web requests keep using the existing
// SSR-cookie session. A Bearer token, when present, is authoritative — it
// never silently falls back to the cookie path.
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { createClient as createCookieClient } from "@/lib/supabase/server";
import { getServerEnv } from "@/lib/env.server";
import {
  DeletionLookupUnavailableError,
  findOpenDeletionRequest,
} from "@/lib/akiba/accountDeletionGuard";

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

/**
 * The actor has an account-deletion request in progress or already completed
 * (AKIBA-MOB-002 §7.4). Extends UnauthorizedError so every existing v1
 * route's `catch (error instanceof UnauthorizedError)` path returns the
 * intended 410 instead of turning it into a 500 — the spec calls this out
 * explicitly because a 500 here would read as an outage, and the app would
 * retry forever instead of signing the stale session out.
 */
export class AccountDeletionPendingError extends UnauthorizedError {
  constructor() {
    super("This account has a deletion request in progress", 410, "ACCOUNT_DELETION_PENDING");
    this.name = "AccountDeletionPendingError";
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

async function resolveActor(request: Request): Promise<RequestActor | null> {
  const token = parseBearerToken(request);
  if (token) return actorFromBearer(token);
  return actorFromCookie();
}

/**
 * Resolves the caller from a Bearer token (native) or the SSR cookie session
 * (web). Never throws — returns `null` when neither resolves a user. A
 * Bearer token is authentication only; every resource query must still be
 * scoped to `actor.userId`/`actor.email`.
 *
 * An actor with a deletion request in progress resolves as **anonymous**
 * rather than throwing. Auth-optional routes (`/config`, `/home`) must keep
 * working — the app still needs to boot far enough to show the maintenance
 * or deletion-pending state — and degrading to anonymous means no
 * member-scoped data is served to a pending account either way. Protected
 * routes get the 410 from {@link requireActor}.
 */
export async function optionalActor(request: Request): Promise<RequestActor | null> {
  const actor = await resolveActor(request);
  if (!actor) return null;
  return (await hasOpenDeletionRequest(actor.userId)) ? null : actor;
}

/** Same resolution as {@link optionalActor}, throwing `UnauthorizedError` instead of returning `null`. */
export async function requireActor(request: Request): Promise<RequestActor> {
  const actor = await resolveActor(request);
  if (!actor) throw new UnauthorizedError();
  if (await hasOpenDeletionRequest(actor.userId)) throw new AccountDeletionPendingError();
  return actor;
}

/**
 * Authentication without the pending-deletion rejection, for the deletion
 * endpoints themselves (§7.4). A member whose final response was dropped has
 * to be able to retry and read their receipt back — which is impossible if
 * their own request locks them out of the route that returns it.
 */
export async function requireActorAllowingDeletionPending(
  request: Request,
): Promise<RequestActor> {
  const actor = await resolveActor(request);
  if (!actor) throw new UnauthorizedError();
  return actor;
}

/**
 * Fails closed: a lookup that cannot be completed is treated as "blocked"
 * via AuthServiceUnavailableError rather than letting a possibly-pending
 * account through. 503 (retryable) is the honest answer for an infrastructure
 * failure, and is distinct from the 410 a real pending request produces.
 */
async function hasOpenDeletionRequest(userId: string): Promise<boolean> {
  try {
    return (await findOpenDeletionRequest(userId)) !== null;
  } catch (error) {
    if (error instanceof DeletionLookupUnavailableError) {
      throw new AuthServiceUnavailableError();
    }
    throw error;
  }
}
