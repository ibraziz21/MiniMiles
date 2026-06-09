/**
 * authorize-farkle-resolver.ts
 *
 * Authorizes the backend relayer wallet as a settlement resolver on the
 * GameSettlementManager, so it can sign EIP-712 SettlementInputs and submit
 * settleMatch() to pay out Farkle rewards on-chain.
 *
 * The relayer (PRIVATE_KEY in the react-app .env, 0x7d63…4403) is the wallet
 * the backend already uses for everything. Authorizing it keeps settlement on a
 * single, well-funded backend key (the contract-owner deployer key stays out of
 * the web app).
 *
 * Must be run by the GameSettlementManager owner (the deployer, 0x42BB…9b7f) —
 * i.e. the default PRIVATE_KEY in this hardhat package's .env.
 *
 * Run:
 *   npx hardhat run scripts/authorize-farkle-resolver.ts \
 *     --config hardhat.farkle.config.ts --network celo
 */

import { ethers } from "hardhat";
import { config as dotEnvConfig } from "dotenv";

dotEnvConfig();

const SM_ABI = [
  "function setAuthorizedResolver(address resolver, bool authorized) external",
  "function authorizedResolvers(address) external view returns (bool)",
  "function owner() external view returns (address)",
];

function nextNonceFromError(err: unknown): number | undefined {
  const message =
    err instanceof Error
      ? `${err.message}\n${err.stack ?? ""}`
      : typeof err === "object" && err !== null && "message" in err
        ? String((err as { message?: unknown }).message)
        : String(err);
  const match = message.match(/next nonce\s+(\d+)/i);
  return match ? Number(match[1]) : undefined;
}

async function main() {
  const [signer] = await ethers.getSigners();

  const smAddr = process.env.GAME_SETTLEMENT_ADDRESS ??
    process.env.NEXT_PUBLIC_GAME_SETTLEMENT_ADDRESS ??
    "0xBeFB1A777E463C2325D6992dB77D9f6ddA88c2DC";
  // The backend relayer that will sign + submit settlements.
  const resolverAddr = process.env.FARKLE_RESOLVER_ADDRESS ??
    "0x7d63d39D88Eb0d8754111c706136f5Bd7Ae84403";

  const sm = new ethers.Contract(smAddr, SM_ABI, signer);

  const owner = await sm.owner();
  console.log("SettlementManager:", smAddr);
  console.log("Resolver to add:  ", resolverAddr);
  console.log("SM owner:         ", owner);
  console.log("Signer:           ", signer.address);

  if (owner.toLowerCase() !== signer.address.toLowerCase()) {
    throw new Error(`Signer is not the settlement-manager owner. Use ${owner}.`);
  }

  if (await sm.authorizedResolvers(resolverAddr)) {
    console.log("\nResolver is already authorized. Nothing to do.");
    return;
  }

  console.log("\nAuthorizing resolver…");
  let tx;
  let nonceOverride: number | undefined;
  for (let attempt = 1; attempt <= 5; attempt++) {
    const nonce = nonceOverride ?? (await ethers.provider.getTransactionCount(signer.address, "pending"));
    try {
      console.log(`  attempt ${attempt}: nonce ${nonce}`);
      tx = await sm.setAuthorizedResolver(resolverAddr, true, { nonce });
      break;
    } catch (err) {
      const nextNonce = nextNonceFromError(err);
      if (nextNonce === undefined || attempt === 5) throw err;
      console.log(`  nonce ${nonce} was stale; retrying with sequencer nonce ${nextNonce}`);
      nonceOverride = nextNonce;
    }
  }
  if (!tx) throw new Error("Failed to submit setAuthorizedResolver transaction.");

  console.log("  tx:", tx.hash);
  await tx.wait();

  console.log(`  authorizedResolvers(${resolverAddr}) = ${await sm.authorizedResolvers(resolverAddr)}`);
  console.log("\nDone. The backend relayer can now sign + submit settleMatch().");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
