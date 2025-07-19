import { NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const SUBGRAPH_URL =
  'https://api.studio.thegraph.com/query/115307/akiba-v-2/version/latest';

/* TEMP: no cache while debugging */
const USE_CACHE = false;
interface CacheEntry { expires: number; data: any }
const CACHE: Record<string, CacheEntry> = {};
const TTL_MS = 30_000;

const FULL_QUERY = /* GraphQL */ `
  query Full($user: Bytes!) {
    mints: transfers(
      where: { to: $user }        # removed zero-from filter for diagnosis
      orderBy: blockTimestamp
      orderDirection: desc
    ) { id value blockTimestamp from }

    spends: transfers(
      where: { from: $user }
      orderBy: blockTimestamp
      orderDirection: desc
    ) { id value blockTimestamp to }

    joins: participantJoineds(
      where: { participant: $user }
      orderBy: blockTimestamp
      orderDirection: desc
    ) { id roundId blockTimestamp }

    wins: winnerSelecteds(
      where: { winner: $user }
      orderBy: blockTimestamp
      orderDirection: desc
    ) { id roundId reward blockTimestamp }
  }
`;

function isAddress(a: string) {
  return /^0x[a-fA-F0-9]{40}$/.test(a);
}

type Params = { address: string };
async function resolveParams<T>(p: T | Promise<T>): Promise<T> {
  return p instanceof Promise ? p : p;
}

export async function GET(_req: Request, ctx: { params: Params | Promise<Params> }) {
  const { address } = await resolveParams(ctx.params);

  if (!isAddress(address)) {
    return NextResponse.json({ error: 'Bad address', provided: address }, { status: 400 });
  }

  const key = address.toLowerCase();

  if (USE_CACHE) {
    const c = CACHE[key];
    if (c && c.expires > Date.now()) {
      return NextResponse.json({ ...c.data, meta: { ...c.data.meta, cached: true } }, {
        headers: { 'X-Cache': 'HIT' }
      });
    }
  }

  let raw = '';
  let json: any;
  let subgraphStatus = 0;

  try {
    const res = await fetch(SUBGRAPH_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: FULL_QUERY, variables: { user: key } })
    });
    subgraphStatus = res.status;
    raw = await res.text();

    try { json = raw ? JSON.parse(raw) : {}; }
    catch {
      return NextResponse.json({
        ok: false,
        phase: 'parse',
        subgraphStatus,
        error: 'Invalid JSON from subgraph',
        snippet: raw.slice(0, 400)
      }, { status: 200 });
    }

    if (!res.ok || json.errors) {
      return NextResponse.json({
        ok: false,
        phase: 'graph',
        subgraphStatus,
        errors: json.errors || res.statusText,
        rawSnippet: raw.slice(0, 400)
      }, { status: 200 });
    }
  } catch (e: any) {
    return NextResponse.json({
        ok: false,
        phase: 'fetch',
        error: e.message || String(e)
    }, { status: 200 });
  }
  const data = json.data || {};
  const mints  = Array.isArray(data.mints)  ? data.mints  : [];
  const spends = Array.isArray(data.spends) ? data.spends : [];
  const joins  = Array.isArray(data.joins)  ? data.joins  : [];
  const wins   = Array.isArray(data.wins)   ? data.wins   : [];

  console.log('[history/debug]', key, {
    mints: mints.length,
    spends: spends.length,
    joins: joins.length,
    wins: wins.length,
    sampleMint: mints[0],
    sampleWin: wins[0]
  });

  // Classify earns (fallback if zero address not present)
  const ZERO = '0x0000000000000000000000000000000000000000';
  const zeroMints = mints.filter((t: any) => t.from?.toLowerCase?.() === ZERO);
  const earnSource = zeroMints.length ? zeroMints : mints;

  const earnItems = earnSource.map((t: any) => {
    const amt = Number(t.value) / 1e18;
    return {
      id: t.id,
      ts: +t.blockTimestamp,
      type: 'EARN' as const,
      amount: amt.toFixed(0),
      note: `You earned ${amt.toFixed(0)} MiniMiles`
    };
  });

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

  const joinItems = joins.map((j: any) => ({
    id: j.id ?? `${j.roundId}-${j.blockTimestamp}-join`,
    ts: +j.blockTimestamp,
    type: 'RAFFLE_ENTRY' as const,
    roundId: j.roundId,
    note: `Entered raffle #${j.roundId}`
  }));

  const winItems = wins.map((w: any) => ({
    id: w.id,
    ts: +w.blockTimestamp,
    type: 'RAFFLE_WIN' as const,
    roundId: w.roundId,
    note: `🎉 Won raffle #${w.roundId}`
  }));

  const history = [...earnItems, ...spendItems, ...joinItems, ...winItems]
    .sort((a, b) => b.ts - a.ts);

  const payload = {
    history,
    stats: {
      totalEarned: earnItems.reduce((s: number, i: { amount: any; }) => s + Number(i.amount), 0),
      totalRafflesWon: winItems.length,
      totalUSDWon: wins.reduce((s: number, w: any) => s + (Number(w.rewardPool) / 1e18), 0)
    },
    participatingRaffles: Array.from(new Set(joinItems.map((j: { roundId: any; }) => Number(j.roundId)))),
    meta: {
      address: key,
      generatedAt: new Date().toISOString(),
      sourceCounts: {
        mints: mints.length,
        spends: spends.length,
        joins: joins.length,
        wins: wins.length
      },
      cached: false
    }
  };

  if (USE_CACHE) {
    CACHE[key] = { expires: Date.now() + TTL_MS, data: payload };
  }

  return NextResponse.json({ ok: true, ...payload });
}
