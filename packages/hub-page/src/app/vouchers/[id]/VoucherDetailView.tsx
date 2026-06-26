"use client";

/**
 * Voucher detail + QR presentation.
 *
 * QR rendering uses the `qrcode` npm package (https://github.com/soldair/node-qrcode),
 * imported dynamically to avoid SSR issues. We render to a <canvas> via
 * `QRCode.toCanvas(element, token)`. The QR encodes ONLY the opaque raw AKV1
 * token string — it carries no PII and is meaningless to a generic QR reader.
 *
 * Lifecycle:
 *   "Show QR"  → POST /api/shop/vouchers/[id]/presentation → render QR + countdown
 *   timer → 0  → auto-rotate (POST again, fresh token)
 *   "Close QR" → DELETE /api/shop/vouchers/[id]/presentation → clear token + QR
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ShoppingBag, QrCode, X, Loader2, Clock } from "lucide-react";
import clsx from "clsx";

export type VoucherType = "free" | "percent_off" | "fixed_off";

export type DetailVoucher = {
  id: string;
  code: string;
  status: "issued" | "redeemed" | "expired" | "void" | "pending" | "claiming";
  created_at: string;
  expires_at: string | null;
  redeemed_at: string | null;
  acquisition_source: string | null;
  sponsor: string | null;
  program_name: string | null;
  template: {
    title: string;
    voucher_type: VoucherType;
    discount_percent: number | null;
    discount_cusd: number | null;
    applicable_category: string | null;
    retail_value_cusd: number | null;
    partner: { slug: string; name: string; image_url: string | null } | null;
  } | null;
};

const SOURCE_LABELS: Record<string, string> = {
  miles_purchase: "Miles Purchase",
  claw:           "Claw Game",
  raffle:         "Raffle",
  giveaway:       "Giveaway",
  merchant_grant: "Merchant Gift",
  akiba_grant:    "Akiba Gift",
};

function discountLabel(t: NonNullable<DetailVoucher["template"]>): string {
  if (t.voucher_type === "free") {
    if (t.retail_value_cusd) return `Free (up to $${t.retail_value_cusd})`;
    return "FREE item";
  }
  if (t.voucher_type === "percent_off") return `${t.discount_percent}% off`;
  return `$${(t.discount_cusd ?? 0).toFixed(2)} off`;
}

type PresentationResponse = {
  token: string;
  expires_at: string;
};

export function VoucherDetailView({ voucher }: { voucher: DetailVoucher }) {
  const router = useRouter();
  const t = voucher.template;
  const merchant = t?.partner;

  const [showQr, setShowQr] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expiresAt, setExpiresAt] = useState<number | null>(null);
  const [secondsLeft, setSecondsLeft] = useState(0);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const showQrRef = useRef(false);
  const presentingRef = useRef(false);
  const reopenPendingRef = useRef(false);
  const requestEpochRef = useRef(0);

  const statusColors: Record<string, string> = {
    issued:   "bg-akiba-tint text-akiba-teal",
    redeemed: "bg-green-50 text-green-700",
    expired:  "bg-akiba-card text-akiba-muted",
    void:     "bg-red-50 text-red-600",
  };

  // Mint a token + render its QR onto the canvas.
  const presentToken = useCallback(async () => {
    if (presentingRef.current) return;
    presentingRef.current = true;
    const requestEpoch = requestEpochRef.current;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/shop/vouchers/${voucher.id}/presentation`, {
        method: "POST",
        cache: "no-store",
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error ?? "Failed to generate QR");
      }
      const data: PresentationResponse = await res.json();

      // Closing the panel while POST was in flight can otherwise mint a token
      // after the earlier DELETE. Revoke again and discard the stale response.
      if (!showQrRef.current || requestEpoch !== requestEpochRef.current) {
        await fetch(`/api/shop/vouchers/${voucher.id}/presentation`, {
          method: "DELETE",
          cache: "no-store",
        }).catch(() => {});
        return;
      }

      const expiryMs = new Date(data.expires_at).getTime();
      setExpiresAt(expiryMs);
      setSecondsLeft(Math.max(0, Math.round((expiryMs - Date.now()) / 1000)));

      // Render QR — import the library dynamically (browser only).
      const QRCode = (await import("qrcode")).default;
      if (canvasRef.current) {
        await QRCode.toCanvas(canvasRef.current, data.token, {
          width: 240,
          margin: 1,
          errorCorrectionLevel: "M",
        });
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to generate QR");
      setExpiresAt(null);
    } finally {
      presentingRef.current = false;
      setLoading(false);
      if (reopenPendingRef.current && showQrRef.current) {
        reopenPendingRef.current = false;
        queueMicrotask(() => void presentToken());
      }
    }
  }, [voucher.id]);

  const openQr = useCallback(async () => {
    requestEpochRef.current += 1;
    setShowQr(true);
    showQrRef.current = true;
    if (presentingRef.current) {
      reopenPendingRef.current = true;
      return;
    }
    await presentToken();
  }, [presentToken]);

  const closeQr = useCallback(async () => {
    requestEpochRef.current += 1;
    reopenPendingRef.current = false;
    showQrRef.current = false;
    setShowQr(false);
    setExpiresAt(null);
    setError(null);
    // Best-effort revoke; ignore failures.
    fetch(`/api/shop/vouchers/${voucher.id}/presentation`, {
      method: "DELETE",
      cache: "no-store",
    }).catch(() => {});
    // Reflect any server-side status change (e.g. redeemed elsewhere).
    router.refresh();
  }, [voucher.id, router]);

  // Refresh the server-owned voucher status while the QR is open. The database
  // clears the token as soon as another flow claims/redeems/voids the voucher.
  useEffect(() => {
    if (!showQr) return;
    const interval = setInterval(() => router.refresh(), 5_000);
    return () => clearInterval(interval);
  }, [showQr, router]);

  // A refresh can deliver a redeemed/expired/claiming status while the panel
  // remains mounted. Close immediately; the status trigger already revoked it.
  useEffect(() => {
    if (voucher.status !== "issued" && showQrRef.current) {
      requestEpochRef.current += 1;
      reopenPendingRef.current = false;
      showQrRef.current = false;
      setShowQr(false);
      setExpiresAt(null);
      setError(null);
    }
  }, [voucher.status]);

  // Countdown + auto-rotation timer.
  useEffect(() => {
    if (!showQr || expiresAt === null) return;
    const interval = setInterval(() => {
      const remaining = Math.round((expiresAt - Date.now()) / 1000);
      if (remaining <= 0) {
        setSecondsLeft(0);
        // Rotate to a fresh token if the panel is still open.
        if (showQrRef.current) void presentToken();
      } else {
        setSecondsLeft(remaining);
      }
    }, 1000);
    return () => clearInterval(interval);
  }, [showQr, expiresAt, presentToken]);

  // Revoke on unmount if a token is live.
  useEffect(() => {
    return () => {
      if (showQrRef.current) {
        fetch(`/api/shop/vouchers/${voucher.id}/presentation`, {
          method: "DELETE",
          keepalive: true,
        }).catch(() => {});
      }
    };
  }, [voucher.id]);

  return (
    <div>
      <button
        onClick={() => router.push("/vouchers")}
        className="mb-4 text-sm font-medium text-akiba-muted hover:text-akiba-ink"
      >
        ← Back to vouchers
      </button>

      <div
        className={clsx(
          "overflow-hidden rounded-3xl border bg-white shadow-sm",
          voucher.status === "expired" || voucher.status === "void"
            ? "border-akiba-line opacity-70"
            : "border-akiba-line"
        )}
      >
        {/* Header */}
        <div className="flex items-center gap-3 border-b border-dashed border-akiba-line bg-akiba-tint px-5 py-4">
          <div className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-2xl bg-white">
            {merchant?.image_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={merchant.image_url} alt={merchant.name} className="h-full w-full object-contain" />
            ) : (
              <ShoppingBag className="h-6 w-6 text-akiba-muted" />
            )}
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-xs text-akiba-muted">{merchant?.name ?? "All merchants"}</p>
            <p className="font-sterling text-xl font-bold text-akiba-teal">
              {t ? discountLabel(t) : "Voucher"}
            </p>
          </div>
          <span
            className={clsx(
              "rounded-full px-3 py-1 text-[11px] font-semibold capitalize",
              statusColors[voucher.status] ?? "bg-akiba-card text-akiba-muted"
            )}
          >
            {voucher.status}
          </span>
        </div>

        {/* Body */}
        <div className="space-y-2 px-5 py-5 text-sm text-akiba-muted">
          {t && <p className="text-base font-medium text-akiba-ink">{t.title}</p>}
          {t?.applicable_category && (
            <p>
              On:{" "}
              <span className="font-medium capitalize text-akiba-ink">
                {t.applicable_category}
              </span>
            </p>
          )}
          {voucher.expires_at && <p>Expires: {new Date(voucher.expires_at).toLocaleString()}</p>}
          {voucher.redeemed_at && <p>Used: {new Date(voucher.redeemed_at).toLocaleString()}</p>}
          {voucher.acquisition_source && (
            <p className="text-akiba-muted/70">
              {SOURCE_LABELS[voucher.acquisition_source] ?? voucher.acquisition_source}
              {voucher.program_name ? ` · ${voucher.program_name}` : ""}
            </p>
          )}
          {voucher.sponsor && <p className="text-purple-500">Sponsored by {voucher.sponsor}</p>}
        </div>

        {/* QR area */}
        <div className="border-t border-akiba-line px-5 py-5">
          {voucher.status !== "issued" ? (
            <p className="text-center text-sm text-akiba-muted">
              {voucher.status === "redeemed"
                ? "This voucher has been redeemed."
                : voucher.status === "expired"
                ? "This voucher has expired."
                : "This voucher is not available."}
            </p>
          ) : !showQr ? (
            <button
              onClick={openQr}
              className="flex w-full items-center justify-center gap-2 rounded-2xl bg-akiba-teal py-3 text-sm font-semibold text-white transition hover:opacity-90"
            >
              <QrCode className="h-5 w-5" /> Show QR to redeem in store
            </button>
          ) : (
            <div className="flex flex-col items-center gap-4">
              <div className="relative flex h-[240px] w-[240px] items-center justify-center rounded-2xl border border-akiba-line bg-white">
                <canvas ref={canvasRef} className={clsx(loading && "opacity-30")} />
                {loading && (
                  <div className="absolute inset-0 flex items-center justify-center">
                    <Loader2 className="h-8 w-8 animate-spin text-akiba-teal" />
                  </div>
                )}
              </div>

              {error ? (
                <p className="text-center text-sm font-medium text-red-600">{error}</p>
              ) : (
                <div className="flex items-center gap-2 text-sm text-akiba-muted">
                  <Clock className="h-4 w-4" />
                  Refreshes in <span className="font-semibold text-akiba-ink">{secondsLeft}s</span>
                </div>
              )}

              <p className="px-2 text-center text-xs text-akiba-muted/80">
                Ask the cashier to scan this code. It rotates automatically for security.
              </p>

              <button
                onClick={closeQr}
                className="flex items-center justify-center gap-1.5 rounded-full border border-akiba-line px-5 py-2 text-sm font-semibold text-akiba-muted hover:bg-akiba-card"
              >
                <X className="h-4 w-4" /> Close QR
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
