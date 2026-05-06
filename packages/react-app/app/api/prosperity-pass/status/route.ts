import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import { getProsperityPassJob } from "@/lib/prosperityPassQueue";

export async function GET(req: NextRequest) {
  try {
    const session = await requireSession();
    if (!session) {
      return NextResponse.json({ error: "Authentication required" }, { status: 401 });
    }

    const idempotencyKey = req.nextUrl.searchParams.get("idempotencyKey")?.trim() ?? "";
    if (!idempotencyKey) {
      return NextResponse.json({ error: "idempotencyKey is required" }, { status: 400 });
    }

    const job = await getProsperityPassJob(idempotencyKey);
    if (!job || job.user_address !== session.walletAddress) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    return NextResponse.json({
      ok: true,
      status: job.status,
      safeAddress: job.safe_address,
      txHash: job.tx_hash,
      burnTxHash: job.burn_tx_hash,
      refundTxHash: job.refund_tx_hash,
      error: job.last_error,
    });
  } catch (err: any) {
    console.error("[prosperity-pass/status]", err);
    return NextResponse.json({ error: err?.message ?? "server-error" }, { status: 500 });
  }
}
