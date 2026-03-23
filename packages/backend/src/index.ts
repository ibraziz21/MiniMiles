// src/index.ts
import express from "express";
import * as dotenv from "dotenv";
import questRouter from "./questRoutes";
import { startMintWorker, runDrain } from "./mintWorker";

dotenv.config();

const app = express();
app.use(express.json());

// Mount the quest routes at /claim
app.use("/claim", questRouter);

app.get("/", (req, res) => {
  res.send("Welcome to the Minimiles Daily Quests Backend!");
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

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
  startMintWorker();
});
