// POST/GET /api/internal/process-offer-alerts
// "New offer at a place you saved" scanner (migration 125,
// src/lib/push/offerAlerts.ts): records newly visible offers and queues a
// push for members who saved a participating merchant.
//
// Same dual invocation path as process-push-jobs:
//  - POST, x-webhook-secret header (INTERNAL_WEBHOOK_SECRET).
//  - GET, Authorization: Bearer <CRON_SECRET> (Vercel Cron; see vercel.json).

import { NextResponse } from "next/server";
import { processOfferAlerts } from "@/lib/push/offerAlerts";

export const dynamic = "force-dynamic";

async function handle() {
  const sources = await processOfferAlerts();
  return NextResponse.json({ ok: sources.every((s) => s.status === "recorded"), sources });
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
