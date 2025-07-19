/* --------------------------------------------------------------------------
 * app/(onboarding)/onboarding/page.tsx
 * Onboarding carousel – now stores “justJoined” in sessionStorage instead of
 * query param so we avoid useSearchParams + Suspense issues.
 * -------------------------------------------------------------------------- */
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

export default function Onboarding() {
  const router = useRouter();
  const { address, getUserAddress } = useWeb3();

  const [api, setApi]               = useState<CarouselApi | null>(null);
  const [idx, setIdx]               = useState(0);
  const [isMember, setIsMember]     = useState<boolean | null>(null);
  const [claiming, setClaiming]     = useState(false);
  const [error, setError]           = useState<string | null>(null);

  /* ---------- load wallet ---------- */
  useEffect(() => { getUserAddress(); }, [getUserAddress]);

  /* ---------- fetch membership ---------- */
  useEffect(() => {
    if (!address) return;
    fetch(`/api/users/${address}`)
      .then(r => r.json())
      .then(({ isMember }) => setIsMember(!!isMember))
      .catch(() => setIsMember(false));
  }, [address]);

  /* ---------- carousel index watcher ---------- */
  useEffect(() => {
    if (!api) return;
    const onSelect = () => setIdx(api.selectedScrollSnap());
    api.on("select", onSelect);
    onSelect();
    return () => { api.off("select", onSelect); };
  }, [api]);

  const isLast = idx === onboardingSource.length - 1;

  /* ---------- finish / claim handler ---------- */
  const finish = async () => {
    if (!address) {
      router.replace("/");
      return;
    }

    if (isMember === false) {
      setClaiming(true);
      setError(null);
      try {
        const r = await fetch("/api/users", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ userAddress: address }),
        });
        if (!r.ok) {
          const j = await r.json().catch(() => ({}));
          throw new Error(j.error || "Claim failed");
        }
        setIsMember(true); // optimistic

        /* -------- optional: quick poll to confirm DB flag -------- */
        for (let i = 0; i < 3; i++) {
          const chk = await fetch(`/api/users/${address}`).then(r => r.json());
          if (chk.isMember) break;
          await new Promise(r => setTimeout(r, 400));
        }
      } catch (e: any) {
        setError(e.message);
        setClaiming(false);
        return;
      }
    }

    /* ---------- set "justJoined" session flag & go home ---------- */
    try {
      if (typeof window !== "undefined") {
        sessionStorage.setItem("justJoined", "1");
      }
    } catch {}
    router.replace("/");
  };

  const primaryLabel =
    claiming
      ? "Claiming…"
      : isLast
        ? (isMember ? "Finish" : "Claim 100 AkibaMiles")
        : "Next";

  /* ---------- UI ---------- */
  return (
    <div className="relative h-screen font-sterling bg-white">
      {/* Skip / Skip & Claim */}
      <div className="absolute top-4 right-4 z-10">
        <button
          className="text-sm font-medium text-[#238D9D] hover:underline disabled:opacity-50"
          disabled={claiming || isMember === null}
          onClick={finish}
        >
          {claiming ? "Claiming…" : (isMember ? "Skip" : "Skip & Claim")}
        </button>
      </div>

      <Carousel setApi={setApi}>
        <CarouselContent className="h-screen">
          {onboardingSource.map((step, i) => (
            <CarouselItem key={i}>
              <div className="flex flex-col items-center justify-center h-full px-6 bg-onboarding bg-no-repeat bg-cover">
                {/* back arrow */}
                {i > 0 && (
                  <button
                    className="self-start mb-4 disabled:opacity-50"
                    onClick={() => api?.scrollPrev()}
                    disabled={claiming}
                  >
                    <CaretLeft size={24} className="text-black" />
                  </button>
                )}

                <Image src={step.img} alt={step.title} />

                <div>
                  <h2 className="mt-5 text-4xl font-[900] text-black">{step.title}</h2>
                  <h4 className="my-5 text-[#00000080] font-poppins">{step.subtitle}</h4>

                  {/* progress dots */}
                  <div className="flex mb-10 space-x-2">
                    {onboardingSource.map((_, j) => (
                      <span
                        key={j}
                        className={`h-2 w-8 rounded-full ${j === i ? "bg-[#238D9D]" : "bg-[#238D9D4D]"}`}
                      />
                    ))}
                  </div>
                </div>

                {error && (
                  <div className="text-sm text-red-600 mb-3">{error}</div>
                )}

                <button
                  className="w-full h-[56px] font-medium bg-[#238D9D] text-white rounded-2xl disabled:opacity-60"
                  disabled={claiming || isMember === null}
                  onClick={() => (isLast ? finish() : api?.scrollNext())}
                >
                  {primaryLabel}
                </button>

                {isLast && (
                  <div className="mt-4 flex space-x-4 text-sm text-[#00000080]">
                    <a
                      href="https://www.akibamiles.com/terms-of-use"
                      className="hover:underline"
                      target="_blank"
                      rel="noreferrer"
                    >
                      Terms of Service
                    </a>
                    <span>•</span>
                    <a
                      href="https://www.akibamiles.com/privacy-policy"
                      className="hover:underline"
                      target="_blank"
                      rel="noreferrer"
                    >
                      Privacy Policy
                    </a>
                  </div>
                )}
              </div>
            </CarouselItem>
          ))}
        </CarouselContent>
      </Carousel>
    </div>
  );
}
