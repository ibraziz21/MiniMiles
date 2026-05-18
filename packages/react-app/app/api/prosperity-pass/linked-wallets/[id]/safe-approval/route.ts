import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import {
  confirmSafeApprovalTx,
  getLinkedWalletRequestById,
  toPublicLinkedWalletRequest,
} from "@/lib/prosperityPassLinkedWallets";
import { normalizeEvmAddress } from "@/lib/prosperity-pass-linking";

export const runtime = "nodejs";

export async function POST(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const session = await requireSession();
    if (!session) {
      return NextResponse.json({ error: "Authentication required" }, { status: 401 });
    }

    const primaryWallet = normalizeEvmAddress(session.walletAddress);
    if (!primaryWallet) {
      return NextResponse.json({ error: "Invalid session wallet" }, { status: 400 });
    }

    const { id } = await context.params;
    const row = await getLinkedWalletRequestById(id);
    if (!row) {
      return NextResponse.json({ error: "Link request not found" }, { status: 404 });
    }
    if (row.primary_wallet !== primaryWallet) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const body = await req.json().catch(() => null);
    const txHash = body?.txHash;
    if (typeof txHash !== "string") {
      return NextResponse.json({ error: "Transaction hash is required" }, { status: 400 });
    }

    const updated = await confirmSafeApprovalTx({ row, txHash });
    return NextResponse.json({ request: toPublicLinkedWalletRequest(updated) });
  } catch (err: any) {
    console.error("[linked-wallets][safe-approval]", err);
    const message = err?.message ?? "Could not confirm Safe approval";
    const status = /expired/i.test(message)
      ? 410
      : /confirmed|transaction|signature|approval/i.test(message)
        ? 400
        : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
