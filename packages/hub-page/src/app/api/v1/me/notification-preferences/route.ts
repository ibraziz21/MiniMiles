// GET / PATCH /api/v1/me/notification-preferences
// (hub-mobile-app-migration-plan.md P1 "Native push").
//
// The native counterpart to the web PATCH on /api/me/push. It writes the same
// hub_notification_preferences row the dispatcher's categoryEnabled() reads,
// so a member's choice applies to both transports at once — a preference is
// about the member, not about which device they happened to set it on.
//
// Defaults are the schema's, not this route's: orders/vouchers/earnings on,
// rewards/marketing off (047_web_push_notifications.sql and
// 069_earnings_notifications.sql). They are repeated here only so a member
// with no row yet still gets an accurate GET.
import { apiError, apiSuccess } from "@/lib/api/v1/response";
import {
  ForbiddenOriginError,
  UnsupportedContentTypeError,
  assertMutationAllowed,
} from "@/lib/api/v1/mutationGuard";
import { requireActor, UnauthorizedError, type RequestActor } from "@/lib/auth/requestActor";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

const COLUMNS = "orders_enabled, vouchers_enabled, rewards_enabled, marketing_enabled, earnings_enabled";

const CATEGORY_COLUMNS = {
  orders: "orders_enabled",
  vouchers: "vouchers_enabled",
  rewards: "rewards_enabled",
  marketing: "marketing_enabled",
  earnings: "earnings_enabled",
} as const;

type Category = keyof typeof CATEGORY_COLUMNS;

type PreferenceRow = {
  orders_enabled: boolean;
  vouchers_enabled: boolean;
  rewards_enabled: boolean;
  marketing_enabled: boolean;
  earnings_enabled: boolean;
};

function toPayload(row: PreferenceRow | null) {
  return {
    orders: row?.orders_enabled ?? true,
    vouchers: row?.vouchers_enabled ?? true,
    rewards: row?.rewards_enabled ?? false,
    marketing: row?.marketing_enabled ?? false,
    earnings: row?.earnings_enabled ?? true,
  };
}

async function authenticate(request: Request): Promise<RequestActor | Response> {
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

export async function GET(request: Request) {
  const actor = await authenticate(request);
  if (isResponse(actor)) return actor;

  const { data, error } = await createAdminClient()
    .from("hub_notification_preferences")
    .select(COLUMNS)
    .eq("hub_user_id", actor.userId)
    .maybeSingle();

  if (error) {
    console.error("[notification-preferences] read failed:", error.message);
    return apiError(request, "PREFERENCES_READ_FAILED", "Could not load notification settings", 500, {
      retryable: true,
    });
  }

  const response = apiSuccess(request, { preferences: toPayload(data as PreferenceRow | null) });
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}

export async function PATCH(request: Request) {
  const actor = await authenticate(request);
  if (isResponse(actor)) return actor;

  try {
    await assertMutationAllowed(request, actor);
  } catch (error) {
    if (error instanceof ForbiddenOriginError || error instanceof UnsupportedContentTypeError) {
      return apiError(request, error.code, error.message, error.status);
    }
    throw error;
  }

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return apiError(request, "INVALID_BODY", "A JSON body is required", 400);

  const patch: Record<string, unknown> = {};
  for (const [category, column] of Object.entries(CATEGORY_COLUMNS) as [Category, string][]) {
    const value = body[category];
    if (value === undefined) continue;
    if (typeof value !== "boolean") {
      return apiError(request, "INVALID_PREFERENCE", `${category} must be a boolean`, 400);
    }
    patch[column] = value;
  }

  if (Object.keys(patch).length === 0) {
    return apiError(request, "NOTHING_TO_UPDATE", "Nothing to update", 400);
  }

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("hub_notification_preferences")
    .upsert(
      { hub_user_id: actor.userId, ...patch, updated_at: new Date().toISOString() },
      { onConflict: "hub_user_id" },
    )
    .select(COLUMNS)
    .maybeSingle();

  if (error) {
    console.error("[notification-preferences] write failed:", error.message);
    return apiError(request, "PREFERENCES_UPDATE_FAILED", "Could not save notification settings", 500, {
      retryable: true,
    });
  }

  const response = apiSuccess(request, { preferences: toPayload(data as PreferenceRow | null) });
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}
