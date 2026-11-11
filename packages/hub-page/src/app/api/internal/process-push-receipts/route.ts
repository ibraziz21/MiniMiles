// POST/GET /api/internal/process-push-receipts
// Scheduled Expo receipt poller (migration 124, src/lib/push/receipts.ts):
// checks whether accepted native pushes were actually delivered, retires
// uninstalled devices, and surfaces APNs/FCM credential failures.
//
// Same dual invocation path as process-push-jobs:
//  - POST, x-webhook-secret header (INTERNAL_WEBHOOK_SECRET).
//  - GET, Authorization: Bearer <CRON_SECRET> (Vercel Cron; see vercel.json).

import { NextResponse } from "next/server";
import { processPushReceipts } from "@/lib/push/receipts";

export const dynamic = "force-dynamic";

async function handle() {
  const result = await processPushReceipts();
  return NextResponse.json({ ok: true, ...result });
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
