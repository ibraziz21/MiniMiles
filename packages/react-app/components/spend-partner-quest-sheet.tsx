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
import { Minus, Plus } from "@phosphor-icons/react";
import { Slider } from "./ui/slider";
import { Ticket, MinimilesSymbolAlt } from "@/lib/svg";
import { StaticImageData } from "next/image";

interface SpendRaffle {
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
}

const PRESETS = [1, 5, 10, 25, 50];

export default function SpendPartnerQuestSheet({
  open,
  onOpenChange,
  raffle,
}: SpendPartnerQuestSheetProps) {
  if (!raffle) return null;

  // Extract numeric cost and compute max tickets
  const ticketCostNum = Number(raffle.ticketCost.replace(/\D/g, "")) || 1;
  const maxTickets = Math.max(Math.floor(raffle.balance / ticketCostNum), 1);

  // Internal ticket count state
  const [count, setCount] = useState(1);

  // Reset to 1 whenever raffle changes
  useEffect(() => {
    setCount(1);
  }, [raffle]);

  // Clamp count to [1, maxTickets]
  useEffect(() => {
    if (count > maxTickets) setCount(maxTickets);
    if (count < 1) setCount(1);
  }, [count, maxTickets]);

  // Compute total cost for display
  const totalCost = count * ticketCostNum;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="bottom"
        className="bg-white rounded-t-xl font-poppins max-h-[90vh] overflow-auto"
      >
        <SheetHeader className="pt-4">
          <SheetTitle>{raffle.title}</SheetTitle>
        </SheetHeader>

        <div className="p-4">
          {/* Hero Image */}
          <div className="relative w-full h-40 rounded-xl overflow-hidden mb-4">
            <Image
              src={raffle.image}
              alt={`${raffle.title} banner`}
              fill
              className="object-cover"
            />
          </div>

          {/* Prize Banner */}
          <div className="bg-green-700 text-white rounded-xl py-3 text-center mb-4">
            <div className="flex items-center justify-center space-x-2">
              <Image src={MinimilesSymbolAlt} alt="MiniMiles icon" width={32} height={32} />
              <span className="text-3xl font-bold">{raffle.reward}</span>
            </div>
            <p className="text-sm">MiniMiles</p>
          </div>

          {/* Details */}
          <div className="mb-4 text-sm">
            <p className="text-gray-500 mb-2">Raffle Details</p>
            <ul className="space-y-2">
              <li className="flex justify-between">
                <span className="font-medium">Prize</span>
                <span className="text-gray-700">{raffle.prize} {raffle.symbol}</span>
              </li>
              <li className="flex justify-between">
                <span className="font-medium">Draw Date</span>
                <span className="text-gray-700">{raffle.endDate}</span>
              </li>
              <li className="flex justify-between">
                <span className="font-medium">Price per ticket</span>
                <span className="text-gray-700">{ticketCostNum} MiniMiles</span>
              </li>
            </ul>
          </div>

          {/* Ticket Count Selector */}
          <div className="mb-2">
            <p className="text-sm text-gray-600 mb-1">Number of tickets</p>
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
                className={`flex-1 rounded-xl py-2 font-semibold ${
                  count === n ? "bg-green-600 text-white" : "bg-gray-100 text-gray-800"
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
              title={`Buy ${count} ticket${count > 1 ? "s" : ""}`}
              onClick={() => {
                console.log(`Buying ${count} tickets for ${totalCost} MiniMiles`);
              }}
              className="w-full bg-green-600 text-white rounded-xl py-4 font-semibold"
            >
              Buy {count} ticket{count > 1 ? "s" : ""}
            </Button>
          </SheetFooter>
        </div>
      </SheetContent>
    </Sheet>
  );
}
