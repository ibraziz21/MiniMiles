"use client";

import MiniMilesHeader from "@/components/mini-miles-header";
import QuestCard from "@/components/quest-card";
import QuestDetailModal from "@/components/quest-details-modal";
import QuestLoadingModal,{ QuestStatus} from "@/components/quest-loading-modal";
import { useWeb3 } from "@/contexts/useWeb3";
import { useState, useEffect } from "react";
import { claimDailyQuest } from "@/helpers/claimDaily"; // <-- NEW
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
  const [modalStatus, setModalStatus] = useState<QuestStatus>("loading");

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

    setModalStatus("loading");
    // setIsClaimingDaily(true);
    setLoadOpen(true);

    console.log("[DailyClaim] Starting claim for:", address);

    try {
      const res = await claimDailyQuest(address);

      if (res.success) {
        console.log("success")
        setModalStatus("success");
        const updated = await getMiniMilesBalance(address);
        setMiniMilesBalance(updated);
      } else {
        setModalStatus("already");
      }
    } catch (err) {
      console.error(err);
      setModalStatus("error");
    } finally {
      // auto‑close after 1.5 s if you like
      setTimeout(() => setLoadOpen(false), 1500);
    }
  };

  const handleDailyCusd = async () => {
    if (!address) return;

    setModalStatus("loading");
    setLoadOpen(true);

    console.log("[TransferClaim] Starting claim for:", address);
    try {
      const { success, message } = await claimDailyTransfer(address);
      if (success) {
        setModalStatus("success");
      } else if (/Already/i.test(message ?? "")) {
        setModalStatus("already");
      } else {
        // covers "No on‑chain transfer ..." and any other eligibility failure
        setModalStatus("ineligible");
      }
    } catch (err) {
      console.error(err);
      setModalStatus("error");
    } 
  }

  const handleDailyReceived = async () => {
    if (!address) return;

    setLoadOpen(true);

    console.log("[TransferClaim] Starting claim for:", address);
    try {
      const { success, message } = await claimDailyReceive(address);
      if (!success) {
        setModalStatus("error");
      } else {
        setModalStatus("success");
        const updated = await getMiniMilesBalance(address);
        setMiniMilesBalance(updated);
      }
    } catch (err) {
      console.error(err);
      setModalStatus("error");
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
      <QuestLoadingModal
        open={loadOpen}
        onOpenChange={setLoadOpen}
        status={modalStatus}
      />

    </div>
  );
}
