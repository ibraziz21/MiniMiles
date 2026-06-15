import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

function clean(value: unknown, max: number) {
  if (typeof value !== "string") return "";
  return value.trim().slice(0, max);
}

function looksLikeEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function clientIp(request: Request) {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0]?.trim() ?? "";
  return request.headers.get("x-real-ip") ?? "";
}

function hashIp(ip: string) {
  if (!ip) return null;
  const salt = process.env.PARTNER_LEAD_IP_HASH_SALT ?? "akibamiles-hub-waitlist";
  return createHash("sha256").update(`${salt}:${ip}`).digest("hex");
}

export async function POST(request: Request) {
  let body: { email?: unknown; source?: unknown };
  try {
    body = (await request.json()) as { email?: unknown; source?: unknown };
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }

  const email = clean(body.email, 254).toLowerCase();
  const source = clean(body.source, 120) || "hub_page";

  if (!email) {
    return NextResponse.json({ error: "Email address is required." }, { status: 400 });
  }
  if (!looksLikeEmail(email)) {
    return NextResponse.json({ error: "Enter a valid email address." }, { status: 400 });
  }

  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) {
    return NextResponse.json({ error: "Waitlist storage is not configured." }, { status: 503 });
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false },
  });

  const { error } = await supabase.from("hub_waitlist").insert({
    email,
    source,
    ip_hash: hashIp(clientIp(request)),
    user_agent: request.headers.get("user-agent")?.slice(0, 500) ?? null,
  });

  if (error) {
    // Unique constraint violation — already signed up
    if (error.code === "23505") {
      return NextResponse.json({ ok: true, already: true });
    }
    console.error("[hub-waitlist] insert failed", error);
    return NextResponse.json({ error: "Could not save your email. Please try again." }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
