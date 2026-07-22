// src/app/akiba-pass/page.tsx
// Akiba Pass onboarding — same carousel pattern as the Prosperity Pass flow,
// but purely descriptive: no claim/burn logic. Final CTA opens the Pass site
// (pass.akibamiles.com), tagged for home-banner attribution.
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
import { passOnboardingSource, AKIBA_PASS_URL } from "@/helpers/passOnboardingSource";
import { openExternalUrl, copyToClipboard } from "@/lib/openExternal";

export default function AkibaPassOnboarding() {
  const router = useRouter();
  const [api, setApi] = useState<CarouselApi | null>(null);
  const [idx, setIdx] = useState(0);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!api) return;
    const onSelect = () => setIdx(api.selectedScrollSnap());
    api.on("select", onSelect);
    onSelect();
    return () => {
      api.off("select", onSelect);
    };
  }, [api]);

  const isLast = idx === passOnboardingSource.length - 1;

  const finish = () => router.push("/");

  const passUrl = () => {
    // Read attribution tag at click time (avoids a useSearchParams Suspense boundary).
    const src = new URLSearchParams(window.location.search).get("src") ?? "app_onboarding";
    return `${AKIBA_PASS_URL}?src=${encodeURIComponent(src)}`;
  };

  // Opens in the PHONE's browser, not MiniPay's webview — the Pass site needs
  // its own session (Google/Apple sign-in) outside the dapp browser.
  const openPassSite = () => openExternalUrl(passUrl());

  const copyPassLink = async () => {
    const ok = await copyToClipboard(AKIBA_PASS_URL);
    if (ok) {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const handleCta = () => {
    if (!isLast) {
      api?.scrollNext();
      return;
    }
    openPassSite();
  };

  return (
    <div className="h-screen bg-white font-sterling">
      <Carousel setApi={setApi}>
        <CarouselContent className="h-screen">
          {passOnboardingSource.map((step, i) => (
            <CarouselItem key={i}>
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
                    <div>
                      <h2 className="text-[36px] leading-[34px] tracking-[-0.26px] font-bold text-black">
                        {step.title}
                      </h2>
                      <p className="mt-4 text-[18px] leading-[28px] tracking-[-0.26px] text-[#00000080] font-sans">
                        {step.subtitle}
                      </p>
                      {step.steps && (
                        <ol className="mt-4 space-y-2.5">
                          {step.steps.map((s, k) => (
                            <li key={k} className="flex items-start gap-3">
                              <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[#238D9D] text-xs font-bold text-white">
                                {k + 1}
                              </span>
                              <span className="text-[15px] leading-[22px] text-[#000000B3] font-sans">
                                {s}
                              </span>
                            </li>
                          ))}
                        </ol>
                      )}
                    </div>

                    {/* Step dots */}
                    <div className="flex items-center">
                      <div className="flex space-x-2">
                        {passOnboardingSource.map((_, j) => (
                          <span
                            key={j}
                            className={`h-2 w-8 rounded-full ${
                              j === i ? "bg-[#238D9D]" : "bg-[#238D9D4D]"
                            }`}
                          />
                        ))}
                      </div>
                    </div>

                    {/* CTA */}
                    <div className="flex flex-col gap-2">
                      <button
                        type="button"
                        className="flex h-14 w-full items-center justify-center rounded-2xl bg-[#238D9D] text-base font-medium text-white active:scale-[0.99] transition-transform"
                        onClick={handleCta}
                      >
                        {step.buttonText}
                      </button>
                      {/* Fallback if the webview blocks the external-browser handoff */}
                      {i === passOnboardingSource.length - 1 && (
                        <button
                          type="button"
                          onClick={copyPassLink}
                          className="text-center text-sm font-medium text-[#238D9D]"
                        >
                          {copied
                            ? "Link copied — paste it in your browser"
                            : "Nothing opened? Copy the link instead"}
                        </button>
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
  );
}
