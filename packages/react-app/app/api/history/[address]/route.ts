// src/app/api/history/[address]/route.ts
import { NextResponse } from 'next/server';
import {
  createPublicClient,
  http,
  type Address,
  type Abi,
} from 'viem';
import { celo } from 'viem/chains';
import erc20Abi from '@/contexts/cusd-abi.json'; // has `symbol()` ABI

const publicClient = createPublicClient({
  chain: celo,
  transport: http(),
});

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const SUBGRAPH_URL =
  'https://api.studio.thegraph.com/query/115307/akiba-v-2/version/latest';

interface CacheEntry { expires: number; data: any }
const CACHE: Record<string, CacheEntry> = {};
const TTL_MS = 30_000;
const USE_CACHE = true;

const FULL_QUERY = /* GraphQL */ `
query Full($user: Bytes!) {
  mints: transfers(
    where: { to: $user, from: "0x0000000000000000000000000000000000000000" }
    orderBy: blockTimestamp
    orderDirection: desc
  ) { id value blockTimestamp }

  spends: transfers(
    where: { from: $user }
    orderBy: blockTimestamp
    orderDirection: desc
  ) { id value blockTimestamp }

  joins: participantJoineds(
    where: { participant: $user }
    orderBy: blockTimestamp
    orderDirection: desc
  ) { id roundId blockTimestamp }

  raffleResults: winnerSelecteds(
    orderBy: blockTimestamp
    orderDirection: desc
    first: 50
  ) { id roundId reward blockTimestamp winner }

  rounds: roundCreateds(
    orderBy: blockTimestamp
    orderDirection: desc
    first: 50
  ) {
    roundId
    rewardToken
    rewardPool
  }
}
`;

function isAddress(a: string) {
  return /^0x[a-fA-F0-9]{40}$/.test(a);
}

export async function GET(_req: Request, context: any) {
  await 0;

  const params = context?.params;
  const address: string | undefined = params?.address;

  if (!address || !isAddress(address)) {
    return NextResponse.json(
      { error: 'Bad address', provided: address },
      { status: 400 }
    );
  }

  const key = address.toLowerCase();

  // Cache
  if (USE_CACHE) {
    const c = CACHE[key];
    if (c && c.expires > Date.now()) {
      return NextResponse.json(
        { ok: true, ...c.data, meta: { ...c.data.meta, cached: true } },
        { headers: { 'X-Cache': 'HIT' } }
      );
    }
  }

  // Subgraph fetch
  let graphJson: any;
  try {
    const res = await fetch(SUBGRAPH_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: FULL_QUERY, variables: { user: key } })
    });
    const raw = await res.text();
    try {
      graphJson = raw ? JSON.parse(raw) : {};
    } catch {
      return NextResponse.json(
        { ok: false, error: 'Invalid JSON from subgraph', snippet: raw.slice(0, 200) },
        { status: 502 }
      );
    }
    if (!res.ok || graphJson.errors) {
      return NextResponse.json(
        { ok: false, error: 'Subgraph error', detail: graphJson.errors || res.statusText },
        { status: 502 }
      );
    }
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: 'Fetch exception', detail: e.message || String(e) },
      { status: 502 }
    );
  }

  const d = graphJson.data || {};
  const mints  = Array.isArray(d.mints)  ? d.mints  : [];
  const spends = Array.isArray(d.spends) ? d.spends : [];
  const joins  = Array.isArray(d.joins)  ? d.joins  : [];
  const raffleResults = Array.isArray(d.raffleResults) ? d.raffleResults : [];
  const rounds        = Array.isArray(d.rounds)        ? d.rounds        : [];

  // Build lookup: roundId → roundMeta
  const roundById: Record<string, any> = {};
  for (const r of rounds) roundById[r.roundId] = r;

  // Earn
  const earnItems = mints.map((t: any) => {
    const amt = Number(t.value) / 1e18;
    return {
      id: t.id,
      ts: +t.blockTimestamp,
      type: 'EARN' as const,
      amount: amt.toFixed(0),
      note: `You earned ${amt.toFixed(0)} MiniMiles`
    };
  });

  // Spend
  const spendItems = spends.map((t: any) => {
    const amt = Number(t.value) / 1e18;
    return {
      id: t.id,
      ts: +t.blockTimestamp,
      type: 'SPEND' as const,
      amount: amt.toFixed(0),
      note: `You spent ${amt.toFixed(0)} MiniMiles`
    };
  });

  // Joins
  const joinItems = joins.map((j: any) => ({
    id: j.id ?? `${j.roundId}-${j.blockTimestamp}-join`,
    ts: +j.blockTimestamp,
    type: 'RAFFLE_ENTRY' as const,
    roundId: j.roundId,
    note: `Entered raffle #${j.roundId}`
  }));

  // Token symbol resolution
  const symbolCache: Record<string, string> = {};
  async function loadSymbols(addrs: Address[]) {
    const unique = addrs
      .map(a => a?.toLowerCase() as Address)
      .filter(a => a && !symbolCache[a]);
    if (!unique.length) return;

    const calls = unique.map(addr => ({
      address: addr,
      abi: erc20Abi.abi as Abi,
      functionName: 'symbol',
    }));

    const res = await publicClient.multicall({ contracts: calls, allowFailure: true });

    unique.forEach((addr, i) => {
      const out = res[i];
      if (out.status === 'success') {
        symbolCache[addr] = out.result as string;
      } else {
        symbolCache[addr] = '???';
      }
    });
  }

  const rewardTokens: Address[] = rounds
    .map((r: any) => r.rewardToken as Address)
    .filter(Boolean);

  await loadSymbols(rewardTokens);

  // Results (public)
  const resultItems = raffleResults.map((w: any) => {
    const meta = roundById[w.roundId] || {};
    const tokenAddr = (meta.rewardToken || '0x').toLowerCase();
    const symbol = symbolCache[tokenAddr] || '???';

    return {
      id: w.id,
      ts: +w.blockTimestamp,
      type: 'RAFFLE_RESULT' as const,
      roundId: w.roundId,
      winner: w.winner,
      rewardToken: tokenAddr,
      symbol,
      rewardPool: meta.rewardPool ?? null,
      image: null, // no image in schema; UI has fallbacks
      note:
        symbol !== '???' && w.reward
          ? `Won ${Number(w.reward) / 1e18} ${symbol}`
          : `Raffle #${w.roundId} result`,
    };
  });

  // Personal stats
  const myWins = resultItems.filter((r: { winner: string; }) => r.winner?.toLowerCase() === key);

  const history = [...earnItems, ...spendItems, ...joinItems]
    .sort((a, b) => b.ts - a.ts);

  const totalEarned     = earnItems.reduce((s: number, i: any) => s + Number(i.amount), 0);
  const totalRafflesWon = myWins.length;
  const totalUSDWon     = 0;

  const participatingRaffles = Array.from(
    new Set(joinItems.map((j: any) => Number(j.roundId)))
  );

  const payload = {
    history,
    raffleResults: resultItems,
    stats: { totalEarned, totalRafflesWon, totalUSDWon },
    participatingRaffles,
    meta: {
      address: key,
      generatedAt: new Date().toISOString(),
      counts: {
        mints: mints.length,
        spends: spends.length,
        joins: joins.length,
        results: resultItems.length,
        myWins: myWins.length,
      },
      cached: false,
      ttlMs: TTL_MS,
    },
  };

  if (USE_CACHE) {
    CACHE[key] = { expires: Date.now() + TTL_MS, data: payload };
  }

  return NextResponse.json({ ok: true, ...payload }, { headers: { 'X-Cache': 'MISS' } });
}
