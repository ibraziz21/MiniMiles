"use client";

import MiniMilesHeader from "@/components/mini-miles-header";
import QuestCard from "@/components/quest-card";
import QuestDetailModal from "@/components/quest-details-modal";
import QuestLoadingModal from "@/components/quest-loading-modal";

import { useWeb3 } from "@/contexts/useWeb3";
import { useState, useEffect } from "react";
import { claimDailyQuest } from "@/helpers/claimDaily"; // <-- NEW
import { toast } from "sonner"; // or your preferred toast system
import { claimDailyTransfer } from "@/helpers/claimTransfer";
import { claimDailyReceive } from "@/helpers/claimReceive";


export default function EarnPage() {

  const {
    address,
    getUserAddress,
    getMiniMilesBalance,
  } = useWeb3();

  const [miniMilesBalance, setMiniMilesBalance] = useState("0");
  const [filter, setFilter] = useState("active");
  const [modalOpen, setModalOpen] = useState(false);
  const [loadOpen, setLoadOpen] = useState(false)
  const [isClaimingDaily, setIsClaimingDaily] = useState(false);
const [triggerDailyClaim, setTriggerDailyClaim] = useState(false);

  const partners = [
    { name: "Celo", icon: "/partners/celo.svg" },
    { name: "MiniPay", icon: "/partners/minipay.svg" },
    { name: "GLO dollar", icon: "/partners/glo.svg" },
    { name: "Mento", icon: "/partners/mento.svg" },
  ];

  useEffect(() => {
    getUserAddress();
}, []);

  useEffect(() => {
    const fetchBalance = async () => {
      if (!address) return;
      try {
        const balance = await getMiniMilesBalance(address);
        setMiniMilesBalance(balance);
      } catch (error) {
        console.log(error);
      }
    };
    fetchBalance();
  }, [address, getMiniMilesBalance]);



  const handleDailyClaim = async () => {
    console.log("Checking....", address)
    if (!address) return;
  
    setIsClaimingDaily(true);
    setLoadOpen(true);
  
    console.log("[DailyClaim] Starting claim for:", address);
  
    try {
      const res = await claimDailyQuest(address);
      console.log("[DailyClaim] Response:", res);
  
      if (res.success) {
        toast.success("✅ You've earned 5 MiniMiles!");
        const updated = await getMiniMilesBalance(address);
        setMiniMilesBalance(updated);
      } else {
        toast.error(res.message || "Already claimed today");
      }
    } catch (err) {
      console.error("[DailyClaim] Error:", err);
      toast.error("Something went wrong.");
    } finally {
      setTimeout(() => setLoadOpen(false), 1500);
      setIsClaimingDaily(false);
    }
  };

  const handleDailyCusd = async () => {
    if (!address) return;

    setLoadOpen(true);
  
    console.log("[TransferClaim] Starting claim for:", address);
    try {
      const { success, message } = await claimDailyTransfer(address);
      if (!success) {
        toast.error(message || "You haven't spent 5 cUSD within the last 24 hours.");
      } else {
        toast.success("You claimed the daily 5 cUSD quest!");
      }
    } catch (err) {
      console.error(err);
      toast.error("Something went wrong claiming daily cUSD quest.");
    }
  }

  const handleDailyReceived = async () => {
    if (!address) return;

    setLoadOpen(true);
  
    console.log("[TransferClaim] Starting claim for:", address);
    try {
      const { success, message } = await claimDailyReceive(address);
      if (!success) {
        toast.error(message || "You haven't spent 5 cUSD within the last 24 hours.");
      } else {
        toast.success("You claimed the daily 5 cUSD quest!");
      }
    } catch (err) {
      console.error(err);
      toast.error("Something went wrong claiming daily cUSD quest.");
    }
  }


  return (
    <div className="pb-24">
      <MiniMilesHeader total={Number(miniMilesBalance)} filter={filter} setFilter={setFilter} />

      <div className="mt-4 px-4">
        <h3 className="font-semibold mb-2">Earn points</h3>
        <div className="flex gap-3 overflow-x-auto">
        <div
  onClick={handleDailyClaim}
>
  <QuestCard
    title="Daily Engagement"
    description="Open the minimiles App Everyday to get points"
    reward="5 MiniMiles"
  />
</div>
          <div onClick={handleDailyCusd}>
            <QuestCard
              title="Spend 5 USD on in stablecoins"
              description="Spend 5 USDT from your MiniPay wallet daily."
              reward="5 MiniMiles"
            />
          </div>
          <div onClick={handleDailyReceived}>
            <QuestCard
              title="Receive 5 cUSD on in stablecoins"
              description="Spend 5 cUSD from your MiniPay wallet daily."
              reward="5 MiniMiles"
            />
          </div>
          <div onClick={() => setModalOpen(true)}>
            <QuestCard
              title="Interact with Minipay Ecosystem"
              description="Interact and do one action in the minipay ecosystem (capped to one action) "
              reward="10 MiniMiles"
            />

          </div>
        </div>
      </div>

      <div className="mt-6 px-4">
        <h3 className="font-semibold mb-2">Partner quests</h3>
        <div className="grid grid-cols-2 gap-4">
          {partners.map((p, i) => (
            <div onClick={() => setModalOpen(true)} key={i} className="flex flex-col items-center bg-white p-4 rounded-xl shadow-sm">
              <img src={p.icon} alt={p.name} className="h-10 w-10 mb-2" />
              <p className="text-sm font-medium">{p.name}</p>
            </div>
          ))}
        </div>
      </div>

      <QuestDetailModal open={modalOpen} onOpenChange={setModalOpen} />
      <QuestLoadingModal open= {loadOpen} onOpenChange={setLoadOpen} />
    </div>
  );
}
