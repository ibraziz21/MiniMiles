// src/app/api/minipoints/refund-for-passport/route.ts
import { NextResponse } from "next/server";
import { safeMintRefund } from "@/lib/minipoints";

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

    const address = body.address as `0x${string}`;
    const amount = body.amount as number;

    const txHash = await safeMintRefund({
      to: address,
      points: amount,
      reason: "prosperity-pass-refund",
    });

    return NextResponse.json({ ok: true, txHash });
  } catch (err: any) {
    console.error("[API] /api//refund-for-passport error:", err);
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
