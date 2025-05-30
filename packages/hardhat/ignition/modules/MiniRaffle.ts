import { buildModule } from "@nomicfoundation/hardhat-ignition/modules";

const RaffleModule = buildModule("MiniRafflesForNiko", (m) => {
  // Initial numbers array to deploy the contract with
  const initialNumbers = [1, 2, 3, 4, 5]; // <-- you can change these
  const cUSD   = "0x874069Fa1Eb16D44d622F2e0Ca25eeA172369bC1";
  // const cKES = '0x1E0433C1769271ECcF4CFF9FDdD515eefE6CdF92'
  const MiniPoints = '0x9a51F81DAcEB772cC195fc8551e7f2fd7c62CD57'
  const raffle = m.contract("MiniRaffle",[MiniPoints, cUSD])

  return { raffle };
});

export default RaffleModule;
