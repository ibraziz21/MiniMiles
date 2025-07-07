// scripts/encodeInit.ts
const  ethers =  require("ethers");
async function main() {
  const iface = new ethers.utils.Interface([
    "function initialize(address,address,address,address)",
  ]);
  const data = iface.encodeFunctionData("initialize", [
    '0xEeD878017f027FE96316007D0ca5fDA58Ee93a6b',
   "0x765de816845861e75a25fca122bb6898b8b1282a",
    '0x48065fbBE25f71C9282ddf5e1cD6D6A887483D5e',
    '0xf20a5e1a4ca28d64f2c4a90998a41e8045288f48'])
  console.log(data);
}
main();
