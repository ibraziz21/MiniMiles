// src/index.ts
import express from "express";
import * as dotenv from "dotenv";
import questRouter from "./questRoutes";
import gamesRouter from "./games/routes";
import farkleRouter from "./farkle/routes";
import { startMintWorker, runDrain, releaseCurrentLock } from "./mintWorker";
import { startBurnBlacklistWatcher } from "./burnBlacklistWatcher";
import { startProsperityPassWorker, releaseCurrentPassLock } from "./prosperityPassWorker";
import { startCrackPotSweeper, runCrackPotSweep } from "./crackpotSweeper";
import { startVaultEventWatcher } from "./vaultEventWatcher";
import { startVaultRewardScheduler } from "./vaultRewardScheduler";

dotenv.config();

const app = express();
app.use(express.json());

// Mount the quest routes at /claim
app.use("/claim", questRouter);
app.use("/games", gamesRouter);
app.use("/games/farkle", farkleRouter);

app.get("/", (_req, res) => {
  res.send("Welcome to the Minimiles Daily Quests Backend!");
});

// Manual one-shot CrackPot sweep (protected)
app.post("/crackpot/sweep", async (req, res) => {
  const secret = process.env.ADMIN_QUEUE_SECRET ?? "";
  const auth = req.headers.authorization;
  if (!secret || auth !== `Bearer ${secret}`) {
    res.status(401).json({ error: "unauthorized" });
    return;
  }
  try {
    const results = await runCrackPotSweep();
    res.json({ ok: true, results });
  } catch (err: any) {
    res.status(500).json({ error: err?.message ?? "sweep failed" });
  }
});

// Manual trigger (protected)
app.post("/drain", async (req, res) => {
  const secret = process.env.ADMIN_QUEUE_SECRET ?? "";
  const auth = req.headers.authorization;
  if (!secret || auth !== `Bearer ${secret}`) {
    res.status(401).json({ error: "unauthorized" });
    return;
  }
  runDrain().catch(console.error);
  res.json({ ok: true, message: "drain triggered" });
});

// BACKEND_ROLE=api    → only game/quest API routes, no background workers
// BACKEND_ROLE=worker → background workers only (no HTTP server is still started)
// BACKEND_ROLE=all    → default; API + all workers
// DISABLE_BACKGROUND_WORKERS=true → skip workers regardless of role
const role = (process.env.BACKEND_ROLE ?? "all").toLowerCase();
const workersEnabled =
  role !== "api" &&
  process.env.DISABLE_BACKGROUND_WORKERS !== "true";

const PORT = Number(process.env.PORT ?? 0);
const server = app.listen(PORT, () => {
  const address = server.address();
  const actualPort = typeof address === "object" && address ? address.port : PORT;
  console.log(`Server listening on port ${actualPort} (role=${role}, workers=${workersEnabled})`);
  if (workersEnabled) {
    startMintWorker();
    startBurnBlacklistWatcher();
    startProsperityPassWorker();
    startCrackPotSweeper();
    startVaultEventWatcher();
    startVaultRewardScheduler();
  }
});

// Release the mint queue lock before Railway (or any host) kills the process.
// Without this, the next deploy is blocked for up to LOCK_LEASE_SECONDS.
async function shutdown() {
  console.log("[server] Shutting down — releasing mint lock…");
  await releaseCurrentLock();
  await releaseCurrentPassLock();
  process.exit(0);
}

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
