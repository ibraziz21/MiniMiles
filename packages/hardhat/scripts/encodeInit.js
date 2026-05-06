// scripts/encodeInit.ts
const  ethers =  require("ethers");
async function main() {
  const iface = new ethers.utils.Interface([
    "function initialize(address,address,address,address,address,address,uint16)",
  ]);
  const data = iface.encodeFunctionData("initialize", [
    '0x7d63d39D88Eb0d8754111c706136f5Bd7Ae84403',
    '0x48065fbBE25f71C9282ddf5e1cD6D6A887483D5e',
    '0xDeE98402A302e4D707fB9bf2bac66fAEEc31e8Df',
    '0x3E59A31363E2ad014dcbc521c4a0d5757d9f3402',
    '0x0000000000000000000000000000000000000001',
    '0x0000000000000000000000000000000000000002',
    0
  ])
  console.log(data);
}
main();
