// src/app/api/raffles/validate-physical/route.ts
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

const SUPABASE_URL = process.env.SUPABASE_URL!;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY!;
const ALLOWED_COUNTRIES = (process.env.ALLOWED_COUNTRY_CODES || "KE")
  .split(",")
  .map((s) => s.trim().toUpperCase());

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
  auth: { persistSession: false },
});

const emailLooksValid = (s: string) =>
  /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(s ?? "").trim());

const phoneIsE164254 = (s: string) =>
  /^\+254\d{9}$/.test(String(s ?? "").trim());

export async function POST(req: Request) {
  try {
    // Geo from headers (Vercel sets these in prod)
  

    const body = await req.json();
    const { raffleId, address, twitter, email, phone } = body;
    const tickets = body?.tickets; // optional

    if (!raffleId || !address || !twitter || !email) {
      return NextResponse.json({ error: "Missing fields" }, { status: 400 });
    }
    if (!emailLooksValid(email)) {
      return NextResponse.json({ error: "Invalid email address" }, { status: 400 });
    }
    // phone is optional; if present, must be Kenyan +254#########
    if (phone && !phoneIsE164254(phone)) {
      return NextResponse.json(
        { error: "Phone must be Kenyan +2547xxxxxxxx or omitted" },
        { status: 400 }
      );
    }

    const user_address = String(address).toLowerCase();

    // --- Upsert user profile (creates row if it doesn't exist) ---
    const upsertPayload: Record<string, any> = {
      user_address,                 // PRIMARY KEY / UNIQUE
      twitter_handle: twitter,
      email,
      ...(phone ? { phone } : {}),  // don't send 'phone' if missing (prevents wiping)
    };

    const { error: upsertErr } = await supabase
      .from("users")
      .upsert(upsertPayload, { onConflict: "user_address" });

    if (upsertErr) {
      return NextResponse.json({ error: "Failed to save user", details: upsertErr.message }, { status: 500 });
    }

    // --- If tickets provided, log/merge participation row for audit ---
    if (typeof tickets !== "undefined" && tickets !== null) {
      // Check if a row exists for this raffle + user
      const { data: existing, error: selErr } = await supabase
        .from("physical_raffle_entries")
        .select("id")
        .eq("raffle_id", raffleId)
        .eq("user_address", user_address)
        .maybeSingle();

      if (selErr) {
        return NextResponse.json({ error: "Lookup failed", details: selErr.message }, { status: 500 });
      }

      const entryPayload = {
        raffle_id: raffleId,
        user_address,
        tickets: Number(tickets),
        twitter_handle: twitter,
        email,
        phone: phone ?? null,
        updated_at: new Date().toISOString(),
      };

      if (existing?.id) {
        const { error: updErr } = await supabase
          .from("physical_raffle_entries")
          .update(entryPayload)
          .eq("id", existing.id);
        if (updErr) {
          return NextResponse.json({ error: "Failed to update entry", details: updErr.message }, { status: 500 });
        }
      } else {
        const { error: insErr } = await supabase
          .from("physical_raffle_entries")
          .insert(entryPayload);
        if (insErr) {
          return NextResponse.json({ error: "Failed to create entry", details: insErr.message }, { status: 500 });
        }
      }
    }

    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json(
      { error: "Server error", details: e?.message ?? String(e) },
      { status: 500 }
    );
  }
}