import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import { isBlacklisted } from "@/lib/blacklist";
import { fetchSuperAccountForOwner } from "@/lib/prosperity-pass";
import { ensureProsperityPassJob } from "@/lib/prosperityPassQueue";

const REQUIRED_MILES = 100;

export async function POST(req: Request) {
  try {
    const session = await requireSession();
    if (!session) {
      return NextResponse.json({ error: "Authentication required" }, { status: 401 });
    }

    const body = await req.json().catch(() => ({}));
    const idempotencyKey = typeof body.idempotencyKey === "string" ? body.idempotencyKey.trim() : "";
    const address = session.walletAddress;

    if (!idempotencyKey) {
      return NextResponse.json({ error: "Missing idempotencyKey" }, { status: 400 });
    }

    if (await isBlacklisted(address, "prosperity-pass/claim")) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { hasPassport } = await fetchSuperAccountForOwner(address);
    if (hasPassport) {
      return NextResponse.json({ error: "You already have a Prosperity Pass" }, { status: 409 });
    }

    const job = await ensureProsperityPassJob({
      idempotencyKey,
      userAddress: address,
      points: REQUIRED_MILES,
    });

    return NextResponse.json({
      ok: true,
      queued: true,
      jobId: job.id,
      status: job.status,
      safeAddress: job.safe_address,
      txHash: job.tx_hash,
      error: job.last_error,
    });
  } catch (err: any) {
    console.error("[prosperity-pass/claim]", err);
    return NextResponse.json({ error: err?.message ?? "server-error" }, { status: 500 });
  }
}
