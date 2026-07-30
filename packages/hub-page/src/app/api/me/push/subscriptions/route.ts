import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { endpointHash } from "@/lib/push/subscriptions";
import { isSameOriginRequest } from "@/lib/push/origin";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PLATFORMS = new Set(["ios", "android", "desktop", "unknown"]);
const MAX_ENDPOINT_LEN = 2048;
const MAX_KEY_LEN = 512;

function clientIp(req: Request): string | null {
  const fwd = req.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0].trim();
  return req.headers.get("x-real-ip");
}

export async function POST(req: Request) {
  if (req.headers.get("content-type")?.includes("application/json") !== true) {
    return NextResponse.json({ error: "Unsupported content type" }, { status: 415 });
  }
  if (!isSameOriginRequest(req)) {
    return NextResponse.json({ error: "Cross-origin request rejected" }, { status: 403 });
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: {
    installation_id?: string;
    platform?: string;
    subscription?: { endpoint?: string; keys?: { p256dh?: string; auth?: string } };
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const installationId = body.installation_id;
  const platform = body.platform;
  const endpoint = body.subscription?.endpoint;
  const p256dh = body.subscription?.keys?.p256dh;
  const auth = body.subscription?.keys?.auth;

  if (!installationId || !UUID_RE.test(installationId)) {
    return NextResponse.json({ error: "Invalid installation_id" }, { status: 400 });
  }
  if (!platform || !PLATFORMS.has(platform)) {
    return NextResponse.json({ error: "Invalid platform" }, { status: 400 });
  }
  if (!endpoint || !endpoint.startsWith("https://") || endpoint.length > MAX_ENDPOINT_LEN) {
    return NextResponse.json({ error: "Invalid subscription endpoint" }, { status: 400 });
  }
  if (!p256dh || p256dh.length > MAX_KEY_LEN || !auth || auth.length > MAX_KEY_LEN) {
    return NextResponse.json({ error: "Invalid subscription keys" }, { status: 400 });
  }

  const admin = createAdminClient();

  const { data: withinLimit, error: rateErr } = await admin.rpc("check_push_subscription_rate_limit", {
    p_hub_user_id: user.id,
    p_ip: clientIp(req),
  });
  if (rateErr) {
    console.error("[push/subscriptions] rate limit check failed:", rateErr.message);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
  if (!withinLimit) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  }

  const { error } = await admin.from("web_push_subscriptions").upsert(
    {
      hub_user_id: user.id,
      installation_id: installationId,
      endpoint,
      endpoint_hash: endpointHash(endpoint),
      p256dh,
      auth_secret: auth,
      platform,
      user_agent: req.headers.get("user-agent")?.slice(0, 512) ?? null,
      status: "active",
      failure_count: 0,
      last_seen_at: new Date().toISOString(),
    },
    { onConflict: "endpoint_hash" }
  );

  if (error) {
    console.error("[push/subscriptions] upsert failed:", error.message);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}

export async function DELETE(req: Request) {
  if (!isSameOriginRequest(req)) {
    return NextResponse.json({ error: "Cross-origin request rejected" }, { status: 403 });
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: { endpoint?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (!body.endpoint) {
    return NextResponse.json({ ok: true });
  }

  const admin = createAdminClient();
  await admin
    .from("web_push_subscriptions")
    .update({ status: "revoked", revoked_at: new Date().toISOString() })
    .eq("hub_user_id", user.id)
    .eq("endpoint_hash", endpointHash(body.endpoint));

  return NextResponse.json({ ok: true });
}
