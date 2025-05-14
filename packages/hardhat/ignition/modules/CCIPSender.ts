import { buildModule } from "@nomicfoundation/hardhat-ignition/modules";

const ETHSEP = buildModule("splitLogic", (m) => {
  // Initial numbers array to deploy the contract with
 const subID = 84628191486477406120341082024507574697055389208972799154939633540122731552071n
 const keyHash = "0x787d74caea10b2b357790d5b5247c2f63d1d91572a9846f780606e4d953677ae" // <-- you can change these
const link = '0x779877A7B0D9E8603169DdbD7836e478b4624789'
const raffleContract = '0xa29dAcE44cEE5Aa2B143981031DafdEc5c09dBA5'
  const raffle = m.contract("VRFSenderCCIP", [subID, keyHash,link,raffleContract])


  return { raffle };
});

export default ETHSEP;
