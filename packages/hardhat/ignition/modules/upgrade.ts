import { buildModule } from "@nomicfoundation/hardhat-ignition/modules";

/**
 * Deploys a fresh AkibaRaffleV6 implementation (with setMiniPoints) and
 * points the existing UUPS proxy at it.
 *
 * Run:
 *   npx hardhat ignition deploy ignition/modules/upgrade.ts --network celo
 */
const PROXY_ADDR = "0xd75dfa972c6136f1c594fec1945302f885e1ab29";

const AkibaRaffleV6_Upgrade = buildModule("AkibaRaffleV6_Upgrade", (m) => {
  // 1) Deploy fresh implementation with setMiniPoints()
  const newImpl = m.contract("AkibaRaffleV6", [], { id: "akiba_raffle_impl_v6_setmp" });

  // 2) Attach to the existing proxy using AkibaRaffleV6 ABI (has upgradeTo + setMiniPoints)
  const proxy = m.contractAt("AkibaRaffleV6", PROXY_ADDR, { id: "akiba_raffle_proxy" });

  // 3) Point proxy at new implementation
  m.call(proxy, "upgradeTo", [newImpl], {
    id: "akiba_raffle_upgrade_setmp",
    after: [newImpl],
  });

  return { newImpl, proxy };
});

export default AkibaRaffleV6_Upgrade;
