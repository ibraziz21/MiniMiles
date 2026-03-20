// src/app/api/minipoints/burn-for-passport/route.ts
import { NextResponse } from "next/server";
import { safeBurnMiniPoints } from "@/lib/minipoints";
import { runPassportOp } from "@/lib/passportOps";

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => null);

    if (!body || typeof body.address !== "string") {
      return NextResponse.json(
        { error: "Missing or invalid 'address' in body" },
        { status: 400 }
      );
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
      type: "burn",
      execute: () =>
        safeBurnMiniPoints({ from: address, points: amount, reason: "prosperity-pass" }),
    });

    return NextResponse.json({ ok: true, txHash });
  } catch (err: any) {
    console.error("[API] /api/burn-for-passport error:", err);
    return NextResponse.json(
      { error: err?.message || "Failed to burn MiniPoints for Prosperity Pass." },
      { status: 500 }
    );
  }
}
