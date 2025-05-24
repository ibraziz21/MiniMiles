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
import QuestLoadingModal, { QuestStatus } from "./quest-loading-modal";
import { useWeb3 } from "@/contexts/useWeb3";
import { createClient } from "@supabase/supabase-js";
import Image from "next/image";
import Link from "next/link";
import { useEffect, useState } from "react";

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

const ACTION_BY_ID: Record<
  string,
  { action: (addr: string) => Promise<any>; img: any }
> = {
  "a9c68150-7db8-4555-b87f-5e9117b43a08": { action: claimDailyQuest,   img: Door },
  "383eaa90-75aa-4592-a783-ad9126e8f04d": { action: claimDailyTransfer, img: Cash },
  "c6b14ae1-66e9-4777-9c9f-65e57b091b16": { action: claimDailyReceive,  img: Cash },
};

/**
 * Props:
 *  • showCompleted – false ⇒ show active quests
 *                  – true  ⇒ show completed quests
 */
export default function DailyChallenges({ showCompleted = false }: { showCompleted?: boolean }) {
  const { address, getUserAddress } = useWeb3();

  const [active,    setActive]    = useState<QuestRow[]>([]);
  const [completed, setCompleted] = useState<QuestRow[]>([]);
  const [loading,   setLoading]   = useState(true);

  // modal
  const [modalOpen,   setModalOpen] = useState(false);
  const [modalStatus, setStatus]    = useState<QuestStatus>("loading");
  const [modalMsg,    setMsg]       = useState<string>();

  /* ── wallet ───────────────────────────────────────────── */
  useEffect(() => { getUserAddress(); }, [getUserAddress]);

  /* ── quests + todays engagements ──────────────────────── */
  useEffect(() => {
    async function fetchAll() {
      const { data: quests } = await supabase
        .from("quests")
        .select("*")
        .eq("is_active", true);
      if (!quests) { setLoading(false); return; }

      if (!address) {               // not connected
        setActive(quests as QuestRow[]);
        setCompleted([]);
        setLoading(false);
        return;
      }

      const today = new Date().toISOString().slice(0, 10);
      const { data: eng } = await supabase
        .from("daily_engagements")
        .select("quest_id")
        .eq("user_address", address)
        .eq("claimed_at", today);

      const claimed = new Set(eng?.map(e => e.quest_id));
      setActive(quests.filter(q => !claimed.has(q.id)));
      setCompleted(quests.filter(q =>  claimed.has(q.id)));
      setLoading(false);
    }
    fetchAll();
  }, [address]);

  const quests = showCompleted ? completed : active;
  if (loading) return null;

  /* ── run quest ────────────────────────────────────────── */
  async function runQuest(q: QuestRow) {
    if (!address) return;
    const map = ACTION_BY_ID[q.id];
    if (!map) return;

    setModalOpen(true); setStatus("loading"); setMsg(undefined);
    try {
      const res = await map.action(address);
      if (res.success) {
        setStatus("success");
        setActive(cur => cur.filter(x => x.id !== q.id));
        setCompleted(cur => [...cur, q]);
      } else if (res.code === "already") setStatus("already");
      else setStatus("error");
      setMsg(res.message);
    } catch (e) {
      console.error(e);
      setStatus("error");
      setMsg("Network or contract error");
    }
  }

  /* ── UI ───────────────────────────────────────────────── */
  return (
    <>
      {/* Empty-state message */}
      {quests.length === 0 && (
        <p className="text-sm text-gray-500 my-4">
          {showCompleted
            ? "You haven’t completed any challenges today."
            : "No more challenges today — come back tomorrow!"}
        </p>
      )}

      {/* Card list */}
      {quests.length > 0 && (
        <div className="flex space-x-3 overflow-x-auto mt-4">
          {quests.map(q => {
            const map = ACTION_BY_ID[q.id];
            if (!map) return null;
            return (
              <button
                key={q.id}
                disabled={showCompleted}
                onClick={() => runQuest(q)}
                className={`flex-none w-44 h-60 rounded-xl p-4 shadow-xl
                  ${showCompleted
                    ? "bg-green-50 opacity-70 cursor-default"
                    : "bg-white border border-[#07955F4D]"}`}
              >
                <div className="flex flex-col justify-between h-full text-center">
                  <Image src={map.img} alt="" className="mx-auto" />
                  <p className="text-sm font-semibold mt-2">{q.title}</p>
                  <p className="text-xs text-gray-600 mt-1 px-1
                                whitespace-normal break-words leading-4">
                    {q.description}
                  </p>
                  <p className="text-xs mt-2 flex items-center justify-center">
                    <Image src={MinimilesSymbol} alt="" className="mr-1" />
                    {q.reward_points} MiniMiles
                  </p>
                </div>
              </button>
            );
          })}
        </div>
      )}

      <QuestLoadingModal
        open={modalOpen}
        onOpenChange={setModalOpen}
        status={modalStatus}
        message={modalMsg}
      />
    </>
  );
}
