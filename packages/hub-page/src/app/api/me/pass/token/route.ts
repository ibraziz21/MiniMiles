/**
 * POST /api/me/pass/token
 *
 * Mints a short-lived signed presentation token (akiba-id:v1:…) for the
 * signed-in hub user by forwarding their Supabase session JWT to the
 * Platform's /api/v1/me/presentation endpoint.
 *
 * The rotating token replaces the static akiba-pass QR as the primary
 * in-store code: it expires in ~5 minutes, so a photographed pass is
 * useless minutes later. The static pass remains the offline/printed
 * fallback at lower trust.
 *
 * Response 200: { token, expiresAt, ttlSeconds }
 * Response 401: no session
 * Response 502: Platform unreachable
 */
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

const AKIBA_API = process.env.AKIBA_API_URL ?? "";

export async function POST() {
  const supabase = await createClient();
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!AKIBA_API) {
    return NextResponse.json({ error: "Service unavailable" }, { status: 503 });
  }

  let upstream: Response;
  try {
    upstream = await fetch(`${AKIBA_API}/api/v1/me/presentation`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${session.access_token}`,
        "Cache-Control": "no-store",
      },
      cache: "no-store",
    });
  } catch (err) {
    console.error("[pass/token] Platform unreachable:", err);
    return NextResponse.json({ error: "Could not mint live code" }, { status: 502 });
  }

  const data = await upstream.json().catch(() => null) as
    | { token?: string; expiresAt?: string; ttlSeconds?: number; error?: unknown }
    | null;

  if (!upstream.ok || !data?.token) {
    console.error("[pass/token] upstream error:", upstream.status, data?.error);
    return NextResponse.json({ error: "Could not mint live code" }, { status: 502 });
  }

  return NextResponse.json(
    { token: data.token, expiresAt: data.expiresAt, ttlSeconds: data.ttlSeconds ?? 300 },
    { headers: { "Cache-Control": "no-store, private" } },
  );
}
