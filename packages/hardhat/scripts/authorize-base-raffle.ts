/**
 * authorize-base-raffle.ts
 * Authorizes the new AkibaRaffle proxy as a burner on AkibaMilesV2.
 * Run: npx hardhat run scripts/authorize-base-raffle.ts --network base
 */
import { ethers } from "hardhat";

const MILES     = "0xA13e9aC89da47B2c526dA265edF9A781C754dB75"; // AkibaMilesV2
const RAFFLE    = "0xEBC6E0cDA027Ff54EeA45D6E66f54e473CC7964a"; // new AkibaRaffle proxy

const MILES_ABI = [
  "function setMinter(address who, bool enabled) external",
  "function minters(address) view returns (bool)",
  "function owner() view returns (address)",
];

async function main() {
  const [signer] = await ethers.getSigners();
  console.log("Signer:", signer.address);

  const miles = new ethers.Contract(MILES, MILES_ABI, signer);
  const owner = await miles.owner();
  console.log("AkibaMilesV2 owner:", owner);

  const alreadyAuthorized = await miles.minters(RAFFLE);
  if (alreadyAuthorized) {
    console.log("✓ Raffle already authorized as minter/burner");
    return;
  }

  console.log("Authorizing raffle as minter/burner...");
  const tx = await miles.setMinter(RAFFLE, true);
  console.log("tx:", tx.hash);
  await tx.wait();
  console.log("✓ Done");

  const confirmed = await miles.minters(RAFFLE);
  console.log("minters[raffle]:", confirmed);
}

main().catch((e) => { console.error(e); process.exit(1); });
