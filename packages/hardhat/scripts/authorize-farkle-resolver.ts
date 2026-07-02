/**
 * Authorizes a resolver address on the GameSettlementManager (Celo).
 * Run with: OWNER_PK=<owner private key> pnpm ts-node scripts/authorize-farkle-resolver.ts
 */
import { JsonRpcProvider, Wallet, Contract } from "ethers";

const GAME_SETTLEMENT_MANAGER = "0xBeFB1A777E463C2325D6992dB77D9f6ddA88c2DC";
const RESOLVER_TO_AUTHORIZE   = "0xb074BE840c443523Aa1ec62F75C58c6EBaFba6e1";

const ABI = [
  "function owner() view returns (address)",
  "function setAuthorizedResolver(address resolver, bool authorized)",
  "function authorizedResolvers(address resolver) view returns (bool)",
];

async function main() {
  const ownerPk = process.env.OWNER_PK;
  if (!ownerPk) throw new Error("OWNER_PK env var not set");

  const provider = new JsonRpcProvider(
    process.env.CELO_RPC_URL ?? "https://forno.celo.org"
  );
  const owner  = new Wallet(ownerPk.startsWith("0x") ? ownerPk : `0x${ownerPk}`, provider);
  const contract = new Contract(GAME_SETTLEMENT_MANAGER, ABI, owner);

  const contractOwner = await contract.owner();
  console.log("Contract owner:  ", contractOwner);
  console.log("Signing wallet:  ", owner.address);

  if (contractOwner.toLowerCase() !== owner.address.toLowerCase()) {
    throw new Error(`Wallet ${owner.address} is not the contract owner (${contractOwner})`);
  }

  const alreadyAuth = await contract.authorizedResolvers(RESOLVER_TO_AUTHORIZE);
  if (alreadyAuth) {
    console.log(`${RESOLVER_TO_AUTHORIZE} is already authorized — nothing to do.`);
    return;
  }

  console.log(`Authorizing ${RESOLVER_TO_AUTHORIZE}...`);
  const tx = await contract.setAuthorizedResolver(RESOLVER_TO_AUTHORIZE, true);
  console.log("tx sent:", tx.hash);
  await tx.wait(1);
  console.log("confirmed ✓");

  const auth = await contract.authorizedResolvers(RESOLVER_TO_AUTHORIZE);
  console.log("authorizedResolvers check:", auth);
}

main().catch((e) => { console.error(e); process.exit(1); });
