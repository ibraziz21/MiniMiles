import { apiError, apiSuccess } from "@/lib/api/v1/response";
import {
  assertMutationAllowed,
  ForbiddenOriginError,
  UnsupportedContentTypeError,
} from "@/lib/api/v1/mutationGuard";
import { requireActor, UnauthorizedError } from "@/lib/auth/requestActor";

type UpstreamPresentation = {
  token?: unknown;
  expiresAt?: unknown;
  ttlSeconds?: unknown;
};

function presentationPayload(value: unknown): UpstreamPresentation | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const payload = record.data && typeof record.data === "object" ? record.data : record;
  return payload as UpstreamPresentation;
}

export async function POST(request: Request) {
  let actor;
  try {
    actor = await requireActor(request);
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return apiError(request, error.code, error.message, error.status);
    }
    throw error;
  }

  try {
    await assertMutationAllowed(request, actor);
  } catch (error) {
    if (error instanceof ForbiddenOriginError || error instanceof UnsupportedContentTypeError) {
      return apiError(request, error.code, error.message, error.status);
    }
    throw error;
  }

  const apiUrl = process.env.AKIBA_API_URL?.trim().replace(/\/$/, "");
  if (!apiUrl) {
    return apiError(request, "PASS_PRESENTATION_UNAVAILABLE", "Live Pass is temporarily unavailable", 503, {
      retryable: true,
    });
  }

  let upstream: Response;
  try {
    upstream = await fetch(`${apiUrl}/api/v1/me/presentation`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${actor.accessToken}`,
        "Cache-Control": "no-store",
      },
      cache: "no-store",
    });
  } catch (error) {
    console.error(
      "[api/v1/me/pass/token] Platform unreachable:",
      error instanceof Error ? error.message : error,
    );
    return apiError(request, "PASS_PRESENTATION_UNAVAILABLE", "Live Pass is temporarily unavailable", 502, {
      retryable: true,
    });
  }

  const payload = presentationPayload(await upstream.json().catch(() => null));
  if (!upstream.ok || typeof payload?.token !== "string" || !payload.token.trim()) {
    console.error("[api/v1/me/pass/token] Platform rejected presentation request:", upstream.status);
    return apiError(request, "PASS_PRESENTATION_UNAVAILABLE", "Live Pass is temporarily unavailable", 502, {
      retryable: true,
    });
  }

  const configuredTtl = Number(payload.ttlSeconds);
  const ttlSeconds = Number.isFinite(configuredTtl) && configuredTtl > 0
    ? Math.floor(configuredTtl)
    : 300;
  const suppliedExpiry = typeof payload.expiresAt === "string" ? Date.parse(payload.expiresAt) : Number.NaN;
  const expiresAt = Number.isFinite(suppliedExpiry) && suppliedExpiry > Date.now()
    ? new Date(suppliedExpiry).toISOString()
    : new Date(Date.now() + ttlSeconds * 1000).toISOString();

  const response = apiSuccess(request, {
    token: payload.token,
    expiresAt,
    ttlSeconds,
  });
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}
