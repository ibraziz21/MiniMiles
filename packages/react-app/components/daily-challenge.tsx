"use client";

import { Cash, Door, MinimilesSymbol } from "@/lib/svg";
import { claimDailyQuest } from "@/helpers/claimDaily";
import { claimDailyTransfer } from "@/helpers/claimTransfer";
import { claimDailyReceive } from "@/helpers/claimReceive";

import { createClient } from "@supabase/supabase-js";
import { useWeb3 } from "@/contexts/useWeb3";
import QuestLoadingModal, { QuestStatus } from "./quest-loading-modal";
import DailyChallengeSheet from "./daily-challenge-sheet";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "./ui/tabs";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useState } from "react";

/* ───── Supabase ───── */
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_SERVICE_KEY!
);

/* ───── DB row type ───── */
type QuestRow = {
  id: string;
  title: string;
  description: string;
  reward: number;
  is_active: boolean;
};

/* ───── quest-id → { action, icon } ───── */
const ACTION_BY_ID: Record<
  string,
  { action: (addr: string) => Promise<any>; img: any }
> = {
  "a9c68150-7db8-4555-b87f-5e9117b43a08": { action: claimDailyQuest, img: Door },
  "383eaa90-75aa-4592-a783-ad9126e8f04d": { action: claimDailyTransfer, img: Cash },
  "c6b14ae1-66e9-4777-9c9f-65e57b091b16": { action: claimDailyReceive, img: Cash },
};

export default function DailyChallenges() {
  const { address, getUserAddress } = useWeb3();

  const [quests, setQuests] = useState<QuestRow[]>([]);
  const [claimed, setClaimed] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState("active");

  const [modal, setModal] = useState<{
    open: boolean;
    status: QuestStatus;
    msg?: string;
  }>({ open: false, status: "loading" });

  const [selectedQuest, setSelectedQuest] = useState<QuestRow | null>(null);

  useEffect(() => {
    getUserAddress();
  }, [getUserAddress]);

  useEffect(() => {
    const today = new Date().toISOString().slice(0, 10);
    (async () => {
      const { data: qRows } = await supabase
        .from("quests")
        .select("*")
        .eq("is_active", true);
      if (qRows) setQuests(qRows as QuestRow[]);

      if (address) {
        const { data } = await supabase
          .from("daily_engagements")
          .select("quest_id")
          .eq("user_address", address)
          .eq("claimed_at", today);
        if (data) setClaimed(new Set(data.map(r => r.quest_id as string)));
      }
      setLoading(false);
    })();
  }, [address]);

  const activeQuests = quests.filter(q => !claimed.has(q.id));
  const completedQuests = quests.filter(q => claimed.has(q.id));

  const handleQuestClick = async (q: QuestRow) => {
    if (!address) return;
    const map = ACTION_BY_ID[q.id];
    if (!map) return;

    setModal({ open: true, status: "loading" });

    try {
      const res = await map.action(address);

      let status: QuestStatus =
        res.success ? "success" :
        res.code === "already" ? "already" :
        res.code === "ineligible" ? "ineligible" :
        "error";

      setModal({ open: true, status, msg: res.message });

      if (res.success) setClaimed(prev => new Set(prev).add(q.id));
    } catch (err) {
      console.error(err);
      setModal({ open: true, status: "error", msg: "Network/contract error" });
    }
  };

  if (loading) return null;

  return (
    <Tabs defaultValue="active" value={activeTab} onValueChange={setActiveTab} className="mx-3">
      <TabsList>
        <TabsTrigger
          value="active"
          className={`rounded-full font-bold px-4 py-1 ${activeTab === "active"
            ? "text-[#219653] bg-[#66D5754D]"
            : "text-[#8E8B8B] bg-[#EBEBEB]"
          }`}
        >
          Active
        </TabsTrigger>
        <TabsTrigger
          value="completed"
          className={`rounded-full font-bold px-4 py-1 ${activeTab === "completed"
            ? "text-[#219653] bg-[#66D5754D]"
            : "text-[#8E8B8B] bg-[#EBEBEB]"
          }`}
        >
          Completed
        </TabsTrigger>
      </TabsList>

      {/* ───── ACTIVE TAB ───── */}
      <TabsContent value="active">
        <div>
          <div className="flex justify-between items-center">
            <h3 className="text-lg font-bold">Daily challenges</h3>
            <Link href="/earn" className="text-sm text-green-600 hover:underline font-bold">
              See all ›
            </Link>
          </div>

          <QuestGrid quests={activeQuests} onClick={(q) => setSelectedQuest(q)} />
        </div>
      </TabsContent>

      {/* ───── COMPLETED TAB ───── */}
      <TabsContent value="completed">
        <div className="mt-6">
          <div className="flex justify-between items-center">
            <h3 className="text-lg font-bold">Daily challenges</h3>
            <Link href="/earn" className="text-sm text-green-600 hover:underline font-bold">
              See all ›
            </Link>
          </div>

          <QuestGrid quests={completedQuests} onClick={() => { }} disabled />
        </div>
      </TabsContent>

      {/* ───── MODALS / SHEETS ───── */}
      <QuestLoadingModal
        open={modal.open}
        onOpenChange={(o) => setModal((m) => ({ ...m, open: o }))}
        status={modal.status}
        message={modal.msg}
      />

      <DailyChallengeSheet
        open={!!selectedQuest}
        onOpenChange={(open) => {
          if (!open) setSelectedQuest(null);
        }}
        raffle={
          selectedQuest
            ? {
                id: selectedQuest.id,
                description: selectedQuest.title,
                ticketCost: selectedQuest.reward,
              }
            : null
        }
      />
    </Tabs>
  );
}

/* ───── GRID COMPONENT ───── */
function QuestGrid({
  quests,
  onClick,
  disabled = false,
}: {
  quests: QuestRow[];
  onClick: (q: QuestRow) => void;
  disabled?: boolean;
}) {
  if (quests.length === 0) return <p className="mt-4 text-gray-500">No quests available.</p>;

  return (
    <div className="flex space-x-3 overflow-x-auto mt-4">
      {quests.map((q) => {
        const map = ACTION_BY_ID[q.id];
        if (!map) return null;

        return (
          <button
            key={q.id}
            onClick={() => onClick(q)}
            disabled={disabled}
            className={`bg-white border border-[#07955F4D] rounded-xl p-4 min-w-[180px] h-[234px] shadow-xl ${
              disabled ? "opacity-40" : ""
            }`}
          >
            <div className="flex flex-col items-center justify-around h-full text-center">
              <Image src={map.img} alt="" />
              <p className="text-sm font-semibold">{q.title}</p>
              <p className="text-xs text-gray-600 mt-2">{q.description}</p>
              <p className="text-xs mt-3 flex items-center justify-center">
                <Image src={MinimilesSymbol} alt="" className="mr-1" />
                {q.reward} MiniMiles
              </p>
            </div>
          </button>
        );
      })}
    </div>
  );
}
