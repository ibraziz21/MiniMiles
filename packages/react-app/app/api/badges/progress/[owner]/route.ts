// src/app/api/badges/progress/[owner]/route.ts
import { NextResponse } from "next/server";
import { createPublicClient, http, isAddress, formatUnits } from "viem";
import { celo } from "viem/chains";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/* ----------------------------- Dice (Games) ----------------------------- */

const DICE_ABI = [
  {
    type: "function",
    name: "getPlayerStats",
    stateMutability: "view",
    inputs: [{ name: "player", type: "address" }],
    outputs: [
      { name: "roundsJoined", type: "uint64" },
      { name: "roundsWon", type: "uint64" },
      { name: "totalStaked", type: "uint128" },
      { name: "totalWon", type: "uint128" },
    ],
  },
] as const;

const DICE_ADDRESS =
  (process.env.DICE_ADDRESS as `0x${string}` | undefined) ??
  ("0xf77e7395Aa5c89BcC8d6e23F67a9c7914AB9702a" as const);

/* ----------------------------- RPCs for tx counts ----------------------------- */
/**
 * If you truly have two networks (CEL2 vs S1), set these.
 * Otherwise they can both point at the same Celo RPC.
 */
const CELO_RPC =
  process.env.CELO_RPC_URL ||
  process.env.NEXT_PUBLIC_CELO_RPC_URL ||
  "https://forno.celo.org";

const CEL2_RPC =
  process.env.CEL2_RPC_URL ||
  process.env.NEXT_PUBLIC_CEL2_RPC_URL ||
  CELO_RPC;

const S1_RPC =
  process.env.CELO_S1_RPC_URL ||
  process.env.NEXT_PUBLIC_CELO_S1_RPC_URL ||
  CELO_RPC;

const clientCel2 = createPublicClient({ chain: celo, transport: http(CEL2_RPC) });
const clientS1 = createPublicClient({ chain: celo, transport: http(S1_RPC) });

async function getTxCount(client: typeof clientCel2, addr: `0x${string}`) {
  // NOTE: This is nonce (txs sent). If you need "total txs involving the address",
  // you must use an indexer/subgraph/explorer API instead.
  const n = await client.getTransactionCount({ address: addr });
  return Number(n);
}

async function getAkibaFromGames(owner: `0x${string}`) {
  try {
    const res = (await clientCel2.readContract({
      address: DICE_ADDRESS,
      abi: DICE_ABI,
      functionName: "getPlayerStats",
      args: [owner],
    })) as readonly [bigint, bigint, bigint, bigint];

    const totalWon = res[3];
    const v = Number.parseFloat(formatUnits(totalWon, 18));
    return Number.isFinite(v) ? v : 0;
  } catch {
    return 0;
  }
}

/* ----------------------------- Lifetime Akiba (History reuse) ----------------------------- */

async function getLifetimeAkibaEarnedFromHistory(
  req: Request,
  owner: `0x${string}`
): Promise<number> {
  /**
   * Reuse your existing aggregation:
   *   /api/history/[address] → { stats: { totalEarned } }
   */
  try {
    const url = new URL(req.url);
    url.pathname = `/api/history/${owner}`;
    url.search = "";

    const res = await fetch(url.toString(), {
      method: "GET",
      headers: { accept: "application/json" },
      cache: "no-store",
    });

    if (!res.ok) return 0;

    const data = await res.json();
    const earned = data?.stats?.totalEarned;

    const n = typeof earned === "number" ? earned : Number(earned);
    return Number.isFinite(n) ? n : 0;
  } catch {
    return 0;
  }
}

/* ----------------------------- Route ----------------------------- */

export async function GET(_req: Request, context: any) {
  // ✅ Next 15+: params is a Promise
  const params = await context?.params;
  const raw = params?.owner ?? params?.address; // tolerate both names
  const ownerStr = Array.isArray(raw) ? raw[0] : raw;

  if (!ownerStr || !isAddress(ownerStr)) {
    return NextResponse.json(
      { ok: false, error: "Bad address", provided: ownerStr },
      { status: 400 }
    );
  }

  const owner = ownerStr as `0x${string}`;

  try {
    const [cel2Txs, s1Txs, lam, amg] = await Promise.all([
      getTxCount(clientCel2, owner),
      getTxCount(clientS1, owner),
      getLifetimeAkibaEarnedFromHistory(_req, owner),
      getAkibaFromGames(owner),
    ]);

    return NextResponse.json(
      {
        ok: true,
        owner,
        values: {
          "cel2-transactions": cel2Txs,
          "s1-transactions": s1Txs,
          "lam-lifetime-akiba": lam,
          "amg-akiba-games": amg,
        },
      },
      { status: 200 }
    );
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: "Failed", detail: String(e?.message ?? e) },
      { status: 500 }
    );
  }
}
