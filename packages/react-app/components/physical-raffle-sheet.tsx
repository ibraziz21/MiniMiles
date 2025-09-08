// components/physical-raffle-sheet.tsx
"use client";

import React, { useEffect, useMemo, useState } from "react";
import Image, { type StaticImageData } from "next/image";
import Link from "next/link";
import { Button } from "./ui/button";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetFooter,
} from "./ui/sheet";
import { Slider } from "./ui/slider";
import { CaretLeft, Minus, Plus, Share } from "@phosphor-icons/react";
import { Ticket, akibaMilesSymbol, Successsvg } from "@/lib/svg";
import { useWeb3 } from "@/contexts/useWeb3";
import { UserRejectedRequestError } from "viem";
import FeedbackDialog from "./FeedbackDialog";

export type PhysicalSpendRaffle = {
  id: number;
  title: string;
  endDate: string;           // formatted (e.g., "2d 3h" or your string)
  ticketCost: string;        // formatted string like "5" or "5 AkibaMiles"
  image: StaticImageData;
  balance: number;           // user's miles balance (number)
  totalTickets: number;
  maxTickets: number;
};

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  raffle: PhysicalSpendRaffle | null;
};

const PRESETS = [1, 5, 10, 25, 50];
const explorerBase = "https://celoscan.io/tx";

export default function PhysicalRaffleSheet({ open, onOpenChange, raffle }: Props) {
  const { address, getUserAddress, joinRaffle } = useWeb3();

  const [count, setCount] = useState(1);
  const [processing, setProcessing] = useState(false);
  const [joined, setJoined] = useState(false);
  const [txHash, setTxHash] = useState<string | null>(null);
  const [errorModal, setErrorModal] = useState<{ title: string; desc?: string } | null>(null);

  // new fields
  const [twitter, setTwitter] = useState<string>("");
  const [entryCode, setEntryCode] = useState<string>("");
  const [verified, setVerified] = useState(false);
  const [verifying, setVerifying] = useState(false);

  useEffect(() => {
    getUserAddress();
  }, [getUserAddress]);

  // Parse numeric ticket cost from string (supports "5" or "5 AkibaMiles")
  const ticketCostNum = useMemo(() => {
    if (!raffle?.ticketCost) return 1;
    const m = raffle.ticketCost.match(/\d+(\.\d+)?/);
    return m ? Number(m[0]) : 1;
  }, [raffle?.ticketCost]);

  const affordable = Math.floor((raffle?.balance ?? 0) / ticketCostNum);
  const notEnough = (raffle?.balance ?? 0) < ticketCostNum;
  const soldOut = raffle ? raffle.totalTickets >= raffle.maxTickets : false;
  const maxTickets = affordable;
  const totalCost = count * ticketCostNum;

  // Reset when raffle changes
  useEffect(() => {
    setCount(soldOut ? 0 : 1);
    setProcessing(false);
    setJoined(false);
    setTxHash(null);
    setTwitter("");
    setEntryCode("");
    setVerified(false);
    setVerifying(false);
  }, [raffle, soldOut]);

  // Clamp count based on balance/soldOut
  useEffect(() => {
    if (soldOut || affordable === 0) {
      if (count !== 0) setCount(0);
      return;
    }
    if (count < 1) setCount(1);
    else if (count > affordable) setCount(affordable);
  }, [count, affordable, soldOut]);

  if (!raffle) return null;

  const handleVerify = async () => {
    if (!address) {
      setErrorModal({ title: "Connect wallet", desc: "Please connect your wallet first." });
      return;
    }
    if (!twitter || !twitter.trim()) {
      setErrorModal({ title: "Twitter required", desc: "Please enter your Twitter username." });
      return;
    }
    if (!entryCode || !entryCode.trim()) {
      setErrorModal({ title: "Entry code required", desc: "Please enter the room entry code." });
      return;
    }
    if (soldOut) {
      setErrorModal({ title: "Sold out", desc: "All tickets have been sold." });
      return;
    }
    if (notEnough) {
      setErrorModal({ title: "Insufficient Miles", desc: "You don't have enough AkibaMiles." });
      return;
    }

    try {
      setVerifying(true);
      const res = await fetch("/api/raffles/validate-physical", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        cache: "no-store",
        body: JSON.stringify({
          raffleId: raffle.id,
          address,
          twitter,
          code: entryCode,
          tickets: count,
        }),
      });

      const json = await res.json();
      if (!res.ok || json?.ok !== true) {
        const reason = json?.reason || json?.error || "Invalid code or verification failed.";
        setErrorModal({ title: "Verification failed", desc: String(reason) });
        setVerified(false);
        return;
      }
      setVerified(true);
    } catch (e: any) {
      setErrorModal({ title: "Verification error", desc: e?.message ?? String(e) });
      setVerified(false);
    } finally {
      setVerifying(false);
    }
  };

  const handleBuy = async () => {
    if (!verified) {
      setErrorModal({ title: "Not verified", desc: "Please verify the entry code first." });
      return;
    }
    if (!address) {
      setErrorModal({ title: "Connect wallet", desc: "Please connect your wallet first." });
      return;
    }
    try {
      setProcessing(true);
      setJoined(false);
      setTxHash(null);

      const hash = await joinRaffle(raffle.id, count);
      setTxHash(hash);

      // simple settle delay for UX
      try { await new Promise((r) => setTimeout(r, 3000)); } catch {}

      setJoined(true);
    } catch (err: any) {
      const rejected =
        err instanceof UserRejectedRequestError ||
        /user rejected/i.test(err?.message ?? "");

      if (rejected) {
        setErrorModal({ title: "Transaction cancelled", desc: "You closed the wallet popup." });
      } else {
        setErrorModal({ title: "Transaction failed", desc: err?.message ?? "Something went wrong." });
      }
    } finally {
      setProcessing(false);
    }
  };

  return (
    <>
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent
          side="bottom"
          className="bg-white rounded-t-xl font-sterling max-h-[90vh] overflow-auto p-3"
        >
          {processing ? (
            <div className="flex flex-col items-center justify-center h-64 space-y-4">
              <p className="text-gray-500">Processing…</p>
            </div>
          ) : joined ? (
            <div className="flex flex-col justify-center h-full p-6 space-y-6">
              <div className="flex items-center justify-between">
                <CaretLeft
                  size={24}
                  className="cursor-pointer"
                  onClick={() => {
                    setJoined(false);
                    onOpenChange(true);
                  }}
                />
              </div>

              <div className="flex justify-center">
                <h3 className="font-bold text-lg text-center">
                  Your raffle tickets have been successfully purchased!
                </h3>
              </div>

              <div className="relative flex justify-center">
                <Image src={Successsvg} alt="Success" />
                <div className="pointer-events-none absolute inset-0 top-20 flex flex-col items-center justify-center">
                  <div className="pointer-events-auto flex items-center gap-1 rounded-md px-3 py-1 text-white">
                    <h2 className="text-4xl mr-2">{count}</h2>
                    <span className="text-2xl">ticket{count > 1 ? "s" : null}</span>
                  </div>
                </div>
              </div>

              {txHash && (
                <Link
                  href={`${explorerBase}/${txHash}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center justify-center gap-1 font-medium text-[#238D9D]"
                >
                  View blockchain receipt <Share size={20} />
                </Link>
              )}

              <Button
                className="w-full rounded-xl bg-[#238D9D1A] text-[#238D9D] py-4 font-medium text-lg h-[56px]"
                onClick={() => onOpenChange(false)}
                title={"Close"}
              >
                Close
              </Button>
            </div>
          ) : (
            <div>
              <SheetHeader className="pt-4">
                <SheetTitle></SheetTitle>
              </SheetHeader>

              <div className="flex flex-col items-start mb-2">
                <h3 className="text-sm font-medium bg-[#24E5E033] text-[#1E8C89] rounded-full px-3">
                  Physical raffle
                </h3>
                <div className="flex w-full items-center gap-2">
  <h3 className="text-lg font-medium">{raffle.title}</h3>
  <h3 className="ml-auto text-sm text-[#238D9D]">
    by CeloPG ›
  </h3>
</div>
              </div>

              <div className="relative w-full h-40 rounded-xl overflow-hidden mb-4">
                <Image
                  src={raffle.image}
                  alt={`${raffle.title} banner`}
                  fill
                  className="object-cover"
                />
              </div>

              <div className="mb-3 text-sm space-y-2">
                <div className="flex justify-between">
                  <span className="font-medium">Price per ticket</span>
                  <span className="text-gray-700 flex">
                    <Image src={akibaMilesSymbol} alt="" width={16} height={16} className="mr-1" />
                    {ticketCostNum} AkibaMiles
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="font-medium">Draw Date</span>
                  <span className="text-gray-700">{raffle.endDate}</span>
                </div>
              </div>

              {/* NEW: Twitter + Entry Code */}
              <div className="mb-4 space-y-3">
                <div>
                  <label className="block text-sm font-medium mb-1">Twitter username</label>
                  <input
                    value={twitter}
                    onChange={(e) => setTwitter(e.target.value)}
                    placeholder="@yourhandle"
                    className="w-full border rounded-xl px-3 py-2 focus:outline-none focus:ring-2 focus:ring-[#238D9D]"
                  />
                  <p className="text-xs text-gray-500 mt-1">
                    Used to publicly announce winners.
                  </p>
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">Entry code</label>
                  <input
                    value={entryCode}
                    onChange={(e) => setEntryCode(e.target.value)}
                    placeholder="Enter the room code"
                    className="w-full border rounded-xl px-3 py-2 focus:outline-none focus:ring-2 focus:ring-[#238D9D]"
                  />
                  <p className="text-xs text-gray-500 mt-1">
                    For this demo, only people in the room can enter.
                  </p>
                </div>
                <Button
                  onClick={handleVerify}
                  disabled={verifying || verified || soldOut || notEnough}
                  title={verified ? "Verified ✓" : verifying ? "Verifying…" : "Verify entry code"}
                  className={`w-full rounded-xl h-[48px] font-medium ${
                    verified ? "bg-[#18a34a] hover:bg-[#169343]" : "bg-[#238D9D] hover:bg-[#1f7b89]"
                  } text-white`}
                >
                  {verified ? "Verified ✓" : verifying ? "Verifying…" : "Verify entry code"}
                </Button>
              </div>

              {/* Tickets */}
              <p className="text-center text-xl font-medium mb-4">Buy tickets</p>
              <div className="flex items-center justify-center space-x-2 mb-4">
                <Image src={Ticket} alt="Ticket icon" width={32} height={32} />
                <span className="text-2xl font-medium text-[#238D9D]">{count}</span>
              </div>

              <div className="mb-4">
                <div className="flex items-center space-x-2">
                  <button
                    onClick={() => setCount((c) => Math.max(1, c - 1))}
                    className="p-2 bg-gray-100 rounded-full"
                    disabled={soldOut || affordable === 0}
                  >
                    <Minus size={20} color="#238D9D" />
                  </button>
                  <Slider
                    value={[count]}
                    min={1}
                    max={Math.max(1, maxTickets)}
                    step={1}
                    onValueChange={([v]) => setCount(v)}
                    className="flex-1"
                    disabled={soldOut || affordable === 0}
                  />
                  <button
                    onClick={() => setCount((c) => Math.min(maxTickets, c + 1))}
                    className="p-2 bg-gray-100 rounded-full"
                    disabled={soldOut || affordable === 0}
                  >
                    <Plus size={20} color="#238D9D" />
                  </button>
                </div>
                <div className="flex justify-between text-xs text-gray-500 mt-1">
                  <span>Min: 1</span>
                  <span>Max: {maxTickets}</span>
                </div>
              </div>

              <div className="text-center text-xs text-gray-500 flex justify-center items-center">
                Balance:
                <Image src={akibaMilesSymbol} alt="" width={16} height={16} className="mx-1" />
                <p className="font-medium text-black">{raffle.balance}</p>
              </div>

              <p className="text-center text-sm font-medium my-4">
                Total cost: {totalCost} AkibaMiles
              </p>

              <SheetFooter className="flex flex-col w-full space-y-2">
                <Button
                  onClick={handleBuy}
                  disabled={soldOut || notEnough || count === 0 || !verified}
                  className="w-full bg-[#238D9D] text-white rounded-xl h-[56px] font-medium"
                  title="Buy Ticket"
                >
                  Buy
                </Button>
                {soldOut ? (
                  <p className="text-center text-sm font-semibold text-gray-500">
                    All tickets have been sold 🎉
                  </p>
                ) : notEnough ? (
                  <p className="text-center text-sm text-red-600">
                    You don’t have enough AkibaMiles to buy a ticket.
                  </p>
                ) : !verified ? (
                  <p className="text-center text-sm text-gray-600">
                    Verify the entry code to enable buying.
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
