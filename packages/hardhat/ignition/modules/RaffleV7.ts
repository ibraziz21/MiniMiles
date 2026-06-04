import { buildModule } from "@nomicfoundation/hardhat-ignition/modules";

/**
 * Deploys the V7 implementation (Witnet-free, Celo native randomness).
 *
 * After deployment, call upgradeTo(v7Address) on the existing ERC1967 proxy
 * as the owner to activate it. The 2 stuck raffles can then be drawn immediately
 * via drawWinner(roundId) — no requestRoundRandomness call needed.
 */
const RaffleV7Module = buildModule("RaffleV7Module", (m) => {
  const raffleV7 = m.contract("AkibaRaffleV7", []);
  return { raffleV7 };
});

export default RaffleV7Module;
