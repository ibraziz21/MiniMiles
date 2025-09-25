// src/app/api/raffles/validate-physical/route.ts
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.SUPABASE_URL!;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY!; // server-side only

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
  auth: { persistSession: false },
});

const emailLooksValid = (s: string) =>
  /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(s ?? "").trim());

export async function POST(req: Request) {
  try {
    const { raffleId, address, twitter, email, tickets } = await req.json();

    if (!raffleId || !address || !twitter || !email || !tickets) {
      return NextResponse.json({ error: "Missing fields" }, { status: 400 });
    }
    if (!emailLooksValid(email)) {
      return NextResponse.json({ error: "Invalid email address" }, { status: 400 });
    }

    const wallet = String(address).toLowerCase();

    // upsert twitter + email into users table (by wallet address)
    await supabase
      .from("users")
      .update({ twitter_handle: twitter, email })
      .eq("wallet", wallet);

    // avoid duplicate rows per (raffle_id, user_address) if already exists
    const { data: existing } = await supabase
      .from("physical_raffle_entries")
      .select("id")
      .eq("raffle_id", raffleId)
      .eq("user_address", wallet)
      .maybeSingle();

    if (existing?.id) {
      await supabase
        .from("physical_raffle_entries")
        .update({
          tickets: Number(tickets),
          twitter_handle: twitter,
          email,
          updated_at: new Date().toISOString(),
        })
        .eq("id", existing.id);
    } else {
      await supabase.from("physical_raffle_entries").insert({
        raffle_id: raffleId,
        user_address: wallet,
        tickets: Number(tickets),
        twitter_handle: twitter,
        email,
      });
    }

    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json(
      { error: "Server error", details: e?.message ?? String(e) },
      { status: 500 }
    );
  }
}
