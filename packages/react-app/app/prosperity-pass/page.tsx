// src/app/prosperity-pass/page.tsx
"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { CaretLeft } from "@phosphor-icons/react";
import {
  Carousel,
  CarouselContent,
  CarouselItem,
  CarouselApi,
} from "@/components/ui/carousel";
import { prosperityPassSource } from "@/helpers/prosperitypassSource";
import { ProsperityPassSuccessSheet } from "@/components/ProsperityPassSuccessSheet";
import { useWeb3 } from "@/contexts/useWeb3";
import { akibaMilesSymbolAlt } from "@/lib/svg";

// 🔗 claim helper
import { claimProsperityPassForAddress } from "@/lib/prosperity-pass-claim";

const REQUIRED_MILES = 100;

export default function ProsperityPassOnboarding() {
  const router = useRouter();
  const [api, setApi] = useState<CarouselApi | null>(null);
  const [idx, setIdx] = useState(0);

  const { address, getUserAddress, getakibaMilesBalance, burnAkibaMiles } =
  useWeb3();
  const [milesBalance, setMilesBalance] = useState<number | null>(null);
  const [showSuccess, setShowSuccess] = useState(false);

  // NEW: submit state
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  useEffect(() => {
    if (!api) return;

    const onSelect = () => setIdx(api.selectedScrollSnap());

    api.on("select", onSelect);
    onSelect();

    // ✅ explicit cleanup
    return () => {
      api.off("select", onSelect);
    };
  }, [api]);

  const isLast = idx === prosperityPassSource.length - 1;

  /* ───────── wallet + balance ───────── */
  useEffect(() => {
    getUserAddress();
  }, [getUserAddress]);

  useEffect(() => {
    if (!address) {
      setMilesBalance(null);
      return;
    }

    (async () => {
      try {
        const balStr = await getakibaMilesBalance(); // string, 18d formatted
        const balNum = parseFloat(balStr);
        setMilesBalance(Number.isNaN(balNum) ? 0 : balNum);
      } catch (e) {
        console.error("[ProsperityPass] balance fetch failed:", e);
        setMilesBalance(0);
      }
    })();
  }, [address, getakibaMilesBalance]);

  // balance logic: only grey out when we KNOW it's insufficient
  const balanceReady = milesBalance !== null;
  const insufficient = balanceReady && milesBalance! < REQUIRED_MILES;
  const canClaim =
    balanceReady && !insufficient && !!address && !isSubmitting;

  const finish = () => {
    router.push("/");
  };

  const handleCta = async () => {
    setSubmitError(null);

    // Not last slide → just move carousel
    if (!isLast) {
      api?.scrollNext();
      return;
    }

    if (!address) {
      setSubmitError("Connect your wallet to claim your Prosperity Pass.");
      return;
    }

    if (!canClaim) {
      // either loading, insufficient, no wallet, or already submitting
      return;
    }

    setIsSubmitting(true);

    try {
      // 1) User burns 100 AkibaMiles from their own wallet
      await burnAkibaMiles(REQUIRED_MILES);

      // 2) Backend creates the eco account / Super Account
      const result = await claimProsperityPassForAddress(
        address,
        REQUIRED_MILES
      );

      console.log("[ProsperityPass] claim result:", result);

      setShowSuccess(true);
    } catch (err: any) {
      console.error("[ProsperityPass] claim failed:", err);

      // If creation step failed AFTER burning, try to refund
      // We don't have perfect introspection here, but in practice:
      //  - if burn fails, it throws BEFORE claimProsperityPassForAddress
      //  - if claim fails, we're in this catch AFTER a successful burn
      try {
        const res = await fetch("/api/refund-for-passport", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ address, amount: REQUIRED_MILES }),
        });

        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          console.error(
            "[ProsperityPass] refund failed:",
            body?.error || "unknown refund error"
          );
        } else {
          const body = await res.json().catch(() => ({}));
          console.info(
            "[ProsperityPass] refund tx:",
            body?.txHash || "(no txHash returned)"
          );
        }
      } catch (refundErr) {
        console.error(
          "[ProsperityPass] refund request threw:",
          refundErr
        );
      }

      setSubmitError(
        err?.message ||
          "We couldn't complete your Prosperity Pass creation. Your points should be refunded. If not, please contact support."
      );
    } finally {
      setIsSubmitting(false);
    }
  };


  return (
    <>
      <div className="h-screen bg-white font-sterling">
        <Carousel setApi={setApi}>
          <CarouselContent className="h-screen">
            {prosperityPassSource.map((step, i) => (
              <CarouselItem key={i}>
                {/* Full-page layout */}
                <div className="flex h-screen flex-col px-6 pb-8 pt-6">
                  {/* Top bar */}
                  <div className="mb-3 flex h-10 w-full items-center justify-between">
                    {i > 0 ? (
                      <button
                        type="button"
                        onClick={() => api?.scrollPrev()}
                        className="flex items-center justify-center"
                      >
                        <CaretLeft size={22} className="text-black" />
                      </button>
                    ) : (
                      <span />
                    )}

                    <button
                      type="button"
                      className="text-sm font-medium text-[#238D9D] hover:underline"
                      onClick={finish}
                    >
                      Skip
                    </button>
                  </div>

                  {/* Main content */}
                  <div className="flex flex-1 flex-col items-center">
                    {/* Illustration */}
                    <div className="mt-4 flex h-[260px] w-[312px] items-center justify-center">
                      <Image
                        src={step.img}
                        alt={step.title}
                        className="h-full w-full object-contain"
                      />
                    </div>

                    {/* Text + steps + button */}
                    <div className="mt-6 flex w-[312px] flex-col gap-8">
                      {/* Message block */}
                      <div>
                        <h2 className="text-[36px] leading-[34px] tracking-[-0.26px] font-bold text-black">
                          {step.title}
                        </h2>
                        <p className="mt-4 text-[18px] leading-[28px] tracking-[-0.26px] text-[#00000080] font-sans">
                          {step.subtitle}
                        </p>
                      </div>

                      {/* Steps */}
                      <div className="flex items-center">
                        <div className="flex space-x-2">
                          {prosperityPassSource.map((_, j) => (
                            <span
                              key={j}
                              className={`h-2 w-8 rounded-full ${
                                j === i ? "bg-[#238D9D]" : "bg-[#238D9D4D]"
                              }`}
                            />
                          ))}
                        </div>
                      </div>

                      {/* CTA + error */}
                      <div className="flex flex-col gap-2">
                        <button
                          type="button"
                          className={
                            "flex h-14 w-full items-center justify-center rounded-2xl text-base font-medium " +
                            (isLast &&
                            (insufficient || isSubmitting || !address)
                              ? "bg-[#D4D4D4] text-white"
                              : "bg-[#238D9D] text-white")
                          }
                          onClick={handleCta}
                          disabled={
                            isSubmitting ||
                            (isLast && (!balanceReady || insufficient))
                          }
                        >
                          {isSubmitting
                            ? "Processing..."
                            : isLast
                            ? (
                              <>
                                <span>Claim Pass for</span>
                                <Image
                                  src={akibaMilesSymbolAlt}
                                  alt=""
                                  width={20}
                                  height={20}
                                  className="mx-1 h-5 w-5"
                                />
                                <span>{REQUIRED_MILES} AkibaMiles</span>
                              </>
                            )
                            : "Next"}
                        </button>

                        {/* Balance error */}
                        {isLast && balanceReady && insufficient && (
                          <p className="text-center text-xs text-red-600">
                            Insufficient AkibaMiles
                          </p>
                        )}

                        {/* Wallet / claim error */}
                        {submitError && (
                          <p className="text-center text-xs text-red-600">
                            {submitError}
                          </p>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              </CarouselItem>
            ))}
          </CarouselContent>
        </Carousel>
      </div>

      {/* Success sheet overlays this page */}
      <ProsperityPassSuccessSheet
        open={showSuccess}
        onOpenChange={setShowSuccess}
        onDone={finish}
      />
    </>
  );
}
