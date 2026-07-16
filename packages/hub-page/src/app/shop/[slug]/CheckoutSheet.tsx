"use client";

import { useState, useCallback } from "react";
import {
  X, ShoppingBag, Tag, Truck, Wallet, CheckCircle2,
  AlertCircle, Loader2, ChevronDown, Coins
} from "lucide-react";
import clsx from "clsx";
import { calculateOrder, formatUSD, voucherLabel } from "@/lib/pricing";
import type { VoucherForPricing } from "@/lib/pricing";
import {
  TOKENS, CELO_CHAIN_ID_HEX, CELO_NETWORK_PARAMS,
  encodeERC20Transfer, toTokenUnits
} from "@/lib/tokens";
import type { TokenSymbol } from "@/lib/tokens";

type Product = {
  id: string;
  name: string;
  description: string | null;
  price_cusd: number;
  category: string;
  image_url: string | null;
};

type VoucherTemplate = VoucherForPricing & {
  id: string;
  title: string;
  miles_cost: number;
  expires_at: string | null;
};

type Merchant = {
  id: string;
  name: string;
  slug: string;
  wallet_address: string | null;
  delivery_cities: string[];
};

type CheckoutStep = "idle" | "details" | "review" | "paying" | "done" | "error";

const DELIVERY_CITIES = [
  "Nairobi", "Mombasa", "Kisumu", "Nakuru", "Eldoret", "Thika",
  "Machakos", "Nyeri", "Meru", "Kitale", "Malindi", "Kilifi", "Other",
];

export function CheckoutSheet({
  product,
  merchant,
  voucherTemplates,
}: {
  product: Product;
  merchant: Merchant;
  voucherTemplates: VoucherTemplate[];
}) {
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<CheckoutStep>("idle");

  // Details form
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [city, setCity] = useState("");
  const [locationDetails, setLocationDetails] = useState("");
  const [currency, setCurrency] = useState<TokenSymbol>("cUSD");
  const [voucherCode, setVoucherCode] = useState("");
  const [voucherId, setVoucherId] = useState<string | null>(null);
  const [voucherCodeInput, setVoucherCodeInput] = useState("");
  const [appliedVoucher, setAppliedVoucher] = useState<VoucherForPricing | null>(null);

  // Payment state
  const [walletAddress, setWalletAddress] = useState<string | null>(null);
  const [txHash, setTxHash] = useState<string | null>(null);
  const [orderId, setOrderId] = useState<string | null>(null);
  const [eta, setEta] = useState<string>("3–5 days");
  const [error, setError] = useState<string | null>(null);
  const [reward, setReward] = useState<{ issued: boolean; miles: number; pending?: boolean; reason?: string } | null>(null);

  const pricing = calculateOrder(
    product.price_cusd,
    product.category,
    product.id,
    city || "other",
    appliedVoucher
  );

  const reset = () => {
    setStep("idle");
    setName("");
    setPhone("");
    setCity("");
    setLocationDetails("");
    setVoucherCode("");
    setVoucherId(null);
    setVoucherCodeInput("");
    setAppliedVoucher(null);
    setWalletAddress(null);
    setTxHash(null);
    setOrderId(null);
    setError(null);
    setReward(null);
  };

  const close = () => {
    setOpen(false);
    setTimeout(reset, 300);
  };

  // Apply voucher code — lookup is authenticated and returns server-side rules
  const applyVoucherCode = async () => {
    if (!voucherCodeInput.trim()) return;
    const res = await fetch(
      `/api/shop/vouchers/lookup?code=${encodeURIComponent(voucherCodeInput.trim().toUpperCase())}&merchant_id=${encodeURIComponent(merchant.id)}`
    );
    if (!res.ok) {
      const json = await res.json().catch(() => ({})) as { error?: string };
      setError(json.error ?? "Voucher not found or already used.");
      return;
    }
    const { voucher_id, rules } = await res.json() as { voucher_id: string; rules: VoucherForPricing };
    setAppliedVoucher(rules);
    setVoucherId(voucher_id);
    setVoucherCode(voucherCodeInput.trim().toUpperCase());
    setError(null);
  };

  const connectWallet = useCallback(async (): Promise<string | null> => {
    if (!window.ethereum) {
      setError("No wallet detected. Please install MetaMask or use MiniPay / Coinbase browser.");
      return null;
    }

    try {
      const accounts = await window.ethereum.request({
        method: "eth_requestAccounts",
      }) as string[];

      const chainId = await window.ethereum.request({ method: "eth_chainId" }) as string;

      if (chainId !== CELO_CHAIN_ID_HEX) {
        try {
          await window.ethereum.request({
            method: "wallet_switchEthereumChain",
            params: [{ chainId: CELO_CHAIN_ID_HEX }],
          });
        } catch {
          await window.ethereum.request({
            method: "wallet_addEthereumChain",
            params: [CELO_NETWORK_PARAMS],
          });
        }
      }

      const address = accounts[0];
      setWalletAddress(address);
      return address;
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Wallet connection failed";
      setError(msg);
      return null;
    }
  }, []);

  const pay = useCallback(async () => {
    if (!merchant.wallet_address) {
      setError("This merchant has no payment wallet configured.");
      return;
    }

    setStep("paying");
    setError(null);

    const address = walletAddress ?? await connectWallet();
    if (!address) { setStep("review"); return; }

    const token = TOKENS[currency];
    const amountWei = toTokenUnits(pricing.total, token.decimals);
    const data = encodeERC20Transfer(merchant.wallet_address, amountWei);

    try {
      const hash = await window.ethereum!.request({
        method: "eth_sendTransaction",
        params: [{
          from: address,
          to: token.address,
          data,
          gas: "0x186a0",
        }],
      }) as string;

      setTxHash(hash);

      // Submit to backend (backend polls for receipt)
      const res = await fetch("/api/shop/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          product_id: product.id,
          voucher_id: voucherId || undefined,
          voucher_code: voucherCode || undefined,
          recipient_name: name,
          phone,
          city,
          location_details: locationDetails || undefined,
          tx_hash: hash,
          currency,
        }),
      });

      const json = await res.json() as {
        error?: string;
        order?: { id: string; eta?: string };
        reward?: { issued: boolean; miles: number; pending?: boolean; reason?: string };
      };

      if (!res.ok) {
        setError(json.error ?? "Order failed.");
        setStep("error");
        return;
      }

      setOrderId(json.order!.id);
      setEta(json.order!.eta ?? "3–5 days");
      setReward(json.reward ?? null);
      setStep("done");
    } catch (e: unknown) {
      if ((e as { code?: number })?.code === 4001) {
        setError("Transaction rejected.");
      } else {
        setError(e instanceof Error ? e.message : "Payment failed.");
      }
      setStep("review");
    }
  }, [
    merchant.wallet_address, walletAddress, currency, pricing.total,
    product.id, voucherId, voucherCode, name, phone, city, locationDetails, connectWallet,
  ]);

  return (
    <>
      <button
        onClick={() => { setOpen(true); setStep("details"); }}
        className="mt-4 w-full rounded-xl bg-akiba-teal py-2.5 text-sm font-semibold text-white transition hover:bg-[#1E7E8D]"
      >
        Buy & Earn
      </button>

      {/* Sheet overlay */}
      {open && (
        <div className="fixed inset-0 z-[60] flex items-end justify-center sm:items-center">
          {/* Backdrop */}
          <div
            className="absolute inset-0 bg-black/40 backdrop-blur-sm"
            onClick={close}
          />

          {/* Sheet */}
          <div className="relative z-10 w-full max-w-lg overflow-y-auto rounded-t-3xl bg-white shadow-2xl sm:rounded-2xl max-h-[90vh] pb-[env(safe-area-inset-bottom)]">
            {/* Handle */}
            <div className="mx-auto mt-3 h-1 w-10 rounded-full bg-akiba-line sm:hidden" />

            {/* Header */}
            <div className="flex items-center justify-between border-b border-akiba-line px-5 py-4">
              <div>
                <h2 className="font-sterling text-lg font-semibold text-akiba-ink">
                  {step === "done" ? "Order placed!" : "Checkout"}
                </h2>
                <p className="text-sm text-akiba-muted">{merchant.name}</p>
              </div>
              <button onClick={close} className="rounded-full p-1.5 hover:bg-akiba-card">
                <X className="h-5 w-5 text-akiba-muted" />
              </button>
            </div>

            <div className="p-5">
              {/* Product summary — always visible */}
              {step !== "done" && (
                <div className="mb-5 flex items-center gap-3 rounded-xl bg-akiba-card p-3">
                  <div className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-white">
                    {product.image_url ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={product.image_url} alt={product.name} className="h-full w-full object-cover" />
                    ) : (
                      <ShoppingBag className="h-6 w-6 text-akiba-muted" />
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-akiba-ink truncate">{product.name}</p>
                    <p className="text-sm text-akiba-muted">${product.price_cusd.toFixed(2)}</p>
                  </div>
                </div>
              )}

              {/* STEP: Delivery details */}
              {step === "details" && (
                <DetailsForm
                  name={name} setName={setName}
                  phone={phone} setPhone={setPhone}
                  city={city} setCity={setCity}
                  locationDetails={locationDetails} setLocationDetails={setLocationDetails}
                  currency={currency} setCurrency={setCurrency}
                  voucherCodeInput={voucherCodeInput} setVoucherCodeInput={setVoucherCodeInput}
                  appliedVoucher={appliedVoucher}
                  voucherTemplates={voucherTemplates}
                  product={product}
                  onApplyVoucher={applyVoucherCode}
                  onClearVoucher={() => { setAppliedVoucher(null); setVoucherCode(""); setVoucherId(null); setVoucherCodeInput(""); }}
                  error={error}
                  onNext={() => {
                    if (!name || !phone || !city) { setError("Fill in all delivery fields."); return; }
                    setError(null);
                    setStep("review");
                  }}
                />
              )}

              {/* STEP: Review + pay */}
              {step === "review" && (
                <ReviewAndPay
                  pricing={pricing}
                  currency={currency}
                  appliedVoucher={appliedVoucher}
                  city={city}
                  name={name}
                  phone={phone}
                  walletAddress={walletAddress}
                  error={error}
                  onConnectWallet={connectWallet}
                  onBack={() => setStep("details")}
                  onPay={pay}
                />
              )}

              {/* STEP: Paying */}
              {step === "paying" && (
                <div className="flex flex-col items-center py-10 text-center">
                  <Loader2 className="mb-4 h-10 w-10 animate-spin text-akiba-teal" />
                  <p className="font-semibold text-akiba-ink">Processing payment…</p>
                  <p className="mt-1 text-sm text-akiba-muted">
                    Confirm in your wallet, then we&apos;ll verify on-chain.
                  </p>
                  {txHash && (
                    <a
                      href={`https://explorer.celo.org/mainnet/tx/${txHash}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="mt-3 text-xs text-akiba-teal underline"
                    >
                      View on Celo Explorer
                    </a>
                  )}
                </div>
              )}

              {/* STEP: Done */}
              {step === "done" && (
                <SuccessScreen
                  orderId={orderId!}
                  eta={eta}
                  reward={reward}
                  onClose={close}
                />
              )}

              {/* STEP: Error */}
              {step === "error" && (
                <div className="flex flex-col items-center py-10 text-center">
                  <AlertCircle className="mb-4 h-10 w-10 text-red-400" />
                  <p className="font-semibold text-akiba-ink">Something went wrong</p>
                  <p className="mt-1 text-sm text-red-500">{error}</p>
                  <button
                    onClick={() => setStep("review")}
                    className="mt-6 rounded-xl bg-akiba-ink px-6 py-2.5 text-sm font-semibold text-white"
                  >
                    Try again
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}

// ─── Sub-components ────────────────────────────────────────────────────────

function DetailsForm({
  name, setName, phone, setPhone, city, setCity,
  locationDetails, setLocationDetails, currency, setCurrency,
  voucherCodeInput, setVoucherCodeInput, appliedVoucher,
  voucherTemplates, product, onApplyVoucher, onClearVoucher, error, onNext,
}: {
  name: string; setName: (v: string) => void;
  phone: string; setPhone: (v: string) => void;
  city: string; setCity: (v: string) => void;
  locationDetails: string; setLocationDetails: (v: string) => void;
  currency: TokenSymbol; setCurrency: (v: TokenSymbol) => void;
  voucherCodeInput: string; setVoucherCodeInput: (v: string) => void;
  appliedVoucher: VoucherForPricing | null;
  voucherTemplates: VoucherTemplate[];
  product: Product;
  onApplyVoucher: () => void;
  onClearVoucher: () => void;
  error: string | null;
  onNext: () => void;
}) {
  return (
    <div className="space-y-4">
      {/* Payment token */}
      <div>
        <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-akiba-muted">
          Pay with
        </label>
        <div className="grid grid-cols-3 gap-2">
          {(Object.keys(TOKENS) as TokenSymbol[]).map((sym) => (
            <button
              key={sym}
              onClick={() => setCurrency(sym)}
              className={clsx(
                "rounded-xl border py-2 text-sm font-semibold transition",
                currency === sym
                  ? "border-akiba-teal bg-akiba-tint text-akiba-teal"
                  : "border-akiba-line bg-white text-akiba-muted hover:border-akiba-teal/40"
              )}
            >
              {sym}
            </button>
          ))}
        </div>
      </div>

      {/* Delivery */}
      <div>
        <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-akiba-muted">
          Delivery details
        </label>
        <div className="space-y-2">
          <input
            type="text"
            placeholder="Recipient name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full rounded-xl border border-akiba-line px-4 py-2.5 text-sm outline-none focus:border-akiba-teal"
          />
          <input
            type="tel"
            placeholder="Phone number"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            className="w-full rounded-xl border border-akiba-line px-4 py-2.5 text-sm outline-none focus:border-akiba-teal"
          />
          <div className="relative">
            <select
              value={city}
              onChange={(e) => setCity(e.target.value)}
              className="w-full appearance-none rounded-xl border border-akiba-line px-4 py-2.5 text-sm outline-none focus:border-akiba-teal"
            >
              <option value="">Select city</option>
              {DELIVERY_CITIES.map((c) => (
                <option key={c} value={c.toLowerCase()}>{c}</option>
              ))}
            </select>
            <ChevronDown className="pointer-events-none absolute right-3 top-3 h-4 w-4 text-akiba-muted" />
          </div>
          <textarea
            placeholder="Delivery address / location details"
            value={locationDetails}
            onChange={(e) => setLocationDetails(e.target.value)}
            rows={2}
            className="w-full rounded-xl border border-akiba-line px-4 py-2.5 text-sm outline-none focus:border-akiba-teal resize-none"
          />
        </div>
      </div>

      {/* Voucher code */}
      <div>
        <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-akiba-muted">
          Voucher code (optional)
        </label>
        {appliedVoucher ? (
          <div className="flex items-center justify-between rounded-xl border border-akiba-teal/30 bg-akiba-tint px-4 py-2.5">
            <div className="flex items-center gap-2">
              <Tag className="h-4 w-4 text-akiba-teal" />
              <span className="text-sm font-medium text-akiba-teal">{voucherLabel(appliedVoucher)}</span>
            </div>
            <button onClick={onClearVoucher} className="text-xs text-akiba-muted hover:text-akiba-ink">
              Remove
            </button>
          </div>
        ) : (
          <div className="flex gap-2">
            <input
              type="text"
              placeholder="Enter code e.g. AKIBA2024"
              value={voucherCodeInput}
              onChange={(e) => setVoucherCodeInput(e.target.value.toUpperCase())}
              className="flex-1 rounded-xl border border-akiba-line px-4 py-2.5 text-sm font-mono outline-none focus:border-akiba-teal"
            />
            <button
              onClick={onApplyVoucher}
              className="rounded-xl border border-akiba-teal px-4 py-2.5 text-sm font-semibold text-akiba-teal transition hover:bg-akiba-tint"
            >
              Apply
            </button>
          </div>
        )}
        {voucherTemplates.length > 0 && !appliedVoucher && (
          <p className="mt-1.5 text-xs text-akiba-muted">
            Issue vouchers using your AkibaMiles on the merchant page.
          </p>
        )}
      </div>

      {error && (
        <p className="flex items-center gap-1.5 text-sm text-red-500">
          <AlertCircle className="h-4 w-4 shrink-0" /> {error}
        </p>
      )}

      <button
        onClick={onNext}
        className="w-full rounded-xl bg-akiba-teal py-3 text-sm font-semibold text-white transition hover:bg-[#1E7E8D]"
      >
        Review order →
      </button>
    </div>
  );
}

function ReviewAndPay({
  pricing, currency, appliedVoucher, city, name, phone,
  walletAddress, error, onConnectWallet, onBack, onPay,
}: {
  pricing: ReturnType<typeof calculateOrder>;
  currency: TokenSymbol;
  appliedVoucher: VoucherForPricing | null;
  city: string;
  name: string;
  phone: string;
  walletAddress: string | null;
  error: string | null;
  onConnectWallet: () => Promise<string | null>;
  onBack: () => void;
  onPay: () => void;
}) {
  return (
    <div className="space-y-4">
      {/* Pricing breakdown */}
      <div className="rounded-2xl border border-akiba-line bg-akiba-card p-4 space-y-2">
        <Row label="Item price" value={formatUSD(pricing.originalPrice)} />
        {pricing.discount > 0 && (
          <Row
            label={`Voucher (${appliedVoucher ? voucherLabel(appliedVoucher) : ""})`}
            value={`-${formatUSD(pricing.discount)}`}
            className="text-akiba-teal"
          />
        )}
        <Row label={`Delivery (${city})`} value={formatUSD(pricing.deliveryFee)} />
        <div className="border-t border-akiba-line pt-2">
          <Row
            label="Total"
            value={`${formatUSD(pricing.total)} (≈ KES ${pricing.totalKes.toLocaleString()})`}
            bold
          />
        </div>
      </div>

      {/* Delivery summary */}
      <div className="rounded-xl bg-white border border-akiba-line p-3 space-y-1.5 text-sm">
        <p className="flex items-center gap-2 text-akiba-muted">
          <Truck className="h-4 w-4 text-akiba-teal" />
          <span className="font-medium text-akiba-ink">Estimated: {pricing.eta}</span>
        </p>
        <p className="pl-6 text-akiba-muted">{name} · {phone}</p>
        <p className="pl-6 text-akiba-muted capitalize">{city}</p>
      </div>

      {/* Wallet connection */}
      {walletAddress ? (
        <div className="flex items-center gap-2 rounded-xl border border-akiba-teal/30 bg-akiba-tint px-4 py-2.5 text-sm">
          <Wallet className="h-4 w-4 text-akiba-teal" />
          <span className="font-mono text-akiba-teal">
            {walletAddress.slice(0, 6)}…{walletAddress.slice(-4)}
          </span>
          <span className="ml-auto text-xs text-akiba-muted">Connected</span>
        </div>
      ) : (
        <button
          onClick={onConnectWallet}
          className="flex w-full items-center justify-center gap-2 rounded-xl border border-akiba-line bg-white py-2.5 text-sm font-semibold text-akiba-ink transition hover:border-akiba-teal/40"
        >
          <Wallet className="h-4 w-4" /> Connect wallet
        </button>
      )}

      {error && (
        <p className="flex items-center gap-1.5 text-sm text-red-500">
          <AlertCircle className="h-4 w-4 shrink-0" /> {error}
        </p>
      )}

      <div className="flex gap-3">
        <button
          onClick={onBack}
          className="rounded-xl border border-akiba-line px-4 py-3 text-sm font-semibold text-akiba-muted transition hover:border-akiba-teal/40"
        >
          ← Back
        </button>
        <button
          onClick={onPay}
          disabled={!walletAddress}
          className="flex-1 rounded-xl bg-akiba-teal py-3 text-sm font-semibold text-white transition hover:bg-[#1E7E8D] disabled:opacity-40"
        >
          Pay {formatUSD(pricing.total)} in {currency}
        </button>
      </div>
    </div>
  );
}

function Row({
  label,
  value,
  bold,
  className,
}: {
  label: string;
  value: string;
  bold?: boolean;
  className?: string;
}) {
  return (
    <div className={clsx("flex items-center justify-between text-sm", className)}>
      <span className={bold ? "font-semibold text-akiba-ink" : "text-akiba-muted"}>{label}</span>
      <span className={bold ? "font-semibold text-akiba-ink" : "text-akiba-muted"}>{value}</span>
    </div>
  );
}

function SuccessScreen({
  orderId, eta, reward, onClose,
}: {
  orderId: string;
  eta: string;
  reward: { issued: boolean; miles: number; pending?: boolean; reason?: string } | null;
  onClose: () => void;
}) {
  const rewardBadge = (() => {
    if (!reward) return null;
    if (reward.pending) {
      return (
        <div className="mt-4 flex items-center gap-2 rounded-full bg-gray-100 px-5 py-2.5 text-sm font-semibold text-akiba-muted">
          <Coins className="h-4 w-4" />
          Reward pending confirmation
        </div>
      );
    }
    if (reward.issued && reward.miles > 0) {
      return (
        <div className="mt-4 flex items-center gap-2 rounded-full bg-akiba-teal/10 px-5 py-2.5 text-sm font-semibold text-akiba-teal">
          <Coins className="h-4 w-4" />
          +{reward.miles} AkibaMiles earned
        </div>
      );
    }
    return null;
  })();

  return (
    <div className="flex flex-col items-center py-8 text-center">
      <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-akiba-tint">
        <CheckCircle2 className="h-9 w-9 text-akiba-teal" />
      </div>
      <h3 className="font-sterling text-2xl font-semibold text-akiba-ink">Order confirmed</h3>
      <p className="mt-2 text-sm text-akiba-muted">
        Your order will be delivered in approximately{" "}
        <span className="font-semibold text-akiba-ink">{eta}</span>.
      </p>

      {rewardBadge}

      <p className="mt-4 text-xs text-akiba-muted">
        Order ID: <span className="font-mono">{orderId.slice(0, 8)}</span>
      </p>

      <div className="mt-6 flex w-full gap-3">
        <a
          href="/me/orders"
          className="flex-1 rounded-xl border border-akiba-line py-2.5 text-sm font-semibold text-akiba-ink transition hover:border-akiba-teal/40"
        >
          View orders
        </a>
        <button
          onClick={onClose}
          className="flex-1 rounded-xl bg-akiba-teal py-2.5 text-sm font-semibold text-white"
        >
          Continue shopping
        </button>
      </div>
    </div>
  );
}
