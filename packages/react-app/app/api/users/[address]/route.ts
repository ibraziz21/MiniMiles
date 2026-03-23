// app/api/users/[address]/route.ts
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
);

function isEthAddress(s: unknown): s is string {
  if (typeof s !== "string") return false;
  return /^0x[a-fA-F0-9]{40}$/.test(s.trim());
}

type RouteContext = {
  params: Promise<{ address?: string }>;
};

const PROFILE_FIELDS = [
  "username",
  "full_name",
  "email",
  "phone",
  "twitter_handle",
  "avatar_url",
  "bio",
  "interests",
] as const;

function computeCompletion(row: Record<string, any>): number {
  let filled = 0;
  for (const f of PROFILE_FIELDS) {
    const v = row[f];
    if (f === "interests") {
      if (Array.isArray(v) && v.length > 0) filled++;
    } else {
      if (v && String(v).trim()) filled++;
    }
  }
  return Math.round((filled / PROFILE_FIELDS.length) * 100);
}

export async function GET(_req: Request, { params }: RouteContext) {
  const { address: raw } = await params;

  if (!isEthAddress(raw)) {
    console.error("[GET /api/users/[address]] bad param:", raw);
    return NextResponse.json({ error: "Bad address" }, { status: 400 });
  }

  const address = raw.trim().toLowerCase();

  // auto-upsert stub row
  await supabase
    .from("users")
    .upsert(
      { user_address: address },
      { onConflict: "user_address", ignoreDuplicates: true }
    );

  const { data, error } = await supabase
    .from("users")
    .select(
      "is_member, username, full_name, email, phone, twitter_handle, avatar_url, bio, country, interests, profile_milestone_50_claimed, profile_milestone_100_claimed"
    )
    .eq("user_address", address)
    .single();

  if (error) {
    console.error("[GET /api/users/[address]] select error:", error);
    return NextResponse.json({ error: "DB error" }, { status: 500 });
  }

  const completion = computeCompletion(data ?? {});

  return NextResponse.json({ ...data, isMember: data?.is_member === true, completion });
}

export async function PATCH(req: Request, { params }: RouteContext) {
  const { address: raw } = await params;

  if (!isEthAddress(raw)) {
    console.error("[PATCH /api/users/[address]] bad param:", raw);
    return NextResponse.json({ error: "Bad address" }, { status: 400 });
  }

  const address = raw.trim().toLowerCase();

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const allowed: Record<string, any> = {};

  if ("username" in body) {
    const v = String(body.username ?? "").trim();
    if (!v || !/^[a-zA-Z0-9_]{3,30}$/.test(v)) {
      return NextResponse.json(
        { error: "username must be 3–30 alphanumeric/underscore chars" },
        { status: 400 }
      );
    }
    allowed.username = v;
  }
  if ("full_name" in body) {
    const v = String(body.full_name ?? "").trim();
    if (!v) return NextResponse.json({ error: "full_name cannot be empty" }, { status: 400 });
    allowed.full_name = v;
  }
  if ("email" in body) {
    const v = String(body.email ?? "").trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) {
      return NextResponse.json({ error: "Invalid email" }, { status: 400 });
    }
    allowed.email = v;
  }
  if ("phone" in body) {
    const v = String(body.phone ?? "").trim();
    if (!/^\+?[0-9]{9,15}$/.test(v)) {
      return NextResponse.json({ error: "Invalid phone" }, { status: 400 });
    }
    allowed.phone = v;
  }
  if ("twitter_handle" in body) {
    const v = String(body.twitter_handle ?? "").trim();
    if (!v) return NextResponse.json({ error: "twitter_handle cannot be empty" }, { status: 400 });
    allowed.twitter_handle = v;
  }
  if ("avatar_url" in body) {
    allowed.avatar_url = String(body.avatar_url ?? "").trim() || null;
  }
  if ("bio" in body) {
    const v = String(body.bio ?? "").trim().slice(0, 200);
    allowed.bio = v || null;
  }
  if ("country" in body) {
    allowed.country = String(body.country ?? "").trim() || null;
  }
  if ("interests" in body) {
    if (!Array.isArray(body.interests)) {
      return NextResponse.json({ error: "interests must be an array" }, { status: 400 });
    }
    allowed.interests = body.interests.slice(0, 8).map(String);
  }

  if (Object.keys(allowed).length === 0) {
    return NextResponse.json({ error: "No valid fields to update" }, { status: 400 });
  }

  const { error } = await supabase
    .from("users")
    .update(allowed)
    .eq("user_address", address);

  if (error) {
    console.error("[PATCH /api/users/[address]]", error);
    return NextResponse.json({ error: "DB error" }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
