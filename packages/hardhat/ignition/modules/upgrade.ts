import { buildModule } from "@nomicfoundation/hardhat-ignition/modules";

/**
 * Upgrades the existing UUPS proxy at PROXY_ADDR to a new AkibaRaffleV3 implementation.
 * Make sure the deployer account is the contract owner (authorized to upgrade).
 */
const PROXY_ADDR = "0x72fEFD4e943475c5cB7Cf11753fE60d04aEb7ff0";

const AkibaRaffleV3_Upgrade = buildModule("AkibaRaffleV3_Upgrade", (m) => {
  // 1) Deploy new implementation
  const newImpl = m.contract("AkibaRaffleV3", [], { id: "akiba_impl_vNext" });

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
