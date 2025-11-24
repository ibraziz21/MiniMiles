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

const AkibaDiceGame_Upgrade = buildModule("AkibaDiceGame_Upgrade2", (m) => {
  // 1) Deploy NEW implementation
  //
  // If your new implementation contract has a different name
  // (e.g. "AkibaDiceGameV2"), change the string below to that name.
  const newImpl = m.contract("AkibaDiceGame", [], {
    id: "akiba_dice_impl_v3",
  });

  // 2) Treat the EXISTING proxy as AkibaDiceGame
  //
  // We just need the ABI of the current version to call upgradeTo().
  const proxyAsDice = m.contractAt("AkibaDiceGame", DICE_PROXY_ADDR);

  // 3) Call upgradeTo(newImpl) via the proxy
  //
  // This will update the implementation slot of the UUPS proxy at DICE_PROXY_ADDR.
  m.call(proxyAsDice, "upgradeTo", [newImpl], {
    id: "akiba_dice_upgrade",
    after: [newImpl],
  });

  return { newImpl, proxyAsDice };
});

export default AkibaDiceGame_Upgrade;
