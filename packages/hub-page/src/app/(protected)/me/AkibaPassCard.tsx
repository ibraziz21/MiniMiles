"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import QRCode from "qrcode";
import { Copy, CheckCheck, Download, Share2, RefreshCw } from "lucide-react";

type Props = {
  initialPassId: string;
  email: string;
  displayLabel: string;
};

// ── Offscreen card composer ───────────────────────────────────────────────────
// Produces a 720×820 PNG suitable for saving to the phone gallery or sharing.
const CARD_W = 720;
const QR_PX  = 340;

async function buildPassCard(
  liveCanvas: HTMLCanvasElement,
  displayLabel: string,
  email: string,
): Promise<Blob> {
  const HEADER_H = 160;
  const PAD      = 48;
  const BODY_H   = QR_PX + PAD * 2 + 180;
  const CARD_H   = HEADER_H + BODY_H;

  const c = document.createElement("canvas");
  c.width  = CARD_W;
  c.height = CARD_H;
  const ctx = c.getContext("2d");
  if (!ctx) throw new Error("canvas 2d unavailable");

  ctx.fillStyle = "#0D3349";
  ctx.fillRect(0, 0, CARD_W, HEADER_H);

  ctx.fillStyle = "rgba(255,255,255,0.35)";
  ctx.font = "bold 22px system-ui, -apple-system, sans-serif";
  ctx.fillText("AKIBA PASS", PAD, 64);

  ctx.fillStyle = "#FFFFFF";
  ctx.font = "bold 40px system-ui, -apple-system, sans-serif";
  const label = displayLabel.length > 28 ? displayLabel.slice(0, 27) + "…" : displayLabel;
  ctx.fillText(label, PAD, 122);

  ctx.fillStyle = "#FFFFFF";
  ctx.fillRect(0, HEADER_H, CARD_W, BODY_H);

  const qrX = (CARD_W - QR_PX) / 2;
  const qrY = HEADER_H + PAD;
  ctx.drawImage(liveCanvas, qrX, qrY, QR_PX, QR_PX);

  ctx.textAlign = "center";

  ctx.font = "26px system-ui, -apple-system, sans-serif";
  ctx.fillStyle = "#374151";
  ctx.fillText("Show this at participating merchants", CARD_W / 2, qrY + QR_PX + 52);
  ctx.fillText("to earn AkibaMiles.", CARD_W / 2, qrY + QR_PX + 88);

  ctx.font = "22px system-ui, -apple-system, sans-serif";
  ctx.fillStyle = "#9CA3AF";
  ctx.fillText(email, CARD_W / 2, qrY + QR_PX + 130);

  ctx.font = "20px system-ui, -apple-system, sans-serif";
  ctx.fillStyle = "#059669";
  ctx.fillText("This QR cannot access your account.", CARD_W / 2, qrY + QR_PX + 168);

  return new Promise<Blob>((resolve, reject) => {
    c.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("canvas export failed"))),
      "image/png",
    );
  });
}

function qrPayload(passId: string) {
  return `akiba-pass:v1:${passId}`;
}

// ── Component ─────────────────────────────────────────────────────────────────
export function AkibaPassCard({ initialPassId, email, displayLabel }: Props) {
  const canvasRef              = useRef<HTMLCanvasElement>(null);
  const [passId, setPassId]    = useState(initialPassId);
  const [copied, setCopied]    = useState(false);
  const [saving, setSaving]    = useState(false);
  const [regen, setRegen]      = useState(false);
  const [regenWarning, setRegenWarning] = useState(false);
  const [actionError, setActionError]   = useState<string | null>(null);
  const [canShare, setCanShare] = useState(false);

  useEffect(() => {
    setCanShare(
      typeof navigator.share === "function" &&
      typeof navigator.canShare === "function",
    );
  }, []);

  const renderQr = useCallback((id: string) => {
    if (!canvasRef.current) return;
    return QRCode.toCanvas(canvasRef.current, qrPayload(id), {
      width: 220,
      margin: 2,
      color: { dark: "#0D3349", light: "#FFFFFF" },
      errorCorrectionLevel: "M",
    });
  }, []);

  useEffect(() => { renderQr(passId); }, [passId, renderQr]);

  // ── Regenerate: issue a new stable UUID, invalidating old QRs ────────────
  const regenerate = useCallback(async () => {
    setRegen(true);
    setActionError(null);
    setRegenWarning(false);
    try {
      const res = await fetch("/api/me/pass/regenerate", { method: "POST" });
      if (!res.ok) throw new Error("server error");
      const { publicPassId } = await res.json() as { publicPassId: string };
      setPassId(publicPassId);
      setRegenWarning(true);
    } catch {
      setActionError("Could not regenerate — check your connection and try again.");
    } finally {
      setRegen(false);
    }
  }, []);

  // ── Save / Share ──────────────────────────────────────────────────────────
  const saveOrShare = useCallback(async () => {
    if (!canvasRef.current) return;
    setSaving(true);
    setActionError(null);
    try {
      await renderQr(passId);
      const blob = await buildPassCard(canvasRef.current, displayLabel, email);
      const file = new File([blob], "akiba-pass.png", { type: "image/png" });

      if (canShare && navigator.canShare({ files: [file] })) {
        await navigator.share({
          files: [file],
          title: "Akiba Pass",
          text: "My Akiba Pass — show this at participating merchants to earn AkibaMiles.",
        });
      } else {
        const url = URL.createObjectURL(blob);
        const a   = document.createElement("a");
        a.href     = url;
        a.download = "akiba-pass.png";
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setTimeout(() => URL.revokeObjectURL(url), 60_000);
      }
    } catch (e) {
      // AbortError = user dismissed the share sheet — not an error
      if ((e as { name?: string }).name !== "AbortError") {
        setActionError("Could not save — try screenshotting the card instead.");
      }
    } finally {
      setSaving(false);
    }
  }, [canShare, passId, displayLabel, email, renderQr]);

  const copyEmail = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(email);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch { /* clipboard denied on some browsers */ }
  }, [email]);

  return (
    <div className="overflow-hidden rounded-3xl border border-akiba-line bg-white shadow-sm">
      {/* Header */}
      <div className="bg-akiba-ink px-5 py-4">
        <p className="text-xs font-semibold uppercase tracking-widest text-white/40">
          Akiba Pass
        </p>
        <p className="mt-0.5 font-sterling text-lg font-semibold text-white">
          {displayLabel}
        </p>
      </div>

      {/* QR + copy */}
      <div className="flex flex-col items-center px-6 py-6">
        <div className="rounded-2xl bg-white p-3 shadow-chip">
          <canvas ref={canvasRef} />
        </div>

        <p className="mt-4 max-w-[240px] text-center text-sm text-akiba-muted">
          Show this at participating merchants to earn AkibaMiles.
        </p>

        <p className="mt-1.5 text-center text-xs font-medium text-emerald-600">
          This QR cannot access your account.
        </p>

        {/* Email fallback copy */}
        <button
          onClick={copyEmail}
          className="mt-4 flex items-center gap-1.5 rounded-full border border-akiba-line bg-akiba-card px-4 py-1.5 text-xs font-medium text-akiba-muted transition hover:border-akiba-teal/40 hover:text-akiba-ink"
        >
          {copied
            ? <><CheckCheck className="h-3.5 w-3.5 text-akiba-teal" />Copied</>
            : <><Copy className="h-3.5 w-3.5" />{email}</>}
        </button>
        <p className="mt-1 text-[10px] text-akiba-muted/60">
          Tap to copy — merchant can enter your email manually
        </p>

        {regenWarning && (
          <p className="mt-3 text-center text-xs font-medium text-amber-600">
            New QR issued. Any previously saved passes are no longer valid.
          </p>
        )}

        {actionError && (
          <p className="mt-3 text-center text-xs text-red-500">{actionError}</p>
        )}

        {/* Primary action row: Save/Share + Regenerate */}
        <div className="mt-5 flex w-full gap-3">
          <button
            onClick={saveOrShare}
            disabled={saving}
            className="flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-akiba-teal py-2.5 text-sm font-semibold text-white transition hover:bg-[#1E7E8D] disabled:opacity-50"
          >
            {saving
              ? <><Download className="h-4 w-4 animate-bounce" />Saving…</>
              : canShare
                ? <><Share2 className="h-4 w-4" />Share pass</>
                : <><Download className="h-4 w-4" />Save pass</>}
          </button>

          <button
            onClick={regenerate}
            disabled={regen}
            title="Issue a new QR — your old saved pass will stop working"
            className="flex items-center justify-center gap-1.5 rounded-xl border border-akiba-line px-4 py-2.5 text-sm font-semibold text-akiba-muted transition hover:border-akiba-teal/40 hover:text-akiba-ink disabled:opacity-40"
          >
            <RefreshCw className={`h-4 w-4 ${regen ? "animate-spin" : ""}`} />
            {regen ? "" : "New QR"}
          </button>
        </div>
      </div>
    </div>
  );
}
