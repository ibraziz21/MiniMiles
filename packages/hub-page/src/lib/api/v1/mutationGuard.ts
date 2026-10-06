// Auth-mode-aware mutation/CSRF guard (hub-mobile-app-migration-plan.md
// "CSRF and origin handling"). Cookie-authenticated (browser) mutations keep
// requiring the existing same-origin check; Bearer-authenticated (native)
// mutations have no browser Origin to check, so they're guarded by a valid
// token (already proven by requireActor before this runs) plus a JSON
// content type instead. isSameOriginRequest itself is never weakened.
import { isSameOriginRequest } from "@/lib/push/origin";
import type { RequestActor } from "@/lib/auth/requestActor";

export class ForbiddenOriginError extends Error {
  readonly status = 403;
  readonly code = "FORBIDDEN_ORIGIN";
  constructor(message = "Cross-origin request rejected") {
    super(message);
    this.name = "ForbiddenOriginError";
  }
}

export class UnsupportedContentTypeError extends Error {
  readonly status = 415;
  readonly code = "UNSUPPORTED_CONTENT_TYPE";
  constructor(message = "Expected application/json") {
    super(message);
    this.name = "UnsupportedContentTypeError";
  }
}

/**
 * Throws when a mutation must be rejected for its actor's auth mode. Call
 * after `requireActor` has already resolved a valid actor for this request.
 */
export async function assertMutationAllowed(request: Request, actor: RequestActor): Promise<void> {
  if (actor.authMode === "cookie") {
    if (!isSameOriginRequest(request)) throw new ForbiddenOriginError();
    return;
  }

  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().includes("application/json")) {
    throw new UnsupportedContentTypeError();
  }
}
