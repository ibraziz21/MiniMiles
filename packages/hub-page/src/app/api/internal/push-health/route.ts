// GET /api/internal/push-health — Authorization: Bearer <CRON_SECRET>
// Snapshot of push configuration and the last day's delivery outcomes
// (src/lib/push/health.ts). Counts and error codes only; no member data.
//
//   curl -H "Authorization: Bearer $CRON_SECRET" https://pass.akibamiles.com/api/internal/push-health

import { NextResponse } from "next/server";

import { pushHealth } from "@/lib/push/health";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const cronSecret = process.env.CRON_SECRET ?? "";
  const auth = req.headers.get("authorization") ?? "";
  if (!cronSecret || auth !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const health = await pushHealth(createAdminClient());
  const response = NextResponse.json(health);
  response.headers.set("Cache-Control", "no-store");
  return response;
}
