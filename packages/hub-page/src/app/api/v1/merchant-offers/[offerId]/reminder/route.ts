import { apiError, apiSuccess } from "@/lib/api/v1/response";
import {
  ForbiddenOriginError,
  UnsupportedContentTypeError,
  assertMutationAllowed,
} from "@/lib/api/v1/mutationGuard";
import { requireActor, UnauthorizedError, type RequestActor } from "@/lib/auth/requestActor";
import { getServerEnv } from "@/lib/env.server";

type ReminderPayload = { reminder: { leadMinutes: number } | null };

async function authenticatedActor(request: Request): Promise<RequestActor | Response> {
  try {
    return await requireActor(request);
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return apiError(request, error.code, error.message, error.status);
    }
    throw error;
  }
}

function isResponse(value: RequestActor | Response): value is Response {
  return value instanceof Response;
}

async function forwardReminder(
  request: Request,
  actor: RequestActor,
  offerId: string,
  method: "GET" | "PUT" | "DELETE",
  leadMinutes?: number,
) {
  const { akiba } = getServerEnv();
  if (!akiba.apiUrl) {
    return apiError(request, "SERVICE_UNAVAILABLE", "Reminder service unavailable", 503, { retryable: true });
  }

  let upstream: Response;
  try {
    upstream = await fetch(
      `${akiba.apiUrl}/api/v1/merchant-offers/${encodeURIComponent(offerId)}/reminder`,
      {
        method,
        headers: {
          Authorization: `Bearer ${actor.accessToken}`,
          Accept: "application/json",
          ...(method === "PUT" ? { "Content-Type": "application/json" } : {}),
          "Cache-Control": "no-store",
        },
        body: method === "PUT" ? JSON.stringify({ leadMinutes }) : undefined,
        cache: "no-store",
      },
    );
  } catch (error) {
    console.error("[merchant-offer reminder] upstream unavailable:", error);
    return apiError(request, "UPSTREAM_UNREACHABLE", "Could not reach the reminder service. Please try again.", 502, {
      retryable: true,
    });
  }

  const body = await upstream.json().catch(() => null) as
    | { success?: boolean; reminder?: { leadMinutes?: unknown } | null; error?: { code?: string; message?: string } }
    | null;

  if (!upstream.ok || body?.success === false) {
    const fallback = upstream.status === 404
      ? "This offer is no longer available."
      : upstream.status === 409
        ? "Reminders are disabled for this offer."
        : "Could not update this reminder.";
    return apiError(
      request,
      body?.error?.code ?? "OFFER_REMINDER_FAILED",
      body?.error?.message ?? fallback,
      upstream.status || 502,
      { retryable: upstream.status >= 500 },
    );
  }

  const reminder = body?.reminder && typeof body.reminder.leadMinutes === "number"
    ? { leadMinutes: body.reminder.leadMinutes }
    : null;
  const response = apiSuccess<ReminderPayload>(request, { reminder });
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}

export async function GET(request: Request, { params }: { params: { offerId: string } }) {
  const actor = await authenticatedActor(request);
  if (isResponse(actor)) return actor;
  return forwardReminder(request, actor, params.offerId, "GET");
}

export async function PUT(request: Request, { params }: { params: { offerId: string } }) {
  const actor = await authenticatedActor(request);
  if (isResponse(actor)) return actor;
  try {
    await assertMutationAllowed(request, actor);
  } catch (error) {
    if (error instanceof ForbiddenOriginError || error instanceof UnsupportedContentTypeError) {
      return apiError(request, error.code, error.message, error.status);
    }
    throw error;
  }

  const body = await request.json().catch(() => null) as { leadMinutes?: unknown } | null;
  if (body?.leadMinutes !== 30 && body?.leadMinutes !== 60 && body?.leadMinutes !== 1440) {
    return apiError(request, "INVALID_LEAD_MINUTES", "leadMinutes must be 30, 60, or 1440", 400);
  }
  return forwardReminder(request, actor, params.offerId, "PUT", body.leadMinutes);
}

export async function DELETE(request: Request, { params }: { params: { offerId: string } }) {
  const actor = await authenticatedActor(request);
  if (isResponse(actor)) return actor;
  try {
    await assertMutationAllowed(request, actor);
  } catch (error) {
    if (error instanceof ForbiddenOriginError || error instanceof UnsupportedContentTypeError) {
      return apiError(request, error.code, error.message, error.status);
    }
    throw error;
  }
  return forwardReminder(request, actor, params.offerId, "DELETE");
}
