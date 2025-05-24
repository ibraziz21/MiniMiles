"use client";

import React, { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { CaretLeft } from "@phosphor-icons/react";

import { onboardingSource } from "@/helpers/onboardingSource";
import {
  Carousel,
  CarouselContent,
  CarouselItem,
  CarouselApi,
} from "@/components/ui/carousel";
import { Button } from "@/components/ui/button";
import { useWeb3 } from "@/contexts/useWeb3";

const Onboarding = () => {
  const router = useRouter();
  const { address, getUserAddress } = useWeb3();

  const [emblaApi, setEmblaApi] = useState<CarouselApi | null>(null);
  const [currentIndex, setCurrentIndex] = useState(0);

  // Load wallet address
  useEffect(() => {
    getUserAddress();
  }, [getUserAddress]);

  // Listen for slide changes
  useEffect(() => {
    if (!emblaApi) return;
    const onSelect = () => setCurrentIndex(emblaApi.selectedScrollSnap());
    emblaApi.on("select", onSelect);
    onSelect();
    return () => {
      emblaApi.off("select", onSelect);
    };
  }, [emblaApi]);

  const isLast = currentIndex === onboardingSource.length - 1;

  const completeOnboarding = async () => {
    if (address) {
      await fetch("/api/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userAddress: address }),
      });
    }
    router.push("/");
  };

  return (
    <div className="relative h-screen font-poppins bg-white">
      {/* Skip & Claim in top-right */}
      <div className="absolute top-4 right-4 z-10">
        <button
          className="text-sm text-green-600 hover:underline font-bold"
          onClick={completeOnboarding}
        >
          Skip &amp; Claim
        </button>
      </div>

      <Carousel className="h-full" setApi={setEmblaApi}>
        <CarouselContent className="h-full">
          {onboardingSource.map((step, idx) => (
            <CarouselItem key={idx}>
              <div className="flex flex-col justify-center items-center h-full p-6 bg-onboarding bg-no-repeat bg-cover">
                {/* Back button */}
                {idx > 0 && (
                  <button
                    className="self-start mb-4"
                    onClick={() => emblaApi?.scrollPrev()}
                  >
                    <CaretLeft
                      size={24}
                      className={
                        idx === onboardingSource.length - 1
                          ? "text-white"
                          : "text-black"
                      }
                    />
                  </button>
                )}

                {/* Illustration */}
                <Image src={step.img} alt={step.title} />

                {/* Title */}
                <h2
                  className={`text-4xl font-bold mt-5 
                     "text-black"
                  }`}
                >
                  {step.title}
                </h2>

                {/* Subtitle */}
                <h4
                  className={`my-5 ${
                    idx === onboardingSource.length - 1
                      ? "text-black"
                      : "text-black"
                  }`}
                >
                  {step.subtitle}
                </h4>

                {/* Progress bars */}
                <div className="flex space-x-2 mb-10">
                  {onboardingSource.map((_, i) => (
                    <span
                      key={i}
                      className={`w-8 h-1 rounded-full ${
                        i === idx
                          ? "bg-[#219653]"
                          : "bg-[#07955F4D]"
                      }`}
                    />
                  ))}
                </div>

                {/* Next / Claim button */}
                <div className="w-full max-w-xs">
                  <Button
                    className={`w-full py-4 font-semibold ${idx === onboardingSource.length - 1
                        ? "bg-[#07955F] text-white hover:bg-[#07955F]"
                        : "bg-[#07955F] text-white hover:bg-[#07955F]"}`}
                    onClick={() => {
                      if (isLast) completeOnboarding();
                      else emblaApi?.scrollNext();
                    } } title={step.buttonText}              >
                    {step.buttonText}
                  </Button>
                </div>
              </div>
            </CarouselItem>
          ))}
        </CarouselContent>
      </Carousel>
    </div>
  );
};

export default Onboarding;
