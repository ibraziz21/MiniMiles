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
  reward: number;
  is_active: boolean;
};

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
  const [showPopup, setShowPopup] = useState(false);
  const [quests, setQuests] = useState<QuestRow[]>([]);
  const [loadingQuests, setLoadingQuests] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [modalStatus, setStatus] = useState<QuestStatus>("loading");
  const [modalMsg, setMsg] = useState<string | undefined>();


  useEffect(() => {
    getUserAddress();
  }, [getUserAddress]);

  useEffect(() => {
    const fetchQuests = async () => {
      const { data, error } = await supabase
        .from("quests")
        .select("*")
        .eq("is_active", true);

      if (error) {
        console.error("Supabase fetch error:", error);
      } else {
        setQuests(data as QuestRow[]);
      }
      setLoadingQuests(false);
    };
    fetchQuests();
  }, []);


  const handleQuestClick = async (quest: QuestRow) => {
    if (!address) {
      return;
    }

    const mapping = ACTION_BY_ID[quest.id];
    if (!mapping) {
      return;
    }

    setModalOpen(true);
    setStatus("loading");
    setMsg(undefined);

    try {
      const res = await mapping.action(address); // must return { success, code?, message? }

      if (res.success) setStatus("success");
      else if (res.code === "already") setStatus("already");
      else if (res.code === "ineligible") setStatus("ineligible");
      else setStatus("error");

      setMsg(res.message);
    } catch (err) {
      console.error(err);
      setStatus("error");
      setMsg("Network or contract error");
    }
  };

  if (loadingQuests) return null;

  const handleOpenPopup = () => {
    setShowPopup(true);
  };

  return (
    <Tabs defaultValue="active" className="mx-3">
      <TabsList>
        <TabsTrigger value="active" className="text-[#219653] bg-[#66D5754D] rounded-full font-bold">Active</TabsTrigger>
        <TabsTrigger value="completed" className="ml-1 text-[#8E8B8B] bg-[#EBEBEB] rounded-full font-bold">Completed</TabsTrigger>
      </TabsList>
      <TabsContent value="active">    <div className="mt-6">
        <div className="flex justify-between items-center">
          <h3 className="text-lg font-bold">Daily challenges</h3>
          <Link href="/earn" className="text-sm text-green-600 hover:underline font-bold">
            See all ›
          </Link>
        </div>

        <div className="flex space-x-3 overflow-x-auto mt-4">
          {quests.map((q) => {
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
                    {q.reward} MiniMiles
                  </p>
                </div>
              </button>
            );
          })}
        </div>

        <QuestLoadingModal
          open={modalOpen}
          onOpenChange={setModalOpen}
          status={modalStatus}
          message={modalMsg}
        />

        <DailyChallengeSheet open={showPopup} onOpenChange={setShowPopup} />
      </div>
      </TabsContent>
      <TabsContent value="completed">
        <div className="mt-6">
          <div className="flex justify-between items-center">
            <h3 className="text-lg font-bold">Daily challenges</h3>
            <Link href="/earn" className="text-sm text-green-600 hover:underline font-bold">
              See all ›
            </Link>
          </div>

          <div className="flex space-x-3 overflow-x-auto mt-4">
            {quests.map((q) => {
              const map = ACTION_BY_ID[q.id];
              if (!map) return null;

              return (
                <button
                  key={q.id}
                  onClick={() => handleQuestClick(q)}
                  className="bg-[#07955F33] rounded-xl p-4 min-w-[180px] h-[234px] focus:outline-none shadow-xl"
                >
                  <div className="flex flex-col items-center justify-around h-full text-center bg-opacity-20">
                    <Image src={map.img} alt="" />
                    <p className="text-sm font-semibold">{q.title}</p>
                    <p className="text-xs text-[#8E8B8B] mt-2">{q.description}</p>
                    <p className="text-xs mt-3 flex items-center justify-center">
                      <Image src={MinimilesSymbol} alt="" className="mr-1" />
                      {q.reward} MiniMiles
                    </p>
                  </div>
                </button>
              );
            })}
          </div>

          <QuestLoadingModal
            open={modalOpen}
            onOpenChange={setModalOpen}
            status={modalStatus}
            message={modalMsg}
          />

          <DailyChallengeSheet open={showPopup} onOpenChange={setShowPopup} />
        </div>
      </TabsContent>
    </Tabs>
  );
}
