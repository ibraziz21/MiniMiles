// app/claw/page.tsx
"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  createPublicClient,
  http,
  formatUnits,
} from "viem";
import { celo } from "viem/chains";

import { useWeb3 } from "@/contexts/useWeb3";
import clawAbi    from "@/contexts/akibaClawGame.json";
import milesAbi   from "@/contexts/minimiles.json";
import Image      from "next/image";

import {
  AKIBA_TOKEN_SYMBOL,
  CLAW_GAME_ADDRESS,
  CLAW_USDT_ADDRESS,
  MILES_ADDRESS,
  CLAW_DEPLOY_BLOCK,
  RewardClass,
  SessionStatus,
  type TierConfig,
  type GameSession,
  type ClawVoucher,
  type MachineState,
  TIER_META,
} from "@/lib/clawTypes";
import { Toaster }            from "@/components/ui/sonner";
import { ClawHero }           from "@/components/claw/ClawHero";
import { ClawMachineDisplay } from "@/components/claw/ClawMachineDisplay";
import { ClawActionBanner }   from "@/components/claw/ClawActionBanner";
import { ClawTierSelector }   from "@/components/claw/ClawTierSelector";
import { ClawSessionsList }   from "@/components/claw/ClawSessionsList";
import { ClawInfoSheet }      from "@/components/claw/ClawInfoSheet";
import { VoucherWinSheet }    from "@/components/claw/VoucherWinSheet";
import { Spinner }            from "@phosphor-icons/react";
import { akibaMilesSymbol }   from "@/lib/svg";
import { toast }              from "sonner";

// ── Minimal USDT ABI (ERC20 approve + allowance + balanceOf) ───────────────
const USDT_ABI = [
  {
    inputs: [{ name: "owner", type: "address" }, { name: "spender", type: "address" }],
    name: "allowance",
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [{ name: "account", type: "address" }],
    name: "balanceOf",
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
] as const;

// ── Helpers ────────────────────────────────────────────────────────────────

function getPublicClient() {
  return createPublicClient({ chain: celo, transport: http("https://forno.celo.org") });
}

// ── Page ───────────────────────────────────────────────────────────────────

export default function ClawPage() {
  const { address, getUserAddress, approveClawUsdt, startClawGame, burnClawVoucherReward } = useWeb3();

  // ── State ──────────────────────────────────────────────────────────────
  const [tiers, setTiers]               = useState<(TierConfig | null)[]>([null, null, null]);
  const [selectedTier, setSelectedTier] = useState<number>(0);
  const [milesBalance, setMilesBalance] = useState<bigint>(0n);
  const [usdtBalance, setUsdtBalance]   = useState<bigint>(0n);
  const [usdtAllowance, setUsdtAllowance] = useState<bigint>(0n);
  const [unresolvedCount, setUnresolvedCount] = useState<bigint>(0n);
  const [dailyPlaysCount, setDailyPlaysCount] = useState<bigint>(0n);
  const [lastLegendaryAt, setLastLegendaryAt] = useState<bigint>(0n);
  const [sessions, setSessions]         = useState<GameSession[]>([]);
  const [vouchers, setVouchers]         = useState<ClawVoucher[]>([]);

  // Active session = most recent non-refunded session
  const [activeSession, setActiveSession] = useState<GameSession | null>(null);
  const [machineState, setMachineState]   = useState<MachineState>("idle");

  // UI flags
  const [loading, setLoading]             = useState(true);
  const [starting, setStarting]           = useState(false);
  const [approving, setApproving]         = useState(false);
  const [burning, setBurning]             = useState(false);
  const [sessionsOpen, setSessionsOpen]   = useState(false);
  const [infoOpen, setInfoOpen]           = useState(false);
  const [voucherWinOpen, setVoucherWinOpen] = useState(false);
  const [showConfetti, setShowConfetti]   = useState(false);

  // Prevent double-settle
  const settlingRef = useRef<Set<string>>(new Set());
  const pollRef     = useRef<ReturnType<typeof setInterval> | null>(null);

  // ── Tier / balance load ─────────────────────────────────────────────────
  const loadChainData = useCallback(async () => {
    const pub = getPublicClient();
    const dayBucket = BigInt(Math.floor(Date.now() / 86_400_000));

    // Tier configs
    const tierResults = await Promise.allSettled(
      [0, 1, 2].map(async (id) => {
        const raw = await pub.readContract({
          address: CLAW_GAME_ADDRESS,
          abi: clawAbi.abi,
          functionName: "getTierConfig",
          args: [id],
        }) as any;
        return {
          active:               raw.active,
          tierId:               Number(raw.tierId),
          payInMiles:           raw.payInMiles,
          playCost:             raw.playCost as bigint,
          loseWeight:           Number(raw.loseWeight),
          commonWeight:         Number(raw.commonWeight),
          rareWeight:           Number(raw.rareWeight),
          epicWeight:           Number(raw.epicWeight),
          legendaryWeight:      Number(raw.legendaryWeight),
          commonMilesReward:    raw.commonMilesReward as bigint,
          rareBurnMiles:        raw.rareBurnMiles as bigint,
          epicUsdtReward:       raw.epicUsdtReward as bigint,
          legendaryBurnUsdt:    raw.legendaryBurnUsdt as bigint,
          rareVoucherBps:       Number(raw.rareVoucherBps),
          legendaryVoucherBps:  Number(raw.legendaryVoucherBps),
          legendaryVoucherCap:  raw.legendaryVoucherCap as bigint,
          dailyPlayLimit:       raw.dailyPlayLimit as bigint,
          legendaryCooldown:    raw.legendaryCooldown as bigint,
          defaultMerchantId:    raw.defaultMerchantId as `0x${string}`,
        } as TierConfig;
      })
    );
    setTiers(tierResults.map((r) => (r.status === "fulfilled" ? r.value : null)));

    if (!address) return;

    // Balances + allowance + play guards
    const [rawMiles, rawUsdt, rawAllow, rawUnresolved, rawDailyPlays, rawLastLegendaryAt] = await Promise.all([
      pub.readContract({ address: MILES_ADDRESS, abi: milesAbi.abi, functionName: "balanceOf", args: [address as `0x${string}`] }),
      pub.readContract({ address: CLAW_USDT_ADDRESS, abi: USDT_ABI, functionName: "balanceOf", args: [address as `0x${string}`] }),
      pub.readContract({ address: CLAW_USDT_ADDRESS, abi: USDT_ABI, functionName: "allowance", args: [address as `0x${string}`, CLAW_GAME_ADDRESS] }),
      pub.readContract({ address: CLAW_GAME_ADDRESS, abi: clawAbi.abi, functionName: "unresolvedSessions", args: [address as `0x${string}`] }),
      pub.readContract({ address: CLAW_GAME_ADDRESS, abi: clawAbi.abi, functionName: "dailyPlays", args: [selectedTier, dayBucket] }),
      pub.readContract({ address: CLAW_GAME_ADDRESS, abi: clawAbi.abi, functionName: "lastLegendaryAt", args: [address as `0x${string}`] }),
    ]) as [bigint, bigint, bigint, bigint, bigint, bigint];

    setMilesBalance(rawMiles);
    setUsdtBalance(rawUsdt);
    setUsdtAllowance(rawAllow);
    setUnresolvedCount(rawUnresolved);
    setDailyPlaysCount(rawDailyPlays);
    setLastLegendaryAt(rawLastLegendaryAt);
  }, [address, selectedTier]);

  // ── Session load from logs ──────────────────────────────────────────────
  const loadSessions = useCallback(async () => {
    if (!address) return;
    const pub = getPublicClient();

    try {
      const currentBlock = await pub.getBlockNumber();
      const fromBlock = currentBlock > 50000n ? currentBlock - 50000n : CLAW_DEPLOY_BLOCK;

      let logs: any[] = [];
      try {
        logs = await pub.getLogs({
          address: CLAW_GAME_ADDRESS,
          event: {
            name: "GameStarted",
            type: "event",
            inputs: [
              { indexed: true,  name: "sessionId",    type: "uint256" },
              { indexed: true,  name: "player",       type: "address" },
              { indexed: true,  name: "tierId",       type: "uint8"   },
              { indexed: false, name: "playCost",     type: "uint256" },
              { indexed: false, name: "requestBlock", type: "uint256" },
            ],
          },
          args: { player: address as `0x${string}` },
          fromBlock,
          toBlock: currentBlock,
        });
      } catch {
        logs = await pub.getLogs({
          address: CLAW_GAME_ADDRESS,
          event: {
            name: "GameStarted",
            type: "event",
            inputs: [
              { indexed: true,  name: "sessionId",    type: "uint256" },
              { indexed: true,  name: "player",       type: "address" },
              { indexed: true,  name: "tierId",       type: "uint8"   },
              { indexed: false, name: "playCost",     type: "uint256" },
              { indexed: false, name: "requestBlock", type: "uint256" },
            ],
          },
          fromBlock,
          toBlock: currentBlock,
        });
        logs = logs.filter((l) => (l.args?.player as string)?.toLowerCase() === address.toLowerCase());
      }

      // Hydrate sessions from chain
      const hydrated = await Promise.allSettled(
        logs.map(async (l) => {
          const sessionId = (l.args as any).sessionId as bigint;
          const raw = await pub.readContract({
            address: CLAW_GAME_ADDRESS,
            abi: clawAbi.abi,
            functionName: "getSession",
            args: [sessionId],
          }) as any;
          return {
            sessionId:    raw.sessionId as bigint,
            player:       raw.player as `0x${string}`,
            tierId:       Number(raw.tierId),
            status:       Number(raw.status) as SessionStatus,
            createdAt:    raw.createdAt as bigint,
            settledAt:    raw.settledAt as bigint,
            requestBlock: raw.requestBlock as bigint,
            rewardClass:  Number(raw.rewardClass) as RewardClass,
            rewardAmount: raw.rewardAmount as bigint,
            voucherId:    raw.voucherId as bigint,
          } as GameSession;
        })
      );

      const loaded = hydrated
        .filter((r): r is PromiseFulfilledResult<GameSession> => r.status === "fulfilled")
        .map((r) => r.value)
        .sort((a, b) => Number(b.createdAt - a.createdAt));

      setSessions(loaded);

      // Active session = most recent non-refunded
      const active = loaded.find((s) => s.status !== SessionStatus.Refunded) ?? null;
      setActiveSession(active);

      // Derive machine state
      if (!active) {
        setMachineState("idle");
      } else if (active.status === SessionStatus.Pending) {
        setMachineState("pending");
      } else if (active.status === SessionStatus.Settled) {
        setMachineState("settling");
      } else if (active.status === SessionStatus.Claimed || active.status === SessionStatus.Burned) {
        setMachineState("settled");
      }

      // Auto-settle pending sessions
      for (const s of loaded) {
        if (s.status === SessionStatus.Pending) {
          const key = s.sessionId.toString();
          if (!settlingRef.current.has(key)) {
            settlingRef.current.add(key);
            fetch("/api/claw/settle", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ sessionId: key }),
            }).finally(() => {
              // Will be picked up on next poll
            });
          }
        }
      }

      // Voucher win sheet
      if (active &&
        (active.status === SessionStatus.Settled || active.status === SessionStatus.Claimed) &&
        (active.rewardClass === RewardClass.Rare || active.rewardClass === RewardClass.Legendary)
      ) {
        setVoucherWinOpen(true);
        setShowConfetti(true);
      }

      // Confetti for non-voucher wins too
      if (active &&
        active.status === SessionStatus.Claimed &&
        active.rewardClass !== RewardClass.Lose &&
        active.rewardClass !== RewardClass.None
      ) {
        setShowConfetti(true);
        setTimeout(() => setShowConfetti(false), 3000);
      }
    } catch (e) {
      console.warn("[ClawPage] loadSessions error", e);
    }
  }, [address]);

  // ── Load vouchers ───────────────────────────────────────────────────────
  const loadVouchers = useCallback(async () => {
    if (!address) return;
    try {
      const res = await fetch(`/api/claw/vouchers/user/${address}`);
      if (!res.ok) return;
      const data = await res.json();
      const raw = (data.vouchers ?? []) as any[];
      setVouchers(
        raw.map((v) => ({
          ...v,
          voucherId:  BigInt(v.voucherId),
          maxValue:   BigInt(v.maxValue),
          expiresAt:  BigInt(v.expiresAt),
        }))
      );
    } catch (e) {
      console.warn("[ClawPage] loadVouchers error", e);
    }
  }, [address]);

  // ── Initial load ────────────────────────────────────────────────────────
  useEffect(() => {
    getUserAddress();
  }, [getUserAddress]);

  useEffect(() => {
    setLoading(true);
    Promise.all([loadChainData(), loadSessions(), loadVouchers()]).finally(() =>
      setLoading(false)
    );
  }, [loadChainData, loadSessions, loadVouchers]);

  useEffect(() => {
    const firstActiveTier = tiers.findIndex((tier) => tier?.active);
    if (firstActiveTier === -1) return;
    if (!tiers[selectedTier]?.active) {
      setSelectedTier(firstActiveTier);
    }
  }, [selectedTier, tiers]);

  // ── Polling every 3 seconds ─────────────────────────────────────────────
  useEffect(() => {
    pollRef.current = setInterval(() => {
      loadChainData();
      loadSessions();
      loadVouchers();
    }, 3000);
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [loadChainData, loadSessions, loadVouchers]);

  // ── Derived: selected tier config ───────────────────────────────────────
  const tierConfig = tiers[selectedTier] ?? null;
  const needsApproval =
    tierConfig !== null &&
    !tierConfig.payInMiles &&
    usdtAllowance < tierConfig.playCost;

  const hasEnoughMiles =
    tierConfig === null ||
    !tierConfig.payInMiles ||
    milesBalance >= tierConfig.playCost;

  const hasEnoughUsdt =
    tierConfig === null ||
    tierConfig.payInMiles ||
    usdtBalance >= tierConfig.playCost;

  const nowSec = BigInt(Math.floor(Date.now() / 1000));
  const cooldownEndsAt =
    tierConfig && lastLegendaryAt > 0n
      ? lastLegendaryAt + tierConfig.legendaryCooldown
      : 0n;
  const isLegendaryCooldownActive = cooldownEndsAt > nowSec;

  let startBlocker: string | null = null;
  if (tierConfig && !tierConfig.active) {
    startBlocker = "This tier is not active yet.";
  } else if (unresolvedCount > 0n) {
    startBlocker = "Finish your current claw session before starting another one.";
  } else if (tierConfig && tierConfig.dailyPlayLimit > 0n && dailyPlaysCount >= tierConfig.dailyPlayLimit) {
    startBlocker = "You have reached today's play limit for this tier.";
  } else if (tierConfig && isLegendaryCooldownActive) {
    startBlocker = "Legendary cooldown is still active for your wallet.";
  }

  const urgentCount = sessions.filter(
    (s) => s.status === SessionStatus.Pending || s.status === SessionStatus.Settled
  ).length;

  // ── Approve USDT ────────────────────────────────────────────────────────
  const handleApprove = async () => {
    if (!address || !tierConfig) return;
    setApproving(true);
    try {
      await approveClawUsdt();
      await loadChainData();
    } catch (e: any) {
      console.error("[ClawPage] approve error", e);
    } finally {
      setApproving(false);
    }
  };

  // ── Start game ──────────────────────────────────────────────────────────
  const handleStart = async () => {
    if (!address || !tierConfig) return;
    if (startBlocker) {
      toast.error(startBlocker);
      return;
    }
    setStarting(true);
    setMachineState("starting");
    try {
      await startClawGame(selectedTier);

      setMachineState("pending");

      // Immediately reload sessions and kick settle
      await loadSessions();
    } catch (e: any) {
      console.error("[ClawPage] startGame error", e);
      const message = String(e?.shortMessage || e?.message || "");
      if (message.includes("TierNotActive")) {
        toast.error("This tier is not active yet.");
      } else if (message.includes("TooManyUnresolvedSessions")) {
        toast.error("Finish your current claw session before starting another one.");
      } else if (message.includes("DailyLimitReached")) {
        toast.error("You have reached today's play limit for this tier.");
      } else if (message.includes("LegendaryCooldownActive")) {
        toast.error("Legendary cooldown is still active for your wallet.");
      } else {
        toast.error("startGame reverted. Check the selected tier and your active claw sessions.");
      }
      setMachineState("idle");
    } finally {
      setStarting(false);
    }
  };

  // ── Burn voucher ────────────────────────────────────────────────────────
  const handleBurn = async (sessionId: bigint) => {
    if (!address) return;
    setBurning(true);
    try {
      await burnClawVoucherReward(sessionId);
      setVoucherWinOpen(false);
      await loadSessions();
    } catch (e: any) {
      console.error("[ClawPage] burnVoucher error", e);
    } finally {
      setBurning(false);
    }
  };

  // ── CTA label ───────────────────────────────────────────────────────────
  const ctaLabel = () => {
    if (!address)     return "Connect wallet to play";
    if (needsApproval) return "Approve USDT to play";
    if (startBlocker) return startBlocker;
    if (!hasEnoughMiles && tierConfig?.payInMiles) return `Not enough ${AKIBA_TOKEN_SYMBOL}`;
    if (!hasEnoughUsdt && !tierConfig?.payInMiles) return "Not enough USDT";
    if (starting)     return "Starting…";
    if (!tierConfig)  return "Loading…";

    const cost = tierConfig.payInMiles
      ? `${parseFloat(formatUnits(tierConfig.playCost, 18)).toLocaleString(undefined, { maximumFractionDigits: 0 })} ${AKIBA_TOKEN_SYMBOL}`
      : `$${parseFloat(formatUnits(tierConfig.playCost, 6)).toFixed(2)}`;
    return `Pull the claw · ${cost}`;
  };

  const ctaDisabled =
    !address ||
    starting ||
    approving ||
    !tierConfig ||
    !!startBlocker ||
    (!hasEnoughMiles && tierConfig.payInMiles) ||
    (!hasEnoughUsdt && !tierConfig.payInMiles);

  const tierMeta = TIER_META[selectedTier] ?? TIER_META[0];

  return (
    <main
      className="h-[calc(100dvh-5rem)] overflow-hidden flex flex-col font-sterling"
      style={{
        background: "radial-gradient(ellipse at 50% 10%, rgba(35,141,157,0.18) 0%, white 65%)",
      }}
    >
      <div className="flex flex-col w-full max-w-md mx-auto h-full px-0 pb-3">
        {/* Header */}
        <ClawHero
          urgentCount={urgentCount}
          onSessionsOpen={() => setSessionsOpen(true)}
          onInfoOpen={() => setInfoOpen(true)}
        />

        {/* Balance chips */}
        <div className="flex items-center gap-2 px-4 py-1.5">
          <div
            className={`flex-1 flex items-center gap-1.5 rounded-full px-3 py-1.5 border text-xs font-semibold ${
              tierConfig?.payInMiles && !hasEnoughMiles
                ? "border-red-200 bg-red-50 text-red-500"
                : "border-gray-100 bg-white/70 text-gray-700"
            }`}
          >
            <Image src={akibaMilesSymbol} alt="" width={14} height={14} />
            <span>{parseFloat(formatUnits(milesBalance, 18)).toLocaleString(undefined, { maximumFractionDigits: 0 })} {AKIBA_TOKEN_SYMBOL}</span>
          </div>
          <div
            className={`flex-1 flex items-center gap-1.5 rounded-full px-3 py-1.5 border text-xs font-semibold ${
              !tierConfig?.payInMiles && !hasEnoughUsdt
                ? "border-red-200 bg-red-50 text-red-500"
                : "border-gray-100 bg-white/70 text-gray-700"
            }`}
          >
            <span>💵</span>
            <span>${parseFloat(formatUnits(usdtBalance, 6)).toFixed(2)} USDT</span>
          </div>
        </div>

        {/* Machine */}
        <div className="flex-1 min-h-0 flex flex-col items-center justify-center gap-3 py-2">
          {loading ? (
            <div className="flex flex-col items-center gap-3 py-16">
              <span className="animate-spin inline-flex" style={{ color: "#238D9D" }}><Spinner size={32} /></span>
              <p className="text-sm text-gray-400">Loading claw machine…</p>
            </div>
          ) : (
            <ClawMachineDisplay
              machineState={machineState}
              rewardClass={activeSession?.rewardClass ?? RewardClass.None}
              showConfetti={showConfetti}
            />
          )}
        </div>

        {/* Active session banner */}
        {activeSession &&
          activeSession.status !== SessionStatus.Refunded && (
            <div className="mb-3">
              <ClawActionBanner
                session={activeSession}
                onBurn={handleBurn}
                burning={burning}
              />
            </div>
          )}

        {/* Tier selector */}
        <div className="mb-3">
          <ClawTierSelector
            tiers={tiers}
            selectedTier={selectedTier}
            onSelect={setSelectedTier}
          />
        </div>

        {/* CTA */}
        <div className="px-4">
          {needsApproval ? (
            <button
              onClick={handleApprove}
              disabled={approving || !address}
              className="w-full h-14 rounded-2xl text-white font-bold text-base flex items-center justify-center gap-2 transition-opacity disabled:opacity-60"
              style={{ background: tierMeta.accent }}
            >
              {approving ? <span className="animate-spin inline-flex"><Spinner size={20} /></span> : null}
              Approve USDT to play
            </button>
          ) : (
            <button
              onClick={handleStart}
              disabled={ctaDisabled}
              className="w-full h-14 rounded-2xl text-white font-bold text-base flex items-center justify-center gap-2 transition-all disabled:opacity-50"
              style={{
                background: ctaDisabled
                  ? "#9CA3AF"
                  : `linear-gradient(135deg, ${tierMeta.accent}, ${tierMeta.accent}CC)`,
                boxShadow: ctaDisabled ? "none" : `0 4px 20px ${tierMeta.accent}55`,
              }}
            >
              {starting ? <span className="animate-spin inline-flex"><Spinner size={20} /></span> : null}
              {ctaLabel()}
            </button>
          )}
          {startBlocker ? (
            <p className="mt-2 text-xs text-amber-600">{startBlocker}</p>
          ) : null}
        </div>
      </div>

      {/* Sheets */}
      <ClawSessionsList
        open={sessionsOpen}
        onOpenChange={setSessionsOpen}
        sessions={sessions}
        vouchers={vouchers}
      />

      <ClawInfoSheet
        open={infoOpen}
        onOpenChange={setInfoOpen}
      />

      <VoucherWinSheet
        open={voucherWinOpen}
        onOpenChange={setVoucherWinOpen}
        session={activeSession}
        onKeep={() => setVoucherWinOpen(false)}
        onBurn={() => activeSession && handleBurn(activeSession.sessionId)}
        burning={burning}
      />
      <Toaster richColors position="bottom-center" />
    </main>
  );
}
