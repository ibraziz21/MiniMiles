import { NextRequest, NextResponse } from "next/server";
import {
  getLinkedWalletRequestById,
  toPublicLinkedWalletRequest,
  verifyExternalWalletSignature,
} from "@/lib/prosperityPassLinkedWallets";

export const runtime = "nodejs";

export async function POST(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await context.params;
    const body = await req.json().catch(() => null);
    const signature = body?.signature;
    if (typeof signature !== "string") {
      return NextResponse.json({ error: "Signature is required" }, { status: 400 });
    }

    const row = await getLinkedWalletRequestById(id);
    if (!row) {
      return NextResponse.json({ error: "Link request not found" }, { status: 404 });
    }

    const updated = await verifyExternalWalletSignature({ row, signature });
    return NextResponse.json({ request: toPublicLinkedWalletRequest(updated) });
  } catch (err: any) {
    console.error("[linked-wallets][verify-signature]", err);
    const message = err?.message ?? "Could not verify signature";
    const status = /expired/i.test(message) ? 410 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}
