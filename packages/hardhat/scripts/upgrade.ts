import { ethers } from "hardhat";

async function upgrade() {
  const proxyAddress = "0xD75dfa972C6136f1c594Fec1945302f885E1ab29";
  const newImplementation = "0x1A73B6603ae2944F8683624D052d951Bd608D80b"; // deployed via Ignition
  const [deployer] = await ethers.getSigners();

  console.log("Using existing AkibaRaffleV2 at:", newImplementation);

  const proxy = await ethers.getContractAt("AkibaRaffle", proxyAddress);

  const tx = await proxy.upgradeTo(newImplementation);
  await tx.wait();

  console.log("Proxy upgraded successfully to V2!");
}

upgrade().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
