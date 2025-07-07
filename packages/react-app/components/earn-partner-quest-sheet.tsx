import React, { useEffect, useState } from 'react';
import { Button } from './ui/button';
import { Sheet, SheetContent } from './ui/sheet';
import Image from 'next/image';
import Link from 'next/link';
import { Quest } from './partner-quests';
import { claimPartnerQuest } from '@/helpers/partnerQuests';
import { useWeb3 } from '@/contexts/useWeb3';

interface PartnerQuestSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  quest: Quest | null;
  setOpenSuccess?: (c:boolean) => void;
}

const EarnPartnerQuestSheet = ({ open, onOpenChange, quest, setOpenSuccess }: PartnerQuestSheetProps) => {
    const [loading, setLoading] = useState(false);
    const { address, getUserAddress } = useWeb3();
  
    useEffect(() => {
      getUserAddress();
    }, [getUserAddress]);
    
    
    if (!quest) return null;

  // EarnPartnerQuestSheet.tsx  ⟨only handleClaim changed⟩
const handleClaim = async () => {
    if (!address) {
      alert("Wallet not connected");
      return;
    }
  
    /* ---------- decide how to open the partner app ---------- */
    const isMiniPay = typeof window !== "undefined" && (window as any).ethereum?.isMiniPay;
  
    // Build a deep-link for Twitter quests
    let destination = quest.actionLink;
    if (quest.title.toLowerCase().includes("twitter")) {
      // open the Twitter app if installed, else fall back to web
      destination = isMiniPay
        ? "twitter://user?screen_name=akibaMilesApp"
        : "https://twitter.com/akibaMilesApp";
    }
  
    if (isMiniPay) {
      // leave MiniPay completely (opens external browser / app)
      window.location.href = destination;
    } else {
      // normal browsers → new tab
      window.open(destination, "_blank", "noopener,noreferrer");
    }
  
    /* ---------- mint later (same as before) ---------- */
    setLoading(true);
    const { minted, error } = await claimPartnerQuest(address, quest.id);
    if (error) alert(error);
    else setOpenSuccess?.(true);
    setLoading(false);
    onOpenChange(false);
  };
  
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="bg-white rounded-t-xl font-sterling p-4">
        <div className="flex justify-start items-center mb-2">
          <div className={`rounded-full mr-2`} style={{backgroundColor: quest.color}}>
            <Image src={quest.img} alt='' className='h-[20px]' />
          </div>
          <h3 className='text-sm font-medium bg-[#24E5E033] text-[#1E8C89] rounded-full px-3 '>Partner Quest</h3>
        </div>

        <div className="mb-4">
          <h4 className='text-2xl font-medium'>{quest.title}</h4>
          <p className='text-sm text-gray-500'>{quest.description}</p>
        </div>

        <div className="bg-partner-quest bg-[#238D9D] rounded-xl p-3 text-center mb-4 text-white">
          <div className="flex justify-center items-center mb-1">
            <Image src={quest.img} width={32} height={32} alt={quest.title} />
            <span className="text-3xl font-medium ml-2">{quest.reward.split(' ')[0]}</span>
          </div>
          <span className="text-sm uppercase">akibaMiles</span>
        </div>

        <div className="mb-6 font-poppins">
          <h5 className="font-medium mb-2">Instructions</h5>
          <ol className="list-decimal list-inside space-y-2 text-[#8E8B8B]">
            {quest.instructions.map((step, i) => (
              <li key={i}>
                <strong className='text-black font-semibold'>{step.title}:</strong> {step.text}
              </li>
            ))}
          </ol>
        </div>

        <Button
          className="w-full rounded-xl py-6 text-white bg-[#238D9D] mb-2"
          title={loading ? 'Processing…' : 'Follow Us'}
          onClick={handleClaim}
          disabled={loading}
        />
     

       
      </SheetContent>
    </Sheet>
  );
};

export default EarnPartnerQuestSheet;