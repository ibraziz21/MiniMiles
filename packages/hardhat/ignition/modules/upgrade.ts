import { buildModule } from "@nomicfoundation/hardhat-ignition/modules";

/**
 * Upgrades the existing UUPS proxy at PROXY_ADDR to a new AkibaRaffleV3 implementation.
 * Make sure the deployer account is the contract owner (authorized to upgrade).
 */
const PROXY_ADDR = "0xd75dfa972c6136f1c594fec1945302f885e1ab29";

const AkibaRaffleV5_Upgrade = buildModule("AkibaRaffleV5_Upgrade", (m) => {
  const newImpl = m.contract("AkibaRaffleV6", [], { id: "akiba_impl_v6" });
  const proxyAsAkiba = m.contractAt("AkibaRaffleV5", PROXY_ADDR);
  m.call(proxyAsAkiba, "upgradeTo", [newImpl], {
    id: "akiba_upgrade_call",
    after: [newImpl],
  });
  return { newImpl, proxyAsAkiba };
});
export default AkibaRaffleV5_Upgrade;
