// components/voucher-order-sheet.tsx
"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import Image from "next/image";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "./ui/sheet";
import { Button } from "./ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "./ui/select";
import {
  CaretLeft,
  CheckCircle,
  Spinner,
  Tag,
  MapPin,
  Package,
  CurrencyCircleDollar,
  Confetti,
} from "@phosphor-icons/react";
import { akibaMilesSymbol, Successsvg } from "@/lib/svg";
import { useWeb3 } from "@/contexts/useWeb3";
import FeedbackDialog from "./FeedbackDialog";
import { createPublicClient, createWalletClient, custom, parseUnits } from "viem";
import { celo } from "viem/chains";
import { calculateOrderTotal } from "@/lib/spendOrderPricing";

// ── Config ────────────────────────────────────────────────────────────────────

const DELIVERY_FEE_ADDRESS =
  process.env.NEXT_PUBLIC_DELIVERY_FEE_ADDRESS as `0x${string}` | undefined;

const ERC20_ABI = [
  {
    name: "transfer",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "to", type: "address" },
      { name: "value", type: "uint256" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
] as const;

const TOKEN_CONFIG = {
  cUSD: {
    address: "0x765de816845861e75a25fca122bb6898b8b1282a" as `0x${string}`,
    decimals: 18,
    label: "cUSD",
  },
  USDT: {
    address: "0x48065fbBE25f71C9282ddf5e1cD6D6A887483D5e" as `0x${string}`,
    decimals: 6,
    label: "USDT",
  },
  USDC: {
    address: "0xcebA9300f2b948710d2653dD7B07f33A8B32118C" as `0x${string}`,
    decimals: 6,
    label: "USDC",
  },
} as const;

type Currency = keyof typeof TOKEN_CONFIG;

// ── Types ─────────────────────────────────────────────────────────────────────

export type SpendMerchant = {
  id: string;
  slug: string;
  name: string;
  image_url?: string | null;
};

export type SpendProduct = {
  id: number;
  name: string;
  description?: string | null;
  price_cusd: number;
  category: string;
  image_url?: string | null;
};

export type IssuedVoucher = {
  id: string;
  code: string;
  status: string;
  rules_snapshot: {
    voucher_type: "free" | "percent_off" | "fixed_off";
    discount_percent?: number | null;
    discount_cusd?: number | null;
    applicable_category?: string | null;
  };
  spend_voucher_templates?: {
    title?: string;
    spend_merchants?: { name?: string };
  } | null;
};

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  merchant: SpendMerchant | null;
  /** Pre-select a voucher (from the vouchers page "Order goods" action) */
  preloadVoucher?: IssuedVoucher | null;
};

// ── Helpers ───────────────────────────────────────────────────────────────────

const KES_RATE = 130;
const OTHER_LOCALITY = "__other__";
const KENYA_LOCALITIES = [
  "Nairobi",
  "Mombasa",
  "Kisumu",
  "Nakuru",
  "Eldoret",
  "Thika",
  "Nyeri",
  "Meru",
  "Machakos",
  "Kakamega",
  "Malindi",
  "Kericho",
  "Nanyuki",
  "Embu",
  "Kitale",
  "Garissa",
  "Isiolo",
  "Kisii",
] as const;

type UserDeliveryProfile = {
  username?: string | null;
  full_name?: string | null;
  phone?: string | null;
  country?: string | null;
};

function discountSummary(v: IssuedVoucher): string {
  const r = v.rules_snapshot;
  if (r.voucher_type === "free") return "FREE product (≤$15)";
  if (r.voucher_type === "percent_off") return `${r.discount_percent ?? 0}% off`;
  if (r.voucher_type === "fixed_off") return `$${r.discount_cusd ?? 0} off`;
  return "";
}

function fmt(n: number) {
  return n.toFixed(2);
}

// ── Step progress indicator ───────────────────────────────────────────────────

const STEPS = ["Product", "Voucher", "Delivery", "Payment", "Done"];

function StepBar({ step }: { step: number }) {
  return (
    <div className="flex items-center gap-1.5 justify-center mb-5">
      {STEPS.map((_, i) => (
        <div
          key={i}
          className={`rounded-full h-1.5 transition-all duration-300 ${
            i === step
              ? "w-6 bg-[#238D9D]"
              : i < step
              ? "w-3 bg-[#238D9D]"
              : "w-3 bg-gray-200"
          }`}
        />
      ))}
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export default function VoucherOrderSheet({
  open,
  onOpenChange,
  merchant,
  preloadVoucher,
}: Props) {
  const { address } = useWeb3();

  // ── Navigation state ──────────────────────────────────────────────────────
  const [step, setStep] = useState(0);

  // ── Step 0 — Products ─────────────────────────────────────────────────────
  const [products, setProducts] = useState<SpendProduct[]>([]);
  const [loadingProducts, setLoadingProducts] = useState(false);
  const [selectedProduct, setSelectedProduct] = useState<SpendProduct | null>(null);

  // ── Step 1 — Vouchers ─────────────────────────────────────────────────────
  const [userVouchers, setUserVouchers] = useState<IssuedVoucher[]>([]);
  const [loadingVouchers, setLoadingVouchers] = useState(false);
  const [selectedVoucher, setSelectedVoucher] = useState<IssuedVoucher | null>(
    preloadVoucher ?? null,
  );

  // ── Step 2 — Delivery ─────────────────────────────────────────────────────
  const [recipientName, setRecipientName] = useState("");
  const [phone, setPhone] = useState("");
  const [selectedLocality, setSelectedLocality] = useState("");
  const [otherLocality, setOtherLocality] = useState("");
  const [locationDetails, setLocationDetails] = useState("");
  const [loadingProfile, setLoadingProfile] = useState(false);

  // ── Step 3 — Payment ─────────────────────────────────────────────────────
  const [currency, setCurrency] = useState<Currency>("cUSD");
  const [paying, setPaying] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  // Preserved after on-chain tx confirms — allows retry if backend submission fails
  const [pendingTxHash, setPendingTxHash] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);

  // ── Step 4 — Success ──────────────────────────────────────────────────────
  const [confirmedOrder, setConfirmedOrder] = useState<{
    id: string;
    delivery_eta: string;
    amount_paid_cusd: number;
  } | null>(null);

  const [error, setError] = useState<{ title: string; desc?: string } | null>(null);

  // ── Pricing ───────────────────────────────────────────────────────────────
  const effectiveCity =
    selectedLocality === OTHER_LOCALITY ? otherLocality.trim() : selectedLocality.trim();

  const pricing = useMemo(() => {
    if (!selectedProduct) return null;
    return calculateOrderTotal({
      product_price_cusd: Number(selectedProduct.price_cusd),
      product_category: selectedProduct.category,
      city: effectiveCity || "other",
      voucher: selectedVoucher ? selectedVoucher.rules_snapshot : null,
    });
  }, [selectedProduct, effectiveCity, selectedVoucher]);

  // ── Load products on open ─────────────────────────────────────────────────
  useEffect(() => {
    if (!open || !merchant) return;
    setLoadingProducts(true);
    fetch(`/api/Spend/orders/products?merchant_id=${merchant.id}`)
      .then((r) => r.json())
      .then((d) => setProducts(d.products ?? []))
      .catch(() => setProducts([]))
      .finally(() => setLoadingProducts(false));
  }, [open, merchant]);

  // ── Load vouchers on step 1 ───────────────────────────────────────────────
  useEffect(() => {
    if (step !== 1 || !address) return;
    setLoadingVouchers(true);
    fetch(`/api/Spend/vouchers/user/${address}`)
      .then((r) => r.json())
      .then((d) => {
        const valid = (d.vouchers ?? []).filter((v: IssuedVoucher) => v.status === "issued");
        setUserVouchers(valid);
      })
      .catch(() => setUserVouchers([]))
      .finally(() => setLoadingVouchers(false));
  }, [step, address]);

  useEffect(() => {
    if (!open || !address) return;

    let cancelled = false;
    setLoadingProfile(true);

    fetch(`/api/users/${address.toLowerCase()}`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((profile: UserDeliveryProfile | null) => {
        if (cancelled || !profile) return;

        const preferredName = profile.full_name?.trim() || profile.username?.trim() || "";
        if (preferredName) setRecipientName((current) => current || preferredName);
        if (profile.phone?.trim()) setPhone((current) => current || profile.phone!.trim());
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setLoadingProfile(false);
      });

    return () => {
      cancelled = true;
    };
  }, [open, address]);

  // ── Reset on open/close ───────────────────────────────────────────────────
  useEffect(() => {
    if (open) {
      setStep(0);
      setSelectedProduct(null);
      setSelectedVoucher(preloadVoucher ?? null);
      setRecipientName("");
      setPhone("");
      setSelectedLocality("");
      setOtherLocality("");
      setLocationDetails("");
      setCurrency("cUSD");
      setConfirmedOrder(null);
      setPendingTxHash(null);
      setSubmitError(null);
    }
  }, [open, preloadVoucher]);

  const back = () => setStep((s) => Math.max(0, s - 1));

  // ── Delivery validation ───────────────────────────────────────────────────
  const deliveryValid =
    recipientName.trim().length >= 2 &&
    phone.trim().length >= 8 &&
    effectiveCity.length >= 2;

  // ── Submit order to backend (can be retried with an existing tx hash) ────────
  const submitOrder = useCallback(async (hash: string) => {
    if (!address || !selectedProduct) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      const res = await fetch("/api/Spend/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          user_address: address,
          product_id: selectedProduct.id,
          voucher_code: selectedVoucher?.code ?? null,
          recipient_name: recipientName.trim(),
          phone: phone.trim(),
          city: effectiveCity,
          location_details: locationDetails.trim() || null,
          delivery_fee_tx_hash: hash,
          currency,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Order submission failed");
      setPendingTxHash(null);
      setSubmitError(null);
      setConfirmedOrder({
        id: json.order.id,
        delivery_eta: json.order.delivery_eta,
        amount_paid_cusd: json.order.amount_paid_cusd,
      });
      setStep(4);
    } catch (err: any) {
      setSubmitError(err?.message ?? "Something went wrong. Your payment was received — tap Retry.");
    } finally {
      setSubmitting(false);
    }
  }, [address, selectedProduct, selectedVoucher, recipientName, phone, effectiveCity, locationDetails, currency]);

  // ── Payment handler ───────────────────────────────────────────────────────
  const handlePay = useCallback(async () => {
    if (!address || !selectedProduct || !pricing || !DELIVERY_FEE_ADDRESS) {
      if (!DELIVERY_FEE_ADDRESS)
        setError({ title: "Config error", desc: "Payment address not configured." });
      return;
    }

    const token = TOKEN_CONFIG[currency];

    try {
      setPaying(true);

      // 1. Send ERC-20 transfer
      const wc = createWalletClient({ transport: custom((window as any).ethereum), chain: celo });
      const pc = createPublicClient({ transport: custom((window as any).ethereum), chain: celo });

      const amountRaw = parseUnits(pricing.total_cusd.toFixed(6), token.decimals);

      const hash = await wc.writeContract({
        address: token.address,
        abi: ERC20_ABI,
        functionName: "transfer",
        args: [DELIVERY_FEE_ADDRESS, amountRaw],
        account: address as `0x${string}`,
        chain: celo,
      });

      // 2. Wait for confirmation — once confirmed the money is gone, store the hash immediately
      await pc.waitForTransactionReceipt({ hash, confirmations: 1, timeout: 120_000 });
      setPendingTxHash(hash);
      setPaying(false);

      // 3. Submit order — if this fails the user can retry without paying again
      await submitOrder(hash);
    } catch (err: any) {
      const msg: string = err?.message ?? "";
      if (/user rejected|rejected by user/i.test(msg)) {
        setError({ title: "Cancelled", desc: "You rejected the transaction." });
      } else if (!pendingTxHash) {
        // Failed before tx confirmed — no money sent
        setError({ title: "Payment failed", desc: msg || "Transaction did not go through." });
      }
      // If pendingTxHash is set, the tx confirmed and submitOrder's own error handling covers it
    } finally {
      setPaying(false);
    }
  }, [
    address, selectedProduct, selectedVoucher, pricing, currency,
    recipientName, phone, effectiveCity, locationDetails, pendingTxHash, submitOrder,
  ]);

  if (!merchant) return null;

  const isProcessing = paying || submitting;

  return (
    <>
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent
          side="bottom"
          className="bg-white rounded-t-2xl font-sterling max-h-[90vh] overflow-auto p-4 pb-8"
        >
          <SheetHeader>
            <SheetTitle className="sr-only">Shop — {merchant.name}</SheetTitle>
          </SheetHeader>

          {/* Processing overlay */}
          {isProcessing && (
            <div className="flex flex-col items-center justify-center h-64 gap-3">
              <Spinner size={32} className="animate-spin text-[#238D9D]" />
              <p className="text-gray-500 text-sm">
                {paying ? "Sending payment…" : "Confirming order…"}
              </p>
            </div>
          )}

          {/* ── STEP 0 — PRODUCTS ──────────────────────────────────────── */}
          {!isProcessing && step === 0 && (
            <div>
              <StepBar step={0} />
              <div className="flex items-center gap-2 mb-4">
                {merchant.image_url && (
                  <div className="relative w-8 h-8 rounded-lg overflow-hidden shrink-0">
                    <Image src={merchant.image_url} alt="" fill className="object-cover" />
                  </div>
                )}
                <div>
                  <p className="text-xs text-gray-400">Shopping at</p>
                  <h2 className="font-semibold text-base leading-tight">{merchant.name}</h2>
                </div>
              </div>

              <h3 className="font-semibold mb-3 text-base flex items-center gap-1.5">
                <Package size={18} className="text-[#238D9D]" /> Choose a product
              </h3>

              {loadingProducts ? (
                <div className="flex justify-center py-10">
                  <Spinner size={28} className="animate-spin text-[#238D9D]" />
                </div>
              ) : products.length === 0 ? (
                <p className="text-center text-gray-400 py-10 text-sm">
                  No products available right now.
                </p>
              ) : (
                <div className="space-y-3">
                  {products.map((p) => (
                    <button
                      key={p.id}
                      onClick={() => {
                        setSelectedProduct(p);
                        setStep(1);
                      }}
                      className="w-full text-left border-2 border-gray-100 hover:border-[#238D9D] rounded-2xl p-3 flex gap-3 transition-all active:border-[#238D9D]"
                    >
                      {p.image_url ? (
                        <div className="relative w-20 h-20 rounded-xl overflow-hidden shrink-0">
                          <Image src={p.image_url} alt={p.name} fill className="object-cover" />
                        </div>
                      ) : (
                        <div className="w-20 h-20 rounded-xl bg-gray-100 shrink-0 flex items-center justify-center">
                          <Package size={24} className="text-gray-300" />
                        </div>
                      )}
                      <div className="flex-1 min-w-0">
                        <p className="font-medium text-sm leading-tight">{p.name}</p>
                        <p className="text-xs text-gray-400 mt-0.5 capitalize">{p.category}</p>
                        {p.description && (
                          <p className="text-xs text-gray-500 mt-1 line-clamp-2">{p.description}</p>
                        )}
                        <p className="font-bold text-[#238D9D] mt-1.5">
                          ${fmt(Number(p.price_cusd))}
                          <span className="font-normal text-gray-400 text-xs ml-1">
                            ({Math.round(Number(p.price_cusd) * KES_RATE).toLocaleString()} KES)
                          </span>
                        </p>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* ── STEP 1 — VOUCHER ───────────────────────────────────────── */}
          {!isProcessing && step === 1 && (
            <div>
              <StepBar step={1} />
              <button onClick={back} className="flex items-center gap-1 text-sm text-gray-500 mb-4">
                <CaretLeft size={16} /> Back
              </button>

              <h3 className="font-semibold text-base mb-1 flex items-center gap-1.5">
                <Tag size={18} className="text-[#238D9D]" /> Apply a voucher
              </h3>
              <p className="text-sm text-gray-400 mb-4">Optional — skip to continue without a discount</p>

              {loadingVouchers ? (
                <div className="flex justify-center py-6">
                  <Spinner size={24} className="animate-spin text-[#238D9D]" />
                </div>
              ) : userVouchers.length === 0 ? (
                <div className="bg-gray-50 rounded-2xl p-4 text-center text-sm text-gray-400 mb-4">
                  No vouchers in your wallet.
                </div>
              ) : (
                <div className="space-y-2 mb-4">
                  {userVouchers.map((v) => {
                    const isSelected = selectedVoucher?.id === v.id;
                    return (
                      <button
                        key={v.id}
                        onClick={() => setSelectedVoucher(isSelected ? null : v)}
                        className={`w-full text-left border-2 rounded-2xl p-3 transition-all ${
                          isSelected
                            ? "border-[#238D9D] bg-[#238D9D0D]"
                            : "border-gray-100 hover:border-[#238D9D33]"
                        }`}
                      >
                        <div className="flex items-center justify-between">
                          <div>
                            <p className="font-semibold text-sm text-[#238D9D]">
                              {discountSummary(v)}
                            </p>
                            <p className="text-xs text-gray-500 mt-0.5">
                              {v.spend_voucher_templates?.title ?? "Voucher"} ·{" "}
                              {v.rules_snapshot.applicable_category
                                ? v.rules_snapshot.applicable_category
                                : "all products"}
                            </p>
                          </div>
                          {isSelected && <CheckCircle size={20} className="text-[#238D9D] shrink-0" />}
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}

              <div className="flex gap-2">
                <Button
                  title="Skip"
                  onClick={() => {
                    setSelectedVoucher(null);
                    setStep(2);
                  }}
                  className="flex-1 bg-gray-100 text-gray-600 rounded-xl h-12 font-medium"
                />
                <Button
                  title={selectedVoucher ? "Apply & Continue" : "Continue"}
                  onClick={() => setStep(2)}
                  className="flex-1 bg-[#238D9D] text-white rounded-xl h-12 font-medium"
                />
              </div>
            </div>
          )}

          {/* ── STEP 2 — DELIVERY ──────────────────────────────────────── */}
          {!isProcessing && step === 2 && (
            <div>
              <StepBar step={2} />
              <button onClick={back} className="flex items-center gap-1 text-sm text-gray-500 mb-4">
                <CaretLeft size={16} /> Back
              </button>

              <h3 className="font-semibold text-base mb-4 flex items-center gap-1.5">
                <MapPin size={18} className="text-[#238D9D]" /> Delivery details
              </h3>

              {loadingProfile && (
                <div className="mb-4 rounded-2xl bg-[#238D9D0D] px-3 py-2 text-xs text-[#238D9D]">
                  Pulling your saved profile details…
                </div>
              )}

              <div className="space-y-3 mb-6">
                <div>
                  <label className="block text-sm font-medium mb-1">Full name</label>
                  <input
                    value={recipientName}
                    onChange={(e) => setRecipientName(e.target.value)}
                    placeholder="Your full name"
                    className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-base focus:outline-none focus:ring-2 focus:ring-[#238D9D]"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium mb-1">Phone number</label>
                  <input
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    placeholder="+254 700 000 000"
                    inputMode="tel"
                    className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-base focus:outline-none focus:ring-2 focus:ring-[#238D9D]"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium mb-1">City / Town</label>
                  <Select
                    value={selectedLocality}
                    onValueChange={(value) => {
                      setSelectedLocality(value);
                      if (value !== OTHER_LOCALITY) setOtherLocality("");
                    }}
                  >
                    <SelectTrigger className="w-full h-12 rounded-xl border-gray-200 bg-white px-3 text-base focus:ring-2 focus:ring-[#238D9D]">
                      <SelectValue placeholder="Choose your town / locality" />
                    </SelectTrigger>
                    <SelectContent className="bg-white">
                      {KENYA_LOCALITIES.map((locality) => (
                        <SelectItem key={locality} value={locality}>
                          {locality}
                        </SelectItem>
                      ))}
                      <SelectItem value={OTHER_LOCALITY}>Other</SelectItem>
                    </SelectContent>
                  </Select>
                  {selectedLocality === OTHER_LOCALITY && (
                    <input
                      value={otherLocality}
                      onChange={(e) => setOtherLocality(e.target.value)}
                      placeholder="Enter your town / area"
                      className="mt-2 w-full border border-gray-200 rounded-xl px-3 py-2.5 text-base focus:outline-none focus:ring-2 focus:ring-[#238D9D]"
                    />
                  )}
                  {effectiveCity && pricing && (
                    <p className="text-xs text-[#238D9D] mt-1">
                      Delivery fee: ${fmt(pricing.delivery_fee_cusd)} · {pricing.delivery_eta}
                    </p>
                  )}
                </div>

                <div>
                  <label className="block text-sm font-medium mb-1">
                    Street / building{" "}
                    <span className="font-normal text-gray-400">(optional)</span>
                  </label>
                  <textarea
                    value={locationDetails}
                    onChange={(e) => setLocationDetails(e.target.value)}
                    placeholder="Building name, street, estate, landmark…"
                    rows={2}
                    className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-base focus:outline-none focus:ring-2 focus:ring-[#238D9D] resize-none"
                  />
                </div>
              </div>

              <Button
                title="Continue to payment"
                onClick={() => setStep(3)}
                disabled={!deliveryValid}
                className="w-full bg-[#238D9D] text-white rounded-xl h-[56px] font-medium text-base"
              />
            </div>
          )}

          {/* ── STEP 3 — PAYMENT ───────────────────────────────────────── */}
          {!isProcessing && step === 3 && pricing && (
            <div>
              <StepBar step={3} />
              <button onClick={back} className="flex items-center gap-1 text-sm text-gray-500 mb-4">
                <CaretLeft size={16} /> Back
              </button>

              <h3 className="font-semibold text-base mb-4 flex items-center gap-1.5">
                <CurrencyCircleDollar size={18} className="text-[#238D9D]" /> Payment summary
              </h3>

              {/* Order summary */}
              <div className="bg-gray-50 rounded-2xl p-4 space-y-2.5 mb-4">
                <div className="flex justify-between text-sm">
                  <span className="text-gray-500">Product</span>
                  <span className="font-medium">{selectedProduct?.name}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-gray-500">Price</span>
                  <span>${fmt(pricing.product_price_cusd)}</span>
                </div>

                {selectedVoucher && pricing.voucher_applied && (
                  <div className="flex justify-between text-sm text-green-600">
                    <span>Voucher <span className="font-mono text-xs">{selectedVoucher.code}</span></span>
                    <span>−${fmt(pricing.product_price_cusd - pricing.discounted_product_cusd)}</span>
                  </div>
                )}
                {selectedVoucher && !pricing.voucher_applied && (
                  <div className="flex justify-between text-sm text-orange-500">
                    <span>Voucher <span className="font-mono text-xs">{selectedVoucher.code}</span></span>
                    <span className="text-xs">Not applicable to this item</span>
                  </div>
                )}

                <div className="flex justify-between text-sm">
                  <span className="text-gray-500">Delivery ({pricing.delivery_eta})</span>
                  <span>${fmt(pricing.delivery_fee_cusd)}</span>
                </div>

                <div className="border-t border-gray-200 pt-2.5 flex justify-between font-bold">
                  <span>Total</span>
                  <div className="text-right">
                    <p className="text-[#238D9D] text-base">${fmt(pricing.total_cusd)}</p>
                    <p className="text-xs text-gray-400 font-normal">
                      ≈ {pricing.total_kes.toLocaleString()} KES
                    </p>
                  </div>
                </div>
              </div>

              {/* Delivery details pill */}
              <div className="flex items-start gap-2 text-sm text-gray-500 mb-4 px-1">
                <MapPin size={15} className="mt-0.5 shrink-0 text-[#238D9D]" />
                <span>
                  {recipientName} · {phone} · {effectiveCity}
                  {locationDetails ? ` · ${locationDetails}` : ""}
                </span>
              </div>

              {/* Rewards note */}
              <div className="flex items-center gap-2 bg-[#238D9D0D] rounded-xl px-3 py-2 mb-5">
                <Image src={akibaMilesSymbol} alt="" width={16} height={16} />
                <p className="text-xs text-[#238D9D] font-medium">
                  +200 AkibaMiles reward after delivery confirmation
                </p>
              </div>

              {/* Currency selector */}
              <p className="text-sm font-medium mb-2">Pay with</p>
              <div className="flex gap-2 mb-5">
                {(Object.keys(TOKEN_CONFIG) as Currency[]).map((c) => (
                  <button
                    key={c}
                    onClick={() => setCurrency(c)}
                    className={`flex-1 py-2.5 rounded-xl font-semibold text-sm border-2 transition-all ${
                      currency === c
                        ? "border-[#238D9D] bg-[#238D9D0D] text-[#238D9D]"
                        : "border-gray-200 text-gray-500"
                    }`}
                  >
                    {c}
                  </button>
                ))}
              </div>

              <Button
                title={`Pay $${fmt(pricing.total_cusd)} ${currency}`}
                onClick={handlePay}
                disabled={!DELIVERY_FEE_ADDRESS}
                className="w-full bg-[#238D9D] text-white rounded-xl h-[56px] font-medium text-base"
              />

              {!DELIVERY_FEE_ADDRESS && (
                <p className="text-xs text-red-500 text-center mt-2">
                  Payment address not configured — contact support.
                </p>
              )}
            </div>
          )}

          {/* ── STEP 4 — SUCCESS ───────────────────────────────────────── */}
          {!isProcessing && step === 4 && confirmedOrder && (
            <div className="flex flex-col items-center text-center py-2">
              <div className="relative w-40 h-40 mb-2">
                <Image src={Successsvg} alt="Success" fill className="object-contain" />
              </div>

              <h2 className="font-bold text-xl mb-1">Order confirmed!</h2>
              <p className="text-sm text-gray-500 mb-5">
                We'll deliver your item within {confirmedOrder.delivery_eta}.
              </p>

              <div className="w-full bg-gray-50 rounded-2xl p-4 space-y-2 text-sm mb-4">
                <div className="flex justify-between">
                  <span className="text-gray-400">Order ID</span>
                  <span className="font-mono text-xs font-medium">{confirmedOrder.id.slice(0, 8)}…</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-400">Paid</span>
                  <span className="font-semibold">${fmt(confirmedOrder.amount_paid_cusd)} {currency}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-400">Delivery</span>
                  <span className="font-medium">{effectiveCity} · {confirmedOrder.delivery_eta}</span>
                </div>
              </div>

              <div className="flex items-center gap-2 bg-[#238D9D0D] rounded-xl px-3 py-2 w-full mb-6">
                <Confetti size={16} className="text-[#238D9D] shrink-0" />
                <p className="text-xs text-[#238D9D] font-medium">
                  +200 AkibaMiles on the way to your wallet!
                </p>
              </div>

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
