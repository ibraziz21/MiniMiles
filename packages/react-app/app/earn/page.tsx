"use client";

import MiniPointsCard from "@/components/mini-points-card";
import DailyChallenges from "@/components/daily-challenge";
import PartnerQuests from "@/components/partner-quests";
import EarnPartnerQuestSheet from "@/components/earn-partner-quest-sheet";
import SuccessModal from "@/components/success-modal";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { useWeb3 } from "@/contexts/useWeb3";
import React, { useEffect, useState } from "react";

export default function EarnPage() {
  const { address, getUserAddress, getMiniMilesBalance } = useWeb3();
  const [balance, setBalance] = useState("0");
  const [sheetOpen, setSheetOpen] = useState(false);
  const [quest, setQuest] = useState<any>(null);
  const [success, setSuccess] = useState(false);

  /* wallet + balance */
  useEffect(() => { getUserAddress(); }, [getUserAddress]);
  useEffect(() => {
    if (!address) return;
    (async () => {
      const b = await getMiniMilesBalance();
      setBalance(b);
    })();
  }, [address, getMiniMilesBalance]);

  const openQuest = (q: any) => { setQuest(q); setSheetOpen(true); };

  return (
    <main className="pb-24 font-sterling bg-white">
      <div className="px-4 pt-4">
        <h1 className="text-2xl font-medium">Earn</h1>
        <p className="font-poppins">Complete challenges and quests to earn MiniMiles.</p>
      </div>

      <MiniPointsCard points={Number(balance)} />

      {/* ── Page-level Active / Completed tabs ───────────── */}
      <Tabs defaultValue="active" className="mx-4">
        <TabsList>
          <TabsTrigger
            value="active"
            className="bg-[#EBEBEB] text-[#8E8B8B]
                       data-[state=active]:bg-[#66D5754D]
                       data-[state=active]:text-[#219653]
                       rounded-full font-medium"
          >
            Active
          </TabsTrigger>
          <TabsTrigger
            value="completed"
            className="ml-1 bg-[#EBEBEB] text-[#8E8B8B]
                       data-[state=active]:bg-[#66D5754D]
                       data-[state=active]:text-[#219653]
                       rounded-full font-medium"
          >
            Completed
          </TabsTrigger>
        </TabsList>

        {/* ── ACTIVE tab ─────────────────────────── */}
        <TabsContent value="active">
          {/* Daily (active only) */}
          <h3 className="text-lg font-medium mt-6 mb-2">Daily challenges</h3>
          <DailyChallenges />


          <PartnerQuests openPopup={openQuest} />
        </TabsContent>

        {/* ── COMPLETED tab ──────────────────────── */}
        <TabsContent value="completed">
          <h3 className="text-lg font-medium mt-6 mb-2">Completed today</h3>
          {/* reuse DailyChallenges with flag */}
          <DailyChallenges showCompleted />

          {/* partner quests don’t yet track completion —
              if/when you store partner_engagements, you can
              add a PartnerQuestsCompleted component here */}
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
