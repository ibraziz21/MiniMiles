"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { QrCode, Store, Repeat } from "lucide-react";
import { drawPassQr } from "@/lib/akiba/passQr";
import { useLivePassToken } from "@/lib/akiba/useLivePassToken";
import { track } from "@/lib/analytics/track";

type ContentSlide = {
  icon: typeof QrCode;
  title: string;
  subtitle: string;
  steps?: string[];
};

const SLIDES: ContentSlide[] = [
  {
    icon: QrCode,
    title: "Meet the Akiba Pass",
    subtitle: "Your personal QR code — one scan at the till and you're earning.",
  },
  {
    icon: Store,
    title: "Earn when you shop",
    subtitle: "Show your Pass when you pay at partner shops and earn 1 Mile for every 100 KES you spend.",
  },
  {
    icon: Repeat,
    title: "Scan. Earn. Repeat.",
    subtitle: "Earning takes seconds at the counter:",
    steps: [
      "Pay at a partner shop as usual",
      "Open your Akiba Pass and show your QR code",
      "The cashier scans it — Miles land instantly",
    ],
  },
];

function markSeen() {
  return fetch("/api/me/onboarding", { method: "POST" }).catch(() => null);
}

function QrRevealSlide({ passId, displayLabel }: { passId: string; displayLabel: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const { currentPayload } = useLivePassToken(passId);

  useEffect(() => {
    if (!canvasRef.current) return;
    void drawPassQr(canvasRef.current, currentPayload, 220);
  }, [currentPayload]);

  return (
    <div className="flex flex-col items-center text-center">
      <p className="font-sterling text-2xl font-semibold text-akiba-ink">Your Pass is ready</p>
      <p className="mt-1 text-sm text-akiba-muted">{displayLabel}</p>
      <div className="mt-6 rounded-2xl bg-white p-3 shadow-chip">
        <canvas ref={canvasRef} />
      </div>
      <p className="mt-4 max-w-[260px] text-sm text-akiba-muted">
        Show it next time you pay.
      </p>
    </div>
  );
}

export function WelcomeCarousel({
  passId,
  displayLabel,
}: {
  passId: string;
  email: string;
  displayLabel: string;
}) {
  const router = useRouter();
  const [index, setIndex] = useState(0);
  const total = SLIDES.length + 1; // + QR reveal
  const isReveal = index === SLIDES.length;

  useEffect(() => {
    track("welcome_slide_view", { i: index });
  }, [index]);

  async function finish() {
    track("welcome_completed");
    await markSeen();
    router.push("/");
    router.refresh();
  }

  async function skip() {
    await markSeen();
    router.push("/");
    router.refresh();
  }

  const slide = !isReveal ? SLIDES[index] : null;
  const Icon = slide?.icon;

  return (
    <main className="mx-auto flex min-h-[calc(100dvh-4rem)] max-w-md flex-col px-6 py-6">
      <div className="flex justify-end">
        <button onClick={skip} className="text-sm font-medium text-akiba-muted">
          Skip
        </button>
      </div>

      <div className="flex flex-1 flex-col items-center justify-center">
        {isReveal ? (
          <QrRevealSlide passId={passId} displayLabel={displayLabel} />
        ) : (
          slide && Icon && (
            <div className="flex flex-col items-center text-center">
              <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-akiba-tint text-akiba-teal">
                <Icon className="h-7 w-7" />
              </div>
              <h1 className="mt-5 font-sterling text-2xl font-semibold text-akiba-ink">
                {slide.title}
              </h1>
              <p className="mt-2 max-w-[280px] text-sm text-akiba-muted">{slide.subtitle}</p>
              {slide.steps && (
                <ol className="mt-4 space-y-2 text-left">
                  {slide.steps.map((s, i) => (
                    <li key={i} className="flex items-start gap-2.5 text-sm text-akiba-ink">
                      <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-akiba-teal text-[11px] font-bold text-white">
                        {i + 1}
                      </span>
                      {s}
                    </li>
                  ))}
                </ol>
              )}
            </div>
          )
        )}
      </div>

      {/* Dots */}
      <div className="mb-4 flex justify-center gap-1.5">
        {Array.from({ length: total }).map((_, i) => (
          <span
            key={i}
            className={`h-1.5 w-6 rounded-full ${i === index ? "bg-akiba-teal" : "bg-akiba-line"}`}
          />
        ))}
      </div>

      <button
        onClick={() => (isReveal ? finish() : setIndex((i) => i + 1))}
        className="w-full rounded-2xl bg-akiba-teal py-3.5 text-sm font-semibold text-white transition hover:bg-[#1E7E8D]"
      >
        {isReveal ? "Get started" : "Next"}
      </button>
    </main>
  );
}
