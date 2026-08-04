/**
 * GET /r/[code]
 *
 * Public referral landing endpoint (referral-system-spec.md §3.2, §8).
 * Validates the code, records an anonymous accepted click, sets the signed
 * attribution cookie, and redirects to the join flow with the public code
 * stripped from the URL. Invalid/disabled/expired/capped/paused links fall
 * through to the normal generic join page — no reward promise, no internal
 * detail leaked (§15 "constant-shape invalid-code responses").
 */
import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  createReferralToken, verifyReferralCookie,
  REFERRAL_COOKIE_NAME, REFERRAL_COOKIE_MAX_AGE_SECONDS,
} from "@/lib/akiba/referral-token";
import { normalizeReferralCode, isPlausibleReferralCode, hashClickSignal } from "@/lib/akiba/referral";

const DEVICE_COOKIE_NAME = "akiba_device";
const DEVICE_COOKIE_MAX_AGE_SECONDS = 365 * 24 * 60 * 60;

function userAgentFamily(userAgent: string | null): string | null {
  if (!userAgent) return null;
  const ua = userAgent.toLowerCase();
  if (ua.includes("instagram") || ua.includes("fban") || ua.includes("fbav")) return "in_app_facebook";
  if (ua.includes("whatsapp")) return "in_app_whatsapp";
  if (ua.includes("edg/")) return "edge";
  if (ua.includes("chrome/") && !ua.includes("chromium")) return "chrome";
  if (ua.includes("crios")) return "chrome_ios";
  if (ua.includes("firefox/")) return "firefox";
  if (ua.includes("safari/") && !ua.includes("chrome")) return "safari";
  return "other";
}

function clientIp(req: NextRequest): string | null {
  const forwarded = req.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0]!.trim();
  return req.headers.get("x-real-ip");
}

export async function GET(req: NextRequest, { params }: { params: { code: string } }) {
  const joinUrl = new URL("/join", req.url);
  const fallback = () => NextResponse.redirect(joinUrl, { status: 302 });

  const rawCode = normalizeReferralCode(params.code ?? "");
  if (!isPlausibleReferralCode(rawCode)) {
    return fallback();
  }

  const admin = createAdminClient();

  // First-touch attribution (spec §3.2 "The first valid invite accepted in
  // a browser wins for the attribution window. A later invite link does
  // not silently overwrite it."). Only an explicit "use a different code"
  // action on the join screen may replace it — this route never does.
  const existingTokenHash = verifyReferralCookie(req.cookies.get(REFERRAL_COOKIE_NAME)?.value ?? null);
  if (existingTokenHash) {
    const { data: existingClick } = await admin
      .from("referral_clicks")
      .select("status, expires_at")
      .eq("token_hash", existingTokenHash)
      .maybeSingle();

    if (existingClick?.status === "accepted" && new Date(existingClick.expires_at) > new Date()) {
      const redirectUrl = new URL("/join", req.url);
      redirectUrl.searchParams.set("src", "referral");
      return NextResponse.redirect(redirectUrl, { status: 302 });
    }
  }

  const { cookieValue, tokenHash } = createReferralToken();

  const ip = clientIp(req);
  const ipHash = ip ? hashClickSignal(ip, "ip") : null;

  let deviceId = req.cookies.get(DEVICE_COOKIE_NAME)?.value ?? null;
  const isNewDeviceCookie = !deviceId;
  if (!deviceId) {
    deviceId = createReferralToken().cookieValue; // reuse the same high-entropy generator
  }
  const deviceHash = hashClickSignal(deviceId, "device");

  const { data, error } = await admin.rpc("accept_referral_click", {
    p_code: rawCode,
    p_token_hash: tokenHash,
    p_ip_hash: ipHash,
    p_device_hash: deviceHash,
    p_user_agent_family: userAgentFamily(req.headers.get("user-agent")),
    p_landing_path: req.nextUrl.pathname,
  });

  if (error) {
    console.error("[r/code] accept_referral_click failed:", error.message);
    return fallback();
  }

  const row = (Array.isArray(data) ? data[0] : data) as { ok: boolean } | undefined;
  if (!row?.ok) {
    return fallback();
  }

  const redirectUrl = new URL("/join", req.url);
  redirectUrl.searchParams.set("src", "referral");
  const res = NextResponse.redirect(redirectUrl, { status: 302 });

  res.cookies.set(REFERRAL_COOKIE_NAME, cookieValue, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    maxAge: REFERRAL_COOKIE_MAX_AGE_SECONDS,
    path: "/",
  });

  if (isNewDeviceCookie) {
    res.cookies.set(DEVICE_COOKIE_NAME, deviceId, {
      httpOnly: true,
      secure: true,
      sameSite: "lax",
      maxAge: DEVICE_COOKIE_MAX_AGE_SECONDS,
      path: "/",
    });
  }

  return res;
}
