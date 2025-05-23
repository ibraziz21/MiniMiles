// components/spend-partner-quest-sheet.tsx
"use client";

import React, { useState, useEffect } from "react";
import { Button } from "./ui/button";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetFooter,
} from "./ui/sheet";
import Image from "next/image";
import { CaretLeft, CaretRight, Minus, Plus, Share } from "@phosphor-icons/react";
import { Slider } from "./ui/slider";
import { Ticket, MinimilesSymbolAlt, OnboardingImgThree, Successsvg } from "@/lib/svg";
import { StaticImageData } from "next/image";
import { useWeb3 } from "@/contexts/useWeb3";
import SuccessModal from "./success-modal";
import Link from "next/link";

interface SpendRaffle {
  id: number;
  title:      string;
  reward:     string;
  prize:      string;
  endDate:    string;
  ticketCost: string;         // e.g. "5 MiniMiles"
  image:      StaticImageData;
  balance:    number;         // user balance in MiniMiles
  symbol: string;
}

interface SpendPartnerQuestSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  raffle: SpendRaffle | null;
  setOpenSuccess?: (c: boolean) => void;
}

const PRESETS = [1, 5, 10, 25, 50];

export default function SpendPartnerQuestSheet({
  open,
  onOpenChange,
  raffle,
}: SpendPartnerQuestSheetProps) {
  // ⚠️ Hooks must come first, unconditionally:
  const [count, setCount] = useState(1);
  const [joinedRaffle, setJoinRaffle] = useState(false);
  const { joinRaffle } = useWeb3();
  // We'll compute these per-render below, after the early return
  // (but we need them in our effects too, so we'll derive safe fallbacks now)
  const ticketCostNum = Number(raffle?.ticketCost.replace(/\D/g, "")) || 1;
  const maxTickets    = Math.max(Math.floor((raffle?.balance ?? 1) / ticketCostNum), 1);

  // Whenever the raffle object changes, reset to 1
  useEffect(() => {
    setCount(1);
  }, [raffle]);

  // Clamp into [1..maxTickets] any time count or maxTickets change
  useEffect(() => {
    if (count < 1)         setCount(1);
    else if (count > maxTickets) setCount(maxTickets);
  }, [count, maxTickets]);

  // Now it's safe to bail if there's no raffle
  if (!raffle) return null;

  // And we can compute totalCost for the button label
  const totalCost = count * ticketCostNum;


  const handleBuy = async () => {
    try {
      const txHash = await joinRaffle(raffle.id, count);
      console.log("Submitted tx:", txHash);
      // onOpenChange(false);
      setJoinRaffle(true);
    } catch (err: any) {
      console.error("Join raffle failed:", err);
      alert(err.message || "Failed to join raffle");
    }
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="bottom"
        className="bg-white rounded-t-xl font-poppins max-h-[90vh] overflow-auto"
      >
        {
          joinedRaffle ? <div className={`flex flex-col justify-center h-full p-3 bg-onboarding  bg-no-repeat bg-cover `}>
            <div className={`flex justify-between items-center `}>
              <CaretLeft size={24} />
              <Link href="/" className="text-sm text-green-600 hover:underline font-bold">
                Skip & Claim
              </Link>
            </div>
            <div className="flex justify-center">
              <Image src={Successsvg} alt="w-full" />
            </div>
            <h4 className={`text-[#07955F] text-center font-bold my-5 flex justify-center`}>View blockchain receipt <Share size={24} color="#219653" weight="duotone" className="mx-2"/></h4>
            <div className="flex flex-col justify-center">
              <Button
                title={"Close"}
                onClick={() => onOpenChange(false)}
                className={`w-full rounded-xl py-6 flex items-center justify-center gap-3 font-semibold tracking-wide shadow-sm text-[#07955F] bg-[#07955F1A] disabled:bg-[#07955F]`}
              >
              </Button>
            </div>
          </div> : <div className="p-4">
            {/* Hero Image */}
            <SheetHeader className="pt-4">
              <SheetTitle>{raffle.title}</SheetTitle>
            </SheetHeader>
            <div className="relative w-full h-40 rounded-xl overflow-hidden mb-4">
              <Image
                src={raffle.image}
                alt={`${raffle.title} banner`}
                fill
                className="object-cover"
              />
            </div>

            {/* Prize Banner */}
            <div className="text-gray-500 rounded-xl py-3 text-center mb-4">
              <div className="flex items-center justify-center space-x-2">
              </div>
              <p className="text-sm">Join our weekly raffle of {raffle.prize} {raffle.symbol} and win big</p>
            </div>

            {/* Details */}
            <div className="mb-4 text-sm">
              <p className="text-black mb-2">Raffle Details</p>
              <ul className="space-y-2">
                <li className="flex justify-between">
                  <span className="font-medium">Prize</span>
                  <span className="text-gray-700">{raffle.prize} {raffle.symbol}</span>
                </li>
                <li className="flex justify-between">
                  <span className="font-medium">Price per ticket</span>
                  <span className="text-gray-700">{ticketCostNum} MiniMiles</span>
                </li>
                <li className="flex justify-between">
                  <span className="font-medium">Draw Date</span>
                  <span className="text-gray-700">{raffle.endDate}</span>
                </li>

              </ul>
            </div>
            <p className="text-center text-2xl font-semibold mb-6">
              Buy tickets
            </p>
            <div className="flex items-center justify-center space-x-2">
              <Image
                src={Ticket}
                alt="Ticket icon"
                width={32}
                height={32}
                className="w-8 h-8"
              />
              <span className="text-2xl font-semibold">
                {count}
              </span>
            </div>
            {/* Ticket Count Selector */}
            <div className="mb-2">
              <div className="flex items-center space-x-2">
                <button
                  onClick={() => setCount(c => Math.max(1, c - 1))}
                  className="p-2 bg-gray-100 rounded-full"
                >
                  <Minus size={20} />
                </button>

                <div className="flex-1">
                  <Slider
                    value={[count]}
                    max={maxTickets}
                    min={1}
                    step={1}
                    onValueChange={([v]) => setCount(v)}
                  />
                </div>

                <button
                  onClick={() => setCount(c => Math.min(maxTickets, c + 1))}
                  className="p-2 bg-gray-100 rounded-full"
                >
                  <Plus size={20} />
                </button>
              </div>
              <div className="flex justify-between text-xs text-gray-500 mt-1">
                <span>Min: 1</span>
                <span>Max: {maxTickets}</span>
              </div>
            </div>

            {/* Preset Buttons */}
            <div className="flex gap-2 mb-4">
              {PRESETS.map(n => (
                <button
                  key={n}
                  onClick={() => setCount(Math.min(n, maxTickets))}
                  disabled={n > maxTickets}
                  className={`flex-1 rounded-xl py-2 font-semibold ${count === n ? "bg-green-600 text-white" : "bg-gray-100 text-gray-800"
                    }`}
                >
                  <div className="flex items-center justify-center space-x-1">
                    <Image src={Ticket} alt="Ticket icon" width={16} height={16} />
                    <span>{n}</span>
                  </div>
                </button>
              ))}
            </div>

            {/* Available & Total */}
            <p className="text-center text-xs text-gray-500 mb-1">
              Available tickets: {maxTickets}
            </p>
            <p className="text-center text-sm font-medium mb-6">
              Total cost: {totalCost} MiniMiles
            </p>

            {/* Buy Button */}
            <SheetFooter>
              <Button
                title={`Buy`}
                onClick={handleBuy}
                className="w-full bg-green-600 text-white rounded-xl py-4 font-semibold"
              >
                Buy
              </Button>
            </SheetFooter>
          </div>
        }
      </SheetContent>
    </Sheet>
  );
}