const  ethers =  require("ethers");
const raffleAbi = require("../artifacts/contracts/MiniRaffle.sol/MiniRaffle.json") 
const milesAbi = require("../artifacts/contracts/MiniPoints.sol/MiniPoints.json")
require("dotenv").config();
// ─── ENV & CONSTANTS ──────────────────────────────────────────────
const RPC_URL      = 'https://forno.celo.org';      // e.g. "https://sepolia.optimism.io"
const PRIVATE_KEY  = process.env.PRIVATE_KEY;  // 
console.log(PRIVATE_KEY)
const RAFFLE_ADDR  = "0xFCbb70095bCCe24Bc26cfb1ff88E2a2120ffe821";
const cUSD   = "0x765de816845861e75a25fca122bb6898b8b1282a";
const MiniPoints = '0xb0012Ff26b6eB4F75d09028233204635c0332050'
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

  // const allowRaffle = await miles.setMinter('0x46dE92B184776D1BebD7c95D8CC085009280E4f6', true);
  // await allowRaffle.wait()
  // console.log("Tx Hash: ", allowRaffle.hash)

 //npx hardhat verify 0x9a9808Df68255c0EB0771814C9Bf5d6c7784091b 84628191486477406120341082024507574697055389208972799154939633540122731552071 0x787d74caea10b2b357790d5b5247c2f63d1d91572a9846f780606e4d953677ae 0x779877A7B0D9E8603169DdbD7836e478b4624789 0xa29dAcE44cEE5Aa2B143981031DafdEc5c09dBA5 --network sepolia
  const rewardPool = ethers.utils.parseUnits("100", 18);  // 100 USDC (6 dec)
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
