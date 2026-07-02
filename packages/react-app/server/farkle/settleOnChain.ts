// server/farkle/settleOnChain.ts
//
// On-chain Farkle settlement. Instead of minting AkibaMiles off-chain, the
// backend signs an EIP-712 SettlementInput as an authorized resolver and submits
// GameSettlementManager.settleMatch(). That single call:
//   · mints both players' AkibaMiles via RewardTreasury.grantAkibaMilesReward()
//   · credits the winner's USDT reward credit via GameCreditVault.creditRewardCredits()
//   · anchors the result (replay/result hashes) and enforces one-settlement-per-match
//
// The resolver signer and the tx submitter can differ — the signature is the
// authorization — so we sign + submit with the backend relayer (PRIVATE_KEY),
// which must be an authorized resolver on the settlement manager.

import {
  createPublicClient,
  createWalletClient,
  http,
  keccak256,
  toBytes,
  parseUnits,
} from "viem";
import { privateKeyToAccount, nonceManager } from "viem/accounts";
import { celo, base } from "viem/chains";

// ── Chain-specific config ─────────────────────────────────────────────────────

const CELO_SM_ADDRESS = (process.env.NEXT_PUBLIC_GAME_SETTLEMENT_ADDRESS ??
  "0xBeFB1A777E463C2325D6992dB77D9f6ddA88c2DC") as `0x${string}`;
const BASE_SM_ADDRESS = (process.env.NEXT_PUBLIC_BASE_GAME_SETTLEMENT_ADDRESS ??
  "0x24814CcD77ABfDa092F30e2789331701BC0b1cc9") as `0x${string}`;

const CELO_CREDIT_VAULT = (process.env.GAME_CREDIT_VAULT_ADDRESS ??
  process.env.NEXT_PUBLIC_GAME_CREDIT_VAULT_ADDRESS ??
  "0x31B4cbc6c3508156eCaFD937b36C5Bf68848bcba") as `0x${string}`;
const BASE_CREDIT_VAULT = (process.env.NEXT_PUBLIC_BASE_GAME_CREDIT_VAULT_ADDRESS ?? "0xCC5a2bD0839c2A9CeB0c13e04569CE7Ee99cc033") as `0x${string}`;

const CELO_RPC = process.env.CELO_RPC_URL ?? "https://forno.celo.org";
const BASE_RPC  = process.env.BASE_RPC_URL  ?? "https://mainnet.base.org";

function chainParams(chainId: number) {
  if (chainId === base.id) {
    return { chain: base, rpc: BASE_RPC, smAddress: BASE_SM_ADDRESS, creditVault: BASE_CREDIT_VAULT };
  }
  return { chain: celo, rpc: CELO_RPC, smAddress: CELO_SM_ADDRESS, creditVault: CELO_CREDIT_VAULT };
}

// Keep legacy exports pointing to Celo for callers that don't pass a chainId.
const SM_ADDRESS = CELO_SM_ADDRESS;
const CREDIT_VAULT_ADDRESS = CELO_CREDIT_VAULT;

// Two roles, two keys:
//   · Resolver  — SIGNS the EIP-712 settlement. Must be authorized on the
//     GameSettlementManager via setAuthorizedResolver. Signing sends no tx and
//     consumes no nonce, so it stays on the backend relayer (PRIVATE_KEY).
//   · Submitter — SENDS settleMatch and pays gas. The signature is the
//     authorization, so this key needs NO on-chain role — only CELO for gas.
//     Use a DEDICATED key (FARKLE_SUBMITTER_PK) so settlement gets its own nonce
//     space and stops fighting the shared/busy relayer (mint/crackpot/dice/claw).
const RESOLVER_PK = (process.env.FARKLE_RESOLVER_PK ?? process.env.PRIVATE_KEY ?? "").trim();
const SUBMITTER_PK = (process.env.FARKLE_SUBMITTER_PK ?? process.env.PRIVATE_KEY ?? RESOLVER_PK).trim();

function asKey(k: string): `0x${string}` {
  return (k.startsWith("0x") ? k : `0x${k}`) as `0x${string}`;
}

const GAME_ID_FARKLE = keccak256(toBytes("FARKLE"));

// Celo contract uses "winnerRewardCreditUsdt"; Base contract uses "winnerRewardCredit".
function buildSettleAbi(creditFieldName: string) {
  return [
    {
      type: "function",
      name: "settleMatch",
      stateMutability: "nonpayable",
      inputs: [
        {
          name: "input",
          type: "tuple",
          components: [
            { name: "matchId", type: "bytes32" },
            { name: "gameId", type: "bytes32" },
            { name: "modeId", type: "bytes32" },
            { name: "winner", type: "address" },
            { name: "loser", type: "address" },
            { name: "winnerScore", type: "uint256" },
            { name: "loserScore", type: "uint256" },
            { name: "winnerMilesReward", type: "uint256" },
            { name: "loserMilesReward", type: "uint256" },
            { name: creditFieldName, type: "uint256" },
            { name: "replayHash", type: "bytes32" },
            { name: "resultHash", type: "bytes32" },
          ],
        },
        { name: "resolverSignature", type: "bytes" },
      ],
      outputs: [],
    },
  ] as const;
}

function buildEip712Types(creditFieldName: string) {
  return {
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
      { name: creditFieldName, type: "uint256" },
      { name: "replayHash", type: "bytes32" },
      { name: "resultHash", type: "bytes32" },
    ],
  } as const;
}

// Legacy Celo constants (kept for unchanged callers).
const SETTLE_ABI    = buildSettleAbi("winnerRewardCreditUsdt");
const EIP712_TYPES  = buildEip712Types("winnerRewardCreditUsdt");

type HexAddress = `0x${string}`;

export interface FarkleSettlementParams {
  matchId:       string;        // DB UUID
  modeKey:       string;        // e.g. FARKLE_QUICK_1500_AKIBA
  winnerAddress: HexAddress;
  loserAddress:  HexAddress;
  winnerScore:   number;
  loserScore:    number;
  winMiles:      number;        // whole AkibaMiles
  losMiles:      number;        // whole AkibaMiles
  winCreditCents: number;       // USDT cents; 0 for Quick Duel
  replayHash?:   string;        // optional precomputed bytes32
  resultHash?:   string;        // optional precomputed bytes32
}

/** Coerce an arbitrary string into a deterministic bytes32. */
function toBytes32(s: string): HexAddress {
  return /^0x[0-9a-fA-F]{64}$/.test(s) ? (s as HexAddress) : keccak256(toBytes(s));
}

const SETTLED_ABI = [
  { type: "function", name: "settledMatches", stateMutability: "view", inputs: [{ type: "bytes32" }], outputs: [{ type: "bool" }] },
] as const;

const CREDIT_VAULT_ABI = [
  { type: "function", name: "rewardCreditBalance", stateMutability: "view", inputs: [{ name: "user", type: "address" }], outputs: [{ type: "uint256" }] },
] as const;

/** Build the EIP-712 SettlementInput tuple. Field name differs between chains. */
function buildSettlementInput(p: FarkleSettlementParams, isBase = false) {
  const creditKey = isBase ? "winnerRewardCredit" : "winnerRewardCreditUsdt";
  const creditValue = BigInt(Math.max(0, Math.round(p.winCreditCents * 1e4))); // cents → 6-dp
  return {
    matchId:            toBytes32(p.matchId),
    gameId:             GAME_ID_FARKLE,
    modeId:             keccak256(toBytes(p.modeKey)),
    winner:             p.winnerAddress,
    loser:              p.loserAddress,
    winnerScore:        BigInt(Math.max(0, Math.trunc(p.winnerScore))),
    loserScore:         BigInt(Math.max(0, Math.trunc(p.loserScore))),
    winnerMilesReward:  parseUnits(String(p.winMiles), 18),
    loserMilesReward:   parseUnits(String(p.losMiles), 18),
    [creditKey]:        creditValue,
    replayHash:         p.replayHash ? toBytes32(p.replayHash) : toBytes32(`replay:${p.matchId}`),
    resultHash:         p.resultHash
      ? toBytes32(p.resultHash)
      : toBytes32(`result:${p.matchId}:${p.winnerAddress}:${p.loserAddress}:${p.winnerScore}:${p.loserScore}`),
  };
}

/** Resolver signs the settlement (EIP-712). Signing consumes no nonce. */
async function signSettlement(
  input: ReturnType<typeof buildSettlementInput>,
  opts: { chain: typeof celo | typeof base; rpc: string; smAddress: `0x${string}`; isBase: boolean }
): Promise<HexAddress> {
  const resolver = privateKeyToAccount(asKey(RESOLVER_PK), { nonceManager });
  const signerClient = createWalletClient({ account: resolver, chain: opts.chain, transport: http(opts.rpc) });
  const domain = { name: "GameSettlementManager", version: "1", chainId: opts.chain.id, verifyingContract: opts.smAddress } as const;
  const types  = buildEip712Types(opts.isBase ? "winnerRewardCredit" : "winnerRewardCreditUsdt");
  return signerClient.signTypedData({
    account: resolver,
    domain,
    types,
    primaryType: "SettlementInput",
    message: input as any,
  });
}

/** Read-only: has this match already been settled on-chain? */
export async function isMatchSettledOnChain(matchId: string, chainId: number = celo.id): Promise<boolean> {
  const { chain, rpc, smAddress } = chainParams(chainId);
  const publicClient = createPublicClient({ chain, transport: http(rpc) });
  return publicClient.readContract({
    address: smAddress,
    abi: SETTLED_ABI,
    functionName: "settledMatches",
    args: [toBytes32(matchId)],
  }) as Promise<boolean>;
}

export async function readFarkleRewardCreditCents(user: HexAddress, chainId: number = celo.id): Promise<number> {
  const { chain, rpc, creditVault } = chainParams(chainId);
  if (!creditVault) throw new Error("GameCreditVault address not configured for this chain");
  const publicClient = createPublicClient({ chain, transport: http(rpc) });
  const baseUnits = (await publicClient.readContract({
    address: creditVault,
    abi: CREDIT_VAULT_ABI,
    functionName: "rewardCreditBalance",
    args: [user],
  })) as bigint;
  return Number(baseUnits / 10_000n);
}

/** Read-only dry run of settleMatch. */
export async function simulateFarkleSettlement(
  p: FarkleSettlementParams,
  chainId: number = celo.id,
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!RESOLVER_PK) return { ok: false, error: "FARKLE_RESOLVER_PK/PRIVATE_KEY not configured" };
  try {
    const isBase = chainId === base.id;
    const opts = chainParams(chainId);
    const input = buildSettlementInput(p, isBase);
    const signature = await signSettlement(input, { ...opts, isBase });
    const submitter = privateKeyToAccount(asKey(SUBMITTER_PK));
    const publicClient = createPublicClient({ chain: opts.chain, transport: http(opts.rpc) });
    await publicClient.simulateContract({
      account: submitter.address,
      address: opts.smAddress,
      abi: buildSettleAbi(isBase ? "winnerRewardCredit" : "winnerRewardCreditUsdt"),
      functionName: "settleMatch",
      args: [input as any, signature],
    });
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: e?.shortMessage ?? e?.message ?? String(e) };
  }
}

/**
 * Settle a finished match on-chain. Throws on failure.
 */
export async function settleFarkleOnChain(p: FarkleSettlementParams, chainId: number = celo.id): Promise<HexAddress> {
  if (!RESOLVER_PK) throw new Error("FARKLE_RESOLVER_PK/PRIVATE_KEY not configured for settlement");

  const isBase  = chainId === base.id;
  const opts    = chainParams(chainId);
  const submitter = privateKeyToAccount(asKey(SUBMITTER_PK), { nonceManager });

  const publicClient = createPublicClient({ chain: opts.chain, transport: http(opts.rpc) });
  const walletClient = createWalletClient({ account: submitter, chain: opts.chain, transport: http(opts.rpc) });

  const input    = buildSettlementInput(p, isBase);
  const signature = await signSettlement(input, { ...opts, isBase });
  const settleAbi = buildSettleAbi(isBase ? "winnerRewardCredit" : "winnerRewardCreditUsdt");

  // 2. Submit (any wallet may relay; the signature is the authorization).
  //    The relayer is shared/busy, so tolerate nonce/gas races with a few retries.
  let lastError: any = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      if (attempt > 0) await new Promise((r) => setTimeout(r, 200 + Math.random() * 300));
      const hash = await walletClient.writeContract({
        address: opts.smAddress,
        abi: settleAbi,
        functionName: "settleMatch",
        args: [input as any, signature],
        account: submitter,
      });
      // The tx is broadcast at this point. settleMatch is replay-protected, so a
      // slow/failed confirmation is safe to retry/ignore — don't let the receipt
      // wait hang the (now awaited) request. Confirm best-effort with a short
      // budget; on timeout return the hash rather than throwing.
      try {
        await publicClient.waitForTransactionReceipt({ hash, confirmations: 1, timeout: 30_000 });
      } catch {
        console.warn(`[settleFarkleOnChain] receipt wait timed out for ${hash} — checking settlement state`);
      }
      const settled = await isMatchSettledOnChain(p.matchId, chainId);
      if (!settled) {
        throw new Error(`settle tx ${hash} not confirmed on-chain for match ${p.matchId}`);
      }
      return hash;
    } catch (err: any) {
      lastError = err;
      const msg = (err?.shortMessage || err?.message || "").toLowerCase();
      const nonceRace =
        msg.includes("nonce too low") ||
        msg.includes("nonce") ||
        msg.includes("replacement transaction underpriced") ||
        msg.includes("already known");
      if (!nonceRace) throw err; // AlreadySettled, InvalidSignature, etc. — don't retry
    }
  }
  throw lastError ?? new Error("settleMatch failed after nonce retries");
}
