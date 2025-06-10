import { buildModule } from "@nomicfoundation/hardhat-ignition/modules";

const RaffleModule = buildModule("MiniRafflesForNiko", (m) => {
  // Initial numbers array to deploy the contract with
  const initialNumbers = [1, 2, 3, 4, 5]; // <-- you can change these
  const cUSD   = "0x765de816845861e75a25fca122bb6898b8b1282a";
   const usdt = '0x48065fbBE25f71C9282ddf5e1cD6D6A887483D5e'
  const MiniPoints = '0xb0012Ff26b6eB4F75d09028233204635c0332050'
  const raffle = m.contract("MiniRaffle",[MiniPoints, cUSD, usdt])

  return { raffle };
});

export default RaffleModule;
