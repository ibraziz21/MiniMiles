// app/api/users/[address]/route.ts
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_SERVICE_KEY!
);

function isEthAddress(s: string | undefined) {
  return typeof s === "string" && /^0x[a-fA-F0-9]{40}$/.test(s);
}

export async function GET(_req: Request, context: any) {
  const address = String(context.params.address || "").toLowerCase();
  if (!isEthAddress(address)) {
    return NextResponse.json({ error: "Bad address" }, { status: 400 });
  }

  // 1) ensure stub row exists (ignore duplicates)
  const { error: upErr } = await supabase
    .from("users")
    .upsert({ user_address: address }, { onConflict: "user_address", ignoreDuplicates: true });
  if (upErr) {
    console.error(upErr);
    return NextResponse.json({ error: "DB error" }, { status: 500 });
  }

  // 2) fetch profile fields
  const { data, error } = await supabase
    .from("users")
    .select("is_member, email, twitter_handle, phone")
    .eq("user_address", address)
    .single();

  if (error) {
    console.error(error);
    return NextResponse.json({ error: "DB error" }, { status: 500 });
  }

  return NextResponse.json({
    user: {
      is_member: data?.is_member === true,
      email: data?.email ?? null,
      twitter_handle: data?.twitter_handle ?? null,
      phone: data?.phone ?? null,
    },
  });
}

export async function PATCH(req: Request, context: any) {
  const address = String(context.params.address || "").toLowerCase();
  if (!isEthAddress(address)) {
    return NextResponse.json({ error: "Bad address" }, { status: 400 });
  }

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const email = String(body?.email ?? "").trim();
  const twitter_handle = String(body?.twitter_handle ?? "").trim();
  const phone = String(body?.phone ?? "").trim();

  // minimal validations (same as client hints)
  const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
  const phoneOk = /^\+?[0-9]{9,15}$/.test(phone);
  if (!emailOk) return NextResponse.json({ error: "Invalid email" }, { status: 400 });
  if (!twitter_handle) return NextResponse.json({ error: "Twitter is required" }, { status: 400 });
  if (!phoneOk) return NextResponse.json({ error: "Invalid phone" }, { status: 400 });

  // upsert user row with details
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
    console.error(upErr);
    return NextResponse.json({ error: "DB error" }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
