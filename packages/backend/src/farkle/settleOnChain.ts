import {
  Contract,
  JsonRpcProvider,
  Wallet,
  id,
  parseUnits,
  toUtf8Bytes,
  keccak256,
} from "ethers";

const CELO_RPC = process.env.CELO_RPC_URL ?? "https://forno.celo.org";
const CELO_CHAIN_ID = 42220;

const SETTLEMENT_MANAGER_ADDRESS =
  process.env.GAME_SETTLEMENT_ADDRESS ??
  process.env.NEXT_PUBLIC_GAME_SETTLEMENT_ADDRESS ??
  "0xBeFB1A777E463C2325D6992dB77D9f6ddA88c2DC";

const GAME_CREDIT_VAULT_ADDRESS =
  process.env.GAME_CREDIT_VAULT_ADDRESS ??
  process.env.NEXT_PUBLIC_GAME_CREDIT_VAULT_ADDRESS ??
  "";

const RESOLVER_PK = (process.env.FARKLE_RESOLVER_PK ?? process.env.PRIVATE_KEY ?? "").trim();
const SUBMITTER_PK = (process.env.FARKLE_SUBMITTER_PK ?? process.env.PRIVATE_KEY ?? RESOLVER_PK).trim();

const provider = new JsonRpcProvider(CELO_RPC);
const GAME_ID_FARKLE = keccak256(toUtf8Bytes("FARKLE"));

const SETTLEMENT_MANAGER_ABI = [
  "function settleMatch((bytes32 matchId,bytes32 gameId,bytes32 modeId,address winner,address loser,uint256 winnerScore,uint256 loserScore,uint256 winnerMilesReward,uint256 loserMilesReward,uint256 winnerRewardCreditUsdt,bytes32 replayHash,bytes32 resultHash) input, bytes resolverSignature)",
  "function settledMatches(bytes32 matchId) view returns (bool)",
  "function authorizedResolvers(address resolver) view returns (bool)",
];

const GAME_CREDIT_VAULT_ABI = [
  "function rewardCreditBalance(address user) view returns (uint256)",
];

const EIP712_TYPES = {
  SettlementInput: [
    { name: "matchId", type: "bytes32" },
    { name: "gameId", type: "bytes32" },
    { name: "modeId", type: "bytes32" },
    { name: "winner", type: "address" },
    { name: "loser", type: "address" },
    { name: "winnerScore", type: "uint256" },
    { name: "loserScore", type: "uint256" },
    { name: "winnerMilesReward", type: "uint256" },
    { name: "loserMilesReward", type: "uint256" },
    { name: "winnerRewardCreditUsdt", type: "uint256" },
    { name: "replayHash", type: "bytes32" },
    { name: "resultHash", type: "bytes32" },
  ],
};

export type HexAddress = `0x${string}`;

export interface FarkleSettlementParams {
  matchId: string;
  modeKey: string;
  winnerAddress: HexAddress;
  loserAddress: HexAddress;
  winnerScore: number;
  loserScore: number;
  winMiles: number;
  losMiles: number;
  winCreditCents: number;
  replayHash?: string;
  resultHash?: string;
}

function asKey(pk: string) {
  return pk.startsWith("0x") ? pk : `0x${pk}`;
}

function toBytes32(value: string) {
  return /^0x[0-9a-fA-F]{64}$/.test(value) ? value : keccak256(toUtf8Bytes(value));
}

function buildSettlementInput(p: FarkleSettlementParams) {
  return {
    matchId: toBytes32(p.matchId),
    gameId: GAME_ID_FARKLE,
    modeId: keccak256(toUtf8Bytes(p.modeKey)),
    winner: p.winnerAddress,
    loser: p.loserAddress,
    winnerScore: BigInt(Math.max(0, Math.trunc(p.winnerScore))),
    loserScore: BigInt(Math.max(0, Math.trunc(p.loserScore))),
    winnerMilesReward: parseUnits(String(p.winMiles), 18),
    loserMilesReward: parseUnits(String(p.losMiles), 18),
    winnerRewardCreditUsdt: BigInt(Math.max(0, Math.round(p.winCreditCents * 10_000))),
    replayHash: p.replayHash ? toBytes32(p.replayHash) : toBytes32(`replay:${p.matchId}`),
    resultHash: p.resultHash
      ? toBytes32(p.resultHash)
      : toBytes32(`result:${p.matchId}:${p.winnerAddress}:${p.loserAddress}:${p.winnerScore}:${p.loserScore}`),
  };
}

function getSettlementManager(readonly = false) {
  const runner = readonly ? provider : new Wallet(asKey(SUBMITTER_PK), provider);
  return new Contract(SETTLEMENT_MANAGER_ADDRESS, SETTLEMENT_MANAGER_ABI, runner);
}

async function signSettlement(input: ReturnType<typeof buildSettlementInput>) {
  if (!RESOLVER_PK) throw new Error("FARKLE_RESOLVER_PK/PRIVATE_KEY not configured");
  const resolver = new Wallet(asKey(RESOLVER_PK), provider);
  return resolver.signTypedData(
    {
      name: "GameSettlementManager",
      version: "1",
      chainId: CELO_CHAIN_ID,
      verifyingContract: SETTLEMENT_MANAGER_ADDRESS,
    },
    EIP712_TYPES,
    input,
  );
}

export async function getFarkleResolverStatus() {
  if (!RESOLVER_PK) return { configured: false, address: null, authorized: false };
  const resolver = new Wallet(asKey(RESOLVER_PK), provider);
  const manager = getSettlementManager(true);
  const authorized = await manager.authorizedResolvers(resolver.address);
  return { configured: true, address: resolver.address, authorized: Boolean(authorized) };
}

export async function isFarkleMatchSettledOnChain(matchId: string): Promise<boolean> {
  const manager = getSettlementManager(true);
  return Boolean(await manager.settledMatches(toBytes32(matchId)));
}

export async function readFarkleRewardCreditCents(user: HexAddress): Promise<number> {
  if (!GAME_CREDIT_VAULT_ADDRESS) throw new Error("GAME_CREDIT_VAULT_ADDRESS not configured");
  const vault = new Contract(GAME_CREDIT_VAULT_ADDRESS, GAME_CREDIT_VAULT_ABI, provider);
  const baseUnits = BigInt(await vault.rewardCreditBalance(user));
  return Number(baseUnits / 10_000n);
}

export async function simulateFarkleSettlement(
  p: FarkleSettlementParams,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    if (!SUBMITTER_PK) return { ok: false, error: "FARKLE_SUBMITTER_PK/PRIVATE_KEY not configured" };
    const input = buildSettlementInput(p);
    const signature = await signSettlement(input);
    const manager = getSettlementManager(false);
    await manager.settleMatch.staticCall(input, signature);
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: e?.shortMessage ?? e?.reason ?? e?.message ?? String(e) };
  }
}

export async function settleFarkleOnChain(p: FarkleSettlementParams): Promise<string> {
  if (!SUBMITTER_PK) throw new Error("FARKLE_SUBMITTER_PK/PRIVATE_KEY not configured");

  const input = buildSettlementInput(p);
  const signature = await signSettlement(input);
  const manager = getSettlementManager(false);

  let lastError: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      if (attempt > 0) await new Promise((resolve) => setTimeout(resolve, 250 + Math.random() * 500));
      const tx = await manager.settleMatch(input, signature);
      try {
        await Promise.race([
          tx.wait(1),
          new Promise((_, reject) => setTimeout(() => reject(new Error("receipt wait timeout")), 45_000)),
        ]);
      } catch {
        console.warn(`[farkle/settle] receipt wait timed out for ${tx.hash}; checking settledMatches`);
      }

      const settled = await isFarkleMatchSettledOnChain(p.matchId);
      if (!settled) throw new Error(`settle tx ${tx.hash} not confirmed on-chain for match ${p.matchId}`);
      return tx.hash;
    } catch (e: any) {
      lastError = e;
      const msg = String(e?.shortMessage ?? e?.reason ?? e?.message ?? e).toLowerCase();
      const nonceRace =
        msg.includes("nonce") ||
        msg.includes("replacement transaction underpriced") ||
        msg.includes("already known");
      if (!nonceRace) throw e;
    }
  }

  throw lastError ?? new Error("settleMatch failed after retries");
}
