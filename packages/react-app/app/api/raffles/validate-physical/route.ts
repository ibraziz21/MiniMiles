// src/app/api/raffles/validate-physical/route.ts
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.SUPABASE_URL!;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY!; // server-side only
const ENTRY_CODE = (process.env.PHYSICAL_ENTRY_CODE || "").trim().toLowerCase();

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
  auth: { persistSession: false },
});

export async function POST(req: Request) {
  try {
    const { raffleId, address, twitter, code, tickets } = await req.json();

    if (!raffleId || !address || !twitter || !code || !tickets) {
      return NextResponse.json({ error: "Missing fields" }, { status: 400 });
    }

    // simple code compare for demo
    if (ENTRY_CODE.length === 0) {
      return NextResponse.json({ error: "Server not configured with entry code" }, { status: 500 });
    }
    if (String(code).trim().toLowerCase() !== ENTRY_CODE) {
      return NextResponse.json({ ok: false, reason: "Invalid entry code" }, { status: 403 });
    }

    // upsert twitter handle into users table (by wallet address)
    await supabase
      .from("users")
      .update({ twitter_handle: twitter })
      .eq("wallet", address.toLowerCase());

    // log entry for audit
    await supabase.from("physical_raffle_entries").insert({
      raffle_id: raffleId,
      user_address: address.toLowerCase(),
      tickets: Number(tickets),
      twitter_handle: twitter,
      entry_code: String(code),
    });

    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json(
      { error: "Server error", details: e?.message ?? String(e) },
      { status: 500 }
    );
  }
}
