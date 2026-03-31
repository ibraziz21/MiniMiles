// components/merchant-voucher-sheet.tsx
"use client";

import React, { useCallback, useEffect, useState } from "react";
import Image from "next/image";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "./ui/sheet";
import { Button } from "./ui/button";
import { CaretLeft, Copy, CheckCircle, Spinner, Tag } from "@phosphor-icons/react";
import { akibaMilesSymbol, Successsvg } from "@/lib/svg";
import { useWeb3 } from "@/contexts/useWeb3";
import FeedbackDialog from "./FeedbackDialog";
import { createWalletClient, custom } from "viem";
import { celo } from "viem/chains";

// ── Types ─────────────────────────────────────────────────────────────────────

export type VoucherTemplate = {
  id: string;
  title: string;
  miles_cost: number;
  voucher_type: "free" | "percent_off" | "fixed_off";
  discount_percent?: number | null;
  discount_cusd?: number | null;
  applicable_category?: string | null;
  cooldown_seconds?: number | null;
  global_cap?: number | null;
  expires_at?: string | null;
};

export type MerchantForVoucher = {
  id: string;
  slug: string;
  name: string;
  image_url?: string | null;
};

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  merchant: MerchantForVoucher | null;
  /** Pre-loaded templates — if omitted the sheet fetches them itself. */
  templates?: VoucherTemplate[];
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function discountLabel(t: VoucherTemplate): string {
  if (t.voucher_type === "free") return "FREE product (up to $15)";
  if (t.voucher_type === "percent_off") return `${t.discount_percent ?? 0}% off`;
  if (t.voucher_type === "fixed_off") return `$${t.discount_cusd ?? 0} off`;
  return "";
}

function categoryLabel(t: VoucherTemplate): string {
  if (!t.applicable_category) return "All products";
  return t.applicable_category.charAt(0).toUpperCase() + t.applicable_category.slice(1);
}

function cooldownLabel(secs?: number | null): string {
  if (!secs) return "";
  if (secs < 3600) return `${Math.round(secs / 60)}m cooldown`;
  if (secs < 86400) return `${Math.round(secs / 3600)}h cooldown`;
  return `${Math.round(secs / 86400)}d cooldown`;
}

// ── Component ─────────────────────────────────────────────────────────────────

type Screen = "list" | "confirm" | "success";

export default function MerchantVoucherSheet({
  open,
  onOpenChange,
  merchant,
  templates: propTemplates,
}: Props) {
  const { address, getakibaMilesBalance } = useWeb3();

  const [screen, setScreen] = useState<Screen>("list");
  const [templates, setTemplates] = useState<VoucherTemplate[]>(propTemplates ?? []);
  const [loadingTemplates, setLoadingTemplates] = useState(false);
  const [selected, setSelected] = useState<VoucherTemplate | null>(null);
  const [balance, setBalance] = useState(0);
  const [issuing, setIssuing] = useState(false);
  const [voucherCode, setVoucherCode] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<{ title: string; desc?: string } | null>(null);

  // Fetch templates on open if not provided via props
  useEffect(() => {
    if (!open || !merchant) return;
    if (propTemplates && propTemplates.length > 0) {
      setTemplates(propTemplates);
      return;
    }
    setLoadingTemplates(true);
    fetch(`/api/Spend/merchants/${merchant.slug}`)
      .then((r) => r.json())
      .then((d) => setTemplates(d.templates ?? []))
      .catch(() => setTemplates([]))
      .finally(() => setLoadingTemplates(false));
  }, [open, merchant, propTemplates]);

  // Fetch AkibaMiles balance on open
  useEffect(() => {
    if (!open || !address) return;
    getakibaMilesBalance()
      .then((b) => setBalance(Number(b)))
      .catch(() => {});
  }, [open, address, getakibaMilesBalance]);

  // Reset to list when sheet re-opens
  useEffect(() => {
    if (open) {
      setScreen("list");
      setSelected(null);
      setVoucherCode(null);
      setCopied(false);
    }
  }, [open]);

  const handleSelectTemplate = (t: VoucherTemplate) => {
    setSelected(t);
    setScreen("confirm");
  };

  const handleIssue = useCallback(async () => {
    if (!address || !selected || !merchant) return;

    const notEnough = balance < selected.miles_cost;
    if (notEnough) {
      setError({ title: "Not enough AkibaMiles", desc: `You need ${selected.miles_cost} AkibaMiles.` });
      return;
    }

    try {
      setIssuing(true);

      // Build + sign the canonical message
      const timestamp = Math.floor(Date.now() / 1000);
      const nonce = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
      const idempotency_key = `${address}-${merchant.id}-${selected.id}-${nonce}`;
      const message = `AkibaVoucher:${merchant.id}:${selected.id}:${address.toLowerCase()}:${timestamp}:${nonce}`;

      const wc = createWalletClient({ transport: custom((window as any).ethereum), chain: celo });
      const signature = await wc.signMessage({ account: address as `0x${string}`, message });

      const res = await fetch("/api/Spend/vouchers/issue", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          merchant_id: merchant.id,
          template_id: selected.id,
          user_address: address,
          timestamp,
          nonce,
          signature,
          idempotency_key,
        }),
      });

      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Voucher issuance failed");

      setVoucherCode(json.voucher.code);
      // Refresh balance display
      getakibaMilesBalance().then((b) => setBalance(Number(b))).catch(() => {});
      window.dispatchEvent(new Event("akiba:miles:refresh"));
      setScreen("success");
    } catch (err: any) {
      const msg: string = err?.message ?? "";
      if (/user rejected|rejected by user/i.test(msg)) {
        setError({ title: "Cancelled", desc: "You rejected the signature request." });
      } else {
        setError({ title: "Voucher failed", desc: msg || "Something went wrong." });
      }
    } finally {
      setIssuing(false);
    }
  }, [address, selected, merchant, balance, getakibaMilesBalance]);

  const handleCopy = () => {
    if (!voucherCode) return;
    navigator.clipboard.writeText(voucherCode).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  if (!merchant) return null;

  return (
    <>
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent
          side="bottom"
          className="bg-white rounded-t-2xl font-sterling max-h-[90vh] overflow-auto p-4 pb-8"
        >
          <SheetHeader>
            <SheetTitle className="sr-only">Buy Voucher</SheetTitle>
          </SheetHeader>

          {/* ── LIST ─────────────────────────────────────────────────────── */}
          {screen === "list" && (
            <div>
              <div className="flex items-center gap-3 mb-5">
                {merchant.image_url && (
                  <div className="relative w-10 h-10 rounded-xl overflow-hidden shrink-0">
                    <Image src={merchant.image_url} alt={merchant.name} fill className="object-cover" />
                  </div>
                )}
                <div>
                  <p className="text-xs text-[#238D9D] font-medium">Buy Voucher</p>
                  <h2 className="font-semibold text-lg leading-tight">{merchant.name}</h2>
                </div>
              </div>

              {/* Balance pill */}
              <div className="flex items-center gap-1.5 bg-[#238D9D0D] rounded-full px-3 py-1.5 w-fit mb-5">
                <Image src={akibaMilesSymbol} alt="" width={16} height={16} />
                <span className="text-sm font-medium text-[#238D9D]">
                  {balance.toLocaleString()} AkibaMiles
                </span>
              </div>

              {loadingTemplates ? (
                <div className="flex justify-center py-10">
                  <Spinner size={28} className="animate-spin text-[#238D9D]" />
                </div>
              ) : templates.length === 0 ? (
                <p className="text-center text-gray-400 py-10 text-sm">
                  No vouchers available right now.
                </p>
              ) : (
                <div className="space-y-3">
                  {templates.map((t) => {
                    const canAfford = balance >= t.miles_cost;
                    return (
                      <button
                        key={t.id}
                        onClick={() => handleSelectTemplate(t)}
                        disabled={!canAfford}
                        className={`w-full text-left border-2 rounded-2xl p-4 transition-all ${
                          canAfford
                            ? "border-gray-100 hover:border-[#238D9D] active:border-[#238D9D]"
                            : "border-gray-100 opacity-50"
                        }`}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex-1">
                            <div className="flex items-center gap-2 mb-1">
                              <Tag size={14} className="text-[#238D9D] shrink-0" />
                              <span className="font-semibold text-sm">{t.title}</span>
                            </div>
                            <p className="text-[#238D9D] font-bold text-base mb-1">
                              {discountLabel(t)}
                            </p>
                            <div className="flex flex-wrap gap-1.5 text-xs text-gray-500">
                              <span className="bg-gray-100 rounded-full px-2 py-0.5">
                                {categoryLabel(t)}
                              </span>
                              {t.cooldown_seconds ? (
                                <span className="bg-gray-100 rounded-full px-2 py-0.5">
                                  {cooldownLabel(t.cooldown_seconds)}
                                </span>
                              ) : null}
                            </div>
                          </div>
                          <div className="text-right shrink-0">
                            <div className="flex items-center gap-1 justify-end">
                              <Image src={akibaMilesSymbol} alt="" width={14} height={14} />
                              <span className="font-bold text-sm">{t.miles_cost.toLocaleString()}</span>
                            </div>
                            <p className="text-xs text-gray-400">miles</p>
                          </div>
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* ── CONFIRM ──────────────────────────────────────────────────── */}
          {screen === "confirm" && selected && (
            <div>
              <button
                onClick={() => setScreen("list")}
                className="flex items-center gap-1 text-sm text-gray-500 mb-4"
              >
                <CaretLeft size={16} /> Back
              </button>

              <h2 className="font-semibold text-xl mb-1">{selected.title}</h2>
              <p className="text-sm text-gray-500 mb-6">Burn AkibaMiles to generate this voucher</p>

              {/* Details card */}
              <div className="bg-gray-50 rounded-2xl p-4 space-y-3 mb-6">
                <div className="flex justify-between text-sm">
                  <span className="text-gray-500">Discount</span>
                  <span className="font-semibold text-[#238D9D]">{discountLabel(selected)}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-gray-500">Applies to</span>
                  <span className="font-medium">{categoryLabel(selected)}</span>
                </div>
                {selected.cooldown_seconds ? (
                  <div className="flex justify-between text-sm">
                    <span className="text-gray-500">Cooldown</span>
                    <span className="font-medium">{cooldownLabel(selected.cooldown_seconds)}</span>
                  </div>
                ) : null}
                {selected.global_cap ? (
                  <div className="flex justify-between text-sm">
                    <span className="text-gray-500">Limited supply</span>
                    <span className="font-medium">{selected.global_cap} total</span>
                  </div>
                ) : null}
                <div className="border-t border-gray-200 pt-3 flex justify-between">
                  <span className="text-sm text-gray-500">Cost</span>
                  <div className="flex items-center gap-1.5">
                    <Image src={akibaMilesSymbol} alt="" width={16} height={16} />
                    <span className="font-bold text-base">{selected.miles_cost.toLocaleString()} AkibaMiles</span>
                  </div>
                </div>
              </div>

              {/* Balance check */}
              <div className="flex justify-between items-center text-sm mb-6">
                <span className="text-gray-500">Your balance</span>
                <div className="flex items-center gap-1">
                  <Image src={akibaMilesSymbol} alt="" width={14} height={14} />
                  <span className={balance < selected.miles_cost ? "text-red-500 font-semibold" : "font-semibold"}>
                    {balance.toLocaleString()}
                  </span>
                </div>
              </div>

              {balance < selected.miles_cost && (
                <p className="text-xs text-red-500 text-center mb-4">
                  You need {(selected.miles_cost - balance).toLocaleString()} more AkibaMiles.
                </p>
              )}

              <Button
                title={issuing ? "Signing & burning…" : `Burn ${selected.miles_cost.toLocaleString()} Miles`}
                onClick={handleIssue}
                disabled={issuing || balance < selected.miles_cost}
                className="w-full bg-[#238D9D] text-white rounded-xl h-[56px] font-medium text-base"
              />
            </div>
          )}

          {/* ── SUCCESS ──────────────────────────────────────────────────── */}
          {screen === "success" && voucherCode && (
            <div className="flex flex-col items-center text-center py-2">
              <div className="relative w-40 h-40 mb-2">
                <Image src={Successsvg} alt="Success" fill className="object-contain" />
              </div>

              <h2 className="font-bold text-xl mb-1">Voucher issued!</h2>
              <p className="text-sm text-gray-500 mb-6">
                Show this code at {merchant.name} when ordering.
              </p>

              {/* Code card */}
              <div className="w-full bg-[#238D9D0D] border border-[#238D9D33] rounded-2xl p-5 mb-4">
                <p className="text-xs text-gray-400 mb-2 uppercase tracking-wide">Your voucher code</p>
                <p className="text-3xl font-mono font-bold tracking-[0.3em] text-[#238D9D] mb-3">
                  {voucherCode}
                </p>
                <button
                  onClick={handleCopy}
                  className="flex items-center gap-1.5 text-sm text-gray-500 mx-auto transition-colors hover:text-[#238D9D]"
                >
                  {copied ? (
                    <>
                      <CheckCircle size={15} className="text-green-500" />
                      <span className="text-green-500">Copied!</span>
                    </>
                  ) : (
                    <>
                      <Copy size={15} />
                      Copy code
                    </>
                  )}
                </button>
              </div>

              <p className="text-xs text-gray-400 mb-6 leading-relaxed">
                Use this code in the Shop flow to apply your discount at checkout.
              </p>

              <Button
                title="Done"
                onClick={() => onOpenChange(false)}
                className="w-full bg-[#238D9D1A] text-[#238D9D] rounded-xl h-[56px] font-medium text-base"
              />
            </div>
          )}
        </SheetContent>
      </Sheet>

      {error && (
        <FeedbackDialog
          open={true}
          title={error.title}
          description={error.desc}
          onClose={() => setError(null)}
        />
      )}
    </>
  );
}
