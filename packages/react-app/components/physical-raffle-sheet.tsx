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
  endDate: string;
  ticketCost: string;
  image: StaticImageData;
  balance: number;
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

const emailLooksValid = (s: string) =>
  /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s.trim());

const phoneLooksValid = (s: string) => {
  const t = String(s || "").trim();
  // allow E.164 like +2547..., or local digits 9–15 chars
  return /^\+?[0-9]{9,15}$/.test(t);
};

export default function PhysicalRaffleSheet({ open, onOpenChange, raffle }: Props) {
  const { address, getUserAddress, joinRaffle } = useWeb3();

  const [count, setCount] = useState(1);
  const [processing, setProcessing] = useState(false);
  const [joined, setJoined] = useState(false);
  const [txHash, setTxHash] = useState<string | null>(null);
  const [errorModal, setErrorModal] = useState<{ title: string; desc?: string } | null>(null);

  // profile fields
  const [twitter, setTwitter] = useState<string>("");
  const [email, setEmail] = useState<string>("");
  const [phone, setPhone] = useState<string>("");

  // saved flag
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    getUserAddress();
  }, [getUserAddress]);

  // prefill user profile when modal opens + address available
  useEffect(() => {
    async function loadProfile() {
      if (!open || !address) return;
      try {
        const res = await fetch(`/api/users/${address}`, { cache: "no-store" });
        const json = await res.json();
        if (res.ok) {
          const u = json?.user || {};
          setTwitter(u?.twitter_handle || "");
          setEmail(u?.email || "");
          setPhone(u?.phone || "");
          // consider “saved” true if all required present
          setSaved(Boolean(u?.email && u?.twitter_handle && u?.phone));
        } else {
          // not fatal — user might be new
          setSaved(false);
        }
      } catch {
        setSaved(false);
      }
    }
    loadProfile();
  }, [open, address]);

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
    setSaved(false);
    setSaving(false);
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

  const handleSaveDetails = async () => {
    if (!address) {
      setErrorModal({ title: "Connect wallet", desc: "Please connect your wallet first." });
      return;
    }
    if (!twitter || !twitter.trim()) {
      setErrorModal({ title: "Twitter required", desc: "Please enter your Twitter username." });
      return;
    }
    if (!emailLooksValid(email)) {
      setErrorModal({ title: "Valid email required", desc: "Please enter a valid email address." });
      return;
    }
    if (!phoneLooksValid(phone)) {
      setErrorModal({ title: "Valid phone required", desc: "Enter a valid phone number (e.g., +2547XXXXXXX)." });
      return;
    }

    try {
      setSaving(true);
      const res = await fetch(`/api/users/${address}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        cache: "no-store",
        body: JSON.stringify({
          twitter_handle: twitter.trim(),
          email: email.trim(),
          phone: phone.trim(),
        }),
      });
      const json = await res.json();
      if (!res.ok || json?.ok !== true) {
        const reason = json?.error || "Could not save your details.";
        setErrorModal({ title: "Save failed", desc: String(reason) });
        setSaved(false);
        return;
      }
      setSaved(true);
    } catch (e: any) {
      setErrorModal({ title: "Save error", desc: e?.message ?? String(e) });
      setSaved(false);
    } finally {
      setSaving(false);
    }
  };

  const handleBuy = async () => {
    if (!saved) {
      setErrorModal({ title: "Details required", desc: "Please save your details first." });
      return;
    }
    if (!address) {
      setErrorModal({ title: "Connect wallet", desc: "Please connect your wallet first." });
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
      setProcessing(true);
      setJoined(false);
      setTxHash(null);

      const hash = await joinRaffle(raffle.id, count);
      setTxHash(hash);

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
                  Physical Lucky Draw
                </h3>
                <div className="flex w-full items-center gap-2">
                  <h3 className="text-lg font-medium">{raffle.title}</h3>
                  <h3 className="ml-auto text-sm text-[#238D9D]">by CeloPG ›</h3>
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

              {/* Profile details (Twitter + Email + Phone) */}
              <div className="mb-4 space-y-3">
                <div>
                  <label className="block text-sm font-medium mb-1">Twitter username</label>
                  <input
                    value={twitter}
                    onChange={(e) => setTwitter(e.target.value)}
                    placeholder="@yourhandle"
                    className="w-full border rounded-xl px-3 py-2 focus:outline-none focus:ring-2 focus:ring-[#238D9D]"
                  />
                  <p className="text-xs text-gray-500 mt-1">Used to publicly announce winners.</p>
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">Email address</label>
                  <input
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="you@example.com"
                    inputMode="email"
                    className="w-full border rounded-xl px-3 py-2 focus:outline-none focus:ring-2 focus:ring-[#238D9D]"
                  />
                  <p className="text-xs text-gray-500 mt-1">We’ll contact winners via this email.</p>
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">Phone number</label>
                  <input
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    placeholder="+2547XXXXXXX"
                    inputMode="tel"
                    className="w-full border rounded-xl px-3 py-2 focus:outline-none focus:ring-2 focus:ring-[#238D9D]"
                  />
                  <p className="text-xs text-gray-500 mt-1">Optional WhatsApp follow-up if needed.</p>
                </div>

                {/* Terms */}
                <p className="text-xs text-gray-500">
                  By submitting this, you agree to the{" "}
                  <Link
                    href="/terms"
                    target="_blank"
                    className="text-[#238D9D] underline underline-offset-2"
                  >
                    terms and conditions
                  </Link>.
                </p>

                <Button
                  onClick={handleSaveDetails}
                  disabled={saving || soldOut || notEnough}
                  title={saved ? "Saved ✓" : saving ? "Saving…" : "Save details"}
                  className={`w-full rounded-xl h-[48px] font-medium ${
                    saved ? "bg-[#18a34a] hover:bg-[#169343]" : "bg-[#238D9D] hover:bg-[#1f7b89]"
                  } text-white`}
                >
                  {saved ? "Saved ✓" : saving ? "Saving…" : "Save details"}
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
                  disabled={soldOut || notEnough || count === 0 || !saved}
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
                ) : !saved ? (
                  <p className="text-center text-sm text-gray-600">
                    Save your details to enable buying.
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
