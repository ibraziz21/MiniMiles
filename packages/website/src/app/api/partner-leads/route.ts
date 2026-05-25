import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

type PartnerLeadPayload = {
  name?: unknown;
  email?: unknown;
  company?: unknown;
  country?: unknown;
  role?: unknown;
  website?: unknown;
  message?: unknown;
  source?: unknown;
  websiteUrl?: unknown;
  turnstileToken?: unknown;
};

const MAX_LENGTHS = {
  name: 120,
  email: 254,
  company: 160,
  country: 120,
  role: 120,
  website: 300,
  message: 2000,
  source: 120,
};

export async function POST(request: Request) {
  let body: PartnerLeadPayload;
  try {
    body = (await request.json()) as PartnerLeadPayload;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  if (clean(body.websiteUrl, 500)) {
    return NextResponse.json({ ok: true });
  }

  const lead = {
    name: clean(body.name, MAX_LENGTHS.name),
    email: clean(body.email, MAX_LENGTHS.email).toLowerCase(),
    company: clean(body.company, MAX_LENGTHS.company),
    country: clean(body.country, MAX_LENGTHS.country),
    role: clean(body.role, MAX_LENGTHS.role),
    website: clean(body.website, MAX_LENGTHS.website),
    message: clean(body.message, MAX_LENGTHS.message),
    source: clean(body.source, MAX_LENGTHS.source) || "website",
  };

  const missing = requiredFields(lead);
  if (missing.length > 0) {
    return NextResponse.json(
      { error: `Missing required field: ${missing[0]}.` },
      { status: 400 },
    );
  }

  if (!looksLikeEmail(lead.email)) {
    return NextResponse.json({ error: "Enter a valid email address." }, { status: 400 });
  }

  if (lead.website && !looksLikeUrl(lead.website)) {
    return NextResponse.json({ error: "Enter a valid website URL." }, { status: 400 });
  }

  const turnstileResult = await verifyTurnstile(
    clean(body.turnstileToken, 3000),
    request,
  );
  if (!turnstileResult.ok) {
    return NextResponse.json({ error: turnstileResult.error }, { status: 400 });
  }

  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) {
    return NextResponse.json(
      { error: "Partner lead storage is not configured." },
      { status: 503 },
    );
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false },
  });

  const userAgent = request.headers.get("user-agent")?.slice(0, 500) ?? null;
  const ipHash = hashIp(clientIp(request));

  const { error } = await supabase.from("partner_leads").insert({
    name: lead.name,
    email: lead.email,
    company: lead.company,
    country: lead.country,
    role: lead.role || null,
    website: lead.website || null,
    message: lead.message,
    source: lead.source,
    status: "new",
    user_agent: userAgent,
    ip_hash: ipHash,
  });

  if (error) {
    console.error("[partner-leads] Supabase insert failed", error);
    return NextResponse.json(
      { error: "We could not save your inquiry. Please try again." },
      { status: 500 },
    );
  }

  return NextResponse.json({ ok: true });
}

function clean(value: unknown, maxLength: number) {
  if (typeof value !== "string") return "";
  return value.trim().slice(0, maxLength);
}

function requiredFields(lead: {
  name: string;
  email: string;
  company: string;
  country: string;
  message: string;
}) {
  const missing: string[] = [];
  if (!lead.name) missing.push("name");
  if (!lead.email) missing.push("email");
  if (!lead.company) missing.push("company");
  if (!lead.country) missing.push("country");
  if (!lead.message) missing.push("message");
  return missing;
}

function looksLikeEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function looksLikeUrl(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function clientIp(request: Request) {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0]?.trim() ?? "";
  return request.headers.get("x-real-ip") ?? "";
}

function hashIp(ip: string) {
  if (!ip) return null;
  const salt = process.env.PARTNER_LEAD_IP_HASH_SALT ?? "akibamiles-partner-leads";
  return createHash("sha256").update(`${salt}:${ip}`).digest("hex");
}

async function verifyTurnstile(token: string, request: Request) {
  const secret = process.env.TURNSTILE_SECRET_KEY;
  if (!secret) {
    if (process.env.NODE_ENV === "production") {
      return { ok: false, error: "Anti-spam verification is not configured." };
    }
    return { ok: true };
  }

  if (!token) {
    return { ok: false, error: "Complete the anti-spam check." };
  }

  const params = new FormData();
  params.append("secret", secret);
  params.append("response", token);
  const ip = clientIp(request);
  if (ip) params.append("remoteip", ip);

  const res = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
    method: "POST",
    body: params,
  });

  if (!res.ok) {
    return { ok: false, error: "Anti-spam verification failed." };
  }

  const result = (await res.json()) as { success?: boolean };
  if (!result.success) {
    return { ok: false, error: "Anti-spam verification failed." };
  }

  return { ok: true };
}
