// POST /api/admin/expire-won-vouchers?secret=<ADMIN_QUEUE_SECRET>
// Daily sweep: auto-burns won vouchers past expires_at at expiry_burn_pct
// (default 50% of marketplace Miles), reason='expired'. Winners never lose
// everything; deciding early stays strictly better (manual burn = 80%).
//
// Idempotent: burn_voucher_for_miles enforces UNIQUE(voucher_id) on
// voucher_burn_events and only touches status='issued' rows.

import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!,
);

const ADMIN_SECRET = process.env.ADMIN_QUEUE_SECRET ?? "";

function isAuthorized(req: Request): boolean {
  if (!ADMIN_SECRET) return false;
  const bearer = req.headers.get("authorization");
  if (bearer === `Bearer ${ADMIN_SECRET}`) return true;
  return new URL(req.url).searchParams.get("secret") === ADMIN_SECRET;
}

export async function POST(req: Request) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const { data: expired, error } = await supabase
    .from("issued_vouchers")
    .select("id, user_address")
    .eq("acquisition_source", "leaderboard_win")
    .eq("status", "issued")
    .lte("expires_at", new Date().toISOString())
    .limit(200);

  if (error) {
    console.error("[expire-won-vouchers] query", error.message);
    return NextResponse.json({ error: "query failed" }, { status: 500 });
  }

  const results: Array<Record<string, unknown>> = [];

  for (const v of expired ?? []) {
    const { data, error: rpcErr } = await supabase.rpc("burn_voucher_for_miles", {
      p_voucher_id:   v.id,
      p_user_address: "",
      p_reason:       "expired",
      p_reason_text:  null,
      p_user_country: null,
      p_user_city:    null,
      p_expired:      true,
    });

    if (rpcErr) {
      console.error("[expire-won-vouchers]", v.id, rpcErr.message);
      results.push({ voucherId: v.id, error: rpcErr.message });
      continue;
    }
    const row = Array.isArray(data) ? data[0] : data;
    results.push({ voucherId: v.id, milesCredited: row?.miles_credited ?? null });
  }

  return NextResponse.json({ processed: results.length, results });
}
