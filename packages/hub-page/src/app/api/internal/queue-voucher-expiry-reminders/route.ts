// POST/GET /api/internal/queue-voucher-expiry-reminders
// Hourly "your voucher expires tomorrow" producer (migration 125,
// src/lib/push/voucherExpiry.ts). The database decides which vouchers are
// due; the push worker sends them.
//
// Same dual invocation path as process-push-jobs:
//  - POST, x-webhook-secret header (INTERNAL_WEBHOOK_SECRET).
//  - GET, Authorization: Bearer <CRON_SECRET> (Vercel Cron; see vercel.json).

import { NextResponse } from "next/server";
import { queueVoucherExpiryReminders } from "@/lib/push/voucherExpiry";

export const dynamic = "force-dynamic";

async function handle() {
  const result = await queueVoucherExpiryReminders();
  return NextResponse.json({ ok: !("error" in result), ...result }, { status: "error" in result ? 500 : 200 });
}

export async function POST(req: Request) {
  const secret = req.headers.get("x-webhook-secret");
  if (!secret || secret !== process.env.INTERNAL_WEBHOOK_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return handle();
}

export async function GET(req: Request) {
  const cronSecret = process.env.CRON_SECRET ?? "";
  const auth = req.headers.get("authorization") ?? "";
  if (!cronSecret || auth !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return handle();
}
