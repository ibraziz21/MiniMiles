// src/autoDailyCheckinScheduler.ts
//
// One-week auto daily check-in experiment. This only enqueues mint jobs; the
// existing mint worker performs the on-chain mints and writes daily_engagements
// after confirmation.

import * as dotenv from "dotenv";
dotenv.config();

import cron from "node-cron";
import { supabase } from "./supabaseClient";

type AutoDailyCheckinResult = {
  skipped: boolean;
  reason?: string;
  runDate: string;
  eligibleCount?: number;
  selectedCount?: number;
  queuedCount?: number;
};

type AutoDailyCheckinConfig = {
  enabled: boolean;
  startDate: string | null;
  days: number;
  cronExpression: string;
  walletLimit: number;
  recentDays: number;
  maxRecentEngagements: number;
  points: number;
  questId: string | null;
  experimentKey: string;
};

function envFlag(name: string): boolean {
  const value = process.env[name]?.trim().toLowerCase();
  return value === "1" || value === "true" || value === "yes";
}

function envInt(name: string, fallback: number): number {
  const value = Number(process.env[name]);
  return Number.isFinite(value) ? Math.trunc(value) : fallback;
}

function todayUTC(): string {
  return new Date().toISOString().slice(0, 10);
}

function isDateOnly(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function getConfig(): AutoDailyCheckinConfig {
  return {
    enabled: envFlag("AUTO_DAILY_CHECKIN_ENABLED"),
    startDate: process.env.AUTO_DAILY_CHECKIN_START_DATE?.trim() || null,
    days: Math.max(1, envInt("AUTO_DAILY_CHECKIN_DAYS", 7)),
    cronExpression: process.env.AUTO_DAILY_CHECKIN_CRON?.trim() || "15 1 * * *",
    walletLimit: Math.max(1, envInt("AUTO_DAILY_CHECKIN_LIMIT", 30_000)),
    recentDays: Math.max(0, envInt("AUTO_DAILY_CHECKIN_RECENT_DAYS", 30)),
    maxRecentEngagements: Math.max(0, envInt("AUTO_DAILY_CHECKIN_MAX_RECENT_ENGAGEMENTS", 0)),
    points: Math.max(1, envInt("AUTO_DAILY_CHECKIN_POINTS", 10)),
    questId: process.env.QUEST_ID_DAILY_CHECKIN?.trim() || null,
    experimentKey: process.env.AUTO_DAILY_CHECKIN_EXPERIMENT_KEY?.trim() || "auto-daily-checkin-v1",
  };
}

function validateWindow(config: AutoDailyCheckinConfig, runDate: string): string | null {
  if (!config.enabled) return "disabled";
  if (!config.questId) return "QUEST_ID_DAILY_CHECKIN missing";
  if (!config.startDate) return "AUTO_DAILY_CHECKIN_START_DATE missing";
  if (!isDateOnly(config.startDate)) return "AUTO_DAILY_CHECKIN_START_DATE must be YYYY-MM-DD";
  if (!isDateOnly(runDate)) return "runDate must be YYYY-MM-DD";

  const endDateExclusive = addDays(config.startDate, config.days);
  if (runDate < config.startDate) return `outside window: starts ${config.startDate}`;
  if (runDate >= endDateExclusive) {
    return `outside window: ended ${addDays(endDateExclusive, -1)}`;
  }

  return null;
}

export async function runAutoDailyCheckins(runDate = todayUTC()): Promise<AutoDailyCheckinResult> {
  const config = getConfig();
  const skipReason = validateWindow(config, runDate);

  if (skipReason) {
    console.log(`[autoDailyCheckin] skipped ${runDate}: ${skipReason}`);
    return { skipped: true, reason: skipReason, runDate };
  }

  const { data, error } = await supabase.rpc("enqueue_auto_daily_checkins", {
    p_run_date: runDate,
    p_quest_id: config.questId,
    p_points: config.points,
    p_wallet_limit: config.walletLimit,
    p_recent_days: config.recentDays,
    p_max_recent_engagements: config.maxRecentEngagements,
    p_experiment_key: config.experimentKey,
  });

  if (error) throw error;

  const row = Array.isArray(data) ? data[0] : data;
  const result: AutoDailyCheckinResult = {
    skipped: false,
    runDate,
    eligibleCount: Number(row?.eligible_count ?? 0),
    selectedCount: Number(row?.selected_count ?? 0),
    queuedCount: Number(row?.queued_count ?? 0),
  };

  console.log(
    `[autoDailyCheckin] ${runDate}: eligible=${result.eligibleCount} selected=${result.selectedCount} queued=${result.queuedCount}`
  );

  return result;
}

export function startAutoDailyCheckinScheduler(): void {
  const config = getConfig();
  if (!config.enabled) {
    console.log("[autoDailyCheckin] disabled");
    return;
  }

  const skipReason = validateWindow(config, todayUTC());
  if (skipReason && skipReason !== "outside window: starts " + config.startDate) {
    console.log(`[autoDailyCheckin] not registered: ${skipReason}`);
    return;
  }

  console.log(
    `[autoDailyCheckin] registered — cron="${config.cronExpression}" start=${config.startDate} days=${config.days} limit=${config.walletLimit}`
  );

  cron.schedule(config.cronExpression, () => {
    runAutoDailyCheckins().catch((err) =>
      console.error("[autoDailyCheckin] cron error", err?.message ?? err)
    );
  });
}

if (require.main === module) {
  runAutoDailyCheckins(process.argv[2] || todayUTC())
    .then((result) => {
      console.log(JSON.stringify(result, null, 2));
      process.exit(0);
    })
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
