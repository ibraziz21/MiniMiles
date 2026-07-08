import { NextResponse } from "next/server";

export const CRACKPOT_COMING_SOON_MESSAGE =
  "CrackPot is temporarily offline.";

export function isCrackPotLive() {
  return process.env.CRACKPOT_PAUSED !== "true";
}

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
