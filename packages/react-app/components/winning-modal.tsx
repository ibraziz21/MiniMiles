// src/components/winning-modal.tsx
"use client";

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { CalendarIcon, TicketIcon } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useHistoryBundle } from "@/helpers/useHistoryBundle";
import { formatUnits } from "viem";
import { RaffleImg1, RaffleImg2, RaffleImg5, RaffleImg3 } from "@/lib/img";

/* ──────────────────────── DEBUG LOGGER ──────────────────────── */
const DEBUG_WINNER = true; // flip false to silence
const tag = "WinningModal";
const now = () => new Date().toISOString();
const log  = (...a: any[]) => DEBUG_WINNER && console.log(`[${tag}]`, now(), ...a);
const warn = (...a: any[]) => DEBUG_WINNER && console.warn(`[${tag}]`, now(), ...a);
const err  = (...a: any[]) => DEBUG_WINNER && console.error(`[${tag}]`, now(), ...a);

/* ───────────────────── window length (72h) ───────────────────── */
const ONE_DAY_SEC = 72 * 60 * 60;

/* ─────────────────── token decimals map ─────────────────────── */
const TOKEN_DECIMALS: Record<string, number> = {
  USDT: 6,
  Miles: 18,
  default: 18,
};

/* ─────────────── token symbol → default image map ────────────── */
const SYMBOL_IMAGE: Record<string, string> = {
  USDT: RaffleImg2.src,
  Miles: RaffleImg5.src,
  default: RaffleImg3.src, // also used for Physical Item Raffle
};

/* ───────────────── address → symbol mapping ─────────────────── */
const ADDRESS_TO_SYMBOL: Record<string, "USDT" | "Miles" | typeof PHYSICAL_LABEL> = {
  "0x48065fbbe25f71c9282ddf5e1cd6d6a887483d5e": "USDT",
  "0xeed878017f027fe96316007d0ca5fda58ee93a6b": "Miles",
};

const PHYSICAL_LABEL = "Physical Item Raffle";

/* ───────────────────── subgraph endpoint (v3) ───────────────── */
const SUBGRAPH_URL =
  "https://api.studio.thegraph.com/query/115307/akiba-v-3/version/latest";

/* ────────────────────────── utils ───────────────────────────── */
const isAddr = (s?: string): s is `0x${string}` =>
  typeof s === "string" && /^0x[a-fA-F0-9]{40}$/.test(s);

function seenKey(resultId: string | number) {
  return `akiba:lastRaffleSeen:${resultId}`;
}
function truncateAddr(a: string) {
  if (!a?.startsWith("0x") || a.length < 10) return a;
  return `${a.slice(0, 6)}…${a.slice(-4)}`;
}
function formatPrize(amountRaw?: string | null, symbol?: string) {
  if (!amountRaw) return symbol ? `${symbol}` : "";
  try {
    const dec = TOKEN_DECIMALS[symbol ?? ""] ?? TOKEN_DECIMALS.default;
    const human = formatUnits(BigInt(amountRaw), dec);
    const [i, f = ""] = human.split(".");
    const pretty = f.length > 4 ? `${i}.${f.slice(0, 4)}` : f.length ? `${i}.${f}` : i;
    return `${pretty} ${symbol ?? ""}`.trim();
  } catch (e) {
    warn("formatPrize fallback path hit", { amountRaw, symbol, e });
    const num = Number(amountRaw) / 1e18;
    return `${num.toLocaleString(undefined, { maximumFractionDigits: 4 })} ${symbol ?? ""}`.trim();
  }
}

/* ───────────────────────── types ────────────────────────────── */
type RaffleResultItem = {
  id: string;
  ts: number;
  roundId: string;
  winner: string;
  rewardToken: string;
  symbol: string;
  rewardPool: string | null;
  image: string | null;
  note: string;
};

/* ─── fetch round meta (rewardToken + rewardPool) from subgraph ─ */
async function fetchRoundMeta(roundId: string): Promise<{
  rewardToken?: `0x${string}`;
  rewardPool?: string | null;
} | null> {
  // Correct v3 query shape; roundId is STRING in where clause
  const QUERY = /* GraphQL */ `
    query RoundMeta($rid: String!) {
      roundCreateds(where: { roundId: $rid }, first: 1) {
        roundId
        rewardToken
        rewardPool
      }
    }
  `;
  const t0 = performance.now();
  log("fetchRoundMeta:start", { roundId });
  try {
    const res = await fetch(SUBGRAPH_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query: QUERY, variables: { rid: roundId } }),
      cache: "no-store",
    });
    const raw = await res.text();
    if (!res.ok) {
      err("fetchRoundMeta:badStatus", { status: res.status, raw: raw?.slice(0, 200) });
      return null;
    }
    const json = raw ? JSON.parse(raw) : {};
    const item = json?.data?.roundCreateds?.[0];
    const t1 = performance.now();
    log("fetchRoundMeta:success", { ms: Math.round(t1 - t0), roundId, item });

    if (!item) return null;

    // Normalize values
    const candidate = item.rewardToken as string | undefined;
    const rewardToken = isAddr(candidate) ? (candidate.toLowerCase() as `0x${string}`) : undefined;
    const rewardPool  = (item.rewardPool as string | null) ?? null;

    log("fetchRoundMeta:normalized", { rewardToken, rewardPool });
    return { rewardToken, rewardPool };
  } catch (e) {
    err("fetchRoundMeta:error", { roundId, e });
    return null;
  }
}

/* ───────────────────────── component ────────────────────────── */
export default function WinningModal({
  open,
  onOpenChange,
}: {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}) {
  const controlled = typeof open === "boolean";
  const [internalOpen, setInternalOpen] = useState(false);
  const isOpen = controlled ? (open as boolean) : internalOpen;

  const { data: bundle, isLoading: bundleLoading, error } = useHistoryBundle();
  useEffect(() => {
    if (error) err("useHistoryBundle:error", error);
  }, [error]);

  // Base latest result from bundle (fallback from history if needed)
  const baseLatest: RaffleResultItem | null = useMemo(() => {
    if (!bundle) {
      log("bundle:undefined");
      return null;
    }
    const direct: RaffleResultItem[] | undefined = (bundle as any)?.raffleResults;
    if (direct?.length) {
      const sorted = [...direct].sort((a, b) => (b.ts ?? 0) - (a.ts ?? 0));
      const pick = sorted[0] ?? null;
      log("pickLatest:fromRaffleResults", {
        count: direct.length,
        picked: pick ? { id: pick.id, ts: pick.ts, roundId: pick.roundId } : null,
      });
      return pick;
    }
    const fromHistory = (bundle?.history ?? [])
      .filter((h: any) => h.type === "RAFFLE_RESULT")
      .sort((a: any, b: any) => (b.ts ?? 0) - (a.ts ?? 0));
    const pick = fromHistory[0] ?? null;
    log("pickLatest:fromHistory", {
      count: fromHistory.length,
      picked: pick ? { id: pick.id, ts: pick.ts, roundId: pick.id } : null,
    });
    if (!pick) return null;
    return {
      id: (pick as any).id,
      ts: (pick as any).ts,
      roundId: (pick as any).roundId,
      winner: (pick as any).winner,
      rewardToken: "",
      symbol: "",
      rewardPool: null,
      image: null,
      note: (pick as any).note,
    };
  }, [bundle]);

  // Resolved fields after subgraph fetch
  const [resolvedToken, setResolvedToken] = useState<`0x${string}` | undefined>(undefined);
  const [resolvedPool, setResolvedPool] = useState<string | null | undefined>(undefined);

  // Resolve missing round data if needed (one-shot per latest round)
  useEffect(() => {
    let stop = false;

    async function resolve() {
      if (!baseLatest) {
        log("resolve:skip:noLatest");
        return;
      }
      // If already present on baseLatest, skip fetch (still validate later)
      if (baseLatest.rewardToken && baseLatest.rewardPool) {
        log("resolve:skip:alreadyHaveTokenAndPool", {
          roundId: baseLatest.roundId,
          rewardToken: baseLatest.rewardToken,
          rewardPool: baseLatest.rewardPool,
        });
        setResolvedToken(undefined);
        setResolvedPool(undefined);
        return;
      }

      log("resolve:begin", {
        roundId: baseLatest.roundId,
        haveToken: !!baseLatest.rewardToken,
        havePool: !!baseLatest.rewardPool,
      });

      const meta = await fetchRoundMeta(baseLatest.roundId);
      if (stop || !meta) {
        warn("resolve:noMetaFromSubgraph", { roundId: baseLatest.roundId });
        return;
      }

      setResolvedToken(meta.rewardToken);
      setResolvedPool(meta.rewardPool ?? null);
      log("resolve:done", {
        roundId: baseLatest.roundId,
        rewardToken: meta.rewardToken,
        rewardPool: meta.rewardPool,
      });
    }

    setResolvedToken(undefined);
    setResolvedPool(undefined);
    resolve();

    return () => {
      stop = true;
    };
  }, [baseLatest?.id, baseLatest?.roundId, baseLatest?.rewardToken, baseLatest?.rewardPool]);

  // Decide to open when fresh & unseen
  useEffect(() => {
    if (bundleLoading) {
      log("openDecision:bundleLoading");
      return;
    }
    if (!baseLatest) {
      log("openDecision:noLatest");
      return;
    }

    const nowSec = Math.floor(Date.now() / 1000);
    const fresh = nowSec - baseLatest.ts < ONE_DAY_SEC;
    const alreadySeen = localStorage.getItem(seenKey(baseLatest.id)) === "1";

    log("openDecision:evaluate", {
      nowSec,
      latestTs: baseLatest.ts,
      ageSec: nowSec - baseLatest.ts,
      fresh,
      alreadySeen,
      id: baseLatest.id,
      roundId: baseLatest.roundId,
    });

    if (fresh && !alreadySeen) {
      if (controlled) {
        log("openDecision:controlledOpen");
        onOpenChange?.(true);
      } else {
        log("openDecision:selfOpen");
        setInternalOpen(true);
      }
    }
  }, [bundleLoading, baseLatest?.id, baseLatest?.ts, controlled, onOpenChange]);

  const handleClose = () => {
    if (baseLatest) {
      try {
        localStorage.setItem(seenKey(baseLatest.id), "1");
        log("handleClose:markSeen", { id: baseLatest.id });
      } catch (e) {
        err("handleClose:markSeen:error", e);
      }
    }
    if (controlled) {
      log("handleClose:controlledClose");
      onOpenChange?.(false);
    } else {
      log("handleClose:selfClose");
      setInternalOpen(false);
    }
  };

  if (bundleLoading) {
    log("render:bundleLoading");
    return null;
  }
  if (!baseLatest) {
    log("render:noLatest");
    return null;
  }

  const nowSec = Math.floor(Date.now() / 1000);
  const isFresh = nowSec - baseLatest.ts < ONE_DAY_SEC;
  if (!isFresh) {
    log("render:notFresh", { ageSec: nowSec - baseLatest.ts, threshold: ONE_DAY_SEC });
    return null;
  }

  // Choose token address: prefer resolved (validated), fall back to baseLatest if valid
  const tokenAddr = (() => {
    if (isAddr(resolvedToken)) return resolvedToken.toLowerCase();
    if (isAddr(baseLatest.rewardToken)) return (baseLatest.rewardToken as string).toLowerCase();
    return "";
  })();
  log("tokenAddr:chosen", { base: baseLatest.rewardToken, resolved: resolvedToken, chosen: tokenAddr });

  // Determine display symbol from mapping (or Physical Item Raffle)
  const displaySymbol = ADDRESS_TO_SYMBOL[tokenAddr] ?? PHYSICAL_LABEL;

  // Prize label:
  // - For USDT/Miles → format amount with decimals
  // - For Physical → show label only
  const rewardPool = baseLatest.rewardPool ?? resolvedPool ?? null;
  const prizeLabel =
    displaySymbol === "Physical Item Raffle"
      ? PHYSICAL_LABEL
      : formatPrize(rewardPool, displaySymbol);

  // Pick image based on display symbol
  const imgSrc =
    baseLatest.image ||
    SYMBOL_IMAGE[displaySymbol] ||
    SYMBOL_IMAGE.default;

  log("render:final", {
    id: baseLatest.id,
    roundId: baseLatest.roundId,
    winner: baseLatest.winner,
    tokenAddr,
    displaySymbol,
    rewardPool,
    prizeLabel,
    imgSrcChosen: imgSrc?.slice?.(0, 64) ?? imgSrc,
    isOpen,
  });

  return (
    <Dialog open={isOpen} onOpenChange={(o) => (o ? onOpenChange?.(o) : handleClose())}>
      <DialogContent className="bg-white max-w-sm rounded-3xl p-0 overflow-hidden">
        {/* Banner image: full width, fixed height, cover */}
    
        <div className="text-center px-6 pt-4">
          <DialogHeader>
            <DialogTitle className="text-left text-xl font-medium">
              Latest Reward Result
            </DialogTitle>
          </DialogHeader>
          <div className="w-full h-40">
          <img
            src={imgSrc}
            alt={displaySymbol}
            className="w-full h-full object-cover"
          />
        </div>
          {/* Winner (public) */}
          <p className="text-sm text-gray-500 mt-2">
            Winner: <span className="font-medium">{truncateAddr(baseLatest.winner)}</span>
          </p>

          {/* Details list: Round ID, Amount won / Label, Draw Date */}
          <div className="mt-4 space-y-3 text-left">
            <div className="flex items-center gap-3">
              <TicketIcon className="text-gray-500" size={20} />
              <div>
                <p className="font-medium text-sm">Round ID</p>
                <p className="text-sm text-gray-600">{baseLatest.roundId}</p>
              </div>
            </div>

            <div className="flex items-center gap-3">
              <TicketIcon className="text-gray-500" size={20} />
              <div>
                <p className="font-medium text-sm">Amount won</p>
                <p className="text-sm text-gray-600">{prizeLabel}</p>
              </div>
            </div>

            <div className="flex items-center gap-3">
              <CalendarIcon className="text-gray-500" size={20} />
              <div>
                <p className="font-medium text-sm">Draw Date</p>
                <p className="text-sm text-gray-600">
                  {new Date(baseLatest.ts * 1000).toLocaleDateString(undefined, {
                    month: "short",
                    day: "numeric",
                  })}
                </p>
              </div>
            </div>
          </div>
        </div>

        <DialogFooter className="flex flex-col items-center px-6 my-6">
          <Button
            title="Close"
            onClick={handleClose}
            className="w-full bg-green-100 text-[#238D9D] font-medium"
          >
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
