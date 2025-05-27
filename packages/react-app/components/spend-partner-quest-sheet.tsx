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
import { CaretLeft, Minus, Plus, Share } from "@phosphor-icons/react";
import { Slider } from "./ui/slider";
import { Ticket, Successsvg } from "@/lib/svg";
import { StaticImageData } from "next/image";
import { useWeb3 } from "@/contexts/useWeb3";
import Link from "next/link";

interface SpendRaffle {
  id: number;
  title: string;
  reward: string;
  prize: string;
  endDate: string;
  ticketCost: string; // e.g. "5 MiniMiles"
  image: StaticImageData;
  balance: number;    // user balance in MiniMiles
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
  // Hooks
  const [count, setCount] = useState(1);
  const [processing, setProcessing] = useState(false);
  const [joined, setJoined] = useState(false);
  const [txHash, setTxHash] = useState<string | null>(null);

  const { joinRaffle } = useWeb3();

  // Derive numeric values
  const ticketCostNum = Number(raffle?.ticketCost.replace(/\D/g, "")) || 1;
  const maxTickets = Math.max(
    Math.floor((raffle?.balance ?? 1) / ticketCostNum),
    1
  );
  const totalCost = count * ticketCostNum;

  // Reset when raffle changes
  useEffect(() => {
    setCount(1);
    setProcessing(false);
    setJoined(false);
    setTxHash(null);
  }, [raffle]);

  // Clamp count
  useEffect(() => {
    if (count < 1) setCount(1);
    else if (count > maxTickets) setCount(maxTickets);
  }, [count, maxTickets]);

  if (!raffle) return null;

  const handleBuy = async () => {
    if (!raffle) return;                // should never happen, but guards TS
  
    try {
      // 1️⃣ Start spinner / disable UI
      setProcessing(true);
      setJoined(false);
      setTxHash(null);
  
      // 2️⃣ Send tx (your hook returns the hash)
      const hash = await joinRaffle(raffle.id, count);
      setTxHash(hash);
  
      // 3️⃣ Wait for confirmation ─ either:
      //    a) the receipt (preferred – no magic numbers), OR
      //    b) a 6 s fallback if you don’t want an extra RPC call
      try {
        // If you already have a viem publicClient in scope, use it:
        // await publicClient.waitForTransactionReceipt({ hash });
        //
        // Otherwise, keep the simple timeout:
        await new Promise((res) => setTimeout(res, 6_000));
      } catch {
        /* ignore wait errors – we’ll still show success after the timeout */
      }
  
      // 4️⃣ Switch to success screen
      setJoined(true);
    } catch (err: any) {
      console.error("Join raffle failed:", err);
      alert(err?.message ?? "Failed to join raffle");
    } finally {
      // 5️⃣ Always stop spinner
      setProcessing(false);
    }
  };

  // Block explorer URL (Alfajores)
  const explorerBase = "https://alfajores.celoscan.io/tx";

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="bottom"
        className="bg-white rounded-t-xl font-poppins max-h-[90vh] overflow-auto"
      >
        {processing ? (
          // ─── Processing View ───────────────────────────────────
          <div className="flex flex-col items-center justify-center h-64 space-y-4">
            <p className="text-gray-500">Processing…</p>
          </div>
        ) : joined ? (
          // ─── Success View ──────────────────────────────────────
    
<div className="flex flex-col justify-center h-full p-6 space-y-6">
  {/* header row */}
  <div className="flex items-center justify-between">
    <CaretLeft
      size={24}
      className="cursor-pointer"
      onClick={() => {
        setJoined(false)
        onOpenChange(true)
      }}
    />
    <button
      onClick={() => onOpenChange(false)}
      className="font-bold text-sm text-green-600 hover:underline"
    >
      Close
    </button>
  </div>

  {/* image + badge */}
  <div className="relative flex justify-center">          {/* ⬅️ give context */}
    <Image src={Successsvg} alt="Success" />

    {/* badge overlay – ignore clicks */}
    <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
      <div className="pointer-events-auto flex items-center gap-1 rounded-md bg-[#07955F]/80 px-3 py-1">
        <h2 className="text-xl">{count}</h2>
        <span className="text-sm">Tickets</span>
      </div>
    </div>
  </div>

  {/* explorer link */}
  <Link
    href={`${explorerBase}/${txHash}`}
    target="_blank"
    rel="noopener noreferrer"
    className="flex items-center justify-center gap-1 font-bold text-[#07955F]"
  >
    View blockchain receipt <Share size={20} />
  </Link>

  {/* done button */}
  <Button
          className="w-full rounded-xl bg-[#07955F] py-4 font-semibold text-white"
          onClick={() => onOpenChange(false)} title={"Done"}  >
    Done
  </Button>
</div>

        ) : (
          // ─── Purchase View ────────────────────────────────────
          <div className="p-4">
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

            <div className="text-gray-500 rounded-xl py-3 text-center mb-4">
              <p className="text-sm">
                Join our raffle for {raffle.prize} {raffle.symbol} and win big!
              </p>
            </div>

            <div className="mb-4 text-sm space-y-2">
              <div className="flex justify-between">
                <span className="font-medium">Prize</span>
                <span className="text-gray-700">
                  {raffle.prize} {raffle.symbol}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="font-medium">Price per ticket</span>
                <span className="text-gray-700">{ticketCostNum} MiniMiles</span>
              </div>
              <div className="flex justify-between">
                <span className="font-medium">Draw Date</span>
                <span className="text-gray-700">{raffle.endDate}</span>
              </div>
            </div>

            <p className="text-center text-2xl font-semibold mb-6">
              Buy tickets
            </p>
            <div className="flex items-center justify-center space-x-2 mb-4">
              <Image src={Ticket} alt="Ticket icon" width={32} height={32} />
              <span className="text-2xl font-semibold">{count}</span>
            </div>

            {/* Ticket count controls */}
            <div className="mb-4">
              <div className="flex items-center space-x-2">
                <button
                  onClick={() => setCount((c) => Math.max(1, c - 1))}
                  className="p-2 bg-gray-100 rounded-full"
                >
                  <Minus size={20} />
                </button>
                <Slider
                  value={[count]}
                  min={1}
                  max={maxTickets}
                  step={1}
                  onValueChange={([v]) => setCount(v)}
                  className="flex-1"
                />
                <button
                  onClick={() => setCount((c) => Math.min(maxTickets, c + 1))}
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

            {/* Preset quick buttons */}
            <div className="flex gap-2 mb-4">
              {PRESETS.map((n) => (
                <button
                  key={n}
                  onClick={() => setCount(Math.min(n, maxTickets))}
                  disabled={n > maxTickets}
                  className={`flex-1 rounded-xl py-2 font-semibold ${count === n
                    ? "bg-green-600 text-white"
                    : "bg-gray-100 text-gray-800"
                    }`}
                >
                  <div className="flex items-center justify-center space-x-1">
                    <Image
                      src={Ticket}
                      alt="Ticket icon"
                      width={16}
                      height={16}
                    />
                    <span>{n}</span>
                  </div>
                </button>
              ))}
            </div>

            <p className="text-center text-xs text-gray-500 mb-1">
              Available tickets: {maxTickets}
            </p>
            <p className="text-center text-sm font-medium mb-6">
              Total cost: {totalCost} MiniMiles
            </p>

            <SheetFooter>
              <Button
                title="Buy"
                onClick={handleBuy}
                className="w-full bg-green-600 text-white rounded-xl py-4 font-semibold"
              />
            </SheetFooter>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
