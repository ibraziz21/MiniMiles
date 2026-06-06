// Deploy ERC1967 proxy pointing at the already-deployed CrackPot implementation.
import { ethers } from "hardhat";
import { config as dotEnvConfig } from "dotenv";
import * as fs from "fs";
import * as path from "path";

dotEnvConfig();

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env var: ${name}`);
  return v;
}

const IMPL_SLOT = "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc";
// Implementation deployed in previous step
const IMPL_ADDRESS = "0xE30dE8150614AE15Fb5875B6d2F440e0b631245B";

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Deployer       :", deployer.address);
  console.log("Implementation :", IMPL_ADDRESS);

  const milesToken = required("MINIPOINTS_V2_ADDRESS");
  const usdtToken  = process.env.NEXT_PUBLIC_USDT_ADDRESS ?? required("USDT_ADDRESS");
  const relayer    = process.env.CRACKPOT_RELAYER_ADDRESS || deployer.address;
  const treasury   = required("CRACKPOT_TREASURY_ADDRESS");

  console.log("Miles token :", milesToken);
  console.log("USDT token  :", usdtToken);
  console.log("Relayer     :", relayer);
  console.log("Treasury    :", treasury);

  const Factory = await ethers.getContractFactory("CrackPot");
  const initData = Factory.interface.encodeFunctionData("initialize", [
    milesToken, usdtToken, relayer, treasury,
  ]);

  // Load ERC1967Proxy artifact from OZ v4
  const proxyArtifactPath = path.resolve(
    __dirname,
    "../node_modules/.pnpm/@openzeppelin+contracts@4.8.3/node_modules/@openzeppelin/contracts/build/contracts/ERC1967Proxy.json",
  );
  const proxyArtifact = JSON.parse(fs.readFileSync(proxyArtifactPath, "utf8"));
  const ProxyFactory = new ethers.ContractFactory(
    proxyArtifact.abi,
    proxyArtifact.bytecode,
    deployer,
  );

  console.log("\nDeploying proxy...");
  const proxy = await ProxyFactory.deploy(IMPL_ADDRESS, initData);
  await proxy.waitForDeployment();
  const proxyAddress = await proxy.getAddress();

  // Confirm ERC1967 slot
  const slotVal = await ethers.provider.getStorage(proxyAddress, IMPL_SLOT);
  console.log("Proxy address  :", proxyAddress);
  console.log("Impl from slot :", "0x" + slotVal.slice(26));

  // Sanity check
  const crackpot = Factory.attach(proxyAddress) as any;
  console.log("Owner          :", await crackpot.owner());
  console.log("Relayer        :", await crackpot.relayer());
  console.log("Treasury       :", await crackpot.treasury());

  console.log("\n✅ CrackPot proxy    :", proxyAddress);
  console.log("   Implementation   :", IMPL_ADDRESS);

  console.log("\n── Post-deploy checklist ──────────────────────────────────");
  console.log(`1. Set Miles minter:`);
  console.log(`     miles.setMinter("${proxyAddress}", true)`);
  console.log(`\n2. Fund USDT seed ($2.00) to proxy:`);
  console.log(`     Send 2_000_000 USDT units to ${proxyAddress}`);
  console.log(`\n3. Add to react-app .env:`);
  console.log(`     NEXT_PUBLIC_CRACKPOT_ADDRESS=${proxyAddress}`);
  console.log(`     NEXT_PUBLIC_CRACKPOT_RELAYER_ADDRESS=${relayer}`);
  console.log(`\n4. Verify implementation on Celoscan:`);
  console.log(`     npx hardhat verify --config hardhat.crackpot.config.ts --network celo ${IMPL_ADDRESS}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
