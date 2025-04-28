"use client";

import DailyChallenges from '@/components/daily-challenge';
import { Hero } from '@/components/Hero';
import MiniPointsCard from '@/components/mini-points-card';
import PartnerQuests from '@/components/partner-quests';
import SwapRewardPopup from '@/components/swap-reward-popup';
import React, { useEffect, useState } from 'react';
import { Button } from "@/components/ui/button";
import { useWeb3 } from "@/contexts/useWeb3";






const Page = () => {
  const {address, getUserAddress, getMiniMilesBalance} = useWeb3();
  const [showPopup, setShowPopup] = useState(false);
  const [miniMilesBalance, setMiniMilesBalance] = useState('0');


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

  const handleOpenPopup = () => {
    setShowPopup(true);
  };

  const handleClosePopup = () => {
    setShowPopup(false);
  };

  return (
    <main className="pb-24 font-poppins">
      <div className="px-4 pt-4">
        <h1 className="text-2xl font-bold mt-2">Earn</h1>
        <h3>Complete challenges and quests to earn MiniMiles.</h3>
      </div>

      <MiniPointsCard points={Number(miniMilesBalance)} />
      <DailyChallenges />
      <PartnerQuests openPopup={handleOpenPopup} />

      {/* Button to manually open the popup */}
      <div className="px-4 mt-6">
        <Button title="Claim Swap Reward" onClick={handleOpenPopup} className="bg-green-600 hover:bg-green-700 text-white">
          
        </Button>
      </div>

      {/* Popup controlled by state */}
      <SwapRewardPopup open={showPopup} onOpenChange={setShowPopup} />
    </main>
  );
}

export default Page;
