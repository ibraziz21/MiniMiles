import { buildModule } from "@nomicfoundation/hardhat-ignition/modules";

/**
 * Upgrades the existing UUPS proxy at PROXY_ADDR to a new AkibaRaffleV3 implementation.
 * Make sure the deployer account is the contract owner (authorized to upgrade).
 */
const PROXY_ADDR = "0xd75dfa972c6136f1c594fec1945302f885e1ab29";

const AkibaRaffleV3_Upgrade = buildModule("AkibaRaffleV4_Upgrade", (m) => {
  // 1) Deploy new implementation
  const newImpl = m.contract("AkibaRaffleV4", [], { id: "akiba_impl_v4" });

  // 2) Treat the existing proxy as AkibaRaffleV3
  const proxyAsAkiba = m.contractAt("AkibaRaffleV3", PROXY_ADDR);

  // 3) Call upgradeTo(newImpl) via the proxy
  m.call(proxyAsAkiba, "upgradeTo", [newImpl], {
    id: "akiba_upgrade_call",
    after: [newImpl],
  });

  return { newImpl, proxyAsAkiba };
});

export default AkibaRaffleV3_Upgrade;
