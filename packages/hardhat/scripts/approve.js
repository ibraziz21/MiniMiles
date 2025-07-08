const  ethers =  require("ethers");
const raffleAbi = require("../artifacts/contracts/MiniRaffle.sol/AkibaRaffle.json") 
const milesAbi = require("../artifacts/contracts/MiniPoints.sol/AkibaMiles.json")
require("dotenv").config();
// ─── ENV & CONSTANTS ──────────────────────────────────────────────
const RPC_URL      = 'https://forno.celo.org';      // e.g. "https://sepolia.optimism.io"
const PRIVATE_KEY  = process.env.PRIVATE_KEY;  // 
console.log(PRIVATE_KEY)
const RAFFLE_ADDR  = "0xD75dfa972C6136f1c594Fec1945302f885E1ab29";
const cUSD   = "0x765de816845861e75a25fca122bb6898b8b1282a";
const MiniPoints = '0xEeD878017f027FE96316007D0ca5fDA58Ee93a6b'
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

  const allowRaffle = await miles.setMinter('0xF20a5e1a4ca28D64f2C4A90998A41E8045288F48', true);
  await allowRaffle.wait()
  console.log("Tx Hash: ", allowRaffle.hash)

  const rewardPool = ethers.utils.parseUnits("10000", 18);  // 100 USDC (6 dec)
  const approveTx  = await miles.approve(RAFFLE_ADDR, rewardPool);
  await approveTx.wait();
  console.log(`✅ Approved ${ethers.utils.formatUnits(rewardPool,18 )} USDC`);

// //   // 2. compute startTime = now + 5 minutes
  const latest      = await provider.getBlock("latest");
  const startTime   = BigInt(latest.timestamp) + 300n; // 300 s = 5 min

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
  const tx = await raffle.createRaffleRound(
    startTime,               // _startTime
    2592000,                 // _duration (1 week)
    300,                   // _maxTickets
    MiniPoints,               // _token
    ethers.utils.parseEther('200'),              // _rewardpool
    ethers.utils.parseUnits("5", 18), // _ticketCostPoints (50 MiniPoints)              // _beneficiary
  );
  await tx.wait();
  console.log("🎉 Round created in tx:", tx.hash);

  

  //   await tx.wait();
  // console.log(ownerSigner.address, ": Round Joined in tx:", tx.hash);
  
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
