// app/(onboarding)/onboarding/page.tsx
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
import { onboardingSource } from "@/helpers/onboardingSource";
import { useWeb3 } from "@/contexts/useWeb3";
import { useQueryClient } from "@tanstack/react-query";
import { useMembership } from "@/helpers/useMembership";

export default function Onboarding() {
  const router = useRouter();
  const { address, getUserAddress } = useWeb3();
  const { data: isMember, isFetched } = useMembership();
  const queryClient = useQueryClient();

  /* ---------- state (declare all hooks unconditionally) ---------- */
  const [api, setApi] = useState<CarouselApi | null>(null);
  const [idx, setIdx] = useState(0);

  // referral
  const [refCode, setRefCode] = useState("");
  const [redeemError, setRedeemError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  /* ---------- effects ---------- */
  useEffect(() => { getUserAddress(); }, [getUserAddress]);

  // Grab ?ref= from URL once
  useEffect(() => {
    if (typeof window === "undefined") return;
    const p = new URLSearchParams(window.location.search);
    const v = p.get("ref");
    if (v) setRefCode(v.toUpperCase());
  }, []);

  // Carousel listener
  useEffect(() => {
    if (!api) return;
    const onSelect = () => setIdx(api.selectedScrollSnap());
    api.on("select", onSelect);
    onSelect();
    return () => { api.off("select", onSelect); };
  }, [api]);

  /* ---------- guard after hooks ---------- */
  if (!isFetched) return null;

  const isLast = idx === onboardingSource.length - 1;

  /* ---------- CTA ---------- */
  const finish = async () => {
    if (isMember) {
      router.push("/");
      return;
    }

    setSubmitting(true);
    setRedeemError(null);

    try {
      // 1) Try redeem if code present
      if (refCode.trim()) {
        const res = await fetch("/api/referral/redeem", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ newAddress: address, code: refCode.trim().toUpperCase() }),
        });
        if (!res.ok) {
          const j = await res.json().catch(() => ({}));
          setRedeemError(j.error || "Invalid code");
          setSubmitting(false);
          return; // stop here, let user fix code or remove it
        }
      }

      // 2) Mint + mark member
      await fetch("/api/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userAddress: address }),
      });

      await queryClient.invalidateQueries({ queryKey: ["isMember"] });
      router.push("/");
    } catch (e) {
      console.error(e);
      setRedeemError("Something went wrong. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  const label = isLast
    ? isMember ? "Finish" : submitting ? "Please wait…" : "Claim 100 AkibaMiles"
    : "Next";

  return (
    <div className="relative h-screen font-sterling bg-white">
      {/* Skip link */}
      <div className="absolute top-4 right-4 z-10">
        <button
          className="text-sm font-medium text-[#238D9D] hover:underline disabled:opacity-50"
          onClick={finish}
          disabled={submitting}
        >
          {isMember ? "Skip" : "Skip & Claim"}
        </button>
      </div>

      <Carousel setApi={setApi}>
        <CarouselContent className="h-screen">
          {onboardingSource.map((step, i) => {
            const showReferralInput = !isMember && i === onboardingSource.length - 1; // on last slide, if not member

            return (
              <CarouselItem key={i}>
                <div className="flex flex-col items-center justify-center h-full px-6 bg-onboarding bg-no-repeat bg-cover">
                  {i > 0 && (
                    <button className="self-start mb-4" onClick={() => api?.scrollPrev()}>
                      <CaretLeft size={24} className="text-black" />
                    </button>
                  )}

                  <Image src={step.img} alt={step.title} />

                  <div>
                    <h2 className="mt-5 text-4xl font-[900] text-black">{step.title}</h2>
                    <h4 className="my-5 text-[#00000080] font-poppins">
                      {step.subtitle}
                    </h4>

                    {/* progress */}
                    <div className="flex mb-10 space-x-2">
                      {onboardingSource.map((_, j) => (
                        <span
                          key={j}
                          className={`h-2 w-8 rounded-full ${j === i ? "bg-[#238D9D]" : "bg-[#238D9D4D]"}`}
                        />
                      ))}
                    </div>
                  </div>

                  {/* Referral input on the last slide (only for non-members) */}
                  {showReferralInput && (
                    <div className="w-full mb-6">
                      <label className="block mb-2 text-sm text-gray-600">
                        Have a referral code? (optional)
                      </label>
                      <input
                        value={refCode}
                        onChange={(e) => {
                          setRefCode(e.target.value.toUpperCase());
                          setRedeemError(null);
                        }}
                        placeholder="ABC123"
                        className="w-full h-12 px-3 border rounded-lg text-center uppercase tracking-widest"
                        maxLength={12}
                        disabled={submitting}
                      />
                      {redeemError && (
                        <p className="mt-2 text-xs text-red-600">{redeemError}</p>
                      )}
                    </div>
                  )}

                  <button
                    className="w-full h-[56px] font-medium bg-[#238D9D] text-white rounded-2xl disabled:opacity-50"
                    onClick={() => (isLast ? finish() : api?.scrollNext())}
                    disabled={submitting}
                  >
                    {label}
                  </button>
                </div>
              </CarouselItem>
            );
          })}
        </CarouselContent>
      </Carousel>
    </div>
  );
}
