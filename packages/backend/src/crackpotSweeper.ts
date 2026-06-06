// src/crackpotSweeper.ts
// Runs every minute via node-cron.
// Responsibilities:
//   1. Expire active cycles past their timer (mark dead, seed next)
//   2. Seed a new cycle for any version that has no active cycle
//   3. Expire lingering active attempts in dead/cracked cycles
//
// This is the production backstop — the Next.js routes handle in-flow seeding,
// but this guarantees continuity if no player is on the page at cycle boundary.

import * as dotenv from "dotenv";
dotenv.config();

import cron from "node-cron";
import * as crypto from "crypto";
import * as https from "https";
import { supabase } from "./supabaseClient";

const VERSIONS = ["miles", "usdt"] as const;
type Version = (typeof VERSIONS)[number];

// ── Cycle timing ─────────────────────────────────────────────────────────────

function getExpiresAt(version: Version): Date {
  const now = new Date();
  if (version === "miles") {
    // Top of next UTC hour
    const next = new Date(now);
    next.setUTCMinutes(0, 0, 0);
    next.setUTCHours(next.getUTCHours() + 1);
    return next;
  }
  // USDT: 12-hour cycles at 00:00 / 12:00 EAT (UTC+3)
  const EAT = 3 * 3_600_000;
  const eatNow = new Date(now.getTime() + EAT);
  const eatHour = eatNow.getUTCHours();
  const next = eatHour < 12 ? 12 : 24;
  const mid = new Date(eatNow);
  mid.setUTCHours(0, 0, 0, 0);
  return new Date(mid.getTime() + next * 3_600_000 - EAT);
}

function getTheme(date: Date): string {
  const THEMES = [
    "bank-vault","dna-lab","launch-code","treasure-map","potion-brew",
    "signal-decode","cyber-lock","star-chart","spice-market","circuit-board",
  ];
  return THEMES[Math.floor(date.getTime() / 86_400_000) % THEMES.length];
}

function generateCode(entropy: string): [number,number,number,number] {
  const rng = crypto.randomBytes(32);
  const h = crypto.createHash("sha256").update(rng).update(entropy).digest();
  return [h[0]%6, h[1]%6, h[2]%6, h[3]%6];
}

function fetchUrl(url: string): Promise<string> {
  return new Promise((resolve) => {
    https.get(url, (res) => {
      let d = "";
      res.on("data", (c) => d += c);
      res.on("end", () => resolve(d.trim()));
    }).on("error", () => resolve(""));
  });
}

// ── Core sweep ────────────────────────────────────────────────────────────────

export async function runCrackPotSweep(): Promise<string[]> {
  const log: string[] = [];

  const entropy = await fetchUrl("https://blockchain.info/q/latesthash").catch(() => "") || `fallback-${Date.now()}`;

  for (const version of VERSIONS) {
    // 1. Expire overdue active cycles
    const { data: overdue } = await supabase
      .from("crackpot_cycles")
      .select("id")
      .eq("version", version)
      .eq("status", "active")
      .lt("expires_at", new Date().toISOString());

    for (const c of overdue ?? []) {
      const { error } = await supabase
        .from("crackpot_cycles")
        .update({ status: "dead" })
        .eq("id", c.id)
        .eq("status", "active");

      if (!error) {
        log.push(`expired ${version} cycle ${c.id}`);
        // Expire lingering attempts
        await supabase
          .from("crackpot_attempts")
          .update({ status: "expired" })
          .eq("cycle_id", c.id)
          .eq("status", "active");
      }
    }

    // 2. Also expire lingering attempts in cracked cycles
    const { data: crackedCycles } = await supabase
      .from("crackpot_cycles")
      .select("id")
      .eq("version", version)
      .eq("status", "cracked")
      .order("created_at", { ascending: false })
      .limit(5);

    for (const c of crackedCycles ?? []) {
      await supabase
        .from("crackpot_attempts")
        .update({ status: "expired" })
        .eq("cycle_id", c.id)
        .eq("status", "active");
    }

    // 3. Seed new cycle if none active
    const { data: active } = await supabase
      .from("crackpot_cycles")
      .select("id")
      .eq("version", version)
      .eq("status", "active")
      .maybeSingle();

    if (!active) {
      const now = new Date();
      const seed = version === "miles" ? 200 : 200;
      const cap  = version === "miles" ? 10000 : 5000;

      const { data: inserted, error } = await supabase
        .from("crackpot_cycles")
        .insert({
          version,
          theme: getTheme(now),
          secret_code: generateCode(entropy),
          entropy_source: entropy,
          status: "active",
          pot_balance: seed,
          pot_cap: cap,
          seed_amount: seed,
          expires_at: getExpiresAt(version).toISOString(),
        })
        .select("id")
        .single();

      if (!error && inserted) {
        log.push(`seeded new ${version} cycle ${inserted.id}`);
      } else if (error?.code === "23505") {
        log.push(`${version} cycle race — already seeded`);
      } else if (error) {
        log.push(`ERROR seeding ${version}: ${error.message}`);
      }
    }
  }

  return log;
}

// ── Scheduler ─────────────────────────────────────────────────────────────────

export function startCrackPotSweeper(): void {
  console.log("[CrackPotSweeper] starting — runs every minute");

  // Run immediately on startup
  runCrackPotSweep()
    .then((log) => { if (log.length) console.log("[CrackPotSweeper]", log.join(" | ")); })
    .catch((e) => console.error("[CrackPotSweeper] startup sweep error:", e));

  // Then every minute
  cron.schedule("* * * * *", () => {
    runCrackPotSweep()
      .then((log) => { if (log.length) console.log("[CrackPotSweeper]", log.join(" | ")); })
      .catch((e) => console.error("[CrackPotSweeper] sweep error:", e));
  });
}
