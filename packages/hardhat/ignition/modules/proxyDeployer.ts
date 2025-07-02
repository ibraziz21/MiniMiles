import { buildModule } from "@nomicfoundation/hardhat-ignition/modules";
import { ethers } from "ethers";

const MiniRaffleModule = buildModule("MiniRaffleFinal", (m) => {
  /*************
   *  CONFIG   *
   *************/
  // <<< fill in real addresses before running >>>
 
  const cUSD   = "0x765de816845861e75a25fca122bb6898b8b1282a";
   const usdt = '0x48065fbBE25f71C9282ddf5e1cD6D6A887483D5e'
  const miniPoints = '0xEeD878017f027FE96316007D0ca5fDA58Ee93a6b'
  const owner = '0xf20a5e1a4ca28d64f2c4a90998a41e8045288f48'


  /*************
   * 1. Deploy implementation
   *************/
  const implementation = m.contract("AkibaRaffle", [], { id: "akiba_impl" });

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
    { id: "akiba_proxy", after: [implementation] }
  );

  /*************
   * 4. Export addresses
   *************/
  return { implementation, proxy };
});

export default MiniRaffleModule;
