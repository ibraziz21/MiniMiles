// src/app/api/minipoints/refund-for-passport/route.ts
import { NextResponse } from "next/server";
import { safeMintRefund } from "@/lib/minipoints";
import { runPassportOp } from "@/lib/passportOps";
import { requireSession } from "@/lib/auth";

export async function POST(req: Request) {
  try {
    const session = await requireSession();
    if (!session) {
      return NextResponse.json({ error: "Authentication required" }, { status: 401 });
    }

    const body = await req.json().catch(() => null);

    if (!body || typeof body.address !== "string") {
      return NextResponse.json(
        { error: "Missing or invalid 'address' in body" },
        { status: 400 }
      );
    }

    if (body.address.toLowerCase() !== session.walletAddress) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    if (
      typeof body.amount !== "number" ||
      !Number.isFinite(body.amount) ||
      body.amount <= 0
    ) {
      return NextResponse.json(
        { error: "Missing or invalid 'amount' in body" },
        { status: 400 }
      );
    }

    if (typeof body.operationId !== "string" || !body.operationId.trim()) {
      return NextResponse.json(
        { error: "Missing 'operationId' in body" },
        { status: 400 }
      );
    }

    const address = body.address as `0x${string}`;
    const amount = body.amount as number;
    const operationId = body.operationId as string;

    const txHash = await runPassportOp({
      operationId,
      address,
      amount,
      type: "refund",
      execute: () =>
        safeMintRefund({ to: address, points: amount, reason: "prosperity-pass-refund" }),
    });

    return NextResponse.json({ ok: true, txHash });
  } catch (err: any) {
    console.error("[API] /api/refund-for-passport error:", err);
    return NextResponse.json(
      {
        error:
          err?.message ||
          "Failed to refund MiniPoints for Prosperity Pass failure.",
      },
      { status: 500 }
    );
  }
}
