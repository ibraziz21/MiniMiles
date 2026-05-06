import { buildModule } from "@nomicfoundation/hardhat-ignition/modules";
import { ethers } from "ethers";

const INITIAL_OWNER = "0x7d63d39D88Eb0d8754111c706136f5Bd7Ae84403";
const ASSET = "0x48065fbBE25f71C9282ddf5e1cD6D6A887483D5e";
const ATOKEN = "0xDeE98402A302e4D707fB9bf2bac66fAEEc31e8Df";
const AAVE_POOL = "0x3E59A31363E2ad014dcbc521c4a0d5757d9f3402";
const SAFE = "0x0000000000000000000000000000000000000000";
const REFERRAL_CODE = 0;

const AkibaVaultModule = buildModule("AkibaVault", (m) => {
  const akToken = m.contract("akUSDT", [], {
    id: "akiba_vault_share_token",
  });

  const implementation = m.contract("AkibaMilesVaultUUPS", [], {
    id: "akiba_vault_impl",
  });

  const iface = new ethers.Interface([
    "function initialize(address,address,address,address,address,address,uint16)",
  ]);
  const initData = iface.encodeFunctionData("initialize", [
    INITIAL_OWNER,
    ASSET,
    ATOKEN,
    AAVE_POOL,
    akToken,
    SAFE,
    REFERRAL_CODE,
  ]);

  const proxy = m.contract("ERC1967Proxy", [implementation, initData], {
    id: "akiba_vault_proxy",
    after: [implementation, akToken],
  });

  m.call(akToken, "transferOwnership", [proxy], {
    id: "akiba_vault_share_token_transfer_ownership",
    after: [proxy],
  });

  return { akToken, implementation, proxy };
});

export default AkibaVaultModule;
