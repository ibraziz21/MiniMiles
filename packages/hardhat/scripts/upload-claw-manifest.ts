/**
 * Upload an existing claw batch manifest JSON file to Supabase.
 *
 * Run from packages/hardhat:
 *   CLAW_BATCH_ID=202604160001 \
 *   CLAW_BATCH_MANIFEST_FILE=/abs/path/claw-batch-202604160001.manifest.json \
 *   npx hardhat run --no-compile scripts/upload-claw-manifest.ts --network celo
 */

import fs from "fs";
import path from "path";
import { createClient } from "@supabase/supabase-js";
import { config as dotEnvConfig } from "dotenv";

dotEnvConfig();
dotEnvConfig({ path: path.resolve(__dirname, "../../react-app/.env") });

async function main() {
  const batchId = process.env.CLAW_BATCH_ID;
  const manifestFile = process.env.CLAW_BATCH_MANIFEST_FILE;
  const url = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_KEY;

  if (!batchId) throw new Error("Set CLAW_BATCH_ID");
  if (!manifestFile) throw new Error("Set CLAW_BATCH_MANIFEST_FILE");
  if (!url || !serviceKey) throw new Error("Set SUPABASE_URL and SUPABASE_SERVICE_KEY");

  const filePath = path.isAbsolute(manifestFile)
    ? manifestFile
    : path.resolve(process.cwd(), manifestFile);
  const raw = JSON.parse(fs.readFileSync(filePath, "utf8"));
  const manifest = raw[batchId] ?? raw;

  if (!manifest?.plays?.length) {
    throw new Error(`Manifest file does not contain plays for batch ${batchId}`);
  }

  const counts = manifest.plays.reduce(
    (acc: Record<string, number>, play: { rewardClass: number }) => {
      const key =
        play.rewardClass === 1 ? "loses" :
        play.rewardClass === 2 ? "commons" :
        play.rewardClass === 3 ? "rares" :
        play.rewardClass === 4 ? "epics" :
        play.rewardClass === 5 ? "legendarys" :
        "invalid";
      acc[key] = (acc[key] ?? 0) + 1;
      return acc;
    },
    { loses: 0, commons: 0, rares: 0, epics: 0, legendarys: 0 }
  );

  if (counts.invalid) throw new Error("Manifest contains an invalid rewardClass");

  const supabase = createClient(url, serviceKey);
  const { error } = await supabase.from("claw_batch_manifests").upsert({
    batch_id: batchId,
    merkle_root: process.env.CLAW_BATCH_MERKLE_ROOT ?? "0x0000000000000000000000000000000000000000000000000000000000000000",
    total_plays: manifest.plays.length,
    counts,
    manifest,
  }, { onConflict: "batch_id" });

  if (error) throw new Error(`Failed to upload manifest: ${error.message}`);

  console.log(`Uploaded claw manifest for batch ${batchId}`);
  console.log(`plays=${manifest.plays.length}`);
  console.log(counts);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
