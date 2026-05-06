import { ethers, upgrades } from "hardhat";
import { config as dotEnvConfig } from "dotenv";

dotEnvConfig();

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required env var ${name}`);
  }
  return value;
}

async function main() {
  const [deployer] = await ethers.getSigners();

  const initialOwner = required("VAULT_OWNER");
  const asset = required("VAULT_ASSET_ADDRESS");
  const aToken = required("VAULT_ATOKEN_ADDRESS");
  const aavePool = required("VAULT_AAVE_POOL_ADDRESS");
  const safe = required("VAULT_SAFE_ADDRESS");
  const referralCode = Number(process.env.VAULT_REFERRAL_CODE ?? "0");

  console.log("Deploying Akiba vault with:", deployer.address);
  console.log("Initial owner:", initialOwner);

  const akTokenFactory = await ethers.getContractFactory("akUSDT");
  const akToken = await akTokenFactory.deploy();
  await akToken.waitForDeployment();
  const akTokenAddress = await akToken.getAddress();

  const vaultFactory = await ethers.getContractFactory("contracts/AkibaMilesVaultUUPS.sol:AkibaMilesVaultUUPS");
  const vault = await upgrades.deployProxy(
    vaultFactory,
    [initialOwner, asset, aToken, aavePool, akTokenAddress, safe, referralCode],
    {
      initializer: "initialize",
      kind: "uups",
    }
  );
  await vault.waitForDeployment();
  const vaultAddress = await vault.getAddress();

  console.log("akUSDT deployed to:", akTokenAddress);
  console.log("Vault proxy deployed to:", vaultAddress);

  console.log("Transferring akUSDT ownership to vault proxy...");
  const transferTx = await akToken.transferOwnership(vaultAddress);
  await transferTx.wait();

  console.log("akUSDT owner:", await akToken.owner());
  console.log("");
  console.log("Post-deploy checklist:");
  console.log(`1. Safe must approve aToken spending for the vault proxy.`);
  console.log(`   spender=${vaultAddress}`);
  console.log(`   token=${aToken}`);
  console.log(`2. Set NEXT_PUBLIC_VAULT_ADDRESS=${vaultAddress}`);
  console.log(`3. Set NEXT_PUBLIC_VAULT_SHARE_TOKEN_ADDRESS=${akTokenAddress}`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
