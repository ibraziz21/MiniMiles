// ignition/modules/AkibaDiceGame_Upgrade.ts
import { buildModule } from "@nomicfoundation/hardhat-ignition/modules";

/**
 * UUPS upgrade for AkibaDiceGame
 *
 * IMPORTANT:
 * - DICE_PROXY_ADDR must be the address your frontend is using
 *   (i.e. the existing proxy on Celo mainnet).
 * - Make sure the deployer (PRIVATE_KEY in hardhat.config) is the contract owner.
 */
const DICE_PROXY_ADDR = "0xf77e7395Aa5c89BcC8d6e23F67a9c7914AB9702a" as const;

const AkibaDiceGame_Upgrade = buildModule("AkibaDiceGame_Upgrade3", (m) => {
  // 1) Deploy fresh implementation with setMiniPoints()
  const newImpl = m.contract("AkibaDiceGame", [], {
    id: "akiba_dice_impl_v4_setmp",
  });

  // 2) Attach to the existing proxy
  const proxyAsDice = m.contractAt("AkibaDiceGame", DICE_PROXY_ADDR, {
    id: "akiba_dice_proxy",
  });

  // 3) Point proxy at new implementation
  m.call(proxyAsDice, "upgradeTo", [newImpl], {
    id: "akiba_dice_upgrade_setmp",
    after: [newImpl],
  });

  return { newImpl, proxyAsDice };
});

export default AkibaDiceGame_Upgrade;
