import { buildModule } from "@nomicfoundation/hardhat-ignition/modules";

const RaffleModule = buildModule("MiniRaffle2", (m) => {
  // Initial numbers array to deploy the contract with
  const initialNumbers = [1, 2, 3, 4, 5]; // <-- you can change these
  const cUSD   = "0x874069Fa1Eb16D44d622F2e0Ca25eeA172369bC1";
  const cKES = '0x1E0433C1769271ECcF4CFF9FDdD515eefE6CdF92'
  const MiniPoints = '0xcEb2caAc90F5B71ecb9a5f3149586b76C9811a76'
  const raffle = m.contract("MiniRaffle",[MiniPoints, cUSD, cKES])

  return { raffle };
});

export default RaffleModule;
