const  ethers =  require("ethers");
const raffleAbi = require("../artifacts/contracts/MiniRaffleV3.sol/AkibaRaffleV3.json") 
const milesAbi = require("../artifacts/contracts/MiniPoints.sol/AkibaMiles.json")
require("dotenv").config();
// ─── ENV & CONSTANTS ──────────────────────────────────────────────
const RPC_URL      = 'https://alfajores-forno.celo-testnet.org/';      // e.g. "https://sepolia.optimism.io"
const PRIVATE_KEY  = process.env.PRIVATE_KEY;  // 
console.log(PRIVATE_KEY)
const RAFFLE_ADDR  = "0x72fEFD4e943475c5cB7Cf11753fE60d04aEb7ff0";
const cUSD   = "0x874069fa1eb16d44d622f2e0ca25eea172369bc1";
const MiniPoints = '0xd59AE111d976342ff58c6dE2B6f2b002415825C1'
const prize="0x8F60907f41593d4B41f5e0cEa48415cd61854a79"
// test‑net USDC
const BENEFICIARY  = "";      // replace

// minimal ERC‑20 ABI (approve only)
const erc20Abi = [
  "function approve(address spender,uint256 amount) external returns (bool)"
];

// ─── SETUP ────────────────────────────────────────────────────────
const provider    = new ethers.providers.JsonRpcProvider(RPC_URL);
const ownerSigner = new ethers.Wallet(PRIVATE_KEY, provider);

const raffle = new ethers.Contract(RAFFLE_ADDR, raffleAbi.abi, ownerSigner);
const usdc   = new ethers.Contract(cUSD, erc20Abi,        ownerSigner);
const miles   = new ethers.Contract(MiniPoints, milesAbi.abi,        ownerSigner);
// ─── MAIN LOGIC ───────────────────────────────────────────────────
async function main() {

  // const allowRaffle = await miles.setMinter('0xF20a5e1a4ca28D64f2C4A90998A41E8045288F48', true);
  // await allowRaffle.wait()
  // console.log("Tx Hash: ", allowRaffle.hash)

//   const rewardPool = ethers.utils.parseUnits("10000", 18);  // 100 USDC (6 dec)
//   const approveTx  = await miles.approve(RAFFLE_ADDR, rewardPool);
//   await approveTx.wait();
//   console.log(`✅ Approved ${ethers.utils.formatUnits(rewardPool,18 )} USDC`);

// //   // 2. compute startTime = now + 5 minutes
  const latest      = await provider.getBlock("latest");
  const startTime   = BigInt(latest.timestamp) + 30n; // 300 s = 5 min

  // const vrfFee = ethers.utils.parseEther("0.01");
  
  // const reqTx  = await raffle.requestRoundRandomness(
  //   1 , {value: vrfFee}                       // _roundI          // payable fee
  // );
  // await reqTx.wait();
  // console.log("🎲 Randomness requested in tx:", reqTx.hash);


  //  const reqTx  = await raffle.drawWinner(
  //   1                      // _roundI          // payable fee
  // );
  // await reqTx.wait();
  // console.log("🎲 Randomness requested in tx:", reqTx.hash);


  // // 3. create the round
  // const tx = await raffle.createRaffleRound(
  //   startTime,               // _startTime
  //   2592000,                 // _duration (1 week)
  //   30,                   // _maxTickets
  //   prize,       
  //   3,        // _token
  //   0,              // _rewardpool
  //   ethers.utils.parseUnits("5", 18),
  //   "ipfs://bafybeidajb6cphtnmofomkdwfas3smvu63msti4pleb4uylpwgwdctn5qe"
  //   // _ticketCostPoints (50 MiniPoints)              // _beneficiary
  // );
  // await tx.wait();
  // console.log("🎉 Round created in tx:", tx.hash);

  const tx = await raffle.drawWinner(1)
    await tx.wait();
   console.log("🎉 Round created in tx:", tx.hash);


  

  //   await tx.wait();
  // console.log(ownerSigner.address, ": Round Joined in tx:", tx.hash);
  
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
