import React, { useEffect, useState } from 'react';
import { Button } from './ui/button';
import { Sheet, SheetContent } from './ui/sheet';
import Image from 'next/image';
import { claimPartnerQuest } from '@/helpers/partnerQuests';
import { useWeb3 } from '@/contexts/useWeb3';
import { akibaMilesSymbol } from "@/lib/svg";
import { Input } from './ui/input'; // ⬅️ make sure this exists
import { Quest } from './partner-quests';

interface PartnerQuestSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  quest: Quest | null;
  setOpenSuccess?: (c: boolean) => void;
}

const EarnPartnerQuestSheet = ({ open, onOpenChange, quest, setOpenSuccess }: PartnerQuestSheetProps) => {
  const [loading, setLoading] = useState(false);
  const [username, setUsername] = useState('');
  const [error, setError] = useState<string | null>(null);

  const { address, getUserAddress } = useWeb3();

  useEffect(() => {
    getUserAddress();
  }, [getUserAddress]);

  if (!quest) return null;

  const isUsernameQuest = quest.id === 'f18818cf-eec4-412e-8311-22e09a1332db';

  const handleClaim = async () => {
    if (!address) {
      alert("Wallet not connected");
      return;
    }

    try {
      setLoading(true);
      setError(null);

      if (isUsernameQuest) {
        // ── Username quest: save username & award 50 Miles ──
        if (!username.trim()) {
          setError("Please enter a username first.");
          setLoading(false);
          return;
        }

        const res = await fetch("/api/partner-quests/username", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            userAddress: address,
            username: username.trim(),
          }),
        });        

        if (!res.ok) {
          const text = await res.text();
          throw new Error(text || "Failed to save username quest");
        }
      } else {
        // ── Normal partner quests: open external app + claimPartnerQuest ──
        const isMiniPay =
          typeof window !== "undefined" &&
          (window as any).ethereum?.isMiniPay;

        let destination = quest.actionLink;

        // If you ever add a Twitter-specific quest, adapt this logic to
        // check quest.id or quest.description instead of title if needed.
        if (quest.title.toLowerCase().includes("twitter")) {
          destination = isMiniPay
            ? "twitter://user?screen_name=akibaMilesApp"
            : "https://twitter.com/akibaMilesApp";
        }

        if (destination) {
          if (isMiniPay) {
            window.location.href = destination;
          } else {
            window.open(destination, "_blank", "noopener,noreferrer");
          }
        }

        const { error: claimError } = await claimPartnerQuest(address, quest.id);
        if (claimError) {
          throw new Error(claimError);
        }
      }

      setOpenSuccess?.(true);
      setUsername('');
      setError(null);
      onOpenChange(false);
    } catch (e: any) {
      console.error("[EarnPartnerQuestSheet] claim error", e);
      setError(e?.message || "Something went wrong. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="bg-white rounded-t-xl font-sterling p-4">
        <div className="flex justify-start items-center mb-2">
          <div className="rounded-full mr-2" style={{ backgroundColor: quest.color }}>
            <Image src={akibaMilesSymbol} alt="" className="h-[20px]" />
          </div>
          <h3 className="text-sm font-medium bg-[#24E5E033] text-[#1E8C89] rounded-full px-3">
            Partner Quest
          </h3>
        </div>

        <div className="mb-4">
          <h4 className="text-2xl font-medium">{quest.title}</h4>
          <p className="text-sm text-gray-500">{quest.description}</p>
        </div>

        <div className="bg-partner-quest bg-[#238D9D] rounded-xl p-3 text-center mb-4 text-white">
          <div className="flex justify-center items-center mb-1">
            <Image src={akibaMilesSymbol} width={32} height={32} alt={quest.title} />
            <span className="text-3xl font-medium ml-2">
              {quest.reward.split(" ")[0]}
            </span>
          </div>
          <span className="text-sm uppercase">akibaMiles</span>
        </div>

        <div className="mb-6 font-poppins">
          {isUsernameQuest ? (
            <>
              <h5 className="font-medium mb-2">Set your Akiba username</h5>
              <p className="text-sm text-[#8E8B8B] mb-3">
                Add the username you want us to use on leaderboards, raffles, and
                future rewards.
              </p>
              <div className="space-y-2">
                <Input
                  placeholder="@yourhandle"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                />
                <p className="text-[11px] text-[#8E8B8B]">
                  Example: <span className="font-semibold">@akibaLegend</span>
                </p>
              </div>
            </>
          ) : (
            <>
              <h5 className="font-medium mb-2">Instructions</h5>
              <ol className="list-decimal list-inside space-y-2 text-[#8E8B8B]">
                {quest.instructions.map((step, i) => (
                  <li key={i}>
                    <strong className="text-black font-semibold">
                      {step.title}:
                    </strong>{" "}
                    {step.text}
                  </li>
                ))}
              </ol>
            </>
          )}

          {error && (
            <p className="mt-2 text-xs text-red-500">
              {error}
            </p>
          )}
        </div>

        <Button
          className="w-full rounded-xl py-6 text-white bg-[#238D9D] mb-2"
          title={
            loading
              ? "Processing…"
              : isUsernameQuest
              ? "Save username & Earn"
              : "Complete & Earn"
          }
          onClick={handleClaim}
          disabled={loading || (isUsernameQuest && !username.trim())}
        >
          {loading
            ? "Processing…"
            : isUsernameQuest
            ? "Save username & Earn"
            : "Complete & Earn"}
        </Button>
      </SheetContent>
    </Sheet>
  );
};

export default EarnPartnerQuestSheet;
