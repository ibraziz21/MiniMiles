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

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Deploying CrackPot with:", deployer.address);

  const milesToken = required("MINIPOINTS_V2_ADDRESS");
  const usdtToken  = process.env.NEXT_PUBLIC_USDT_ADDRESS ?? required("USDT_ADDRESS");
  const relayer    = process.env.CRACKPOT_RELAYER_ADDRESS || deployer.address;
  const treasury   = required("CRACKPOT_TREASURY_ADDRESS");

  console.log("Miles token :", milesToken);
  console.log("USDT token  :", usdtToken);
  console.log("Relayer     :", relayer);
  console.log("Treasury    :", treasury);

  const Factory = await ethers.getContractFactory("CrackPot");

  // 1. Deploy implementation
  console.log("\nDeploying implementation...");
  const impl = await Factory.deploy();
  await impl.waitForDeployment();
  const implAddress = await impl.getAddress();
  console.log("Implementation:", implAddress);

  // 2. Encode initializer calldata
  const initData = Factory.interface.encodeFunctionData("initialize", [
    milesToken, usdtToken, relayer, treasury,
  ]);

  // 3. Deploy ERC1967Proxy using OZ artifact from node_modules
  console.log("Deploying ERC1967 proxy...");
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
  const proxy = await ProxyFactory.deploy(implAddress, initData);
  await proxy.waitForDeployment();
  const proxyAddress = await proxy.getAddress();

  // 4. Confirm slot
  const implSlotValue = await ethers.provider.getStorage(proxyAddress, IMPL_SLOT);
  const implFromSlot = "0x" + implSlotValue.slice(26);
  console.log("Proxy deployed :", proxyAddress);
  console.log("Impl from slot :", implFromSlot);

  // 5. Sanity-check by calling owner()
  const crackpot = Factory.attach(proxyAddress) as any;
  const owner = await crackpot.owner();
  console.log("Owner          :", owner);
  console.log("Relayer set    :", await crackpot.relayer());
  console.log("Treasury set   :", await crackpot.treasury());

  console.log("\n✅ CrackPot proxy    :", proxyAddress);
  console.log("   Implementation   :", implAddress);

  console.log("\n── Post-deploy checklist ──────────────────────────────────");
  console.log(`1. Set Miles minter:`);
  console.log(`     miles.setMinter("${proxyAddress}", true)`);
  console.log(`\n2. Fund USDT seed ($2.00) to proxy:`);
  console.log(`     Send 2_000_000 USDT units to ${proxyAddress}`);
  console.log(`\n3. Add to react-app .env:`);
  console.log(`     NEXT_PUBLIC_CRACKPOT_ADDRESS=${proxyAddress}`);
  console.log(`     NEXT_PUBLIC_CRACKPOT_RELAYER_ADDRESS=${relayer}`);
  console.log(`\n4. Verify implementation on Celoscan:`);
  console.log(`     npx hardhat verify --config hardhat.crackpot.config.ts --network celo ${implAddress}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
