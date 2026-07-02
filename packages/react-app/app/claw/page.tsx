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
  MILES_ADDRESS,
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

type BatchStatus = {
  active: boolean;
  batchId: string;
  totalRemaining: string;
  manifestReady: boolean;
};

type IndexedClawSession = {
  sessionId: string;
  player: string;
  tierId: number;
  txHash?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
};

type SettleIssue = {
  sessionId: string;
  retryable: boolean;
};

// ── Helpers ────────────────────────────────────────────────────────────────

function getPublicClient() {
  return createPublicClient({ chain: celo, transport: http("https://forno.celo.org") });
}

function settleRetryDelayMs(attempts: number, retryable: boolean) {
  if (!retryable) return 5 * 60_000;
  if (attempts <= 3) return 3_000;
  return Math.min(60_000, 5_000 * 2 ** Math.min(attempts - 4, 4));
}

// ── Page ───────────────────────────────────────────────────────────────────

export default function ClawPage() {
  const {
    address,
    getUserAddress,
    waitForAuth,
    startClawGame,
    burnClawVoucherReward,
  } = useWeb3();

  // ── State ──────────────────────────────────────────────────────────────
  const [tiers, setTiers]               = useState<(TierConfig | null)[]>([null, null, null]);
  const [selectedTier, setSelectedTier] = useState<number>(0);
  const [milesBalance, setMilesBalance] = useState<bigint>(0n);
  const [unresolvedCount, setUnresolvedCount] = useState<bigint>(0n);
  const [maxUnresolvedPerUser, setMaxUnresolvedPerUser] = useState<bigint>(1n);
  const [dailyPlaysCount, setDailyPlaysCount] = useState<bigint>(0n);
  const [lastLegendaryAt, setLastLegendaryAt] = useState<bigint>(0n);
  const [sessions, setSessions]         = useState<GameSession[]>([]);
  const [vouchers, setVouchers]         = useState<ClawVoucher[]>([]);
  const [batchStatus, setBatchStatus]   = useState<BatchStatus | null>(null);

  // Active session = most recent non-refunded session
  const [activeSession, setActiveSession] = useState<GameSession | null>(null);
  const [machineState, setMachineState]   = useState<MachineState>("idle");

  // UI flags
  const [loading, setLoading]             = useState(true);
  const [starting, setStarting]           = useState(false);
  const [burning, setBurning]             = useState(false);
  const [sessionsOpen, setSessionsOpen]   = useState(false);
  const [infoOpen, setInfoOpen]           = useState(false);
  const [voucherWinOpen, setVoucherWinOpen] = useState(false);
  const [showConfetti, setShowConfetti]   = useState(false);

  // Settle bookkeeping. `settlingRef` is only an in-flight guard (one attempt
  // per session at a time); retry cadence is controlled by `nextSettleAtRef`
  // so a temporarily blocked session keeps recovering without hammering the relayer.
  const settlingRef    = useRef<Set<string>>(new Set());
  const settleAttemptsRef = useRef<Map<string, number>>(new Map());
  const nextSettleAtRef = useRef<Map<string, number>>(new Map());
  const shownVoucherRef = useRef<Set<string>>(new Set());
  const pollRef        = useRef<ReturnType<typeof setInterval> | null>(null);
  const localStartedSessionIdsRef = useRef<Set<string>>(new Set());
  const recoverAttemptedRef = useRef(false);
  const [settleIssue, setSettleIssue] = useState<SettleIssue | null>(null);

  const loadBatchStatus = useCallback(async () => {
    try {
      const res = await fetch("/api/claw/rotate/ensure", { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? "Failed to load claw batch");
      setBatchStatus({
        active: Boolean(data.active),
        batchId: String(data.batchId ?? "0"),
        totalRemaining: String(data.totalRemaining ?? "0"),
        manifestReady: Boolean(data.manifestReady),
      });
      return data;
    } catch (e) {
      console.error("[ClawPage] batch status error", e);
      setBatchStatus(null);
      return null;
    }
  }, []);

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

    // Balances + play guards
    const [
      rawMiles,
      rawUnresolved,
      rawMaxUnresolved,
      rawDailyPlays,
      rawLastLegendaryAt,
    ] = await Promise.all([
      pub.readContract({ address: MILES_ADDRESS, abi: milesAbi.abi, functionName: "balanceOf", args: [address as `0x${string}`] }),
      pub.readContract({ address: CLAW_GAME_ADDRESS, abi: clawAbi.abi, functionName: "unresolvedSessions", args: [address as `0x${string}`] }),
      pub.readContract({ address: CLAW_GAME_ADDRESS, abi: clawAbi.abi, functionName: "maxUnresolvedPerUser" }),
      pub.readContract({ address: CLAW_GAME_ADDRESS, abi: clawAbi.abi, functionName: "dailyPlays", args: [selectedTier, dayBucket] }),
      pub.readContract({ address: CLAW_GAME_ADDRESS, abi: clawAbi.abi, functionName: "lastLegendaryAt", args: [address as `0x${string}`] }),
    ]) as [bigint, bigint, bigint, bigint, bigint];

    setMilesBalance(rawMiles);
    setUnresolvedCount(rawUnresolved);
    setMaxUnresolvedPerUser(rawMaxUnresolved);
    setDailyPlaysCount(rawDailyPlays);
    setLastLegendaryAt(rawLastLegendaryAt);
  }, [address, selectedTier]);

  useEffect(() => {
    localStartedSessionIdsRef.current.clear();
    settlingRef.current.clear();
    settleAttemptsRef.current.clear();
    nextSettleAtRef.current.clear();
    recoverAttemptedRef.current = false;
    setSettleIssue(null);
  }, [address]);

  // ── Session load from local index + direct contract reads ───────────────
  const loadSessions = useCallback(async () => {
    if (!address) return;
    const pub = getPublicClient();

    try {
      let indexedSessions: IndexedClawSession[] = [];
      const localSessionIds = Array.from(localStartedSessionIdsRef.current);

      const loadIndexedSessions = async () => {
        const res = await fetch(`/api/claw/sessions/user/${address}`, { cache: "no-store" });
        if (!res.ok) return [] as IndexedClawSession[];
        const data = await res.json();
        return (data.sessions ?? []) as IndexedClawSession[];
      };

      indexedSessions = await loadIndexedSessions();

      if (unresolvedCount > 0n && !recoverAttemptedRef.current) {
        await waitForAuth();
        const recovery = await fetch("/api/claw/sessions/recover", { method: "POST" }).catch(() => null);
        if (recovery?.ok) {
          recoverAttemptedRef.current = true;
          const data = await recovery.json();
          indexedSessions = (data.sessions ?? []) as IndexedClawSession[];
        } else if (recovery && recovery.status !== 401) {
          recoverAttemptedRef.current = true;
        }
      }

      const sessionIds = Array.from(new Set([
        ...indexedSessions.map((session) => session.sessionId),
        ...localSessionIds,
      ])).filter((sessionId) => sessionId && sessionId !== "0");

      if (sessionIds.length === 0) {
        setSessions([]);
        setActiveSession(null);
        setMachineState("idle");
        return;
      }

      // Hydrate sessions from chain
      const hydrated = await Promise.allSettled(
        sessionIds.map(async (sessionIdStr) => {
          const sessionId = BigInt(sessionIdStr);
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

      // Kick the relayer to settle pending sessions (and claim settled voucher
      // sessions). The backend (/api/claw/settle → settleSession) drives the
      // actual on-chain resolution; here we just trigger it reliably.
      //
      // `settlingRef` guards against firing twice for the same session while a
      // request is in flight. We ALWAYS release it when the attempt finishes.
      // Failed attempts are retried with backoff instead of a permanent cap.
      for (const s of loaded) {
        const needsSettle =
          s.status === SessionStatus.Pending ||
          (s.status === SessionStatus.Settled &&
            (s.rewardClass === RewardClass.Rare || s.rewardClass === RewardClass.Legendary));

        if (!needsSettle) continue;

        const key = s.sessionId.toString();
        if (settlingRef.current.has(key)) continue; // attempt already in flight
        if ((nextSettleAtRef.current.get(key) ?? 0) > Date.now()) continue;

        settlingRef.current.add(key);
        (async () => {
          try {
            await waitForAuth();
            const res = await fetch("/api/claw/settle", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ sessionId: key }),
            });
            const data = await res.json().catch(() => null);
            if (res.ok) {
              settleAttemptsRef.current.delete(key);
              nextSettleAtRef.current.delete(key);
              setSettleIssue((issue) => issue?.sessionId === key ? null : issue);
            } else {
              const attempts = (settleAttemptsRef.current.get(key) ?? 0) + 1;
              const retryable = data?.retryable !== false;
              settleAttemptsRef.current.set(key, attempts);
              nextSettleAtRef.current.set(key, Date.now() + settleRetryDelayMs(attempts, retryable));
              if (attempts >= 3) {
                setSettleIssue({
                  sessionId: key,
                  retryable,
                });
              }
            }
          } catch {
            const attempts = (settleAttemptsRef.current.get(key) ?? 0) + 1;
            settleAttemptsRef.current.set(key, attempts);
            nextSettleAtRef.current.set(key, Date.now() + settleRetryDelayMs(attempts, true));
            if (attempts >= 3) {
              setSettleIssue({
                sessionId: key,
                retryable: true,
              });
            }
          } finally {
            // Release the in-flight guard so the next poll can retry if needed.
            settlingRef.current.delete(key);
          }
        })();
      }

      // Voucher win sheet — show once per session
      if (active &&
        (active.status === SessionStatus.Settled || active.status === SessionStatus.Claimed) &&
        (active.rewardClass === RewardClass.Rare || active.rewardClass === RewardClass.Legendary)
      ) {
        const key = active.sessionId.toString();
        if (!shownVoucherRef.current.has(key)) {
          shownVoucherRef.current.add(key);
          setVoucherWinOpen(true);
          setShowConfetti(true);
        }
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
  }, [address, unresolvedCount, waitForAuth]);

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

  // Initial load — show the full-screen loader only ONCE per connected address.
  // Ongoing refreshes are handled by the 3s poller below, so starting a game
  // (which changes unresolvedCount and rebuilds the load callbacks) must not
  // flip `loading` and remount/reset the claw machine graphic.
  useEffect(() => {
    let active = true;
    setLoading(true);
    Promise.all([loadChainData(), loadSessions(), loadVouchers(), loadBatchStatus()]).finally(() => {
      if (active) setLoading(false);
    });
    return () => { active = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [address]);

  useEffect(() => {
    const firstActiveTier = tiers.findIndex((tier) => tier?.active && tier.payInMiles);
    if (firstActiveTier === -1) return;
    if (!tiers[selectedTier]?.active || !tiers[selectedTier]?.payInMiles) {
      setSelectedTier(firstActiveTier);
    }
  }, [selectedTier, tiers]);

  // ── Polling every 3 seconds ─────────────────────────────────────────────
  useEffect(() => {
    pollRef.current = setInterval(() => {
      loadChainData();
      loadSessions();
      loadVouchers();
      loadBatchStatus();
    }, 3000);
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [loadChainData, loadSessions, loadVouchers, loadBatchStatus]);

  // ── Derived: selected tier config ───────────────────────────────────────
  const tierConfig = tiers[selectedTier] ?? null;

  const hasEnoughMiles =
    tierConfig === null ||
    (tierConfig.payInMiles && milesBalance >= tierConfig.playCost);

  const nowSec = BigInt(Math.floor(Date.now() / 1000));
  const cooldownEndsAt =
    tierConfig && lastLegendaryAt > 0n
      ? lastLegendaryAt + tierConfig.legendaryCooldown
      : 0n;
  const isLegendaryCooldownActive = cooldownEndsAt > nowSec;

  let startBlocker: string | null = null;
  if (!batchStatus) {
    startBlocker = "Checking claw batch...";
  } else if (!batchStatus.active || BigInt(batchStatus.totalRemaining) === 0n || !batchStatus.manifestReady) {
    startBlocker = "The claw batch is being prepared.";
  } else if (tierConfig && !tierConfig.active) {
    startBlocker = "This tier is not active yet.";
  } else if (tierConfig && !tierConfig.payInMiles) {
    startBlocker = "This tier is not available for Miles play.";
  } else if (unresolvedCount >= maxUnresolvedPerUser) {
    startBlocker = "Finish your current claw session before starting another one.";
  } else if (tierConfig && tierConfig.dailyPlayLimit > 0n && dailyPlaysCount >= tierConfig.dailyPlayLimit) {
    startBlocker = "You have reached today's play limit for this tier.";
  } else if (tierConfig && isLegendaryCooldownActive) {
    startBlocker = "Legendary cooldown is still active for your wallet.";
  }

  const urgentCount = sessions.filter(
    (s) => s.status === SessionStatus.Pending || s.status === SessionStatus.Settled
  ).length;

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
      const latestBatch = await loadBatchStatus();
      if (
        !latestBatch?.active ||
        BigInt(String(latestBatch?.totalRemaining ?? "0")) === 0n ||
        !latestBatch?.manifestReady
      ) {
        toast.error("The claw batch is being prepared.");
        setMachineState("idle");
        return;
      }

      await waitForAuth();
      const started = await startClawGame(selectedTier);
      const sessionId =
        typeof started === "object" && started && "sessionId" in started
          ? started.sessionId
          : null;
      if (sessionId) {
        localStartedSessionIdsRef.current.add(sessionId);
      }

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
  const ctaLabel = (): React.ReactNode => {
    if (!address)     return "Connect wallet to play";
    if (startBlocker) return startBlocker;
    if (!hasEnoughMiles) return `Not enough ${AKIBA_TOKEN_SYMBOL}`;
    if (starting)     return "Starting…";
    if (!tierConfig)  return "Loading…";

    const cost = parseFloat(formatUnits(tierConfig.playCost, 18)).toLocaleString(undefined, { maximumFractionDigits: 0 });
    return (
      <span className="inline-flex items-center gap-1">
        Pull the claw ·
        <Image src={akibaMilesSymbol} alt="" width={16} height={16} className="inline-block" />
        {cost}
      </span>
    );
  };

  const ctaDisabled =
    !address ||
    starting ||
    !tierConfig ||
    !!startBlocker ||
    !hasEnoughMiles;

  const tierMeta = TIER_META[selectedTier] ?? TIER_META[0];
  const activeSettleIssue =
    activeSession && settleIssue?.sessionId === activeSession.sessionId.toString()
      ? settleIssue
      : null;
  const activeSettleStatusText =
    activeSession?.status === SessionStatus.Settled
      ? "Voucher issuance is taking longer than usual. Retrying automatically."
      : "Prize reveal is taking longer than usual. Retrying automatically.";
  const retryActiveSettlement = () => {
    if (!activeSession) return;
    const key = activeSession.sessionId.toString();
    nextSettleAtRef.current.delete(key);
    setSettleIssue(null);
    void loadSessions();
  };

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
          hasActiveSession={!!activeSession && activeSession.status !== SessionStatus.Refunded}
          onSessionsOpen={() => setSessionsOpen(true)}
          onInfoOpen={() => setInfoOpen(true)}
        />

        {/* Balance chip */}
        <div className="flex items-center gap-2 px-4 py-1.5">
          <div
            className={`flex w-full items-center gap-1.5 rounded-full px-3 py-1.5 border text-xs font-semibold ${
              !hasEnoughMiles
                ? "border-red-200 bg-red-50 text-red-500"
                : "border-gray-100 bg-white/70 text-gray-700"
            }`}
          >
            <Image src={akibaMilesSymbol} alt="" width={14} height={14} />
            <span>{parseFloat(formatUnits(milesBalance, 18)).toLocaleString(undefined, { maximumFractionDigits: 0 })}</span>
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

        {/* Active session banner — in-progress states only */}
        {activeSession &&
          activeSession.status !== SessionStatus.Refunded && (
            <div className="mb-3">
              <ClawActionBanner session={activeSession} />
              {activeSettleIssue ? (
                <div className="px-4 pt-2">
                  <div className="flex items-center justify-between gap-3 rounded-2xl border border-amber-200 bg-amber-50 px-3.5 py-2.5">
                    <p className="text-xs font-semibold text-amber-700">
                      {activeSettleIssue.retryable
                        ? activeSettleStatusText
                        : "This session needs a support retry."}
                    </p>
                    <button
                      type="button"
                      onClick={retryActiveSettlement}
                      className="shrink-0 rounded-full bg-white px-3 py-1 text-xs font-bold text-amber-700 shadow-sm"
                    >
                      Retry now
                    </button>
                  </div>
                </div>
              ) : null}
            </div>
          )}

        {/* Tier selector — AkibaMiles tiers only */}
        <div className="mb-3">
          <ClawTierSelector
            tiers={tiers}
            selectedTier={selectedTier}
            onSelect={setSelectedTier}
          />
        </div>

        {/* CTA */}
        <div className="px-4">
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
        onKeep={() => {
          if (activeSession) shownVoucherRef.current.add(activeSession.sessionId.toString());
          setVoucherWinOpen(false);
        }}
        onBurn={() => activeSession && handleBurn(activeSession.sessionId)}
        burning={burning}
      />
      <Toaster richColors position="bottom-center" />
    </main>
  );
}
