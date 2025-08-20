import { buildModule } from "@nomicfoundation/hardhat-ignition/modules";
import { ethers } from "ethers";

const MiniRaffleModule = buildModule("MilesVault", (m) => {
  /*************
   *  CONFIG   *
   *************/
  // <<< fill in real addresses before running >>>
 
  const aCelUSDT   = "0xDeE98402A302e4D707fB9bf2bac66fAEEc31e8Df";
   const usdt = '0x48065fbBE25f71C9282ddf5e1cD6D6A887483D5e'
  const vaultToken = '0x9eF834341C0aaE253206e838c37518d1E1927716'
  const pool = '0x3E59A31363E2ad014dcbc521c4a0d5757d9f3402'
  const safe = '0x9E621004591Fa0224182083D535ACBee90914e63'
  const referralCode = 0;


  /*************
   * 1. Deploy implementation
   *************/
  const implementation = m.contract("AkibaMilesVaultUUPS", [], { id: "akiba_impl" });

  /*************
   * 2. Encode initializer data
   *************/
  const iface = new ethers.utils.Interface([
    "function initialize(address,address,address,address, address, uint16)"
  ]);
  const initData = iface.encodeFunctionData("initialize", [
    usdt, aCelUSDT, pool,vaultToken,safe,referralCode
  ]);

  /*************
   * 3. Deploy ERC1967 proxy
   *************/
  const proxy = m.contract("ERC1967Proxy",  [ implementation, initData ],
    { id: "akiba_proxy", after: [implementation] }
  );

  /*************
   * 4. Export addresses
   *************/
  return { implementation, proxy };
});

export default MiniRaffleModule;
