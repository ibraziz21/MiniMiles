import { buildModule } from "@nomicfoundation/hardhat-ignition/modules";

const celoRaffle = buildModule("CrossChainRaffle", (m) => {
  // Initial numbers array to deploy the contract with
 const cKES = '0x1E0433C1769271ECcF4CFF9FDdD515eefE6CdF92'
 const cUSD = "0x874069Fa1Eb16D44d622F2e0Ca25eeA172369bC1" // <-- you can change these
const router = '0xb00E95b773528E2Ea724DB06B75113F239D15Dca'
const selector = 16015286601757825753n
const mpoints = '0xcEb2caAc90F5B71ecb9a5f3149586b76C9811a76'
  const raffle = m.contract("CrossChainRaffle",[router,selector,mpoints,cUSD,cKES])


  return { raffle };
});

export default celoRaffle;
