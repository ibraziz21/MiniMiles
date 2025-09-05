import { buildModule } from "@nomicfoundation/hardhat-ignition/modules";
import { ethers } from "ethers";

const MiniRaffleModule = buildModule("AMilesV3", (m) => {
  /*************
   *  CONFIG   *
   *************/
  // <<< fill in real addresses before running >>>

 
  const minipoints   = "0xd59AE111d976342ff58c6dE2B6f2b002415825C1";
   const usdt = '0x48065fbBE25f71C9282ddf5e1cD6D6A887483D5e'
  const cUSD = '0x874069fa1eb16d44d622f2e0ca25eea172369bc1'
  const owner = '0x03909bb1E9799336d4a8c49B74343C2a85fDad9d'
  const prize = '0x8F60907f41593d4B41f5e0cEa48415cd61854a79'
  const referralCode = 0;


  /*************
   * 1. Deploy implementation
   *************/
  const implementation = m.contract("AkibaRaffleV3", [], { id: "akiba_impl" });

  /*************
   * 2. Encode initializer data
   *************/
  const iface = new ethers.utils.Interface([
    "function initialize(address,address,address,address,address)"
  ]);
  const initData = iface.encodeFunctionData("initialize", [
    minipoints, cUSD, usdt,prize,owner
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
