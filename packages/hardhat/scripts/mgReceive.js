const  ethers =  require("ethers");
const router = require('../artifacts/@chainlink/contracts-ccip/src/v0.8/ccip/interfaces/IRouterClient.sol/IRouterClient.json')

const SRC_ROUTER  = "0x0BF3dE8c5D3e8A2B34D2BEeB17ABfCeBaf363A59"; // OP Sepolia
const DST_ROUTER  = "0xb00E0b3a25d3b677c0bF1f9243aeF99bC65D5Dca"; // Alfajores
const MSG_ID      = "0x000000000000000000000000000000000000000000000000DE41BA4FC9D91AD9";
const Alf_RPC_URL      = 'https://alfajores-forno.celo-testnet.org';  
const Sep_RPC_URL = 'https://eth-sepolia.g.alchemy.com/v2/XucMy0SW663XxpBZLQtKH2kvbvydqysK'
const PRIVATE_KEY  = "";  // owner’s key





async function main(){

const op  = new ethers.providers.JsonRpcProvider(Sep_RPC_URL);
const cel = new ethers.providers.JsonRpcProvider(Alf_RPC_URL);
const ownerSigner = new ethers.Wallet(PRIVATE_KEY, op);
const ownerSigner1 = new ethers.Wallet(PRIVATE_KEY, cel);

const srcRouter = new ethers.Contract(router.abi, SRC_ROUTER, ownerSigner);
const dstRouter = new ethers.Contract(router.abi, DST_ROUTER, ownerSigner1);

const info = await srcRouter.getMessage(MSG_ID);
console.log("source status:", info.status);   // 0=NA,1=Sent,2=Executed,3=Failed

if (info.status === 3) {
  console.log("revert:", ethers.toUtf8String(info.error));
}
}

main().catch(err => {
    console.error(err);
    process.exit(1);
  });
