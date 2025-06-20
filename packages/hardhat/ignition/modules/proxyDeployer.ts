import { buildModule } from "@nomicfoundation/hardhat-ignition/modules";
import { ethers } from "ethers";

const MiniRaffleModule = buildModule("MiniRaffleModule", (m) => {
  /*************
   *  CONFIG   *
   *************/
  // <<< fill in real addresses before running >>>
 
  const cUSD   = "0x765de816845861e75a25fca122bb6898b8b1282a";
   const usdt = '0x48065fbBE25f71C9282ddf5e1cD6D6A887483D5e'
  const miniPoints = '0xb0012Ff26b6eB4F75d09028233204635c0332050'
  const owner = '0xa5065676D5d12b202dF10f479F2DDD62234b91b9'


  /*************
   * 1. Deploy implementation
   *************/
  const implementation = m.contract("MiniRaffle");

  /*************
   * 2. Encode initializer data
   *************/
  const iface = new ethers.utils.Interface([
    "function initialize(address,address,address,address)"
  ]);
  const initData = iface.encodeFunctionData("initialize", [
    miniPoints,
    cUSD,
    usdt,
    owner,
  ]);

  /*************
   * 3. Deploy ERC1967 proxy
   *************/
  const proxy = m.contract("ERC1967Proxy",  [ implementation, initData ],
  );

  /*************
   * 4. Export addresses
   *************/
  return { implementation, proxy };
});

export default MiniRaffleModule;
