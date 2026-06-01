import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import { evaluateRaffleRequirements } from "@/lib/raffleRequirements";

export async function GET(req: NextRequest) {
  const roundIdParam = req.nextUrl.searchParams.get("roundId");
  const roundId = Number(roundIdParam);

  if (!Number.isInteger(roundId) || roundId <= 0) {
    return NextResponse.json({ error: "Invalid roundId" }, { status: 400 });
  }

  try {
    const session = await requireSession();
    if (!session) {
      return NextResponse.json(
        await evaluateRaffleRequirements(roundId),
        { status: 401 },
      );
    }

    return NextResponse.json(
      await evaluateRaffleRequirements(roundId, session.walletAddress),
    );
  } catch (err: any) {
    console.error("[raffle_requirements]", err);
    return NextResponse.json(
      { error: err?.message ?? "Failed to check raffle requirements" },
      { status: 500 },
    );
  }
}
