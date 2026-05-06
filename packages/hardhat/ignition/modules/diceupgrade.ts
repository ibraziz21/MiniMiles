// ignition/modules/AkibaDiceGame_Upgrade.ts
import { buildModule } from "@nomicfoundation/hardhat-ignition/modules";

/**
 * UUPS upgrade for AkibaDiceGame → V2
 *
 * IMPORTANT:
 * - DICE_PROXY_ADDR must be the address your frontend is using
 *   (i.e. the existing proxy on Celo mainnet).
 * - Make sure the deployer (PRIVATE_KEY in hardhat.config) is the contract owner.
 * - Set USDT_ADDRESS and TREASURY_ADDRESS before running.
 */
const DICE_PROXY_ADDR = "0xf77e7395Aa5c89BcC8d6e23F67a9c7914AB9702a" as const;

/** USDT on Celo mainnet – confirm before deploying */
const USDT_ADDRESS = "0x48065fbBE25f71C9282ddf5e1cD6D6A887483D5e" as const;

/** Treasury wallet that receives USD-tier house revenue */
const TREASURY_ADDRESS = "0x7622665217d7FA81Ca06E62C58596d5D38d327B3" as const;

const AkibaDiceGame_Upgrade = buildModule("AkibaDiceGame_UpgradeV2", (m) => {
  // 1) Deploy fresh V2 implementation
  const newImpl = m.contract("AkibaDiceGame", [], {
    id: "akiba_dice_impl_v2",
  });

  // 2) Attach to the existing proxy
  const proxyAsDice = m.contractAt("AkibaDiceGame", DICE_PROXY_ADDR, {
    id: "akiba_dice_proxy",
  });

  // 3) Upgrade implementation
  m.call(proxyAsDice, "upgradeTo", [newImpl], {
    id: "akiba_dice_upgrade_v2",
    after: [newImpl],
  });

  // 4) Call initializeV2 to set stablecoin and treasury
  const initV2 = m.call(proxyAsDice, "initializeV2", [USDT_ADDRESS, TREASURY_ADDRESS], {
    id: "akiba_dice_init_v2",
    after: ["akiba_dice_upgrade_v2"],
  });

  // 5) Configure USD tiers
  //    setupUsdTier(tierId, entryAmount (6dec), payoutAmount (6dec), milesAmount (18dec))
  m.call(proxyAsDice, "setupUsdTier", [
    250n, 250_000n, 1_000_000n, 100_000_000_000_000_000_000n  // $0.25 → $1 + 100 Miles
  ], { id: "setup_usd_tier_025", after: [initV2] });

  m.call(proxyAsDice, "setupUsdTier", [
    500n, 500_000n, 2_000_000n, 200_000_000_000_000_000_000n  // $0.50 → $2 + 200 Miles
  ], { id: "setup_usd_tier_050", after: [initV2] });

  m.call(proxyAsDice, "setupUsdTier", [
    1000n, 1_000_000n, 3_000_000n, 300_000_000_000_000_000_000n  // $1.00 → $3 + 300 Miles
  ], { id: "setup_usd_tier_100", after: [initV2] });

  // 6) Set optional USDT bonus for the 30 Miles tier ($0.10 = 100,000 in 6-decimal USDT)
  //    This registers the bonus amount. Separately, call depositBonusPool() to fund it.
  m.call(proxyAsDice, "setMilesTierBonus", [
    30n, 100_000n  // 30 Miles tier → +$0.10 USDT bonus (paid exclusively from bonusPool)
  ], { id: "set_miles_30_bonus", after: [initV2] });

  // NOTE: To fund the bonus pool, the owner must call:
  //   1. USDT.approve(DICE_PROXY_ADDR, amount)
  //   2. diceContract.depositBonusPool(amount)
  // Bonus funds are tracked separately from USD-round collateral and cannot cross-subsidise.

  return { newImpl, proxyAsDice };
});

export default AkibaDiceGame_Upgrade;
