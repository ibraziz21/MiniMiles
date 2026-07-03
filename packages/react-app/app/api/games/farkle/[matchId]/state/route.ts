import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import { FarkleStateError, getFarkleTurnState } from "@/server/farkle/state";

type Ctx = { params: Promise<{ matchId: string }> };

export async function GET(_req: Request, { params }: Ctx) {
  const { matchId } = await params;

  const session = await requireSession();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const wallet = session.walletAddress.toLowerCase();

  try {
    const state = await getFarkleTurnState(matchId, wallet);
    return NextResponse.json(state, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    const status = err instanceof FarkleStateError ? err.status : 500;
    const message = err instanceof Error ? err.message : "state unavailable";
    return NextResponse.json({ error: message }, { status });
  }
}
