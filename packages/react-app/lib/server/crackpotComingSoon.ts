import { NextResponse } from "next/server";
import type { CrackPotVersion } from "@/lib/crackpotTypes";

export const CRACKPOT_COMING_SOON_MESSAGE =
  "CrackPot is temporarily offline.";

export const CRACKPOT_USDT_LOCKED_MESSAGE =
  "CrackPot USDT is locked pending gaming licence approval.";

// CRACKPOT_PAUSED=true is the global kill switch (both versions offline).
// USDT requires a gaming licence before launch (see project GDD), so it
// stays locked unless CRACKPOT_USDT_ENABLED=true is explicitly set — Miles
// can be live while USDT remains locked.
export function isCrackPotLive(version?: CrackPotVersion) {
  if (process.env.CRACKPOT_PAUSED === "true") return false;
  if (version === "usdt") return process.env.CRACKPOT_USDT_ENABLED === "true";
  return true;
}

export function crackPotComingSoonResponse(version?: CrackPotVersion) {
  return NextResponse.json(
    {
      error: "crackpot-coming-soon",
      message: version === "usdt" ? CRACKPOT_USDT_LOCKED_MESSAGE : CRACKPOT_COMING_SOON_MESSAGE,
      retryable: false,
    },
    { status: 503 },
  );
}
