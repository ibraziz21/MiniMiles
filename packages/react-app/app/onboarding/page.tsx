"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { CaretLeft } from "@phosphor-icons/react";
import {
  Carousel, CarouselContent, CarouselItem, CarouselApi,
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



  /* slides */
  const [api, setApi] = useState<CarouselApi | null>(null);
  const [idx, setIdx] = useState(0);


  /* ensure wallet */
  useEffect(() => { getUserAddress(); }, [getUserAddress]);

  useEffect(() => {
    if (!api) return;
  
    const onSelect = () => setIdx(api.selectedScrollSnap());
  
    api.on("select", onSelect);
    onSelect();
  
    // CLEANUP ──────────────────────────────────────────
    return () => {
      api.off("select", onSelect);   // <- call, then implicitly return void
    };
  }, [api]);

  if (!isFetched) return null; 
  

  const isLast = idx === onboardingSource.length - 1;

  /* CTA */
  const finish = async () => {
    if (!isMember) {
      await fetch("/api/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userAddress: address }),
      });
      await queryClient.invalidateQueries({ queryKey: ["isMember"] });
    }
    router.push("/");
  };

  const label = isLast
    ? isMember ? "Finish" : "Claim 100 AkibaMiles"
    : "Next";

  return (
    <div className="relative h-screen font-sterling bg-white">
      {/* Skip link */}
      <div className="absolute top-4 right-4 z-10">
        <button className="text-sm font-medium text-[#238D9D] hover:underline" onClick={finish}>
          {isMember ? "Skip" : "Skip & Claim"}
        </button>
      </div>

      <Carousel setApi={setApi}>
        <CarouselContent className="h-screen">
          {onboardingSource.map((step, i) => (
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
                  <h4 className="my-5 text-[#00000080] font-poppins">{step.subtitle}</h4>

                  {/* progress */}
                  <div className="flex mb-10 space-x-2">
                    {onboardingSource.map((_, j) => (
                      <span key={j} className={`h-2 w-8 rounded-full ${j === i ? "bg-[#238D9D]" : "bg-[#238D9D4D]"}`} />
                    ))}
                  </div>
                </div>

                <button
                  className="w-full h-[56px] font-medium bg-[#238D9D] text-white rounded-2xl"
                  onClick={() => (isLast ? finish() : api?.scrollNext())}
                >
                  {label}
                </button>

                {isLast && (
                  <div className="mt-4 flex space-x-4 text-sm text-[#00000080]">
                    <a href="https://www.akibamiles.com/terms-of-use" className="hover:underline" target="_blank">Terms of Service</a>
                    <span>•</span>
                    <a href="https://www.akibamiles.com/privacy-policy" className="hover:underline" target="_blank">Privacy Policy</a>
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
