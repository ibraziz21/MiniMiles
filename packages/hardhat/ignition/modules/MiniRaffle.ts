import { buildModule } from "@nomicfoundation/hardhat-ignition/modules";

const RaffleModule = buildModule("Minipoints", (m) => {
  // Initial numbers array to deploy the contract with
  const minipoints ="0xcEb2caAc90F5B71ecb9a5f3149586b76C9811a76"
  const CUSD_ADDRESS="0x874069fa1eb16d44d622f2e0ca25eea172369bc1" // <-- you can change these
const cKES_address = '0x1E0433C1769271ECcF4CFF9FDdD515eefE6CdF92'
  const raffle = m.contract("MiniRaffle", [minipoints, CUSD_ADDRESS,cKES_address])

  return { raffle };
});

export default RaffleModule;
