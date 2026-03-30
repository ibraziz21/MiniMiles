/**
 * gen-progress.ts
 *
 * Generates blacklist-progress.json from the first N batches of black-list.json.
 * Run this before re-running setBatchBlacklist.ts to avoid re-processing batches
 * that already succeeded on-chain.
 *
 * Usage:
 *   COMPLETED_BATCHES=77 npx ts-node src/gen-progress.ts
 */

import * as fs from "fs";
import * as path from "path";

const BATCH_SIZE = 500;
const COMPLETED_BATCHES = Number(process.env.COMPLETED_BATCHES ?? "77");

interface BotEntry {
  user_address: string;
  partner_count: number;
  profile_milestone_50_claimed: boolean;
  profile_milestone_100_claimed: boolean;
}

function shouldBlacklist(entry: BotEntry): boolean {
  if (
    entry.partner_count < 2 &&
    !entry.profile_milestone_50_claimed &&
    !entry.profile_milestone_100_claimed
  ) {
    return false;
  }
  return true;
}

const listPath = path.resolve(__dirname, "black-list.json");
const progressPath = path.resolve(__dirname, "blacklist-progress.json");

const raw: BotEntry[] = JSON.parse(fs.readFileSync(listPath, "utf-8"));
const toBlacklist = raw.filter(shouldBlacklist).map((e) => e.user_address.toLowerCase());

const completed = toBlacklist.slice(0, COMPLETED_BATCHES * BATCH_SIZE);

fs.writeFileSync(progressPath, JSON.stringify(completed, null, 0));

console.log(`Written ${completed.length} addresses to blacklist-progress.json`);
console.log(`setBatchBlacklist.ts will resume from batch ${COMPLETED_BATCHES + 1}`);
