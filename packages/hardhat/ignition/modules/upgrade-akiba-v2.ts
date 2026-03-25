import { buildModule } from "@nomicfoundation/hardhat-ignition/modules";

/**
 * Upgrades the AkibaMilesV2 proxy to a new implementation (adds blacklist).
 *
 * Run:
 *   npx hardhat ignition deploy ignition/modules/upgrade-akiba-v2.ts --network celo --deployment-id akiba-miles-v2-blacklist
 */

const AKIBA_V2_PROXY = "0xab93400000751fc17918940C202A66066885d628"; // ← paste the proxy address from the initial deploy

const AkibaMilesV2_Upgrade = buildModule("AkibaMilesV2_Upgrade", (m) => {
  // 1) Deploy fresh implementation with blacklist
  const newImpl = m.contract("AkibaMilesV2", [], {
    id: "akiba_miles_v2_impl_blacklist",
  });

  // 2) Attach to the existing proxy
  const proxy = m.contractAt("AkibaMilesV2", AKIBA_V2_PROXY, {
    id: "akiba_miles_v2_proxy",
  });

  // 3) Point proxy at new implementation
  m.call(proxy, "upgradeTo", [newImpl], {
    id: "akiba_miles_v2_upgrade_blacklist",
    after: [newImpl],
  });

  return { newImpl, proxy };
});

export default AkibaMilesV2_Upgrade;
