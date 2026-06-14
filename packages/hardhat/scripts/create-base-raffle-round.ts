/**
 * create-base-raffle-round.ts
 * Creates an initial raffle round on the Base AkibaRaffle proxy.
 * Reward token = AkibaMiles (no USDC approval needed; raffle mints to winner).
 *
 * Run: npx hardhat run scripts/create-base-raffle-round.ts --network base
 */
import { ethers } from "hardhat";

const RAFFLE = "0xEBC6E0cDA027Ff54EeA45D6E66f54e473CC7964a";
const MILES  = "0xA13e9aC89da47B2c526dA265edF9A781C754dB75";

const RAFFLE_ABI = [
  "function createRaffleRound(uint256 _startTime, uint256 _duration, uint32 _maxTickets, address _token, uint256 _rewardPool, uint256 _ticketCostPoints) external",
  "function roundIdCounter() view returns (uint256)",
  "function getActiveRound(uint256 _roundId) view returns (uint256,uint256,uint256,uint32,uint32,address,uint256,uint256,bool)",
];

async function main() {
  const [signer] = await ethers.getSigners();
  console.log("Signer:", signer.address);

  const raffle = new ethers.Contract(RAFFLE, RAFFLE_ABI, signer);

  const now = Math.floor(Date.now() / 1000);
  const startTime     = now + 60;          // starts 1 min from now
  const duration      = 7 * 24 * 3600;    // 7 days
  const maxTickets    = 500;
  const token         = MILES;
  const rewardPool    = ethers.parseEther("5000"); // 5000 AkibaMiles prize
  const ticketCost    = ethers.parseEther("200");  // 200 AkibaMiles per ticket

  console.log(`Creating round: startTime=${startTime}, duration=${duration}s, maxTickets=${maxTickets}`);
  console.log(`  token=${token}, rewardPool=5000 Miles, ticketCost=200 Miles`);

  const tx = await raffle.createRaffleRound(startTime, duration, maxTickets, token, rewardPool, ticketCost);
  console.log("tx:", tx.hash);
  await tx.wait();
  console.log("✓ Round created");

  const counter = await raffle.roundIdCounter();
  console.log("roundIdCounter:", counter.toString());

  try {
    const round = await raffle.getActiveRound(counter);
    console.log("Round info:", {
      id: round[0].toString(),
      starts: new Date(Number(round[1]) * 1000).toISOString(),
      ends: new Date(Number(round[2]) * 1000).toISOString(),
      maxTickets: round[3].toString(),
      totalTickets: round[4].toString(),
      token: round[5],
    });
    console.log(`\nAdd to Supabase raffle_meta:`);
    console.log(JSON.stringify({
      round_id: Number(counter),
      kind: "token",
      card_title: "AkibaMiles Raffle",
      prize_title: "5000 AkibaMiles",
      description: "Join the first Base raffle and win 5000 AkibaMiles!",
      card_image_url: null,
      winners: 1,
    }, null, 2));
  } catch(e: any) {
    console.log("getActiveRound error (round not started yet):", e.message);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
