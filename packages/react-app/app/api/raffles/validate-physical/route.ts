// src/app/api/raffles/validate-physical/route.ts
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

const SUPABASE_URL = process.env.SUPABASE_URL!;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY!;

/**
 * Countries where the raffle is available (used for phone dial-code gating + UI dropdown elsewhere).
 */
const COUNTRY_CONFIG = [
  { iso: "NG", name: "Nigeria", dialCode: "+234" },
  { iso: "KE", name: "Kenya", dialCode: "+254" },
  { iso: "GH", name: "Ghana", dialCode: "+233" },
  { iso: "EG", name: "Egypt", dialCode: "+20" },
  { iso: "MA", name: "Morocco", dialCode: "+212" },
  { iso: "CI", name: "Côte d’Ivoire", dialCode: "+225" },
  { iso: "UG", name: "Uganda", dialCode: "+256" },
  { iso: "TZ", name: "Tanzania", dialCode: "+255" },
  { iso: "TN", name: "Tunisia", dialCode: "+216" },
  { iso: "ZA", name: "South Africa", dialCode: "+27" },
];

const ALLOWED_DIAL_CODES = COUNTRY_CONFIG.map((c) => c.dialCode);

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
  auth: { persistSession: false },
});

const emailLooksValid = (s: string) =>
  /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(s ?? "").trim());

/**
 * Phone must:
 *  - be E.164-like (+<digits>)
 *  - start with one of the allowed dial codes
 */
const phoneIsAllowedE164 = (s: string) => {
  const str = String(s ?? "").trim();
  if (!/^\+\d{6,15}$/.test(str)) return false;
  return ALLOWED_DIAL_CODES.some((code) => str.startsWith(code));
};

export async function POST(req: Request) {
  try {
    // ✅ IP/Geo gating removed — no country header enforcement.

    const body = await req.json();
    const { raffleId, address, twitter, email, phone } = body;
    const tickets = body?.tickets; // optional

    // ─── Basic required fields ───────────────────────────────────────────────
    if (!raffleId || !address || !twitter || !email) {
      return NextResponse.json(
        { ok: false, error: "Missing fields" },
        { status: 400 }
      );
    }

    if (!emailLooksValid(email)) {
      return NextResponse.json(
        { ok: false, error: "Invalid email address" },
        { status: 400 }
      );
    }

    // PHONE REQUIRED + must be from one of the allowed dial codes
    if (!phone || !phoneIsAllowedE164(phone)) {
      const allowedCodes = ALLOWED_DIAL_CODES.join(", ");
      return NextResponse.json(
        {
          ok: false,
          error: "Invalid phone",
          reason: `Phone must be a valid mobile number starting with one of: ${allowedCodes}.`,
        },
        { status: 400 }
      );
    }

    const user_address = String(address).toLowerCase();

    // ─── Upsert user profile ─────────────────────────────────────────────────
    const upsertPayload: Record<string, any> = {
      user_address, // PRIMARY KEY / UNIQUE
      twitter_handle: twitter,
      email,
      phone, // always present & valid now
    };

    const { error: upsertErr } = await supabase
      .from("users")
      .upsert(upsertPayload, { onConflict: "user_address" });

    if (upsertErr) {
      return NextResponse.json(
        {
          ok: false,
          error: "Failed to save user",
          details: upsertErr.message,
        },
        { status: 500 }
      );
    }

    // ─── If tickets provided, log/merge participation row for audit ──────────
    if (typeof tickets !== "undefined" && tickets !== null) {
      const ticketCount = Number(tickets);

      if (!Number.isFinite(ticketCount) || ticketCount <= 0) {
        return NextResponse.json(
          {
            ok: false,
            error: "Invalid tickets",
            reason: "Tickets must be a positive number.",
          },
          { status: 400 }
        );
      }

      const { data: existing, error: selErr } = await supabase
        .from("physical_raffle_entries")
        .select("id")
        .eq("raffle_id", raffleId)
        .eq("user_address", user_address)
        .maybeSingle();

      if (selErr) {
        return NextResponse.json(
          { ok: false, error: "Lookup failed", details: selErr.message },
          { status: 500 }
        );
      }

      const entryPayload = {
        raffle_id: raffleId,
        user_address,
        tickets: ticketCount,
        twitter_handle: twitter,
        email,
        phone,
        updated_at: new Date().toISOString(),
      };

      if (existing?.id) {
        const { error: updErr } = await supabase
          .from("physical_raffle_entries")
          .update(entryPayload)
          .eq("id", existing.id);

        if (updErr) {
          return NextResponse.json(
            {
              ok: false,
              error: "Failed to update entry",
              details: updErr.message,
            },
            { status: 500 }
          );
        }
      } else {
        const { error: insErr } = await supabase
          .from("physical_raffle_entries")
          .insert(entryPayload);

        if (insErr) {
          return NextResponse.json(
            {
              ok: false,
              error: "Failed to create entry",
              details: insErr.message,
            },
            { status: 500 }
          );
        }
      }
    }

    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json(
      {
        ok: false,
        error: "Server error",
        details: e?.message ?? String(e),
      },
      { status: 500 }
    );
  }
}
