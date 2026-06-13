import {
  Contract,
  JsonRpcProvider,
  Wallet,
  id,
  parseUnits,
  toUtf8Bytes,
  keccak256,
} from "ethers";

const CELO_CHAIN_ID = 42220;
const BASE_CHAIN_ID = 8453;

const RESOLVER_PK = (process.env.FARKLE_RESOLVER_PK ?? process.env.PRIVATE_KEY ?? "").trim();
const SUBMITTER_PK = (process.env.FARKLE_SUBMITTER_PK ?? process.env.PRIVATE_KEY ?? RESOLVER_PK).trim();

const GAME_ID_FARKLE = keccak256(toUtf8Bytes("FARKLE"));

// ── Per-chain config ──────────────────────────────────────────────────────────

interface ChainParams {
  chainId: number;
  rpc: string;
  smAddress: string;
  creditVaultAddress: string;
  creditFieldName: "winnerRewardCreditUsdt" | "winnerRewardCredit";
}

function getChainParams(chainId: number = CELO_CHAIN_ID): ChainParams {
  if (chainId === BASE_CHAIN_ID) {
    return {
      chainId: BASE_CHAIN_ID,
      rpc: process.env.BASE_RPC_URL ?? "https://mainnet.base.org",
      smAddress:
        process.env.BASE_GAME_SETTLEMENT_ADDRESS ??
        "0x24814CcD77ABfDa092F30e2789331701BC0b1cc9",
      creditVaultAddress:
        process.env.BASE_GAME_CREDIT_VAULT_ADDRESS ??
        "0xCC5a2bD0839c2A9CeB0c13e04569CE7Ee99cc033",
      creditFieldName: "winnerRewardCredit",
    };
  }
  return {
    chainId: CELO_CHAIN_ID,
    rpc: process.env.CELO_RPC_URL ?? "https://forno.celo.org",
    smAddress:
      process.env.GAME_SETTLEMENT_ADDRESS ??
      process.env.NEXT_PUBLIC_GAME_SETTLEMENT_ADDRESS ??
      "0xBeFB1A777E463C2325D6992dB77D9f6ddA88c2DC",
    creditVaultAddress:
      process.env.GAME_CREDIT_VAULT_ADDRESS ??
      process.env.NEXT_PUBLIC_GAME_CREDIT_VAULT_ADDRESS ??
      "",
    creditFieldName: "winnerRewardCreditUsdt",
  };
}

// ── Dynamic ABI/types per credit field ───────────────────────────────────────

function buildAbi(creditField: string) {
  return [
    `function settleMatch((bytes32 matchId,bytes32 gameId,bytes32 modeId,address winner,address loser,uint256 winnerScore,uint256 loserScore,uint256 winnerMilesReward,uint256 loserMilesReward,uint256 ${creditField},bytes32 replayHash,bytes32 resultHash) input, bytes resolverSignature)`,
    "function settledMatches(bytes32 matchId) view returns (bool)",
    "function authorizedResolvers(address resolver) view returns (bool)",
  ];
}

function buildEip712Types(creditField: string) {
  return {
    SettlementInput: [
      { name: "matchId",             type: "bytes32"  },
      { name: "gameId",              type: "bytes32"  },
      { name: "modeId",              type: "bytes32"  },
      { name: "winner",              type: "address"  },
      { name: "loser",               type: "address"  },
      { name: "winnerScore",         type: "uint256"  },
      { name: "loserScore",          type: "uint256"  },
      { name: "winnerMilesReward",   type: "uint256"  },
      { name: "loserMilesReward",    type: "uint256"  },
      { name: creditField,           type: "uint256"  },
      { name: "replayHash",          type: "bytes32"  },
      { name: "resultHash",          type: "bytes32"  },
    ],
  };
}

const GAME_CREDIT_VAULT_ABI = [
  "function rewardCreditBalance(address user) view returns (uint256)",
];

// ── Types ─────────────────────────────────────────────────────────────────────

export type HexAddress = `0x${string}`;

export interface FarkleSettlementParams {
  matchId:        string;
  modeKey:        string;
  winnerAddress:  HexAddress;
  loserAddress:   HexAddress;
  winnerScore:    number;
  loserScore:     number;
  winMiles:       number;
  losMiles:       number;
  winCreditCents: number;
  replayHash?:    string;
  resultHash?:    string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function asKey(pk: string) {
  return pk.startsWith("0x") ? pk : `0x${pk}`;
}

function toBytes32(value: string) {
  return /^0x[0-9a-fA-F]{64}$/.test(value) ? value : keccak256(toUtf8Bytes(value));
}

function buildSettlementInput(p: FarkleSettlementParams, creditField: string) {
  return {
    matchId:              toBytes32(p.matchId),
    gameId:               GAME_ID_FARKLE,
    modeId:               keccak256(toUtf8Bytes(p.modeKey)),
    winner:               p.winnerAddress,
    loser:                p.loserAddress,
    winnerScore:          BigInt(Math.max(0, Math.trunc(p.winnerScore))),
    loserScore:           BigInt(Math.max(0, Math.trunc(p.loserScore))),
    winnerMilesReward:    parseUnits(String(p.winMiles), 18),
    loserMilesReward:     parseUnits(String(p.losMiles), 18),
    [creditField]:        BigInt(Math.max(0, Math.round(p.winCreditCents * 10_000))),
    replayHash:           p.replayHash ? toBytes32(p.replayHash) : toBytes32(`replay:${p.matchId}`),
    resultHash:           p.resultHash
      ? toBytes32(p.resultHash)
      : toBytes32(`result:${p.matchId}:${p.winnerAddress}:${p.loserAddress}:${p.winnerScore}:${p.loserScore}`),
  };
}

function getProvider(cp: ChainParams) {
  return new JsonRpcProvider(cp.rpc);
}

function getSettlementManager(cp: ChainParams, readonly = false) {
  const prov = getProvider(cp);
  const runner = readonly ? prov : new Wallet(asKey(SUBMITTER_PK), prov);
  return new Contract(cp.smAddress, buildAbi(cp.creditFieldName), runner);
}

async function signSettlement(
  cp: ChainParams,
  input: Record<string, unknown>,
) {
  if (!RESOLVER_PK) throw new Error("FARKLE_RESOLVER_PK/PRIVATE_KEY not configured");
  const resolver = new Wallet(asKey(RESOLVER_PK), getProvider(cp));
  return resolver.signTypedData(
    {
      name:            "GameSettlementManager",
      version:         "1",
      chainId:         cp.chainId,
      verifyingContract: cp.smAddress,
    },
    buildEip712Types(cp.creditFieldName),
    input,
  );
}

// ── Exported API ──────────────────────────────────────────────────────────────

export async function getFarkleResolverStatus(chainId?: number) {
  const cp = getChainParams(chainId);
  if (!RESOLVER_PK) return { configured: false, address: null, authorized: false };
  const resolver = new Wallet(asKey(RESOLVER_PK), getProvider(cp));
  const manager  = getSettlementManager(cp, true);
  const authorized = await manager.authorizedResolvers(resolver.address);
  return { configured: true, address: resolver.address, authorized: Boolean(authorized) };
}

export async function isFarkleMatchSettledOnChain(
  matchId: string,
  chainId?: number,
): Promise<boolean> {
  const cp      = getChainParams(chainId);
  const manager = getSettlementManager(cp, true);
  return Boolean(await manager.settledMatches(toBytes32(matchId)));
}

export async function readFarkleRewardCreditCents(
  user: HexAddress,
  chainId?: number,
): Promise<number> {
  const cp = getChainParams(chainId);
  if (!cp.creditVaultAddress) throw new Error("GAME_CREDIT_VAULT_ADDRESS not configured");
  const vault = new Contract(cp.creditVaultAddress, GAME_CREDIT_VAULT_ABI, getProvider(cp));
  const baseUnits = BigInt(await vault.rewardCreditBalance(user));
  return Number(baseUnits / 10_000n);
}

export async function simulateFarkleSettlement(
  p: FarkleSettlementParams,
  chainId?: number,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    if (!SUBMITTER_PK) return { ok: false, error: "FARKLE_SUBMITTER_PK/PRIVATE_KEY not configured" };
    const cp      = getChainParams(chainId);
    const input   = buildSettlementInput(p, cp.creditFieldName);
    const sig     = await signSettlement(cp, input);
    const manager = getSettlementManager(cp, false);
    await manager.settleMatch.staticCall(input, sig);
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: e?.shortMessage ?? e?.reason ?? e?.message ?? String(e) };
  }
}

export async function settleFarkleOnChain(
  p: FarkleSettlementParams,
  chainId?: number,
): Promise<string> {
  if (!SUBMITTER_PK) throw new Error("FARKLE_SUBMITTER_PK/PRIVATE_KEY not configured");

  const cp      = getChainParams(chainId);
  const input   = buildSettlementInput(p, cp.creditFieldName);
  const sig     = await signSettlement(cp, input);
  const manager = getSettlementManager(cp, false);

  let lastError: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      if (attempt > 0) await new Promise((resolve) => setTimeout(resolve, 250 + Math.random() * 500));
      const tx = await manager.settleMatch(input, sig);
      try {
        await Promise.race([
          tx.wait(1),
          new Promise((_, reject) =>
            setTimeout(() => reject(new Error("receipt wait timeout")), 45_000),
          ),
        ]);
      } catch {
        console.warn(`[farkle/settle] receipt wait timed out for ${tx.hash}; checking settledMatches`);
      }

      const settled = await isFarkleMatchSettledOnChain(p.matchId, chainId);
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
