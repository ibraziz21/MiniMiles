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
import FeedbackDialog from './FeedbackDialog'
import { CaretLeft, Minus, Plus, Share } from "@phosphor-icons/react";
import { Slider } from "./ui/slider";
import { Ticket, Successsvg, akibaMilesSymbol } from "@/lib/svg";
import { StaticImageData } from "next/image";
import { useWeb3 } from "@/contexts/useWeb3";
import Link from "next/link";
import posthog from "posthog-js";
import { UserRejectedRequestError } from "viem";
import { toast } from "sonner";

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
  totalTickets: number;
  maxTickets: number;
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
  const [errorModal, setErrorModal] = useState<{title: string; desc?: string} | null>(null)

  const { joinRaffle, address, getUserAddress } = useWeb3();

  useEffect(() => {
    getUserAddress();
  }, []);

  // Derive numeric values
  const ticketCostNum = Number(raffle?.ticketCost.replace(/\D/g, "")) || 1;
  const maxTickets = Math.floor((raffle?.balance ?? 0) / ticketCostNum)
  const affordable     = Math.floor((raffle?.balance ?? 0) / ticketCostNum);
  const notEnough  = (raffle?.balance ?? 0) < ticketCostNum

  const soldOut = raffle
  ? raffle.totalTickets >= raffle.maxTickets   // no more tickets in the pool
  : false;
  const totalCost = count * ticketCostNum;

  let milesSymbol
  if(raffle?.symbol ==="Miles"){
    milesSymbol = "AkibaMiles"
  }else{
    milesSymbol = raffle?.symbol
  }

  // Reset when raffle changes
  useEffect(() => {
    setCount(1);
    setProcessing(false);
    setJoined(false);
    setTxHash(null);
  }, [raffle]);

  useEffect(() => {
    setCount(soldOut ? 0 : 1);   // NEW – default to 0 if sold out
    setProcessing(false);
    setJoined(false);
    setTxHash(null);
  }, [raffle, soldOut]);

  // Clamp count
  useEffect(() => {
    if (soldOut) {                // NEW – nothing selectable
      if (count !== 0) setCount(0);
      return;
    }
    if (affordable === 0) {
      if (count !== 0) setCount(0);
      return;
    }
    if (count < 1) setCount(1);
    else if (count > affordable) setCount(affordable);
  }, [count, affordable, soldOut]);

  if (!raffle) return null;

  const handleBuy = async () => {
    posthog.capture('buy-state', {
      raffle,
      address
    })
    if (!raffle) return;                // should never happen, but guards TS
    console.log("Button actually runs function")

    if (!address) {
      console.error("Not Connected")
    }
    console.log(address)
    try {
      // 1️⃣ Start spinner / disable UI
      setProcessing(true);
      setJoined(false);
      setTxHash(null);
      console.log("Processing....")

      // 2️⃣ Send tx (your hook returns the hash)
      const hash = await joinRaffle(raffle.id, count);
      posthog.capture('join-success', {
        hash
      })
      setTxHash(hash);
      console.log("Tx Hash", hash)

  
      try {
       
        await new Promise((res) => setTimeout(res, 6_000));
      } catch {
        /* ignore wait errors – we’ll still show success after the timeout */
      }

      // 4️⃣ Switch to success screen
      setJoined(true);
    } catch (err: any) {
      posthog.capture("buy-button-press-error", {
        err: err
      })
      const rejected =
      err instanceof UserRejectedRequestError ||
      /user rejected/i.test(err?.message ?? '')

      if (rejected) {
        setErrorModal({
          title: 'Transaction cancelled',
          desc:  'You closed the wallet popup.',
        })
      } else {
        setErrorModal({
          title: 'Transaction failed',
          desc:  err?.message ?? 'Something went wrong.',
        })
      }
  
    } finally {
      // 5️⃣ Always stop spinner
      setProcessing(false);
    }
  };

  // Block explorer URL (Alfajores)
  const explorerBase = "https://celoscan.io/tx";

  return (
    <>
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="bottom"
        className="bg-white rounded-t-xl font-sterling max-h-[90vh] overflow-auto p-3"
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
            </div>

            <div className="flex justify-center">
              <h3 className="font-bold text-lg text-center">Your raffle tickets have been successfully purchased!</h3>
            </div>

            {/* image + badge */}
            <div className="relative flex justify-center">          {/* ⬅️ give context */}
              <Image src={Successsvg} alt="Success" />

              {/* badge overlay – ignore clicks */}
              <div className="pointer-events-none absolute inset-0 top-20 flex flex-col items-center justify-center">
                <div className="pointer-events-auto flex items-center gap-1 rounded-md  px-3 py-1 text-white">
                  <h2 className="text-4xl mr-2">{count}</h2>
                  <span className="text-2xl">ticket{count > 1 ? 's' : null}</span>
                </div>
              </div>

            </div>

            <div className="flex flex-col justify-center items-center">
              <div className="">

                  <h4 className="bg-[#ADF4FF] rounded-full text-[#238D9D] px-4 font-semibold">Purchased</h4>
              </div>
              {/* <h3 className="">28 May 2025, 14:20</h3> */}
            </div>
            {/* explorer link */}
            <Link
              href={`${explorerBase}/${txHash}`}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center justify-center gap-1 font-medium text-[#238D9D]"
            >
              View blockchain receipt <Share size={20} />
            </Link>

            {/* done button */}
            <Button
              className="w-full rounded-xl bg-[#238D9D1A] text-[#238D9D] py-4 font-medium text-lg h-[56px]"
              onClick={() => onOpenChange(false)} title={"Close"}  >
              Close
            </Button>
          </div>

        ) : (
          // ─── Purchase View ────────────────────────────────────
          <div className="">
            <SheetHeader className="pt-4">
              <SheetTitle></SheetTitle>
            </SheetHeader>

            <div className="flex flex-col justify-start items-start mb-2">
              <h3 className='text-sm font-medium bg-[#24E5E033] text-[#1E8C89] rounded-full px-3 '>Digital cash raffle</h3>
              <h2 className="text-black font-medium text-3xl my-2">Weekly Raffle</h2>
            </div>

            <div className="relative w-full h-40 rounded-xl overflow-hidden mb-4">
              <Image
                src={raffle.image}
                alt={`${raffle.title} banner`}
                fill
                className="object-cover"
              />
              <div
                className={`absolute top-10 right-5 p-2 `}>
                <p className="font-medium text-white text-3xl"></p>
                <p className="text-xs  rounded-full p-1 mt-1 flex items-center text-white">
                  {/* <Image src={akibaMilesSymbol} alt="" width={16} height={16} className="mr-1" /> */}
                  
                </p>
              </div>
            </div>

            <div className="text-gray-500 rounded-xl py-3 text-center mb-4">
              <p className="text-sm">
                Join our raffle for {raffle.prize} {milesSymbol} and win big!
              </p>
            </div>

            <div className="mb-4 text-sm space-y-2">
              <div className="flex justify-between">
                <span className="font-medium">Prize</span>
                <span className="text-gray-700 flex">
                  <Image src={akibaMilesSymbol} alt="" width={16} height={16} className="mr-1" /> {raffle.prize} {milesSymbol}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="font-medium">Price per ticket</span>
                <span className="text-gray-700 flex "><Image src={akibaMilesSymbol} alt="" width={16} height={16} className="mr-1" />{ticketCostNum} AkibaMiles</span>
              </div>
              <div className="flex justify-between">
                <span className="font-medium">Draw Date</span>
                <span className="text-gray-700">{raffle.endDate}</span>
              </div>
            </div>

            <p className="text-center text-xl font-medium mb-6">
              Buy tickets
            </p>
            <div className="flex items-center justify-center space-x-2 mb-4">
              <Image src={Ticket} alt="Ticket icon" width={32} height={32} />
              <span className="text-2xl font-medium text-[#238D9D]">{count}</span>
            </div>

            {/* Ticket count controls */}
            <div className="mb-4">
              <div className="flex items-center space-x-2">
                <button
                  onClick={() => setCount((c) => Math.max(1, c - 1))}
                  className="p-2 bg-gray-100 rounded-full"
                >
                  <Minus size={20} color="#238D9D" />
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
                  <Plus size={20} color="#238D9D" />
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
                  className={`flex-1 rounded-xl py-2 px-3 font-medium ${count === n
                    ? "border-[#238D9D] bg-[#238D9D1A] text-[#238D9D] border-2"
                    : "bg-[#238D9D1A] text-[#238D9D]"
                    }`}
                >
                  <div className="flex items-center justify-center space-x-1">
                    <Image
                      src={Ticket}
                      alt="Ticket icon"
                      width={24}
                      height={24}
                    />
                    <span>{n}</span>
                  </div>
                </button>
              ))}
            </div>
            <p className="text-center text-xs text-gray-500 "> Select an amount of tickets to buy </p>
            <div className="text-center text-xs text-gray-500 flex justify-center items-center"> Balance: <Image src={akibaMilesSymbol} alt="" width={16} height={16} className="mr-1" /> <p className="font-medium text-black">{maxTickets}</p> <p className="text-xs mx-1 rounded-full py-1 px-3 flex items-center text-[#219653] bg-[#238D9D1A]">
              Max
            </p>
            </div>
            <p className="text-center text-sm font-medium mb-6">
              Total cost: {totalCost} AkibaMiles
            </p>
            <SheetFooter className="flex flex-col w-full space-y-2">
  {/* primary action */}
  <Button
                      onClick={handleBuy}
                      disabled={soldOut || notEnough || count === 0}
                      className="w-full bg-[#238D9D] text-white rounded-xl h-[56px] font-medium" title={"Buy Ticket"}  >
    Buy
  </Button>

  {/* helper message */}
  {soldOut ? (
    <p className="text-center text-sm font-semibold text-gray-500">
      All tickets have been sold&nbsp;🎉
    </p>
  ) : notEnough ? (
    <p className="text-center text-sm text-red-600">
      You don’t have enough AkibaMiles to buy a ticket.
    </p>
  ) : null}
</SheetFooter>
          </div>
        )}
      </SheetContent>
    </Sheet>
    {errorModal && (
       <FeedbackDialog
        open={true}
          title={errorModal.title}
         description={errorModal.desc}
         onClose={() => setErrorModal(null)}
       />
    )}
    </>
  );
 

  


}
