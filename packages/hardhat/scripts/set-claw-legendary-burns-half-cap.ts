/**
 * Configure AkibaClawGame so Legendary voucher burns pay 50% of the voucher cap.
 *
 * This updates existing deployed tier configs. New deployments already use this
 * default in AkibaClawGame._initDefaultTiers().
 *
 * Run from packages/hardhat:
 *   npm run claw:set-legendary-burns
 *
 * Env:
 *   NEXT_PUBLIC_CLAW_GAME_ADDRESS / CLAW_GAME_ADDRESS
 *   CLAW_TIERS=0,1,2 (optional)
 */

import { ethers } from "hardhat";
import { config as dotEnvConfig } from "dotenv";
import path from "path";
import clawAbi from "../../react-app/contexts/akibaClawGame.json";

dotEnvConfig();
dotEnvConfig({ path: path.resolve(__dirname, "../../react-app/.env") });

function parseTiers(): number[] {
  const raw = process.env.CLAW_TIERS ?? "0,1,2";
  return raw
    .split(",")
    .map((part) => Number(part.trim()))
    .filter((tier) => Number.isInteger(tier) && tier >= 0 && tier <= 255);
}

async function main() {
  const clawGame =
    process.env.CLAW_GAME_ADDRESS ??
    process.env.NEXT_PUBLIC_CLAW_GAME_ADDRESS ??
    "0x32cd4449A49786f8e9C68A5466d46E4dbC5197B3";

  const tiers = parseTiers();
  if (tiers.length === 0) throw new Error("No valid CLAW_TIERS provided");

  const [signer] = await ethers.getSigners();
  const claw = new ethers.Contract(clawGame, clawAbi.abi, signer);

  console.log("Signer:", signer.address);
  console.log("AkibaClawGame:", clawGame);

  for (const tierId of tiers) {
    const cfg = await claw.getTierConfig(tierId);
    const halfCap = cfg.legendaryVoucherCap / 2n;

    if (cfg.legendaryBurnUsdt === halfCap) {
      console.log(`Tier ${tierId}: already ${halfCap.toString()}`);
      continue;
    }

    const nextCfg = [
      cfg.active,
      cfg.tierId,
      cfg.payInMiles,
      cfg.playCost,
      cfg.loseWeight,
      cfg.commonWeight,
      cfg.rareWeight,
      cfg.epicWeight,
      cfg.legendaryWeight,
      cfg.commonMilesReward,
      cfg.rareBurnMiles,
      cfg.epicUsdtReward,
      halfCap,
      cfg.rareVoucherBps,
      cfg.legendaryVoucherBps,
      cfg.legendaryVoucherCap,
      cfg.dailyPlayLimit,
      cfg.legendaryCooldown,
      cfg.defaultMerchantId,
    ];

    const tx = await claw.setTierConfig(tierId, nextCfg);
    console.log(`Tier ${tierId}: set legendaryBurnUsdt=${halfCap.toString()} tx=${tx.hash}`);
    await tx.wait();
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
