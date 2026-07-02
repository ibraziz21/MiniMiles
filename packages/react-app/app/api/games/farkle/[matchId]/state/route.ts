import { NextResponse } from "next/server";
import { FarkleStateError, getFarkleTurnState } from "@/server/farkle/state";

type Ctx = { params: Promise<{ matchId: string }> };

export async function GET(req: Request, { params }: Ctx) {
  const { matchId } = await params;
  const address = new URL(req.url).searchParams.get("address")?.toLowerCase();
  if (!address) return NextResponse.json({ error: "missing address" }, { status: 400 });

  try {
    const state = await getFarkleTurnState(matchId, address);
    return NextResponse.json(state, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    const status = err instanceof FarkleStateError ? err.status : 500;
    const message = err instanceof Error ? err.message : "state unavailable";
    return NextResponse.json({ error: message }, { status });
  }
}
