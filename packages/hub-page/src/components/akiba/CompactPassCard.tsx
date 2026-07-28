"use client";

// Compact Pass card — MemberHome §2a. Always first on the member home tool.
// Reuses the same shared QR pieces as the full /me card and /pass, just a
// small thumbnail instead of the full chrome (save/share/regenerate live
// only on /me and /pass).
import { useEffect, useRef } from "react";
import Link from "next/link";
import { drawPassQr } from "@/lib/akiba/passQr";
import { useLivePassToken } from "@/lib/akiba/useLivePassToken";
import { track } from "@/lib/analytics/track";

type Props = {
  passId: string;
  displayLabel: string;
};

export function CompactPassCard({ passId, displayLabel }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const { currentPayload } = useLivePassToken(passId);

  useEffect(() => {
    if (!canvasRef.current) return;
    void drawPassQr(canvasRef.current, currentPayload, 72);
  }, [currentPayload]);

  return (
    <Link
      href="/pass"
      onClick={() => track("pass_card_tap")}
      className="flex items-center gap-4 rounded-2xl border border-akiba-line bg-akiba-ink px-5 py-4 text-white transition active:scale-[0.99]"
    >
      <div className="flex h-[72px] w-[72px] shrink-0 items-center justify-center rounded-xl bg-white p-1.5">
        <canvas ref={canvasRef} />
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate font-sterling text-base font-semibold">{displayLabel}</p>
        <p className="mt-1 text-sm text-white/60">
          Show at the till — earn 1 Mile per 100 KES
        </p>
      </div>
    </Link>
  );
}
