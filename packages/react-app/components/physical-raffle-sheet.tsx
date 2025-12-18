// components/physical-raffle-sheet.tsx
"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
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

const explorerBase = "https://celoscan.io/tx";
const BALANCE_REFRESH_EVENT = "akiba:miles:refresh";


/* ──────────────────────────────────────────────────────────── */
/*   Country / phone helpers                                   */
/* ──────────────────────────────────────────────────────────── */

const COUNTRY_OPTIONS = [
  { iso: "NG", name: "Nigeria", dialCode: "+234" },
  { iso: "KE", name: "Kenya", dialCode: "+254" },
  { iso: "GH", name: "Ghana", dialCode: "+233" },
  { iso: "EG", name: "Egypt", dialCode: "+20" },
  { iso: "MA", name: "Morocco", dialCode: "+212" },
  { iso: "CI", name: "Côte d’Ivoire", dialCode: "+225" },
  { iso: "UG", name: "Uganda", dialCode: "+256" },
  { iso: "TZ", name: "Tanzania", dialCode: "+255" },
  { iso: "TN", name: "Tunisia", dialCode: "+216" },
  { iso: "ZA", name: "South Africa", dialCode: "+27" },
] as const;

type CountryOption = (typeof COUNTRY_OPTIONS)[number];

const DEFAULT_COUNTRY_ISO: CountryOption["iso"] = "KE";

const findCountryByIso = (iso: string | null | undefined): CountryOption =>
  COUNTRY_OPTIONS.find((c) => c.iso === iso) ??
  COUNTRY_OPTIONS.find((c) => c.iso === DEFAULT_COUNTRY_ISO)!;

const findCountryByPhone = (
  phone: string | null | undefined
): CountryOption | null => {
  if (!phone) return null;
  const trimmed = phone.trim();
  if (!trimmed.startsWith("+")) return null;
  return COUNTRY_OPTIONS.find((c) => trimmed.startsWith(c.dialCode)) ?? null;
};

const emailLooksValid = (s: string) =>
  /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s.trim());

// local/national number: 6–12 digits, no leading "+"
const phoneLocalLooksValid = (s: string) =>
  /^\d{6,12}$/.test((s || "").trim());

export default function PhysicalRaffleSheet({
  open,
  onOpenChange,
  raffle,
}: Props) {
  const { address, getUserAddress, joinRaffle } = useWeb3();

  const [count, setCount] = useState(1);
  const [processing, setProcessing] = useState(false);
  const [joined, setJoined] = useState(false);
  const [txHash, setTxHash] = useState<string | null>(null);
  const [errorModal, setErrorModal] = useState<{
    title: string;
    desc?: string;
  } | null>(null);

  // profile + verify
  const [twitter, setTwitter] = useState<string>("");
  const [email, setEmail] = useState<string>("");

  // phone split into country + local part
  const [phoneCountryIso, setPhoneCountryIso] =
    useState<CountryOption["iso"]>(DEFAULT_COUNTRY_ISO);
  const [phoneLocal, setPhoneLocal] = useState<string>(""); // no "+", no dial code

  const [verifying, setVerifying] = useState(false);
  const [verified, setVerified] = useState(false);

  // prevent double auto-verify on rapid re-renders
  const autoVerifyTried = useRef(false);

  useEffect(() => {
    getUserAddress();
  }, [getUserAddress]);

  // Prefill user profile when modal opens + address available
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

          const saved = String(u?.phone || "");
          if (saved.startsWith("+")) {
            const country = findCountryByPhone(saved);
            if (country) {
              setPhoneCountryIso(country.iso);
              setPhoneLocal(saved.slice(country.dialCode.length));
            }
          }
        }
      } catch {
        // ignore prefill errors
      }
    }
    loadProfile();
  }, [open, address]);

  // Auto-verify ONLY if twitter+email+phone (valid) are already present
  useEffect(() => {
    const canAutoverify =
      open &&
      address &&
      !verified &&
      !autoVerifyTried.current &&
      twitter.trim() &&
      emailLooksValid(email) &&
      phoneLocalLooksValid(phoneLocal) &&
      raffle;

    if (!canAutoverify) return;

    (async () => {
      autoVerifyTried.current = true;
      try {
        setVerifying(true);

        const country = findCountryByIso(phoneCountryIso);
        const fullPhone = `${country.dialCode}${phoneLocal.trim()}`;

        const res = await fetch("/api/raffles/validate-physical", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          cache: "no-store",
          // tickets omitted → geo-check + upsert profile only
          body: JSON.stringify({
            raffleId: raffle!.id,
            address,
            twitter: twitter.trim(),
            email: email.trim(),
            phone: fullPhone,
          }),
        });
        const json = await res.json();
        if (res.ok && json?.ok) setVerified(true);
      } catch {
        // silent — user can still press Verify manually
      } finally {
        setVerifying(false);
      }
    })();
  }, [open, address, twitter, email, phoneLocal, phoneCountryIso, raffle, verified]);

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

  // Reset when raffle changes / sheet reopens
  useEffect(() => {
    setCount(soldOut ? 0 : 1);
    setProcessing(false);
    setJoined(false);
    setTxHash(null);
    setVerified(false);
    setVerifying(false);
    autoVerifyTried.current = false;

    if (!open) {
      setPhoneCountryIso(DEFAULT_COUNTRY_ISO);
      setPhoneLocal("");
    }
  }, [raffle, soldOut, open]);

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

  // Phone handlers
  const onPhoneLocalChange = (v: string) => {
    const digits = v.replace(/\D/g, "").slice(0, 12);
    setPhoneLocal(digits);
    autoVerifyTried.current = false;
    setVerified(false);
  };

  const onPhoneCountryChange = (iso: CountryOption["iso"]) => {
    setPhoneCountryIso(iso);
    autoVerifyTried.current = false;
    setVerified(false);
  };

  const handleVerify = async () => {
    if (!address) {
      setErrorModal({
        title: "Connect wallet",
        desc: "Please connect your wallet first.",
      });
      return;
    }
    if (!twitter || !twitter.trim()) {
      setErrorModal({
        title: "Twitter required",
        desc: "Please enter your Twitter username.",
      });
      return;
    }
    if (!emailLooksValid(email)) {
      setErrorModal({
        title: "Valid email required",
        desc: "Please enter a valid email address.",
      });
      return;
    }
    // PHONE REQUIRED (local part) – full E.164 is built from dropdown + local
    if (!phoneLocalLooksValid(phoneLocal)) {
      setErrorModal({
        title: "Phone number required",
        desc: "Select your country and enter a valid mobile number (digits only, no leading + or 0).",
      });
      return;
    }
    if (soldOut) {
      setErrorModal({
        title: "Sold out",
        desc: "All tickets have been sold.",
      });
      return;
    }
    if (notEnough) {
      setErrorModal({
        title: "Insufficient Miles",
        desc: "You don't have enough AkibaMiles.",
      });
      return;
    }

    try {
      setVerifying(true);

      const country = findCountryByIso(phoneCountryIso);
      const fullPhone = `${country.dialCode}${phoneLocal.trim()}`;

      const res = await fetch("/api/raffles/validate-physical", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        cache: "no-store",
        body: JSON.stringify({
          raffleId: raffle.id,
          address,
          twitter: twitter.trim(),
          email: email.trim(),
          phone: fullPhone,
          tickets: count, // log participation intent with ticket count
        }),
      });

      const json = await res.json();
      if (!res.ok || json?.ok !== true) {
        const reason = json?.reason || json?.error || "Verification failed.";
        setErrorModal({
          title: "Verification failed",
          desc: String(reason),
        });
        setVerified(false);
        return;
      }
      setVerified(true);
    } catch (e: any) {
      setErrorModal({
        title: "Verification error",
        desc: e?.message ?? String(e),
      });
      setVerified(false);
    } finally {
      setVerifying(false);
    }
  };

  const handleBuy = async () => {
    if (!verified) {
      setErrorModal({
        title: "Not verified",
        desc: "Please verify your location first.",
      });
      return;
    }
    if (!address) {
      setErrorModal({
        title: "Connect wallet",
        desc: "Please connect your wallet first.",
      });
      return;
    }

    try {
      setProcessing(true);
      setJoined(false);
      setTxHash(null);

      const hash = await joinRaffle(raffle.id, count);
      setTxHash(hash);

      try {
        await new Promise((r) => setTimeout(r, 3000));
      } catch {}
      setJoined(true);
    } catch (err: any) {
      const rejected =
        err instanceof UserRejectedRequestError ||
        /user rejected/i.test(err?.message ?? "");
      if (rejected) {
        setErrorModal({
          title: "Transaction cancelled",
          desc: "You closed the wallet popup.",
        });
      } else {
        setErrorModal({
          title: "Transaction failed",
          desc: err?.message ?? "Something went wrong.",
        });
      }
    } finally {
      setProcessing(false);
    }
  };

  const sliderMin = soldOut || affordable === 0 ? 0 : 1;
  const sliderMax =
    soldOut || affordable === 0 ? 0 : Math.max(1, maxTickets || 1);

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
                    <span className="text-2xl">
                      ticket{count > 1 ? "s" : null}
                    </span>
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
                  Physical Reward
                </h3>
                <div className="flex w-full items-center gap-2">
                  <h3 className="text-lg font-medium">{raffle.title}</h3>
                  <h3 className="ml-auto text-sm text-[#238D9D]">
                    by Minipay ›
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
                    <Image
                      src={akibaMilesSymbol}
                      alt=""
                      width={16}
                      height={16}
                      className="mr-1"
                    />
                    {ticketCostNum} AkibaMiles
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="font-medium">Draw Date</span>
                  <span className="text-gray-700">{raffle.endDate}</span>
                </div>
                <div className="flex justify-between">
                  <span className="font-medium">Eligible Locations</span>
                  <span className="text-gray-700 text-right">
                    Nigeria, Kenya, Ghana, Egypt, Morocco, Côte d’Ivoire,
                    Uganda, Tanzania, Tunisia, South Africa
                  </span>
                </div>
              </div>

              {/* Twitter + Email + REQUIRED phone */}
              <div className="mb-4 space-y-3">
                <div>
                  <label className="block text-sm font-medium mb-1">
                    Twitter username
                  </label>
                  <input
                    value={twitter}
                    onChange={(e) => {
                      setTwitter(e.target.value);
                      autoVerifyTried.current = false;
                      setVerified(false);
                    }}
                    placeholder="@yourhandle"
                    className="w-full border rounded-xl px-3 py-2 focus:outline-none focus:ring-2 focus:ring-[#238D9D]"
                  />
                  <p className="text-xs text-gray-500 mt-1">
                    Used to publicly announce winners.
                  </p>
                </div>

                <div>
                  <label className="block text-sm font-medium mb-1">
                    Email address
                  </label>
                  <input
                    value={email}
                    onChange={(e) => {
                      setEmail(e.target.value);
                      autoVerifyTried.current = false;
                      setVerified(false);
                    }}
                    placeholder="you@example.com"
                    inputMode="email"
                    className="w-full border rounded-xl px-3 py-2 focus:outline-none focus:ring-2 focus:ring-[#238D9D]"
                  />
                  <p className="text-xs text-gray-500 mt-1">
                    We’ll contact winners via this email.
                  </p>
                </div>

                <div>
                  <label className="block text-sm font-medium mb-1">
                    Phone number (required)
                  </label>
                  <div className="flex items-center border rounded-xl overflow-hidden">
                    <select
                      className="h-[40px] bg-gray-50 px-3 text-sm text-gray-700 border-r outline-none"
                      value={phoneCountryIso}
                      onChange={(e) =>
                        onPhoneCountryChange(
                          e.target.value as CountryOption["iso"]
                        )
                      }
                    >
                      {COUNTRY_OPTIONS.map((c) => (
                        <option key={c.iso} value={c.iso}>
                          {c.name} {c.dialCode}
                        </option>
                      ))}
                    </select>
                    <input
                      value={phoneLocal}
                      onChange={(e) => onPhoneLocalChange(e.target.value)}
                      placeholder="phone number (no leading 0)"
                      inputMode="numeric"
                      pattern="\d*"
                      maxLength={12}
                      className="w-full px-3 py-2 focus:outline-none text-sm"
                    />
                  </div>
                  <p className="text-xs text-gray-500 mt-1">
                    Select your country and enter your mobile number without the
                    leading 0.
                  </p>
                </div>

                <Button
                  onClick={handleVerify}
                  disabled={verifying || verified || soldOut || notEnough}
                  title={
                    verified
                      ? "Verified ✓"
                      : verifying
                      ? "Verifying…"
                      : "Verify location"
                  }
                  className={`w-full rounded-xl h-[48px] font-medium ${
                    verified
                      ? "bg-[#18a34a] hover:bg-[#169343]"
                      : "bg-[#238D9D] hover:bg-[#1f7b89]"
                  } text-white`}
                >
                  {verified
                    ? "Verified ✓"
                    : verifying
                    ? "Verifying…"
                    : "Verify location"}
                </Button>

                <p className="text-xs text-gray-500">
                  By verifying, you agree to the{" "}
                  <Link
                    href="https://docs.google.com/document/d/1TbZl6gZxT67njFyEWnIfcdne5oFtFrwKEyWi76O3310/edit?usp=sharing"
                    target="_blank"
                    className="text-[#238D9D] underline underline-offset-2"
                  >
                    terms and conditions
                  </Link>
                  .
                </p>
              </div>

              {/* Tickets */}
              <p className="text-center text-xl font-medium mb-4">
                Buy tickets
              </p>
              <div className="flex items-center justify-center space-x-2 mb-4">
                <Image src={Ticket} alt="Ticket icon" width={32} height={32} />
                <span className="text-2xl font-medium text-[#238D9D]">
                  {count}
                </span>
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
                    min={sliderMin}
                    max={sliderMax}
                    step={1}
                    onValueChange={([v]) => setCount(v)}
                    className="flex-1"
                    disabled={soldOut || affordable === 0}
                  />
                  <button
                    onClick={() =>
                      setCount((c) => Math.min(maxTickets || 1, c + 1))
                    }
                    className="p-2 bg-gray-100 rounded-full"
                    disabled={soldOut || affordable === 0}
                  >
                    <Plus size={20} color="#238D9D" />
                  </button>
                </div>
                <div className="flex justify-between text-xs text-gray-500 mt-1">
                  <span>Min: 1</span>
                  <span>Max: {maxTickets || 1}</span>
                </div>
              </div>

              <div className="text-center text-xs text-gray-500 flex justify-center items-center">
                Balance:
                <Image
                  src={akibaMilesSymbol}
                  alt=""
                  width={16}
                  height={16}
                  className="mx-1"
                />
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
                    Verify your location to enable buying.
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
