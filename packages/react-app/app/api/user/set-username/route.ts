import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const SUPABASE_SERVICE_KEY =
  process.env.NEXT_PUBLIC_SUPABASE_SERVICE_KEY || "";

const supabase = SUPABASE_URL && SUPABASE_SERVICE_KEY
  ? createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)
  : null;

function isEthAddress(addr: string): boolean {
  return /^0x[a-fA-F0-9]{40}$/.test(addr);
}

function validateUsername(raw: string): string | null {
  const trimmed = raw.trim();
  if (trimmed.length < 3 || trimmed.length > 20) {
    return "Username must be between 3 and 20 characters.";
  }
  if (!/^[a-zA-Z0-9_]+$/.test(trimmed)) {
    return "Username can only contain letters, numbers, and underscores.";
  }
  return null;
}

export async function POST(req: Request) {
  try {
    if (!supabase) {
      return NextResponse.json(
        { error: "Supabase is not configured" },
        { status: 500 }
      );
    }

    const body = await req.json().catch(() => null) as
      | { address?: string; username?: string }
      | null;

    if (!body?.address || !body?.username) {
      return NextResponse.json(
        { error: "address and username are required" },
        { status: 400 }
      );
    }

    const address = body.address.trim();
    if (!isEthAddress(address)) {
      return NextResponse.json(
        { error: "Invalid wallet address" },
        { status: 400 }
      );
    }

    const usernameErr = validateUsername(body.username);
    if (usernameErr) {
      return NextResponse.json(
        { error: usernameErr },
        { status: 400 }
      );
    }

    const username = body.username.trim().toLowerCase();
    const lowerAddr = address.toLowerCase();

    // 1) Check if some other user already owns this username
    const { data: existing, error: existingErr } = await supabase
      .from("users")
      .select("user_address")
      .eq("username", username)
      .maybeSingle();

    if (existingErr) {
      console.error(
        "[POST /api/user/set-username] select existing error:",
        existingErr
      );
      return NextResponse.json(
        { error: "Failed to check username availability" },
        { status: 500 }
      );
    }

    if (existing && existing.user_address.toLowerCase() !== lowerAddr) {
      return NextResponse.json(
        { error: "This username is already taken." },
        { status: 409 }
      );
    }

    // 2) Upsert for this wallet
    const { error: upsertErr } = await supabase
      .from("users")
      .upsert(
        { user_address: lowerAddr, username },
        { onConflict: "user_address" }
      );

    if (upsertErr) {
      console.error(
        "[POST /api/user/set-username] upsert error:",
        upsertErr
      );
      return NextResponse.json(
        { error: "Failed to save username" },
        { status: 500 }
      );
    }

    return NextResponse.json({ username });
  } catch (err) {
    console.error("[POST /api/user/set-username] exception:", err);
    return NextResponse.json(
      { error: "Unexpected error" },
      { status: 500 }
    );
  }
}
