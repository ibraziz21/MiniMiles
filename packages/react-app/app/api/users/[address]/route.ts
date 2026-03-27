// app/api/users/[address]/route.ts
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { requireSession } from "@/lib/auth";

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

const VALID_COUNTRIES = new Set([
  'Afghanistan','Albania','Algeria','Angola','Argentina','Armenia','Australia',
  'Austria','Azerbaijan','Bahrain','Bangladesh','Belarus','Belgium','Benin',
  'Bolivia','Bosnia and Herzegovina','Botswana','Brazil','Bulgaria','Burkina Faso',
  'Burundi','Cambodia','Cameroon','Canada','Central African Republic','Chad','Chile',
  'China','Colombia','Congo','Costa Rica','Croatia','Cuba','Cyprus','Czech Republic',
  'Denmark','Dominican Republic','DR Congo','Ecuador','Egypt','El Salvador',
  'Estonia','Ethiopia','Finland','France','Gabon','Gambia','Georgia','Germany',
  'Ghana','Greece','Guatemala','Guinea','Haiti','Honduras','Hungary','India',
  'Indonesia','Iran','Iraq','Ireland','Israel','Italy','Ivory Coast','Jamaica',
  'Japan','Jordan','Kazakhstan','Kenya','Kosovo','Kuwait','Kyrgyzstan','Laos',
  'Latvia','Lebanon','Liberia','Libya','Lithuania','Luxembourg','Madagascar',
  'Malawi','Malaysia','Mali','Malta','Mauritania','Mauritius','Mexico','Moldova',
  'Mongolia','Morocco','Mozambique','Myanmar','Namibia','Nepal','Netherlands',
  'New Zealand','Nicaragua','Niger','Nigeria','North Korea','North Macedonia',
  'Norway','Oman','Pakistan','Panama','Paraguay','Peru','Philippines','Poland',
  'Portugal','Qatar','Romania','Russia','Rwanda','Saudi Arabia','Senegal',
  'Serbia','Sierra Leone','Singapore','Slovakia','Slovenia','Somalia',
  'South Africa','South Korea','South Sudan','Spain','Sri Lanka','Sudan',
  'Sweden','Switzerland','Syria','Taiwan','Tajikistan','Tanzania','Thailand',
  'Togo','Trinidad and Tobago','Tunisia','Turkey','Turkmenistan','Uganda',
  'Ukraine','United Arab Emirates','United Kingdom','United States','Uruguay',
  'Uzbekistan','Venezuela','Vietnam','Yemen','Zambia','Zimbabwe',
]);

import { computeCompletion } from "@/lib/profileCompletion";

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

  // Verify the caller owns this address
  const session = await requireSession();
  if (!session || session.walletAddress !== address) {
    return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  }

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
    // Uniqueness check — another user must not hold this username
    const { data: taken } = await supabase
      .from("users")
      .select("user_address")
      .eq("username", v)
      .neq("user_address", address)
      .maybeSingle();
    if (taken) {
      return NextResponse.json({ error: "Username already taken" }, { status: 409 });
    }
    allowed.username = v;
  }

  if ("full_name" in body) {
    const v = String(body.full_name ?? "").trim();
    if (v && v.length < 3) {
      return NextResponse.json({ error: "full_name must be at least 3 characters" }, { status: 400 });
    }
    allowed.full_name = v || null;
  }

  if ("email" in body) {
    const v = String(body.email ?? "").trim();
    if (v && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) {
      return NextResponse.json({ error: "Invalid email" }, { status: 400 });
    }
    allowed.email = v || null;
  }

  if ("phone" in body) {
    const v = String(body.phone ?? "").trim();
    if (v && !/^\+?[0-9]{9,15}$/.test(v)) {
      return NextResponse.json({ error: "Invalid phone" }, { status: 400 });
    }
    allowed.phone = v || null;
  }

  if ("twitter_handle" in body) {
    const v = String(body.twitter_handle ?? "").trim();
    if (v && !/^@?[A-Za-z0-9_]{4,15}$/.test(v)) {
      return NextResponse.json(
        { error: "twitter_handle must be a valid Twitter username (4–15 chars)" },
        { status: 400 }
      );
    }
    allowed.twitter_handle = v || null;
  }

  if ("avatar_url" in body) {
    allowed.avatar_url = String(body.avatar_url ?? "").trim() || null;
  }

  if ("bio" in body) {
    const v = String(body.bio ?? "").trim().slice(0, 200);
    if (v && v.length < 20) {
      return NextResponse.json({ error: "bio must be at least 20 characters" }, { status: 400 });
    }
    allowed.bio = v || null;
  }

  if ("country" in body) {
    const v = String(body.country ?? "").trim();
    if (v && !VALID_COUNTRIES.has(v)) {
      return NextResponse.json({ error: "Invalid country" }, { status: 400 });
    }
    allowed.country = v || null;
  }

  if ("interests" in body) {
    if (!Array.isArray(body.interests)) {
      return NextResponse.json({ error: "interests must be an array" }, { status: 400 });
    }
    const items = body.interests
      .map((i: any) => String(i).trim())
      .filter((i: string) => i.length >= 2)
      .slice(0, 8);
    allowed.interests = items;
  }

  if (Object.keys(allowed).length === 0) {
    return NextResponse.json({ error: "No valid fields to update" }, { status: 400 });
  }

  const { error } = await supabase
    .from("users")
    .update(allowed)
    .eq("user_address", address);

  if (error) {
    // Unique constraint violation on username (concurrent request race)
    if (error.code === "23505") {
      return NextResponse.json({ error: "Username already taken" }, { status: 409 });
    }
    console.error("[PATCH /api/users/[address]]", error);
    return NextResponse.json({ error: "DB error" }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
