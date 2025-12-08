// app/api/users/[address]/route.ts
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_SERVICE_KEY!
);

function isEthAddress(s: unknown): s is string {
  if (typeof s !== "string") return false;
  const trimmed = s.trim();
  return /^0x[a-fA-F0-9]{40}$/.test(trimmed);
}

// Next 16: params is a Promise, so we must await it
type RouteContext = {
  params: Promise<{ address?: string }>;
};

export async function GET(_req: Request, { params }: RouteContext) {
  const { address: raw } = await params;

  if (!isEthAddress(raw)) {
    console.error("[GET /api/users/[address]] bad param:", raw);
    return NextResponse.json({ error: "Bad address" }, { status: 400 });
  }

  const address = raw.trim().toLowerCase();

  // 1) ensure the stub row exists (ignore duplicate conflicts)
  const { error: upErr } = await supabase
    .from("users")
    .upsert(
      { user_address: address },
      { onConflict: "user_address", ignoreDuplicates: true }
    );

  if (upErr) {
    console.error("[GET /api/users/[address]] upsert error:", upErr);
    return NextResponse.json({ error: "DB error" }, { status: 500 });
  }

  // 2) fetch the flag
  const { data, error } = await supabase
    .from("users")
    .select("is_member")
    .eq("user_address", address)
    .single();

  if (error) {
    console.error("[GET /api/users/[address]] select error:", error);
    return NextResponse.json({ error: "DB error" }, { status: 500 });
  }

  return NextResponse.json({ isMember: data?.is_member === true });
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

  const email = String(body?.email ?? "").trim();
  const twitter_handle = String(body?.twitter_handle ?? "").trim();
  const phone = String(body?.phone ?? "").trim();

  const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
  const phoneOk = /^\+?[0-9]{9,15}$/.test(phone);

  if (!emailOk) {
    return NextResponse.json({ error: "Invalid email" }, { status: 400 });
  }
  if (!twitter_handle) {
    return NextResponse.json({ error: "Twitter is required" }, { status: 400 });
  }
  if (!phoneOk) {
    return NextResponse.json({ error: "Invalid phone" }, { status: 400 });
  }

  const { error: upErr } = await supabase
    .from("users")
    .upsert(
      {
        user_address: address,
        email,
        twitter_handle,
        phone,
      },
      { onConflict: "user_address" }
    );

  if (upErr) {
    console.error("[PATCH /api/users/[address]] upsert error:", upErr);
    return NextResponse.json({ error: "DB error" }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
