import { ethers, upgrades } from "hardhat";

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Deploying AkibaMilesV2 with:", deployer.address);

  const Factory = await ethers.getContractFactory("AkibaMilesV2");

  const proxy = await upgrades.deployProxy(Factory, [deployer.address], {
    initializer: "initialize",
    kind: "uups",
  });

  await proxy.waitForDeployment();

  const proxyAddress = await proxy.getAddress();
  console.log("AkibaMilesV2 proxy deployed to:", proxyAddress);
  console.log(
    "Set MINIPOINTS_V2_ADDRESS =",
    proxyAddress,
    "in your .env before running migrate.ts"
  );
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
