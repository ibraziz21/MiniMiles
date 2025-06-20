// scripts/encodeInit.ts
const  ethers =  require("ethers");
async function main() {
  const iface = new ethers.utils.Interface([
    "function initialize(address,address,address,address)",
  ]);
  const data = iface.encodeFunctionData("initialize", [
    '0xb0012Ff26b6eB4F75d09028233204635c0332050',
   "0x765de816845861e75a25fca122bb6898b8b1282a",
    '0x48065fbBE25f71C9282ddf5e1cD6D6A887483D5e',
    '0xa5065676D5d12b202dF10f479F2DDD62234b91b9'])
  console.log(data);
}
main();
