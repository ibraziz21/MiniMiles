import { NextResponse } from "next/server";
import { adminIdForWrite, requireAdminSession } from "@/lib/auth";
import { writeAdminAuditLog } from "@/lib/audit";
import { validatePushCampaignInput } from "@/lib/pushCampaigns";
import { supabase } from "@/lib/supabase";

function isSameOrigin(req: Request): boolean {
  const origin = req.headers.get("origin");
  if (!origin) return true;
  try {
    return new URL(origin).origin === new URL(req.url).origin;
  } catch {
    return false;
  }
}

export async function POST(req: Request) {
  const session = await requireAdminSession("notifications.write");
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!isSameOrigin(req)) {
    return NextResponse.json({ error: "Cross-origin request rejected" }, { status: 403 });
  }
  if (!req.headers.get("content-type")?.includes("application/json")) {
    return NextResponse.json({ error: "Unsupported content type" }, { status: 415 });
  }

  const parsed = validatePushCampaignInput(await req.json().catch(() => null));
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });

  const input = parsed.value;
  const { data, error } = await supabase.rpc("create_web_push_campaign", {
    p_campaign_type: input.campaignType,
    p_title: input.title,
    p_body: input.body,
    p_deep_link: input.deepLink,
    p_created_by: session.email,
    p_idempotency_key: input.idempotencyKey,
  });

  if (error) {
    console.error("[push-campaigns] create_web_push_campaign failed:", error.message);
    return NextResponse.json({ error: "Failed to queue notification campaign" }, { status: 500 });
  }

  const result = Array.isArray(data) ? data[0] : data;
  if (!result?.campaign_id) {
    return NextResponse.json({ error: "Campaign was not created" }, { status: 500 });
  }

  await writeAdminAuditLog({
    adminUserId: adminIdForWrite(session),
    action: "push_campaign.queued",
    targetType: "web_push_campaign",
    targetId: result.campaign_id,
    metadata: {
      campaignType: input.campaignType,
      title: input.title,
      deepLink: input.deepLink,
      audienceCount: result.audience_count,
      queuedCount: result.queued_count,
    },
    ipAddress: req.headers.get("x-forwarded-for")?.split(",")[0]?.trim(),
  });

  return NextResponse.json(
    {
      ok: true,
      campaignId: result.campaign_id,
      audienceCount: result.audience_count,
      queuedCount: result.queued_count,
    },
    { status: 201 },
  );
}
