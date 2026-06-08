"use client";

import MiniPointsCard from "@/components/mini-points-card";
import DailyChallenges from "@/components/daily-challenge";
import PartnerQuests from "@/components/partner-quests";
import EarnPartnerQuestSheet from "@/components/earn-partner-quest-sheet";
import SuccessModal from "@/components/success-modal";
import VerifiedInsights from "@/components/verified-insights";
import PollSheet from "@/components/poll-sheet";
import { BadgesSection } from "@/components/BadgesSection";
import {
  BadgeClaimLoadingSheet,
  BadgeClaimSuccessSheet,
} from "@/components/BadgeClaimSuccessSheet";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Sheet, SheetClose, SheetContent, SheetFooter } from "@/components/ui/sheet";
import { useWeb3 } from "@/contexts/useWeb3";
import { usdtSymbol, RefreshSvg } from "@/lib/svg";
import { ArrowDown, ArrowUp, Gift, Question } from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
import Image from "next/image";
import { useRouter } from "next/navigation";
import React, { useEffect, useState } from "react";
import { useIsMiniPay } from "@/hooks/useIsMiniPay";
import { fetchSuperAccountForOwner } from "@/lib/prosperity-pass";
import {
  BADGES,
  type BadgeProgress,
  type BadgeKey,
  EMPTY_BADGE_PROGRESS,
} from "@/lib/prosperityBadges";

type PassportState =
  | { status: "idle" | "loading" | "none" }
  | { status: "has"; safe: `0x${string}` };

type BackendBadge = {
  badgeId: string;
  badgeTiers: any[];
  tier: number;
  claimableTier: number | null;
  claimable: boolean;
};

const BADGE_ID_BY_KEY: Record<BadgeKey, number | null> = {
  "cel2-transactions": 18,
  "s1-transactions": 22,
  "lam-lifetime-akiba": 27,
  "amg-akiba-games": 30,
};

export default function EarnPage() {
  const web3 = useWeb3() as any;
  const { address, getUserAddress, getakibaMilesBalance, getUserVaultBalance } = web3;
  const [balance, setBalance] = useState("0");
  const [sheetOpen, setSheetOpen] = useState(false);
  const [vaultHelp, setVaultHelp] = useState(false);
  const [currentDeposit, setCurrentDeposit] = useState<number>(0);
  const [quest, setQuest] = useState<any>(null);
  const [success, setSuccess] = useState(false);
  const [vaultMilesEarned, setVaultMilesEarned] = useState<string | null>(null);
  const [vaultMilesLoading, setVaultMilesLoading] = useState(false);
  const isMiniPay = useIsMiniPay();
  const showVault = isMiniPay === false;

  const router = useRouter();

  // Pass Badges state
  const [passport, setPassport] = useState<PassportState>({ status: "idle" });
  const [badgeProgress, setBadgeProgress] = useState<BadgeProgress>(EMPTY_BADGE_PROGRESS);
  const [hasClaimableBadges, setHasClaimableBadges] = useState(false);
  const [badgeAction, setBadgeAction] = useState<"idle" | "claiming">("idle");
  const [badgeClaimLoadingOpen, setBadgeClaimLoadingOpen] = useState(false);
  const [badgeSheetOpen, setBadgeSheetOpen] = useState(false);
  const [unlockedBadges, setUnlockedBadges] = useState<string[]>([]);
  const badgeBusy = badgeAction !== "idle";
  const claimDisabled = badgeBusy || !hasClaimableBadges;

  // Verified Insights state
  const [activePollId, setActivePollId] = useState<string | null>(null);
  const [pollSheetOpen, setPollSheetOpen] = useState(false);
  const [pollRefreshKey, setPollRefreshKey] = useState(0);

  /* wallet + balance */
  useEffect(() => { getUserAddress?.(); }, [getUserAddress]);

  useEffect(() => {
    let cancelled = false;

    const loadVaultMiles = async () => {
      if (!showVault || !address) {
        if (!cancelled) setVaultMilesEarned(null);
        return;
      }

      setVaultMilesLoading(true);
      try {
        const res = await fetch("/api/vault/position", { cache: "no-store" });
        if (!res.ok) throw new Error(await res.text());
        const { lifetimeMilesEarned } = await res.json();
        const pretty = Number(lifetimeMilesEarned ?? 0).toLocaleString(
          undefined,
          { maximumFractionDigits: 0 }
        );
        if (!cancelled) setVaultMilesEarned(pretty);
      } catch {
        if (!cancelled) setVaultMilesEarned(null);
      } finally {
        if (!cancelled) setVaultMilesLoading(false);
      }
    };

    loadVaultMiles();
    return () => {
      cancelled = true;
    };
  }, [address, success, showVault]);

  useEffect(() => {
    if (!address) return;
    (async () => {
      const b = await getakibaMilesBalance();
      setBalance(b);
    })();
  }, [address, getakibaMilesBalance]);

  useEffect(() => {
    const fetchVaultBalance = async () => {
      if (!showVault || !address || !getUserVaultBalance) return;
      try {
        const vaultBalance = await getUserVaultBalance();
        setCurrentDeposit(Number(vaultBalance));
      } catch (e) {
        console.error(e);
      }
    };

    fetchVaultBalance();
  }, [address, getUserVaultBalance, showVault]);

  // passport + badge fetch
  useEffect(() => {
    if (!address) { setPassport({ status: "none" }); return; }
    let cancelled = false;
    setPassport({ status: "loading" });
    (async () => {
      try {
        const result: any = await fetchSuperAccountForOwner(address);
        if (cancelled) return;
        const safe = result?.hasPassport && result?.account?.smartAccount
          ? (result.account.smartAccount as `0x${string}`) : null;
        if (!safe) { setPassport({ status: "none" }); return; }
        setPassport({ status: "has", safe });

        const base = process.env.NEXT_PUBLIC_BADGES_API_BASE ?? "";
        const res = await fetch(`${base}/api/user/${safe}`, { cache: "no-store" });
        if (!res.ok || cancelled) return;
        const data = await res.json();
        const backendBadges: BackendBadge[] = data.currentBadges ?? [];
        const trackedIds = new Set(Object.values(BADGE_ID_BY_KEY).filter((id): id is number => id != null));
        setHasClaimableBadges(backendBadges.some(b =>
          trackedIds.has(Number(b.badgeId)) && b.claimable && (b.claimableTier ?? 0) > (b.tier ?? 0)
        ));
      } catch { if (!cancelled) setPassport({ status: "none" }); }
    })();
    return () => { cancelled = true; };
  }, [address]);

  async function claimBadges(safe: `0x${string}`) {
    setBadgeAction("claiming");
    setBadgeClaimLoadingOpen(true);
    try {
      const base = process.env.NEXT_PUBLIC_BADGES_API_BASE ?? "";
      const res = await fetch(`${base}/api/user/${safe}`, {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({}),
      });
      if (!res.ok) return;
      const data = await res.json();
      const updates: any[] = Array.isArray(data?.badgeUpdates) ? data.badgeUpdates : [];
      const newlyUnlocked: string[] = [];
      updates.forEach((u) => {
        const key = (Object.keys(BADGE_ID_BY_KEY) as BadgeKey[]).find(k => BADGE_ID_BY_KEY[k] === Number(u.badgeId));
        const def = key ? BADGES.find(b => b.key === key) : null;
        if (!def) return;
        for (let lvl = Number(u.previousLevel ?? 0) + 1; lvl <= Number(u.level ?? 0) && lvl <= def.tiers.length; lvl++) {
          newlyUnlocked.push(`${def.title} • ${def.tiers[lvl - 1].label}`);
        }
      });
      setUnlockedBadges(newlyUnlocked);
      if (newlyUnlocked.length > 0) setBadgeSheetOpen(true);
    } catch {} finally {
      setBadgeClaimLoadingOpen(false);
      setBadgeAction("idle");
    }
  }

  const openQuest = (q: any) => { setQuest(q); setSheetOpen(true); };
  const goDeposit = () => router.push("/vaults");
  const goWithdraw = () => router.push("/vaults/withdraw");
  const hasDeposit = currentDeposit > 0;

  const handleOpenPoll = (pollId: string) => {
    setActivePollId(pollId);
    setPollSheetOpen(true);
  };

  const handlePollSuccess = (rewardPoints: number) => {
    // Refresh poll list so completion state updates
    setPollRefreshKey((k) => k + 1);
    if (rewardPoints > 0) {
      // Reuse the existing success modal
      setSuccess(true);
    }
  };

  return (
    <main className="pb-24 font-sterling">
      <div className="px-4 flex flex-col justify-around gap-1 mb-4">
        <h1 className="text-2xl font-medium">Earn</h1>
        <p className="font-poppins">Complete challenges to earn AkibaMiles.</p>
      </div>
      <MiniPointsCard points={Number(balance)} />

      {showVault && (
      <div className="px-4">
        <div className="mt-6 gap-1">
          <div className="flex items-center justify-start my-1">
            <h3 className="text-lg font-medium">Akiba Vault</h3>
            <button
              type="button"
              className="mx-1"
              onClick={() => setVaultHelp(true)}
              aria-label="Open vault help"
            >
              <Question weight="duotone" color="#238D9D" size={20} />
            </button>
          </div>
          <p className="mb-1 text-gray-500">Deposit USDT to earn akibaMiles daily.</p>
        </div>

        <div className="h-[200px] rounded-xl border border-[#238D9D4D] bg-gradient-to-bl from-[#76E0F020] to-[#F0FDFF] p-4 shadow-lg">
          <div className="flex h-[100px] flex-col items-center justify-center rounded-xl border border-[#238D9D4D] bg-white p-5">
            <h4 className="font-light text-[#817E7E]">My Deposit(USDT)</h4>
            <div className="flex">
              <Image src={usdtSymbol} alt="USDT" />
              <h3 className="mx-2">{currentDeposit.toFixed(2)}</h3>
            </div>
            {hasDeposit && (
              <p className="mt-2 text-xs font-semibold text-[#238D9D]">
                {vaultMilesLoading ? "..." : (vaultMilesEarned ?? "0")} AkibaMiles earned
              </p>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Button
              title="Deposit"
              onClick={goDeposit}
              widthFull
              className="mt-5 flex w-full items-center justify-center gap-3 rounded-xl bg-[#238D9D] py-6 font-medium tracking-wide text-white shadow-sm hover:bg-[#238D9D] disabled:bg-[#238D9D]"
            />
            <Button
              title="Withdraw"
              onClick={goWithdraw}
              widthFull
              disabled={!hasDeposit}
              className="mt-5 flex w-full items-center justify-center gap-3 rounded-xl bg-[#238D9D1A] py-6 font-medium tracking-wide text-[#238D9D] shadow-sm"
            />
          </div>
        </div>

        <Sheet open={vaultHelp} onOpenChange={setVaultHelp}>
          <SheetContent side="bottom" className="flex flex-col justify-between rounded-t-xl bg-white">
            <div className="flex items-start gap-3 font-sterling">
              <div className="rounded-full bg-[#F0FDFF] p-2">
                <ArrowDown size={20} color="#238D9D" />
              </div>
              <div>
                <h2 className="font-semibold">Deposit USDT</h2>
                <p className="font-light text-[#525252]">
                  Deposit USDT into the Akiba Vault and earn 1 AkibaMile per day for every 1 USDT you hold.
                </p>
              </div>
            </div>
            <div className="flex items-start gap-3 font-sterling">
              <div className="rounded-full bg-[#F0FDFF] p-2">
                <Gift size={20} color="#238D9D" />
              </div>
              <div>
                <h2 className="font-semibold">Earn Rewards</h2>
                <p className="font-light text-[#525252]">
                  AkibaMiles are automatically added to your balance during the daily payout every 24 hours.
                </p>
              </div>
            </div>
            <div className="flex items-start gap-3 font-sterling">
              <div className="rounded-full bg-[#F0FDFF] p-2">
                <ArrowUp size={20} color="#238D9D" />
              </div>
              <div>
                <h2 className="font-semibold">Withdraw Anytime</h2>
                <p className="font-light text-[#525252]">
                  You can withdraw anytime and your miles are yours to keep.
                </p>
              </div>
            </div>
            <SheetFooter className="mt-8">
              <SheetClose asChild>
                <Button
                  title="Close"
                  widthFull
                  variant="secondary"
                  className="rounded-md bg-[#238D9D1A] py-4 font-bold text-[#238D9D]"
                  onClick={() => setVaultHelp(false)}
                />
              </SheetClose>
            </SheetFooter>
          </SheetContent>
        </Sheet>
      </div>
      )}

      <Tabs defaultValue="active" className="mt-6 mx-4">
        <TabsList>
          <TabsTrigger
            value="active"
            className="bg-[#EBEBEB] text-[#8E8B8B]
                       data-[state=active]:bg-[#ADF4FF80]
                       data-[state=active]:text-[#238D9D]
                       rounded-full font-medium"
          >
            Active
          </TabsTrigger>
          <TabsTrigger
            value="completed"
            className="ml-1 bg-[#EBEBEB] text-[#8E8B8B]
                       data-[state=active]:bg-[#ADF4FF80]
                       data-[state=active]:text-[#238D9D]
                       rounded-full font-medium"
          >
            Completed
          </TabsTrigger>
        </TabsList>

        {/* -- ACTIVE tab --------------------------─ */}
        <TabsContent value="active">
          <div className=" mt-6 gap-1">
            <h3 className="text-lg font-medium mt-6 mb-2">Daily challenges</h3>
            <p className="text-gray-500">Completed a challenge? Click & claim Miles</p>
          </div>
          <DailyChallenges showCompleted={false} />
          <PartnerQuests openPopup={openQuest} />

          {/* ── Verified Insights ───────────────────── */}
          <VerifiedInsights
            onOpenPoll={handleOpenPoll}
            refreshKey={pollRefreshKey}
          />

          {/* ── Pass Badges ──────────────────────────── */}
          <div className="mt-6">
            <div className="flex justify-between items-center mb-2">
              <h3 className="text-lg font-medium">Pass Badges</h3>
              {passport.status === "has" && (
                <button
                  type="button"
                  className="flex items-center"
                  disabled={claimDisabled}
                  onClick={() => passport.status === "has" && claimBadges(passport.safe)}
                >
                  <span className={["text-sm font-medium", claimDisabled ? "text-gray-400 cursor-not-allowed" : "text-[#238D9D] hover:underline"].join(" ")}>
                    {badgeAction === "claiming" ? "Claiming…" : "Claim Badges"}
                  </span>
                  {!claimDisabled && (
                    <span className={`ml-1 inline-flex ${badgeBusy ? "animate-spin" : ""}`}>
                      <Image src={RefreshSvg} alt="" width={24} height={24} className="w-6 h-6" />
                    </span>
                  )}
                </button>
              )}
            </div>
            {passport.status === "loading" && (
              <div className="space-y-3 animate-pulse">
                <div className="h-10 rounded-lg bg-gray-100" />
                <div className="h-10 rounded-lg bg-gray-100" />
              </div>
            )}
            {passport.status === "none" && (
              <p className="text-sm text-gray-500">Get Prosperity Pass to unlock badges.</p>
            )}
            {passport.status === "has" && <BadgesSection progress={badgeProgress} />}
          </div>
        </TabsContent>

        <TabsContent value="completed">
          <h3 className="text-lg font-medium mt-6 mb-2">Completed today</h3>
          <DailyChallenges showCompleted={true} />
        </TabsContent>
      </Tabs>

      {/* sheets / modals */}
      <EarnPartnerQuestSheet
        open={sheetOpen}
        onOpenChange={setSheetOpen}
        quest={quest}
        setOpenSuccess={setSuccess}
      />
      <PollSheet
        pollId={activePollId}
        open={pollSheetOpen}
        onOpenChange={setPollSheetOpen}
        onSuccess={handlePollSuccess}
      />
      <SuccessModal openSuccess={success} setOpenSuccess={setSuccess} />
      <BadgeClaimLoadingSheet open={badgeClaimLoadingOpen} onOpenChange={setBadgeClaimLoadingOpen} />
      <BadgeClaimSuccessSheet open={badgeSheetOpen} onOpenChange={setBadgeSheetOpen} unlocked={unlockedBadges} />
    </main>
  );
}
