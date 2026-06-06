import { ethers } from "hardhat";
import { config as dotEnvConfig } from "dotenv";

dotEnvConfig();

const PROXY = "0x32E2eBD9B502563a3B8FA59207F0542709456906";
const IMPL_SLOT = "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc";

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Upgrading CrackPot with:", deployer.address);

  // Deploy new implementation
  const Factory = await ethers.getContractFactory("CrackPot");
  const newImpl = await Factory.deploy();
  await newImpl.waitForDeployment();
  const newImplAddress = await newImpl.getAddress();
  console.log("New implementation:", newImplAddress);

  // Call upgradeTo on the proxy (owner-only UUPS)
  const proxy = new ethers.Contract(
    PROXY,
    ["function upgradeTo(address newImplementation) external"],
    deployer,
  );
  const nonce = await ethers.provider.getTransactionCount(deployer.address, "latest");
  const tx = await proxy.upgradeTo(newImplAddress, { nonce });
  console.log("upgradeTo tx:", tx.hash);
  await tx.wait();

  // Verify slot
  const slotVal = await ethers.provider.getStorage(PROXY, IMPL_SLOT);
  console.log("Impl from slot:", "0x" + slotVal.slice(26));
  console.log("Expected      :", newImplAddress.toLowerCase());

  // Sanity check enterGame is available
  const upgraded = Factory.attach(PROXY) as any;
  console.log("milesEntryFee :", (await upgraded.milesEntryFee()).toString());

  console.log("\n✅ Upgrade complete");
  console.log("   Proxy     :", PROXY);
  console.log("   New impl  :", newImplAddress);
  console.log("\nVerify:");
  console.log(`  npx hardhat verify --config hardhat.crackpot.config.ts --network celo ${newImplAddress}`);
}

main().catch((e) => { console.error(e.message ?? e); process.exit(1); });
