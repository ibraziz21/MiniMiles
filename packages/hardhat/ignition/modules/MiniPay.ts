import { buildModule } from "@nomicfoundation/hardhat-ignition/modules";

const RaffleModule = buildModule("Minipoints", (m) => {
  // Initial numbers array to deploy the contract with
  const initialNumbers = [1, 2, 3, 4, 5]; // <-- you can change these

  const raffle = m.contract("MiniPoints")

  return { raffle };
});

export default RaffleModule;
