// Shared auth/identity/rate-limit boilerplate for every /api/games/* BFF
// route. walletless-pass-skill-games-spec.md §7.1: the browser is never
// trusted for hubUserId/canonicalId/wallet/score/reward — every mutation
// route here re-derives identity from the Supabase cookie session and
// enforces same-origin + rate limits before touching the Backend.

import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { resolveHubQuestCanonical } from "@/lib/akiba/canonicalPartnerQuests";
import { checkAllRateLimits } from "@/lib/rateLimit";
import { isSameOriginRequest } from "@/lib/push/origin";
import { isGamesEnabledFor } from "./gamesRollout";
import type { Identity } from "./backendClient";

export type GameIdentityContext = {
  identity: Identity;
  userId: string;
  email: string | null;
};

export type GameIdentityResult =
  | { ok: true; context: GameIdentityContext }
  | { ok: false; response: NextResponse };

export async function requireGameIdentity(
  req: Request,
  rateLimit: { scope: string; limit: number; windowSeconds: number },
  options: { mutation?: boolean } = {}
): Promise<GameIdentityResult> {
  if (options.mutation) {
    if (req.headers.get("content-type")?.includes("application/json") !== true) {
      return { ok: false, response: NextResponse.json({ error: "unsupported-content-type" }, { status: 415 }) };
    }
    if (!isSameOriginRequest(req)) {
      return { ok: false, response: NextResponse.json({ error: "cross-origin-rejected" }, { status: 403 }) };
    }
  }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return { ok: false, response: NextResponse.json({ error: "unauthenticated" }, { status: 401 }) };
  }

  if (!isGamesEnabledFor(user.email ?? user.id)) {
    return { ok: false, response: NextResponse.json({ error: "not-available" }, { status: 404 }) };
  }

  const withinLimits = await checkAllRateLimits([
    { scope: `${rateLimit.scope}:user:${user.id}`, limit: rateLimit.limit, windowSeconds: rateLimit.windowSeconds },
  ]);
  if (!withinLimits) {
    return { ok: false, response: NextResponse.json({ error: "rate-limited" }, { status: 429 }) };
  }

  const email = user.email ?? null;
  let canonicalId: string;
  try {
    canonicalId = await resolveHubQuestCanonical({ hubUserId: user.id, email });
  } catch (err) {
    console.error("[games/identity] canonical resolution failed:", err);
    return { ok: false, response: NextResponse.json({ error: "game-service-unavailable" }, { status: 503 }) };
  }

  return {
    ok: true,
    context: {
      identity: { canonicalId, hubUserId: user.id },
      userId: user.id,
      email,
    },
  };
}
