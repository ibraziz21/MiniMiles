import { buildModule } from "@nomicfoundation/hardhat-ignition/modules";

const AkibaRaffleV2Module = buildModule("AkibaRaffleV2Module", (m) => {
  const raffleV2 = m.contract("AkibaRaffleV2", []);
  return { raffleV2 };
});

export default AkibaRaffleV2Module;
