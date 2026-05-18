import { NextResponse } from "next/server";
import {
  getLinkedWalletRequestById,
  toPublicLinkedWalletRequest,
} from "@/lib/prosperityPassLinkedWallets";

export const runtime = "nodejs";

export async function GET(
  _req: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await context.params;
    const row = await getLinkedWalletRequestById(id);
    if (!row) {
      return NextResponse.json({ error: "Link request not found" }, { status: 404 });
    }

    return NextResponse.json({ request: toPublicLinkedWalletRequest(row) });
  } catch (err: any) {
    console.error("[linked-wallets][id][GET]", err);
    return NextResponse.json(
      { error: err?.message ?? "Could not load link request" },
      { status: 500 }
    );
  }
}
