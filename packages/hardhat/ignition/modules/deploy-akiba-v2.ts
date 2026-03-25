import { buildModule } from "@nomicfoundation/hardhat-ignition/modules";
import { ethers } from "ethers";

/**
 * Deploys AkibaMilesV2 behind a fresh ERC1967 UUPS proxy.
 *
 * Run:
 *   npx hardhat ignition deploy ignition/modules/deploy-akiba-v2.ts --network celo --deployment-id akiba-miles-v2
 *
 * After deploy:
 *   - Call setMinter(backendWallet, true)  via set-minters-v2.ts
 *   - Call setV1Token(v1Address)           via set-minters-v2.ts
 */

const INITIAL_OWNER = "0x7d63d39D88Eb0d8754111c706136f5Bd7Ae84403";

const AkibaMilesV2Module = buildModule("AkibaMilesV2", (m) => {
  // 1) Deploy implementation
  const implementation = m.contract("AkibaMilesV2", [], {
    id: "akiba_miles_v2_impl",
  });

  // 2) Encode initialize(address initialOwner)
  const iface = new ethers.Interface([
    "function initialize(address initialOwner)",
  ]);
  const initData = iface.encodeFunctionData("initialize", [INITIAL_OWNER]);

  // 3) Deploy ERC1967 proxy pointing at the implementation
  const proxy = m.contract("ERC1967Proxy", [implementation, initData], {
    id: "akiba_miles_v2_proxy",
    after: [implementation],
  });

  return { implementation, proxy };
});

export default AkibaMilesV2Module;
