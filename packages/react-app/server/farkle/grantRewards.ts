// server/farkle/grantRewards.ts
// Shared reward-granting logic for all Farkle match-end paths:
// bank (win by score), forfeit, and timeout.
//
// Delegates settlement to the Railway backend. Vercel should not own the
// resolver nonce space or long-running receipt/reconcile work.

const FARKLE_BACKEND =
  process.env.FARKLE_SETTLEMENT_BACKEND_URL ??
  process.env.GAMES_BACKEND_URL ??
  "https://backend-production-aa7f.up.railway.app";

const FARKLE_SETTLEMENT_SECRET =
  process.env.FARKLE_SETTLEMENT_SECRET ??
  process.env.ADMIN_QUEUE_SECRET ??
  process.env.CRON_SECRET ??
  "";

const FARKLE_SETTLEMENT_DISPATCH_TIMEOUT_MS =
  Number(process.env.FARKLE_SETTLEMENT_DISPATCH_TIMEOUT_MS ?? "25000") || 25_000;

export interface FarkleRewardParams {
  matchId:       string;
  modeKey:       string;
  winnerAddress: string;
  loserAddress:  string;
  winnerScore:   number;
  loserScore:    number;
  winMiles:      number;
  losMiles:      number;
  winCreditCents: number;
  endReason:     "score" | "forfeit" | "timeout";
}

export async function grantFarkleRewards(p: FarkleRewardParams): Promise<void> {
  if (!FARKLE_SETTLEMENT_SECRET) {
    throw new Error("FARKLE_SETTLEMENT_SECRET/ADMIN_QUEUE_SECRET/CRON_SECRET not configured");
  }

  console.log(
    `[grantFarkleRewards] dispatching matchId=${p.matchId} modeKey=${p.modeKey}` +
    ` winner=${p.winnerAddress} loser=${p.loserAddress}` +
    ` winMiles=${p.winMiles} lossMiles=${p.losMiles} winCreditCents=${p.winCreditCents}` +
    ` endReason=${p.endReason}`,
  );

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FARKLE_SETTLEMENT_DISPATCH_TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(`${FARKLE_BACKEND.replace(/\/$/, "")}/games/farkle/settle`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${FARKLE_SETTLEMENT_SECRET}`,
      },
      body: JSON.stringify({ matchId: p.matchId }),
      signal: controller.signal,
    });
  } catch (err: any) {
    const timedOut = err?.name === "AbortError";
    throw new Error(
      timedOut
        ? `Railway Farkle settlement timed out after ${FARKLE_SETTLEMENT_DISPATCH_TIMEOUT_MS}ms`
        : err?.message ?? "Railway Farkle settlement request failed",
    );
  } finally {
    clearTimeout(timer);
  }

  const data = await res.json().catch(() => null);
  if (!res.ok || data?.ok === false) {
    const msg = data?.error ?? `Railway Farkle settlement failed with status ${res.status}`;
    console.error(`[grantFarkleRewards] settlement FAILED matchId=${p.matchId} status=${res.status} error=${msg}`);
    throw new Error(msg);
  }

  console.log(
    `[grantFarkleRewards] settlement dispatched matchId=${p.matchId}` +
    ` txHash=${data?.txHash ?? "pending"} alreadySettled=${data?.alreadySettled ?? false}`,
  );
}
