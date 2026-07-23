"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { drawPassQr } from "@/lib/akiba/passQr";
import { useLivePassToken } from "@/lib/akiba/useLivePassToken";

export function JoinQrReveal({ passId }: { passId: string }) {
  const router = useRouter();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const { currentPayload } = useLivePassToken(passId);

  useEffect(() => {
    if (!canvasRef.current) return;
    void drawPassQr(canvasRef.current, currentPayload, 220);
  }, [currentPayload]);

  return (
    <main className="mx-auto flex min-h-[calc(100dvh-4rem)] max-w-sm flex-col items-center justify-center px-6 py-8 text-center">
      <p className="font-sterling text-2xl font-semibold text-akiba-ink">You&apos;re in!</p>
      <p className="mt-2 max-w-[260px] text-sm text-akiba-muted">
        Show this to the cashier now to earn on this purchase.
      </p>
      <div className="mt-6 rounded-2xl bg-white p-3 shadow-chip">
        <canvas ref={canvasRef} />
      </div>
      <button
        onClick={() => { router.push("/"); router.refresh(); }}
        className="mt-8 w-full rounded-2xl bg-akiba-teal py-3.5 text-sm font-semibold text-white transition hover:bg-[#1E7E8D]"
      >
        Continue
      </button>
    </main>
  );
}
