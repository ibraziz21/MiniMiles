"use client";

import MiniPointsCard from "@/components/mini-points-card";
import DailyChallenges from "@/components/daily-challenge";
import PartnerQuests from "@/components/partner-quests";
import EarnPartnerQuestSheet from "@/components/earn-partner-quest-sheet";
import SuccessModal from "@/components/success-modal";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { useWeb3 } from "@/contexts/useWeb3";
import React, { useEffect, useMemo, useState } from "react";
import { USDT } from "@/lib/svg";
import Image from "next/image";
import { Sheet, SheetClose, SheetContent, SheetFooter } from "@/components/ui/sheet";
import { ArrowDown, ArrowUp, Download, Gift, Question } from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
import { useRouter } from "next/navigation";
import { formatUnits } from "viem";

export default function EarnPage() {
  // ✅ one call
  const web3 = useWeb3() as any;
  const { address, getUserAddress, getakibaMilesBalance, getUserVaultBalance } = web3;

  const [balance, setBalance] = useState("0");
  const [sheetOpen, setSheetOpen] = useState(false);
  const [vaultHelp, setVaultHelp] = useState(false);
  const [currentDeposit, setCurrentDeposit] = useState<number>(0);
  const [quest, setQuest] = useState<any>(null);
  const [success, setSuccess] = useState(false);
  const [vaultDeposit, setVaultDeposit] = useState<number>(0);
  const [vaultMilesEarned, setVaultMilesEarned] = useState<string | null>(null);
  const [vaultMilesLoading, setVaultMilesLoading] = useState(false);


  const router = useRouter();


  useEffect(() => {
    let aborted = false;
    const load = async () => {
      if (!address) return;
      setVaultMilesLoading(true);
      try {
        const base = process.env.NEXT_PUBLIC_REWARDS_URL!;
        const res = await fetch(`${base}/vault/earned/${address}`, { cache: 'no-store' });
        if (!res.ok) throw new Error(await res.text());
        const { earnedWei } = await res.json();
        const pretty = Number(formatUnits(BigInt(earnedWei ?? '0'), 18))
          .toLocaleString(undefined, { maximumFractionDigits: 4 });
        if (!aborted) setVaultMilesEarned(pretty);
      } catch {
        if (!aborted) setVaultMilesEarned(null);
      } finally {
        if (!aborted) setVaultMilesLoading(false);
      }
    };
    load();
    return () => { aborted = true; };
  }, [address, success]);

  useEffect(() => { getUserAddress?.(); }, [getUserAddress]);
  useEffect(() => {
    const fetchBalance = async () => {
      if (!address) return;
      try {
        const balance = await getUserVaultBalance();
        setCurrentDeposit(balance); // ← number
      } catch (e) { console.log(e); }
    };
    fetchBalance();
  }, [address, getUserVaultBalance]);

  useEffect(() => {
    if (!address) return;
    (async () => {
      const b = await getakibaMilesBalance?.();
      if (b != null) setBalance(b);

      const d = await web3?.getVaultDeposit?.().catch(() => null);
      if (d != null) setVaultDeposit(Number(d));
    })();
  }, [address, getakibaMilesBalance, web3]);

  const openQuest = (q: any) => { setQuest(q); setSheetOpen(true); };

  const goDeposit = () => router.push("/vaults");
  const goWithdraw = () => router.push("/vaults/withdraw");
  const hasDeposit = currentDeposit > 0;

  return (
    <main className="pb-24 font-sterling">
      <div className="px-4 flex flex-col justify-around gap-1 mb-4">
        <h1 className="text-2xl font-medium">Earn</h1>
        <p className="font-poppins">Complete challenges to earn AkibaMiles.</p>
      </div>
      <MiniPointsCard points={Number(balance)} />

      <div className="px-4 ">
        <div className="mt-6 gap-1">
          <div className="flex justify-start items-center my-1">
            <h3 className="text-lg font-medium">Akiba Vault</h3>
            <Question className="mx-1" weight="duotone" color="#238D9D" size={20} onClick={() => setVaultHelp(true)} />
          </div>
          <p className="text-gray-500 mb-1">Deposit USDT to earn akibaMiles daily.</p>
        </div>

        <div className="border border-[#238D9D4D] bg-gradient-to-bl from-[#76E0F020] to-[#F0FDFF] rounded-xl p-4 shadow-lg h-[200px]">
          <div className="flex flex-col justify-center items-center p-5 border border-[#238D9D4D] bg-white rounded-xl h-[100px]">
            <h4 className="text-[#817E7E] font-light">My Deposit(USDT)</h4>
            <div className="flex ">
              <Image src={USDT} alt="" />
              <h3 className="mx-2">{currentDeposit}</h3>
            </div>
            {hasDeposit && (
              <p className="mt-2 text-xs text-[#238D9D] font-semibold">
                {vaultMilesLoading ? '…' : (vaultMilesEarned ?? '0')} AkibaMiles earned
              </p>
            )}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Button
              title="Deposit"
              onClick={goDeposit}
              widthFull
              className="w-full rounded-xl mt-5 py-6 flex items-center justify-center gap-3 font-medium tracking-wide shadow-sm text-white bg-[#238D9D] hover:bg-[#238D9D] disabled:bg-[#238D9D]"
            />
            <Button
              title="Withdraw"
              onClick={goWithdraw}
              widthFull
              disabled={!hasDeposit}
              className="w-full rounded-xl mt-5 py-6 flex items-center justify-center gap-3 font-medium tracking-wide shadow-sm bg-[#238D9D1A] text-[#238D9D]"
            />
          </div>
        </div>

        <Sheet open={vaultHelp} onOpenChange={setVaultHelp}>
          <SheetContent side={"bottom"} className="bg-white flex flex-col justify-between rounded-t-xl">
            <div className="flex gap-3 items-start font-sterling">
              <div className="rounded-full p-2 bg-[#F0FDFF]">
                <ArrowDown width={20} height={20} color="#238D9D" />
              </div>
              <div>
                <h2 className="font-semibold">Deposit USDT</h2>
                <p className="text-[#525252] font-light">Deposit USDT into the Akiba Vault and earn 1 AkibaMile per day for every 1 USDT you hold.</p>
              </div>
            </div>
            <div className="flex gap-3 items-start font-sterling">
              <div className="rounded-full p-2 bg-[#F0FDFF]">
                <Gift width={20} height={20} color="#238D9D" />
              </div>
              <div>
                <h2 className="font-semibold">Earn Rewards</h2>
                <p className="text-[#525252] font-light">AkibaMiles are automatically added to your balance during the daily payout every 24 hours.
                  0.00</p>
              </div>
            </div>
            <div className="flex gap-3 items-start font-sterling">
              <div className="rounded-full p-2 bg-[#F0FDFF]">
                <ArrowUp width={20} height={20} color="#238D9D" />
              </div>
              <div>
                <h2 className="font-semibold">Withdraw Anytime</h2>
                <p className="text-[#525252] font-light">You can withdraw anytime and your miles are yours to keep.</p>
              </div>
            </div>
            <SheetFooter className="mt-8">
              <SheetClose asChild>
                <Button
                  title="Close"
                  widthFull
                  variant="secondary"
                  className="bg-[#238D9D1A] text-[#238D9D] rounded-md py-4 text-bold"
                  onClick={() => setVaultHelp(false)}
                />
              </SheetClose>
            </SheetFooter>
          </SheetContent>
        </Sheet>
      </div>

      {/* Tabs */}
      <Tabs defaultValue="active" className="mt-6 mx-4">
        <div className=" mt-6 gap-1">
          <h3 className="text-lg font-medium mt-6 mb-2">Daily challenges</h3>
          <p className="text-gray-500">Completed a challenge? Click & claim Miles</p>
        </div>
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

        <TabsContent value="active">

          <DailyChallenges showCompleted={false} />
          <PartnerQuests openPopup={(q: any) => { setQuest(q); setSheetOpen(true); }} />
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
      <SuccessModal openSuccess={success} setOpenSuccess={setSuccess} />
    </main>
  );
}
