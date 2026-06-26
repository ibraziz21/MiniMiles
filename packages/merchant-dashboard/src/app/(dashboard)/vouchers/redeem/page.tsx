"use client";

/**
 * In-store voucher redemption scanner.
 *
 * QR decoding uses the `jsqr` npm package (https://github.com/cozmo/jsQR) — a
 * pure-JS decoder. We pull frames from a getUserMedia <video> stream into an
 * off-screen <canvas>, hand the pixel data to jsQR, and treat any decoded
 * strict AKV1 + 256-bit base64url string as a candidate token.
 *
 * Flow:
 *   1. Scan (camera) or paste a token → POST /scan/inspect → preview
 *   2. Confirm → POST /scan/redeem → success/failure
 * The token never leaves the browser except over HTTPS to our own API, which
 * hashes it before touching the DB.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { QrCode, Camera, CameraOff, Check, X, Loader2, RotateCcw, Clipboard } from "lucide-react";

type Preview = {
  valid: boolean;
  invalid_reason: string | null;
  voucher_id: string | null;
  offer_title: string | null;
  voucher_type: string | null;
  discount_percent: number | null;
  discount_cusd: number | null;
  merchant_name: string | null;
  applicable_category: string | null;
  token_expires_at: string | null;
};

type RedemptionRow = {
  id: string;
  issued_voucher_id: string;
  discount_applied: number;
  external_reference: string | null;
  redeemed_at: string;
};

const PRESENTATION_TOKEN_RE = /^AKV1\.[A-Za-z0-9_-]{43}$/;

export default function RedeemPage() {
  const [token, setToken] = useState("");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [inspecting, setInspecting] = useState(false);
  const [redeeming, setRedeeming] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [externalRef, setExternalRef] = useState("");
  const [grossAmount, setGrossAmount] = useState("");
  const [cameraOn, setCameraOn] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [history, setHistory] = useState<RedemptionRow[]>([]);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number | null>(null);
  const scanningRef = useRef(false);

  const loadHistory = useCallback(async () => {
    try {
      const res = await fetch("/api/vouchers/scan/history", { cache: "no-store" });
      if (res.ok) {
        const { redemptions } = await res.json();
        setHistory(redemptions ?? []);
      }
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    void loadHistory();
  }, [loadHistory]);

  const inspect = useCallback(async (raw: string) => {
    const candidate = raw.trim();
    if (!PRESENTATION_TOKEN_RE.test(candidate)) {
      setResult({ ok: false, message: "That does not look like a voucher code." });
      return;
    }
    setInspecting(true);
    setResult(null);
    try {
      const res = await fetch("/api/vouchers/scan/inspect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: candidate }),
        cache: "no-store",
      });
      const data: Preview = await res.json();
      setToken(candidate);
      setPreview(data);
    } catch {
      setResult({ ok: false, message: "Could not inspect the code. Try again." });
    } finally {
      setInspecting(false);
    }
  }, []);

  const stopCamera = useCallback(() => {
    scanningRef.current = false;
    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setCameraOn(false);
  }, []);

  const scanFrame = useCallback(async () => {
    if (!scanningRef.current) return;
    const video = videoRef.current;
    if (video && video.readyState === video.HAVE_ENOUGH_DATA) {
      const canvas = document.createElement("canvas");
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      const ctx = canvas.getContext("2d");
      if (ctx) {
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const jsQR = (await import("jsqr")).default;
        const code = jsQR(imageData.data, imageData.width, imageData.height, {
          inversionAttempts: "dontInvert",
        });
        if (code?.data && PRESENTATION_TOKEN_RE.test(code.data.trim())) {
          stopCamera();
          await inspect(code.data);
          return;
        }
      }
    }
    rafRef.current = requestAnimationFrame(() => void scanFrame());
  }, [inspect, stopCamera]);

  const startCamera = useCallback(async () => {
    setCameraError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "environment" },
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      setCameraOn(true);
      scanningRef.current = true;
      rafRef.current = requestAnimationFrame(() => void scanFrame());
    } catch {
      setCameraError("Camera unavailable. Use manual paste instead.");
      setCameraOn(false);
    }
  }, [scanFrame]);

  useEffect(() => () => stopCamera(), [stopCamera]);

  const confirmRedeem = useCallback(async () => {
    if (!token) return;
    const parsedGross = Number(grossAmount);
    if (!Number.isFinite(parsedGross) || parsedGross <= 0 || parsedGross > 1_000_000) {
      setResult({ ok: false, message: "Enter a valid gross order amount." });
      return;
    }
    setRedeeming(true);
    setResult(null);
    try {
      const res = await fetch("/api/vouchers/scan/redeem", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          token,
          gross_amount_cusd: parsedGross,
          external_reference: externalRef.trim() || undefined,
        }),
        cache: "no-store",
      });
      const data = await res.json();
      if (res.ok && data.ok) {
        setResult({ ok: true, message: `Redeemed: ${data.offer_title ?? "voucher"}` });
        setPreview(null);
        setToken("");
        setExternalRef("");
        setGrossAmount("");
        void loadHistory();
      } else {
        setResult({ ok: false, message: data.error ?? "Redemption failed." });
      }
    } catch {
      setResult({ ok: false, message: "Redemption failed. Try again." });
    } finally {
      setRedeeming(false);
    }
  }, [token, externalRef, grossAmount, loadHistory]);

  function reset() {
    setPreview(null);
    setToken("");
    setResult(null);
    setExternalRef("");
    setGrossAmount("");
  }

  function discountText(p: Preview): string {
    if (p.voucher_type === "free") return "Free item";
    if (p.voucher_type === "percent_off") return `${p.discount_percent}% off`;
    if (p.voucher_type === "fixed_off") return `$${p.discount_cusd} off`;
    return "—";
  }

  return (
    <div className="mx-auto max-w-2xl px-4 py-6">
      <div className="mb-6 flex items-center gap-2">
        <QrCode className="h-6 w-6 text-teal-600" />
        <h1 className="text-2xl font-semibold">Redeem voucher</h1>
      </div>

      {/* Scanner / input */}
      {!preview && (
        <div className="space-y-4 rounded-2xl border border-gray-200 bg-white p-5">
          <div className="relative aspect-square w-full overflow-hidden rounded-xl bg-black/90">
            <video ref={videoRef} className="h-full w-full object-cover" muted playsInline />
            {!cameraOn && (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-white/80">
                <Camera className="h-10 w-10" />
                <p className="text-sm">Camera is off</p>
              </div>
            )}
            {cameraOn && (
              <div className="pointer-events-none absolute inset-8 rounded-2xl border-2 border-white/70" />
            )}
          </div>

          {cameraError && <p className="text-sm text-red-600">{cameraError}</p>}

          <div className="flex gap-2">
            {!cameraOn ? (
              <button
                onClick={() => void startCamera()}
                className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-teal-600 py-3 text-sm font-semibold text-white hover:bg-teal-700"
              >
                <Camera className="h-4 w-4" /> Start camera
              </button>
            ) : (
              <button
                onClick={stopCamera}
                className="flex flex-1 items-center justify-center gap-2 rounded-xl border border-gray-300 py-3 text-sm font-semibold text-gray-700 hover:bg-gray-50"
              >
                <CameraOff className="h-4 w-4" /> Stop camera
              </button>
            )}
          </div>

          {/* Manual paste fallback */}
          <div className="border-t border-gray-100 pt-4">
            <label className="mb-1 block text-xs font-medium text-gray-500">
              Or paste the code (starts with AKV1.)
            </label>
            <div className="flex gap-2">
              <input
                value={token}
                onChange={(e) => setToken(e.target.value)}
                placeholder="AKV1...."
                className="flex-1 rounded-xl border border-gray-300 px-3 py-2 font-mono text-sm focus:border-teal-500 focus:outline-none"
              />
              <button
                onClick={() => void inspect(token)}
                disabled={inspecting}
                className="flex items-center justify-center gap-1.5 rounded-xl bg-gray-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
              >
                {inspecting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Clipboard className="h-4 w-4" />}
                Check
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Preview / confirm */}
      {preview && (
        <div className="space-y-4 rounded-2xl border border-gray-200 bg-white p-5">
          {preview.valid ? (
            <>
              <div className="rounded-xl bg-teal-50 p-4">
                <p className="text-xs text-teal-700">{preview.merchant_name ?? "Your store"}</p>
                <p className="text-2xl font-bold text-teal-700">{discountText(preview)}</p>
                <p className="mt-1 text-sm text-gray-700">{preview.offer_title}</p>
                {preview.applicable_category && (
                  <p className="text-xs capitalize text-gray-500">On: {preview.applicable_category}</p>
                )}
              </div>

              <div>
                <label className="mb-1 block text-xs font-medium text-gray-500">
                  Gross order amount (cUSD) *
                </label>
                <input
                  type="number"
                  min="0.01"
                  max="1000000"
                  step="0.01"
                  required
                  value={grossAmount}
                  onChange={(e) => setGrossAmount(e.target.value)}
                  placeholder="e.g. 12.50"
                  className="w-full rounded-xl border border-gray-300 px-3 py-2 text-sm focus:border-teal-500 focus:outline-none"
                />
                <p className="mt-1 text-xs text-gray-400">
                  The discount is calculated by the settlement service from the voucher snapshot.
                </p>
              </div>

              <div>
                <label className="mb-1 block text-xs font-medium text-gray-500">
                  Receipt / order reference (optional)
                </label>
                <input
                  value={externalRef}
                  onChange={(e) => setExternalRef(e.target.value)}
                  placeholder="e.g. POS-12345"
                  className="w-full rounded-xl border border-gray-300 px-3 py-2 text-sm focus:border-teal-500 focus:outline-none"
                />
              </div>

              <div className="flex gap-2">
                <button
                  onClick={() => void confirmRedeem()}
                  disabled={redeeming || !grossAmount}
                  className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-teal-600 py-3 text-sm font-semibold text-white hover:bg-teal-700 disabled:opacity-50"
                >
                  {redeeming ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                  Confirm redemption
                </button>
                <button
                  onClick={reset}
                  className="flex items-center justify-center gap-1.5 rounded-xl border border-gray-300 px-4 py-3 text-sm font-semibold text-gray-700 hover:bg-gray-50"
                >
                  <X className="h-4 w-4" /> Cancel
                </button>
              </div>
            </>
          ) : (
            <div className="space-y-4">
              <div className="flex items-start gap-3 rounded-xl bg-red-50 p-4">
                <X className="mt-0.5 h-5 w-5 shrink-0 text-red-600" />
                <p className="text-sm font-medium text-red-700">
                  Voucher code is invalid or unavailable.
                </p>
              </div>
              <button
                onClick={reset}
                className="flex w-full items-center justify-center gap-2 rounded-xl bg-gray-900 py-3 text-sm font-semibold text-white"
              >
                <RotateCcw className="h-4 w-4" /> Scan another
              </button>
            </div>
          )}
        </div>
      )}

      {/* Result toast */}
      {result && (
        <div
          className={`mt-4 flex items-center gap-2 rounded-xl p-4 text-sm font-medium ${
            result.ok ? "bg-green-50 text-green-700" : "bg-red-50 text-red-700"
          }`}
        >
          {result.ok ? <Check className="h-4 w-4" /> : <X className="h-4 w-4" />}
          {result.message}
        </div>
      )}

      {/* Redemption history */}
      <div className="mt-8">
        <h2 className="mb-3 text-sm font-semibold text-gray-700">Recent in-store redemptions</h2>
        {history.length === 0 ? (
          <p className="rounded-xl border border-dashed border-gray-200 p-6 text-center text-sm text-gray-400">
            No in-store redemptions yet.
          </p>
        ) : (
          <div className="divide-y divide-gray-100 overflow-hidden rounded-2xl border border-gray-200 bg-white">
            {history.map((r) => (
              <div key={r.id} className="flex items-center justify-between px-4 py-3 text-sm">
                <div>
                  <p className="font-mono text-xs text-gray-500">{r.issued_voucher_id.slice(0, 8)}…</p>
                  {r.external_reference && (
                    <p className="text-xs text-gray-400">Ref: {r.external_reference}</p>
                  )}
                </div>
                <div className="text-right">
                  <p className="text-xs text-gray-500">{new Date(r.redeemed_at).toLocaleString()}</p>
                  {r.discount_applied > 0 && (
                    <p className="text-xs font-medium text-teal-600">
                      −${Number(r.discount_applied).toFixed(2)}
                    </p>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
