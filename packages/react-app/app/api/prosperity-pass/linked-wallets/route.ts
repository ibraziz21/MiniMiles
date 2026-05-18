import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import {
  createLinkedWalletRequest,
  getLatestLinkedWalletRequestForPrimary,
  toPublicLinkedWalletRequest,
} from "@/lib/prosperityPassLinkedWallets";
import { normalizeEvmAddress } from "@/lib/prosperity-pass-linking";

export const runtime = "nodejs";

export async function GET() {
  try {
    const session = await requireSession();
    if (!session) {
      return NextResponse.json({ error: "Authentication required" }, { status: 401 });
    }

    const primaryWallet = normalizeEvmAddress(session.walletAddress);
    if (!primaryWallet) {
      return NextResponse.json({ error: "Invalid session wallet" }, { status: 400 });
    }

    const row = await getLatestLinkedWalletRequestForPrimary(primaryWallet);
    return NextResponse.json({
      request: row ? toPublicLinkedWalletRequest(row) : null,
    });
  } catch (err: any) {
    console.error("[linked-wallets][GET]", err);
    return NextResponse.json(
      { error: err?.message ?? "Could not load linked wallet status" },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await requireSession();
    if (!session) {
      return NextResponse.json({ error: "Authentication required" }, { status: 401 });
    }

    const primaryWallet = normalizeEvmAddress(session.walletAddress);
    if (!primaryWallet) {
      return NextResponse.json({ error: "Invalid session wallet" }, { status: 400 });
    }

    const body = await req.json().catch(() => null);
    const linkedWallet = normalizeEvmAddress(body?.linkedWallet);
    if (!linkedWallet) {
      return NextResponse.json({ error: "Invalid external wallet address" }, { status: 400 });
    }

    const row = await createLinkedWalletRequest({
      primaryWallet,
      linkedWallet,
    });

    return NextResponse.json(
      { request: toPublicLinkedWalletRequest(row) },
      { status: 201 }
    );
  } catch (err: any) {
    console.error("[linked-wallets][POST]", err);
    const message = err?.message ?? "Could not create linked wallet request";
    const status =
      /invalid|different|required|already|create your prosperity pass/i.test(message)
        ? 400
        : 500;

    return NextResponse.json({ error: message }, { status });
  }
}
