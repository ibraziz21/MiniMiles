import { NextResponse } from "next/server";

export const CRACKPOT_COMING_SOON_MESSAGE =
  "CrackPot is temporarily locked while we stabilize the live game.";

export function crackPotComingSoonResponse() {
  return NextResponse.json(
    {
      error: "crackpot-coming-soon",
      message: CRACKPOT_COMING_SOON_MESSAGE,
      retryable: false,
    },
    { status: 503 },
  );
}
