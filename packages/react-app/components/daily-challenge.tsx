"use client";

import {
  claimDailyQuest,
} from "@/helpers/claimDaily";
import {
  claimDailyTransfer,
} from "@/helpers/claimTransfer";
import {
  claimDailyReceive,
} from "@/helpers/claimReceive";


import { Cash, Door, MinimilesSymbol } from "@/lib/svg";
// import { supabase } from "@/lib/supabaseClient";
import QuestLoadingModal, { QuestStatus } from "./quest-loading-modal";
import { useWeb3 } from "@/contexts/useWeb3";
import { useEffect, useMemo, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { createClient } from "@supabase/supabase-js";
import DailyChallengeSheet from "./daily-challenge-sheet";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "./ui/tabs";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_SERVICE_KEY!
);

type QuestRow = {
  id: string;
  title: string;
  description: string;
  reward_points: number;
  is_active: boolean;
};

const ACTION_BY_ID: Record<string, { action: (addr: string) => Promise<any>; img: any }> = {
  "a9c68150-7db8-4555-b87f-5e9117b43a08": { action: claimDailyQuest, img: Door },
  "383eaa90-75aa-4592-a783-ad9126e8f04d": { action: claimDailyTransfer, img: Cash },
  "c6b14ae1-66e9-4777-9c9f-65e57b091b16": { action: claimDailyReceive, img: Cash },
};

export default function DailyChallenges() {
  const { address, getUserAddress } = useWeb3();

  // raw quests from DB
  const [allQuests, setAllQuests] = useState<QuestRow[]>([]);
  // after filtering by whether claimed today
  const [activeQuests, setActiveQuests] = useState<QuestRow[]>([]);
  const [completedQuests, setCompletedQuests] = useState<QuestRow[]>([]);

  const [loadingQuests, setLoadingQuests] = useState(true);

  // modal
  const [modalOpen, setModalOpen] = useState(false);
  const [modalStatus, setStatus] = useState<QuestStatus>("loading");
  const [modalMsg, setMsg] = useState<string>();

  // 1. load wallet
  useEffect(() => {
    getUserAddress();
  }, [getUserAddress]);

  // 2. fetch quests
  useEffect(() => {
    async function fetchQuests() {
      const { data, error } = await supabase
        .from("quests")
        .select("*")
        .eq("is_active", true);

      if (error) {
        console.error("Supabase fetch error:", error);
      } else {
        setAllQuests(data as QuestRow[]);
      }
      setLoadingQuests(false);
    }
    fetchQuests();
  }, []);

  // 3. once we have address & allQuests, fetch today's engagements
  useEffect(() => {
    if (!address || allQuests.length === 0) return;

    async function splitByClaimed() {
      const today = new Date().toISOString().slice(0, 10);
      const { data: engagements, error } = await supabase
        .from("daily_engagements")
        .select("quest_id")
        .eq("user_address", address)
        .eq("claimed_at", today);

      if (error) {
        console.error("Error fetching engagements:", error);
        // fallback: treat all as active
        setActiveQuests(allQuests);
        setCompletedQuests([]);
        return;
      }

      const claimedIds = new Set(engagements?.map((e) => e.quest_id));

      setActiveQuests(allQuests.filter((q) => !claimedIds.has(q.id)));
      setCompletedQuests(allQuests.filter((q) => claimedIds.has(q.id)));
    }

    splitByClaimed();
  }, [address, allQuests]);

  const handleQuestClick = async (quest: QuestRow) => {
    if (!address) return;

    const mapping = ACTION_BY_ID[quest.id];
    if (!mapping) return;

    setModalOpen(true);
    setStatus("loading");
    setMsg(undefined);

    try {
      const res = await mapping.action(address);
      if (res.success) setStatus("success");
      else if (res.code === "already") setStatus("already");
      else setStatus("error");
      setMsg(res.message);
      // after success, move quest to completed tab
      if (res.success) {
        setActiveQuests((cur) => cur.filter((q) => q.id !== quest.id));
        setCompletedQuests((cur) => [...cur, quest]);
      }
    } catch (err) {
      console.error(err);
      setStatus("error");
      setMsg("Network or contract error");
    }
  };

  if (loadingQuests) return null;

  return (
    <Tabs defaultValue="active" className="mx-3">
      <TabsList>
        <TabsTrigger value="active" className=" bg-[#EBEBEB] text-[#8E8B8B]   
      data-[state=active]:bg-[#66D5754D]   
      data-[state=active]:text-[#219653]  
      rounded-full font-bold">
          Active
        </TabsTrigger>
        <TabsTrigger value="completed" className="      bg-[#EBEBEB] text-[#8E8B8B]
      data-[state=active]:bg-[#66D5754D]
      data-[state=active]:text-[#219653]
      ml-1 rounded-full font-bold">
          Completed
        </TabsTrigger>
      </TabsList>

      {/* Active Quests */}
      <TabsContent value="active">
        <div className="mt-6">
          <div className="flex justify-between items-center mb-4">
            <h3 className="text-lg font-bold">Daily challenges</h3>
            <Link href="/earn" className="text-sm text-green-600 hover:underline font-bold">
              See all ›
            </Link>
          </div>
          <div className="flex space-x-3 overflow-x-auto">
            {activeQuests.map((q) => {
              const map = ACTION_BY_ID[q.id];
              if (!map) return null;

              return (
                <button
                  key={q.id}
                  onClick={() => handleQuestClick(q)}
                  className="bg-white border border-[#07955F4D] rounded-xl p-4 min-w-[180px] h-[234px] focus:outline-none shadow-xl"
                >
                  <div className="flex flex-col items-center justify-around h-full text-center">
                    <Image src={map.img} alt="" />
                    <p className="text-sm font-semibold">{q.title}</p>
                    <p className="text-xs text-gray-600 mt-2">{q.description}</p>
                    <p className="text-xs mt-3 flex items-center justify-center">
                      <Image src={MinimilesSymbol} alt="" className="mr-1" />
                      {q.reward_points} MiniMiles
                    </p>
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      </TabsContent>

      {/* Completed Quests */}
      <TabsContent value="completed">
        <div className="mt-6">
          <h3 className="text-lg font-bold mb-4">Completed today</h3>
          <div className="flex space-x-3 overflow-x-auto">
            {completedQuests.length ? (
              completedQuests.map((q) => (
                <div
                  key={q.id}
                  className="relative rounded-xl min-w-[180px] h-[234px] bg-green-50 overflow-hidden"
                >
                  {/* semi-transparent overlay */}
                  <div className="absolute inset-0 bg-white bg-opacity-60" />

                  {/* badge */}
                  <div className="absolute left-1/2 top-1/3 transform -translate-x-1/2">
                    <span className="px-3 py-1 bg-green-600 text-white text-xs font-semibold rounded-full">
                      Completed
                    </span>
                  </div>

                  {/* underlying content (dimmed by overlay) */}
                  <div className="relative flex flex-col items-center justify-around h-full text-center p-4">
                    <Image src={ACTION_BY_ID[q.id].img} alt="" />
                    <p className="text-sm text-gray-500">{q.title}</p>
                    <p className="text-xs text-gray-500">{q.description}</p>
                    <p className="text-xs flex items-center justify-center">
                      <Image src={MinimilesSymbol} alt="" className="mr-1" />
                      {q.reward_points} MiniMiles
                    </p>
                  </div>
                </div>
              ))
            ) : (
              <p className="text-gray-500">You haven’t completed any challenges today.</p>
            )}
          </div>
        </div>
      </TabsContent>

      <QuestLoadingModal
        open={modalOpen}
        onOpenChange={setModalOpen}
        status={modalStatus}
        message={modalMsg}
      />
    </Tabs>
  );
}