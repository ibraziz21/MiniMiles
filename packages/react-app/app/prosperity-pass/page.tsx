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
import { ProsperityPassUsernameSheet } from "@/components/ProsperityPassUsernameSheet";
import { useWeb3 } from "@/contexts/useWeb3";
import { akibaMilesSymbolAlt } from "@/lib/svg";

const REQUIRED_MILES = 100;
const STATUS_POLL_INTERVAL_MS = 3000;

export default function ProsperityPassOnboarding() {
  const router = useRouter();
  const [api, setApi] = useState<CarouselApi | null>(null);
  const [idx, setIdx] = useState(0);

  const { address, getUserAddress, getakibaMilesBalance } = useWeb3();
  const [milesBalance, setMilesBalance] = useState<number | null>(null);
  const [showSuccess, setShowSuccess] = useState(false);

  // NEW: username sheet state
  const [showUsernameSheet, setShowUsernameSheet] = useState(false);

  // submit state
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  useEffect(() => {
    if (!api) return;

    const onSelect = () => setIdx(api.selectedScrollSnap());

    api.on("select", onSelect);
    onSelect();

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

  // balance logic
  const balanceReady = milesBalance !== null;
  const insufficient = balanceReady && milesBalance! < REQUIRED_MILES;
  const canClaim =
    balanceReady && !insufficient && !!address && !isSubmitting;

  const finish = () => {
    router.push("/");
  };

  const waitForPassCompletion = async (idempotencyKey: string) => {
    const deadline = Date.now() + 5 * 60 * 1000;

    while (Date.now() < deadline) {
      const res = await fetch(
        `/api/prosperity-pass/status?idempotencyKey=${encodeURIComponent(idempotencyKey)}`,
        { cache: "no-store" },
      );

      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(body?.error || "Could not read Prosperity Pass job status");
      }

      if (body?.status === "completed") {
        return body;
      }

      if (body?.status === "failed") {
        throw new Error(
          body?.error ||
          "We couldn't complete your Prosperity Pass creation. Any required refund will be handled by the backend worker.",
        );
      }

      await new Promise((resolve) => setTimeout(resolve, STATUS_POLL_INTERVAL_MS));
    }

    throw new Error("Prosperity Pass creation is still processing. Please check again shortly.");
  };

  const runClaimFlow = async () => {
    if (!address) {
      setSubmitError("Connect your wallet to claim your Prosperity Pass.");
      return;
    }

    setSubmitError(null);
    setIsSubmitting(true);

    try {
      const idempotencyKey = crypto.randomUUID();
      const claimRes = await fetch("/api/prosperity-pass/claim", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ idempotencyKey }),
      });

      const claimBody = await claimRes.json().catch(() => ({}));
      if (!claimRes.ok) {
        throw new Error(claimBody?.error || "Failed to queue Prosperity Pass creation");
      }

      if (claimBody?.status === "completed") {
        setShowSuccess(true);
        return;
      }

      await waitForPassCompletion(idempotencyKey);
      setShowSuccess(true);
    } catch (err: any) {
      console.error("[ProsperityPass] queued claim failed:", err);
      setSubmitError(
        err?.message || "We couldn't complete your Prosperity Pass creation. Please try again.",
      );
    } finally {
      setIsSubmitting(false);
    }
  };


  const handleCta = async () => {
    setSubmitError(null);

    // Not last slide → just move carousel
    if (!isLast) {
      api?.scrollNext();
      return;
    }

    // Last slide → claim
    if (!address) {
      setSubmitError("Connect your wallet to claim your Prosperity Pass.");
      return;
    }

    if (!canClaim) {
      // either loading, insufficient, no wallet, or already submitting
      return;
    }

    // At this point we know they can claim.
    // Show username sheet FIRST, then runClaimFlow after username is saved.
    setShowUsernameSheet(true);
  };

  const handleUsernameConfirmed = async (_username: string) => {
    // Username is now saved on backend via /api/user/set-username
    // Now run the burn + claim flow
    await runClaimFlow();
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
                        <CaretLeft size={22} color="#000000" />
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
                  <div className="flex flex-1 flex-col items-center overflow-y-auto">
                    {/* Illustration */}
                    <div className="mt-4 flex h-[min(260px,35vh)] w-full max-w-[312px] flex-shrink-0 items-center justify-center">
                      <Image
                        src={step.img}
                        alt={step.title}
                        className="h-full w-full object-contain"
                      />
                    </div>

                    {/* Text + steps + button */}
                    <div className="mt-4 flex w-full max-w-[312px] flex-col gap-4 pb-2">
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

      {/* Username sheet overlays before claim */}
      <ProsperityPassUsernameSheet
        open={showUsernameSheet}
        onOpenChange={setShowUsernameSheet}
        address={address ?? null}
        onConfirmed={handleUsernameConfirmed}
      />
    </>
  );
}
