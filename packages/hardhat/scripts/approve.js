const  ethers =  require("ethers");
const raffleAbi = require("../artifacts/contracts/MiniRaffle.sol/MiniRaffle.json") 
const milesAbi = require("../artifacts/contracts/MiniPoints.sol/MiniPoints.json")
require("dotenv").config();
// ─── ENV & CONSTANTS ──────────────────────────────────────────────
const RPC_URL      = 'https://alfajores-forno.celo-testnet.org';      // e.g. "https://sepolia.optimism.io"
const PRIVATE_KEY  = process.env.PRIVATE_KEY;  // 
console.log(PRIVATE_KEY)
const RAFFLE_ADDR  = "0xA1F1Cd3b90f49c9d44ed324C69869df139616d55";
const cUSD   = "0x874069Fa1Eb16D44d622F2e0Ca25eeA172369bC1";
const cKES = '0x1E0433C1769271ECcF4CFF9FDdD515eefE6CdF92'
const MiniPoints = '0x9a51F81DAcEB772cC195fc8551e7f2fd7c62CD57'
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
const ckes   = new ethers.Contract(cKES, erc20Abi,        ownerSigner);
const miles   = new ethers.Contract(MiniPoints, milesAbi.abi,        ownerSigner);
// ─── MAIN LOGIC ───────────────────────────────────────────────────
async function main() {

  const allowRaffle = await miles.setMinter('0xa5065676D5d12b202dF10f479F2DDD62234b91b9', true);
  await allowRaffle.wait()
  console.log("Tx Hash: ", allowRaffle.hash)

 //npx hardhat verify 0x9a9808Df68255c0EB0771814C9Bf5d6c7784091b 84628191486477406120341082024507574697055389208972799154939633540122731552071 0x787d74caea10b2b357790d5b5247c2f63d1d91572a9846f780606e4d953677ae 0x779877A7B0D9E8603169DdbD7836e478b4624789 0xa29dAcE44cEE5Aa2B143981031DafdEc5c09dBA5 --network sepolia
  // const rewardPool = ethers.utils.parseUnits("100", 18);  // 100 USDC (6 dec)
  // const approveTx  = await usdc.approve(RAFFLE_ADDR, rewardPool);
  // await approveTx.wait();
  // console.log(`✅ Approved ${ethers.utils.formatUnits(rewardPool,18 )} USDC`);

// // //   // 2. compute startTime = now + 5 minutes
  const latest      = await provider.getBlock("latest");
  const startTime   = BigInt(latest.timestamp) + 1000n; // 300 s = 5 min

//   const vrfFee = ethers.utils.parseEther("0.01");
//   const reqTx  = await raffle.drawWinner(
//     2                          // _roundI          // payable fee
//   );
//   await reqTx.wait();
//   console.log("🎲 Randomness requested in tx:", reqTx.hash);


  // // // 3. create the round
  // const tx = await raffle.createRaffleRound(
  //   startTime,               // _startTime
  //   1200000,                 // _duration (1 week)
  //   1_0,                   // _maxTickets
  //   cUSD,               // _token
  //   ethers.utils.parseEther('1'),              // _rewardpool
  //   ethers.utils.parseUnits("5", 18), // _ticketCostPoints (50 MiniPoints)              // _beneficiary
  // );
  // await tx.wait();
  // console.log("🎉 Round created in tx:", tx.hash);


  //   await tx.wait();
  // console.log(ownerSigner.address, ": Round Joined in tx:", tx.hash);
  
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
