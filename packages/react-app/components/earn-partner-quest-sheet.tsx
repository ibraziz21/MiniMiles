// components/earn-partner-quest-sheet.tsx


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
}

const EarnPartnerQuestSheet = ({ open, onOpenChange, quest }: PartnerQuestSheetProps) => {
  if (!quest) return null;
  const [loading, setLoading] = useState(false);
  const { address, getUserAddress } = useWeb3();
  const [pendingClaim, setPendingClaim] = useState(false);

  useEffect(() => {
    getUserAddress();
  }, [getUserAddress]);
  
  
  const handleClaim = () => {
    if (!address) {
      alert('Wallet not connected');
      return;
    }
    // open partner site first
    window.open(quest.actionLink, '_blank');
    // mark for pending minting when user returns
    setPendingClaim(true);
  };

  // Trigger mint when the app gains focus again
  useEffect(() => {
    const onFocus = async () => {
      if (pendingClaim) {
        setLoading(true);
        const { minted, error } = await claimPartnerQuest(address!, quest.id);
        setLoading(false);

        if (error) {
          alert(error);
        } else {
          alert(`Minted ${minted} MiniMiles!`);
          onOpenChange(false);
        }
        setPendingClaim(false);
      }
    };
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [pendingClaim, address, quest, onOpenChange]);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="bg-white rounded-t-xl font-poppins p-4">
        <div className="flex justify-between items-center mb-2">
          <h3 className='text-base font-bold'>Partner Quest</h3>
          <button onClick={() => onOpenChange(false)} className="text-gray-400">✕</button>
        </div>

        <div className="mb-4">
          <h4 className='text-2xl font-bold'>{quest.title}</h4>
          <p className='text-sm text-gray-500'>{quest.description}</p>
        </div>

        <div className="bg-[${quest.color}] rounded-xl p-3 text-center mb-4">
          <div className="flex justify-center items-center mb-1">
            <Image src={quest.img} width={32} height={32} alt={quest.title} />
            <span className="text-3xl font-bold ml-2">{quest.reward.split(' ')[0]}</span>
          </div>
          <span className="text-sm uppercase">MiniMiles</span>
        </div>

        <div className="mb-6">
          <h5 className="font-semibold mb-2">Instructions</h5>
          <ol className="list-decimal list-inside space-y-2 text-gray-800">
            {quest.instructions.map((step, i) => (
              <li key={i}>
                <strong>{step.title}:</strong> {step.text}
              </li>
            ))}
          </ol>
        </div>

        <Button
          className="w-full rounded-xl py-6 text-white bg-[#07955F] mb-2"
          title={loading ? 'Processing…' : 'Go & Earn'}
          onClick={handleClaim}
          disabled={loading}
        />
        <Button
          className="w-full text-green-600 bg-green-50"
          title="Close"
          onClick={() => onOpenChange(false)}
        />

        <p className="text-center text-xs text-gray-400 mt-2">
          Valid until xx/xx/xxxx. Terms apply.
        </p>
      </SheetContent>
    </Sheet>
  );
};

export default EarnPartnerQuestSheet;
