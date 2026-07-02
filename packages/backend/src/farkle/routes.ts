import { Router } from "express";
import { getFarkleResolverStatus } from "./settleOnChain";
import { reconcileFarkleSettlements, settleCompletedFarkleMatch } from "./service";

const router = Router();

function authorized(req: any) {
  const secrets = [process.env.FARKLE_SETTLEMENT_SECRET, process.env.ADMIN_QUEUE_SECRET, process.env.CRON_SECRET]
    .filter(Boolean);
  if (secrets.length === 0) return false;
  const auth = req.headers.authorization ?? "";
  return secrets.some((secret) => auth === `Bearer ${secret}`);
}

router.get("/health", async (_req, res) => {
  try {
    const [celo, base] = await Promise.all([
      getFarkleResolverStatus(42220),
      getFarkleResolverStatus(8453),
    ]);
    res.json({ ok: true, resolver: { celo, base } });
  } catch (e: any) {
    res.status(500).json({ ok: false, error: e?.message ?? "health check failed" });
  }
});

router.post("/settle", async (req, res) => {
  if (!authorized(req)) {
    res.status(401).json({ error: "unauthorized" });
    return;
  }

  const matchId = req.body?.matchId;
  if (!matchId || typeof matchId !== "string") {
    res.status(400).json({ error: "missing matchId" });
    return;
  }

  console.log(`[farkle/routes] settlement_submit matchId=${matchId}`);
  try {
    const result = await settleCompletedFarkleMatch(matchId);
    console.log(
      `[farkle/routes] settlement_confirm matchId=${matchId}` +
        ` alreadySettled=${result.alreadySettled} txHash=${result.txHash ?? "none"}`,
    );
    res.json({ ok: true, ...result });
  } catch (e: any) {
    console.error(`[farkle/routes] settlement_failure matchId=${matchId} error=${e?.message ?? e}`);
    res.status(500).json({ ok: false, error: e?.message ?? "settle failed" });
  }
});

async function reconcile(req: any, res: any) {
  if (!authorized(req)) {
    res.status(401).json({ error: "unauthorized" });
    return;
  }

  const sinceDays = req.query?.sinceDays ? Number(req.query.sinceDays) : undefined;
  const limit = req.query?.limit ? Number(req.query.limit) : undefined;

  try {
    const result = await reconcileFarkleSettlements({ sinceDays, limit });
    res.json({ ok: true, ...result });
  } catch (e: any) {
    console.error("[farkle/routes] reconcile failed:", e?.message ?? e);
    res.status(500).json({ ok: false, error: e?.message ?? "reconcile failed" });
  }
}

router.get("/reconcile", reconcile);
router.post("/reconcile", reconcile);

export default router;
