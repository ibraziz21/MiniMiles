import { ethers } from "hardhat";

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Deploying DailyQuestClaimer with account:", deployer.address);

  const MILES_TOKEN = process.env.MINIPOINTS_V2_ADDRESS ?? "0xab93400000751fc17918940C202A66066885d628";
  // The signer is the backend key that issues vouchers — store it separately from the deployer.
  const VOUCHER_SIGNER = process.env.QUEST_VOUCHER_SIGNER ?? deployer.address;

  const Factory = await ethers.getContractFactory("DailyQuestClaimer");
  const contract = await Factory.deploy(MILES_TOKEN, VOUCHER_SIGNER);
  await contract.waitForDeployment();

  const address = await contract.getAddress();
  console.log("DailyQuestClaimer deployed to:", address);
  console.log("  milesToken:", MILES_TOKEN);
  console.log("  signer:", VOUCHER_SIGNER);
  console.log("\nNext steps:");
  console.log("  1. Register the contract as a minter on AkibaMilesV2:");
  console.log(`     await milesToken.setMinter("${address}", true)`);
  console.log("  2. Add to .env:");
  console.log(`     NEXT_PUBLIC_DAILY_QUEST_CLAIMER_ADDRESS="${address}"`);
}

main().catch((e) => { console.error(e); process.exit(1); });
