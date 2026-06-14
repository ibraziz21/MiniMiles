/**
 * init-base-raffle.ts
 *
 * One-shot script to initialize the Base MiniRaffle proxy.
 * The proxy was deployed but initialize() was never called.
 *
 * Run:
 *   npx hardhat run scripts/init-base-raffle.ts --network base
 */

import { ethers } from "hardhat";

const BASE_RAFFLE_PROXY  = "0x2a03b234b70d073aEbCaa87B94C2B08fDE4d88b6";
const BASE_MILES_TOKEN   = "0xA13e9aC89da47B2c526dA265edF9A781C754dB75"; // AkibaMilesV2 on Base
const BASE_USDC          = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913"; // USDC on Base
const OWNER              = "0xfF8E27c7Fdc48e868E35A1b3614FA6393d235106"; // deployer wallet

const RAFFLE_ABI = [
  "function initialize(address _miniPoints, address _cUSD, address _usdt, address _owner) external",
  "function roundIdCounter() view returns (uint256)",
  "function owner() view returns (address)",
];

async function main() {
  const [signer] = await ethers.getSigners();
  console.log("Signer:", signer.address);

  const raffle = new ethers.Contract(BASE_RAFFLE_PROXY, RAFFLE_ABI, signer);

  // Check if already initialized
  try {
    const counter = await raffle.roundIdCounter();
    console.log("Contract already initialized. roundIdCounter =", counter.toString());
    const owner = await raffle.owner();
    console.log("Owner:", owner);
    return;
  } catch {
    console.log("roundIdCounter() reverted — contract not initialized. Proceeding...");
  }

  // On Base we use USDC for both _cUSD and _usdt slots
  // (the contract accepts any ERC20; we point both to USDC)
  const tx = await raffle.initialize(
    BASE_MILES_TOKEN,
    BASE_USDC,   // _cUSD slot → USDC on Base
    BASE_USDC,   // _usdt slot → USDC on Base
    OWNER,
  );

  console.log("initialize() tx sent:", tx.hash);
  await tx.wait();
  console.log("✓ Initialized");

  const counter = await raffle.roundIdCounter();
  console.log("roundIdCounter:", counter.toString());
  const owner = await raffle.owner();
  console.log("owner:", owner);
}

main().catch((e) => { console.error(e); process.exit(1); });
