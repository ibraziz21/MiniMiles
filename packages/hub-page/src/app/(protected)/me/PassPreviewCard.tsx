"use client";

import { useEffect, useRef } from "react";
import { QrCode, ArrowUpRight } from "lucide-react";
import { qrPayload, drawPassQr } from "@/lib/akiba/passQr";

/**
 * Compact, non-live glimpse of the user's Akiba Pass — draws the static QR
 * once (no live-token polling, unlike AkibaPassCard) and links straight to
 * the full-screen /pass route, which already owns the "about to pay" moment
 * (brightness prompt, live/offline status, save/share/regenerate). Keeping
 * those two concerns apart means /me never runs a second live-token poller
 * alongside /pass's.
 */
export function PassPreviewCard({ publicPassId }: { publicPassId: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (!canvasRef.current) return;
    void drawPassQr(canvasRef.current, qrPayload(publicPassId), 72);
  }, [publicPassId]);

  return (
    <a
      href="/pass"
      className="flex items-center gap-4 rounded-2xl border border-akiba-line bg-white px-5 py-4 transition hover:border-akiba-teal/40 hover:shadow-chip focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-akiba-teal"
    >
      <span className="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-white p-1.5 shadow-chip">
        <canvas ref={canvasRef} role="img" aria-label="Your Akiba Pass QR code" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5 text-sm font-semibold text-akiba-ink">
          <QrCode className="h-4 w-4 text-akiba-teal" aria-hidden="true" />
          Akiba Pass
        </span>
        <span className="mt-0.5 block text-xs text-akiba-muted">
          Tap to present at checkout
        </span>
      </span>
      <ArrowUpRight className="h-4 w-4 shrink-0 text-akiba-muted/60" aria-hidden="true" />
    </a>
  );
}
