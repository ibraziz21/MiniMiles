import { NextRequest, NextResponse } from "next/server";
import {
  confirmFinalAddOwnerTx,
  getLinkedWalletRequestById,
  toPublicLinkedWalletRequest,
} from "@/lib/prosperityPassLinkedWallets";

export const runtime = "nodejs";

export async function POST(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await context.params;
    const row = await getLinkedWalletRequestById(id);
    if (!row) {
      return NextResponse.json({ error: "Link request not found" }, { status: 404 });
    }

    const body = await req.json().catch(() => null);
    const txHash = body?.txHash;
    if (typeof txHash !== "string") {
      return NextResponse.json({ error: "Transaction hash is required" }, { status: 400 });
    }

    const updated = await confirmFinalAddOwnerTx({ row, txHash });
    return NextResponse.json({ request: toPublicLinkedWalletRequest(updated) });
  } catch (err: any) {
    console.error("[linked-wallets][finalize]", err);
    const message = err?.message ?? "Could not finalize linked wallet";
    const status = /expired/i.test(message)
      ? 410
      : /approval|transaction|linked|expected/i.test(message)
        ? 400
        : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
