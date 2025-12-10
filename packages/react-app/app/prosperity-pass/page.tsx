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

const REQUIRED_MILES = 20;

export default function ProsperityPassOnboarding() {
  const router = useRouter();
  const [api, setApi] = useState<CarouselApi | null>(null);
  const [idx, setIdx] = useState(0);

  const { address, getUserAddress, getakibaMilesBalance } = useWeb3();
  const [milesBalance, setMilesBalance] = useState<number | null>(null);
  const [showSuccess, setShowSuccess] = useState(false);

  useEffect(() => {
    if (!api) return;

    const onSelect = () => setIdx(api.selectedScrollSnap());

    api.on("select", onSelect);
    onSelect();

    // ✅ explicit void cleanup
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
    if (!address) return;

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
  const canClaim = balanceReady && !insufficient;

  const finish = () => {
    router.push("/");
  };

  const handleCta = () => {
    if (!isLast) {
      api?.scrollNext();
      return;
    }
    if (!canClaim) return; // either loading or insufficient
    // TODO: put real on-chain claim here, then:
    setShowSuccess(true);
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
                            (isLast && insufficient
                              ? "bg-[#D4D4D4] text-white" // grey when insufficient
                              : "bg-[#238D9D] text-white")
                          }
                          onClick={handleCta}
                          disabled={isLast && !canClaim}
                        >
                          {isLast ? (
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
                          ) : (
                            "Next"
                          )}
                        </button>

                        {/* Error only on last step and when balance is known + low */}
                        {isLast && balanceReady && insufficient && (
                          <p className="text-center text-xs text-red-600">
                            Insufficient AkibaMiles
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
