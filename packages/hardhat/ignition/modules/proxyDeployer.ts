import { buildModule } from "@nomicfoundation/hardhat-ignition/modules";
import { ethers } from "ethers";

const MiniRaffleModule = buildModule("DiceV1", (m) => {
  /*************
   *  CONFIG   *
   *************/
  // <<< fill in real addresses before running >>>
 
  const minipoints   = "0xEeD878017f027FE96316007D0ca5fDA58Ee93a6b";
   const owner = '0xf769597e4a78a1CBEc3cFFC181389887f120D818'



  /*************
   * 1. Deploy implementation
   *************/
  const implementation = m.contract("AkibaDiceGame", [], { id: "akiba_impl" });

  /*************
   * 2. Encode initializer data
   *************/
  const iface = new ethers.utils.Interface([
    "function initialize(address,address)"
  ]);
  const initData = iface.encodeFunctionData("initialize", [
    minipoints, owner
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
