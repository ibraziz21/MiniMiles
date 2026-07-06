import { Router } from "express";
import { getFarkleResolverStatus } from "./settleOnChain";
import {
  cancelFarkleQueueEntry,
  enterFarkleMatch,
  getActiveFarkleMatchForPlayer,
  getFarkleLeaderboard,
  getFarkleRecoverySnapshot,
  getFarkleQueue,
  reconcileFarkleSettlements,
  retryFarkleRecoveryTarget,
  runFarkleSettlementJobs,
  settleCompletedFarkleMatch,
} from "./service";
import type { FarkleSettlementJobStatus } from "./settlementJobs";

const router = Router();

function authorized(req: any) {
  const secrets = [process.env.FARKLE_SETTLEMENT_SECRET, process.env.ADMIN_QUEUE_SECRET, process.env.CRON_SECRET]
    .filter(Boolean);
  if (secrets.length === 0) return false;
  const auth = req.headers.authorization ?? "";
  return secrets.some((secret) => auth === `Bearer ${secret}`);
}

function isWalletAddress(value: unknown): value is string {
  return typeof value === "string" && /^0x[a-fA-F0-9]{40}$/.test(value);
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

router.get("/active", async (req, res) => {
  if (!authorized(req)) {
    res.status(401).json({ error: "unauthorized" });
    return;
  }

  const address = String(req.query.address ?? "").toLowerCase();
  if (!isWalletAddress(address)) {
    res.status(400).json({ error: "missing or invalid address" });
    return;
  }

  try {
    const active = await getActiveFarkleMatchForPlayer(address);
    res.json({ active });
  } catch (e: any) {
    console.error(`[farkle/routes] active failed address=${address}:`, e?.message ?? e);
    res.status(503).json({ error: "active match unavailable", retryable: true });
  }
});

router.post("/matches/find", async (req, res) => {
  if (!authorized(req)) {
    res.status(401).json({ error: "unauthorized" });
    return;
  }

  const address = String(req.body?.address ?? "").toLowerCase();
  const modeKey = req.body?.modeKey;
  const targetAddress =
    typeof req.body?.targetAddress === "string"
      ? req.body.targetAddress.toLowerCase()
      : null;
  const inviteCode =
    typeof req.body?.inviteCode === "string" ? req.body.inviteCode.trim() : null;
  const queueType = req.body?.queueType === "invite" ? "invite" : "public";

  if (!isWalletAddress(address)) {
    res.status(400).json({ error: "missing or invalid address" });
    return;
  }
  if (!modeKey || typeof modeKey !== "string") {
    res.status(400).json({ error: "missing modeKey" });
    return;
  }
  if (targetAddress && !isWalletAddress(targetAddress)) {
    res.status(400).json({ error: "invalid targetAddress" });
    return;
  }

  try {
    const result = await enterFarkleMatch({ address, modeKey, targetAddress, inviteCode, queueType });
    res.status(result.statusCode).json(result.body);
  } catch (e: any) {
    console.error(
      `[farkle/routes] matchmaking failed address=${address} modeKey=${modeKey}:`,
      e?.message ?? e,
    );
    res.status(503).json({ error: "matchmaking failed", retryable: true });
  }
});

router.get("/matches/queue", async (req, res) => {
  if (!authorized(req)) {
    res.status(401).json({ error: "unauthorized" });
    return;
  }

  const modeKey = req.query.modeKey;
  const address = req.query.address ? String(req.query.address).toLowerCase() : null;
  if (!modeKey || typeof modeKey !== "string") {
    res.status(400).json({ error: "missing modeKey" });
    return;
  }
  if (address && !isWalletAddress(address)) {
    res.status(400).json({ error: "invalid address" });
    return;
  }

  try {
    const result = await getFarkleQueue(modeKey, address);
    res.status(result.statusCode).json(result.body);
  } catch (e: any) {
    console.error(
      `[farkle/routes] queue failed address=${address ?? "none"} modeKey=${modeKey}:`,
      e?.message ?? e,
    );
    res.status(503).json({ error: "queue unavailable", retryable: true });
  }
});

router.delete("/matches/queue", async (req, res) => {
  if (!authorized(req)) {
    res.status(401).json({ error: "unauthorized" });
    return;
  }

  const modeKey = req.body?.modeKey ?? req.query.modeKey;
  const address = String(req.body?.address ?? req.query.address ?? "").toLowerCase();
  if (!modeKey || typeof modeKey !== "string" || !isWalletAddress(address)) {
    res.status(400).json({ error: "missing fields" });
    return;
  }

  try {
    await cancelFarkleQueueEntry(modeKey, address);
    res.json({ ok: true });
  } catch (e: any) {
    console.error(
      `[farkle/routes] queue cancel failed address=${address} modeKey=${modeKey}:`,
      e?.message ?? e,
    );
    res.status(503).json({ error: "failed to leave lobby", retryable: true });
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

router.get("/admin/recovery", async (req, res) => {
  if (!authorized(req)) {
    res.status(401).json({ error: "unauthorized" });
    return;
  }

  const rawStatuses = typeof req.query.status === "string" ? req.query.status : "";
  const statuses = rawStatuses
    ? rawStatuses.split(",").map((status) => status.trim()).filter(Boolean) as FarkleSettlementJobStatus[]
    : undefined;
  const limit = req.query?.limit ? Number(req.query.limit) : undefined;

  try {
    const snapshot = await getFarkleRecoverySnapshot({ statuses, limit });
    res.status(snapshot.tableMissing ? 503 : 200).json(snapshot);
  } catch (e: any) {
    console.error("[farkle/routes] recovery snapshot failed:", e?.message ?? e);
    res.status(500).json({ ok: false, error: e?.message ?? "recovery snapshot failed" });
  }
});

router.post("/admin/recovery/retry", async (req, res) => {
  if (!authorized(req)) {
    res.status(401).json({ error: "unauthorized" });
    return;
  }

  const jobId = typeof req.body?.jobId === "string" ? req.body.jobId : undefined;
  const matchId = typeof req.body?.matchId === "string" ? req.body.matchId : undefined;
  if (!jobId && !matchId) {
    res.status(400).json({ error: "jobId or matchId required" });
    return;
  }

  try {
    const result = await retryFarkleRecoveryTarget({ jobId, matchId });
    res.json({ ok: true, ...result });
  } catch (e: any) {
    console.error("[farkle/routes] recovery retry failed:", e?.message ?? e);
    res.status(500).json({ ok: false, error: e?.message ?? "recovery retry failed" });
  }
});

router.get("/leaderboard", async (req, res) => {
  if (!authorized(req)) {
    res.status(401).json({ error: "unauthorized" });
    return;
  }

  const modeKey = typeof req.query.modeKey === "string" ? req.query.modeKey : "";
  const limit = req.query.limit ? Math.max(1, Math.min(Number(req.query.limit), 100)) : 10;
  const rawAddress = typeof req.query.address === "string" ? req.query.address.toLowerCase() : null;
  const address = rawAddress && isWalletAddress(rawAddress) ? rawAddress : null;

  if (!modeKey) {
    res.status(400).json({ error: "missing modeKey" });
    return;
  }

  try {
    const result = await getFarkleLeaderboard({ modeKey, limit, address });
    res.status(result.statusCode).json(result.body);
  } catch (e: any) {
    console.error(`[farkle/routes] leaderboard failed modeKey=${modeKey}:`, e?.message ?? e);
    res.status(503).json({ error: "leaderboard unavailable", retryable: true });
  }
});

router.post("/admin/recovery/run", async (req, res) => {
  if (!authorized(req)) {
    res.status(401).json({ error: "unauthorized" });
    return;
  }

  const limit = req.body?.limit ? Number(req.body.limit) : undefined;
  try {
    const result = await runFarkleSettlementJobs(limit);
    res.json({ ok: true, ...result });
  } catch (e: any) {
    console.error("[farkle/routes] recovery run failed:", e?.message ?? e);
    res.status(500).json({ ok: false, error: e?.message ?? "recovery run failed" });
  }
});

export default router;
