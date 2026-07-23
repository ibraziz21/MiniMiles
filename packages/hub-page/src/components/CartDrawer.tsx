"use client";

import { useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import {
  X, ShoppingBag, Minus, Plus, Trash2, Tag, Truck,
  ChevronDown, Wallet, CheckCircle2, AlertCircle, Loader2,
  Smartphone,
} from "lucide-react";
import clsx from "clsx";
import { useCart } from "@/lib/cart";
import { calculateOrder, formatUSD } from "@/lib/pricing";
import type { VoucherForPricing } from "@/lib/pricing";
import { TOKENS, CELO_CHAIN_ID_HEX, CELO_NETWORK_PARAMS, encodeERC20Transfer, toTokenUnits } from "@/lib/tokens";
import type { TokenSymbol } from "@/lib/tokens";
import { MilesAmount, MilesIcon } from "@/components/MilesIcon";

const DELIVERY_CITIES = [
  "Nairobi", "Mombasa", "Kisumu", "Nakuru", "Eldoret",
  "Thika", "Machakos", "Nyeri", "Meru", "Kitale", "Malindi", "Other",
];

type Step = "cart" | "delivery" | "review" | "paying" | "mpesa-wait" | "done" | "error";
type PayMode = "crypto" | "mpesa";
type RewardResult = { issued: boolean; miles: number; pending?: boolean; reason?: string };

export function CartDrawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { items, merchantId, merchantName, subtotal, count, remove, setQty, clear } = useCart();
  const router = useRouter();

  const [step, setStep] = useState<Step>("cart");
  const [payMode, setPayMode] = useState<PayMode>("crypto");

  // Delivery
  const [name,     setName]     = useState("");
  const [phone,    setPhone]    = useState("");
  const [city,     setCity]     = useState("");
  const [location, setLocation] = useState("");

  // Crypto payment
  const [currency,       setCurrency]       = useState<TokenSymbol>("cUSD");
  const [walletAddress,  setWalletAddress]  = useState<string | null>(null);
  const [txHash,         setTxHash]         = useState<string | null>(null);

  // M-Pesa payment
  const [mpesaPhone,         setMpesaPhone]         = useState("");
  const [checkoutRequestId,  setCheckoutRequestId]  = useState<string | null>(null);
  const [mpesaReceipt,       setMpesaReceipt]       = useState<string | null>(null);
  const [mpesaAmountKes,     setMpesaAmountKes]     = useState<number>(0);
  const [mpesaMpesaPhone,    setMpesaMpesaPhone]    = useState<string>("");

  // Voucher
  const [voucherInput,   setVoucherInput]   = useState("");
  const [appliedVoucher, setAppliedVoucher] = useState<VoucherForPricing | null>(null);
  const [voucherCode,    setVoucherCode]    = useState("");

  // Result
  const [orderId, setOrderId] = useState<string | null>(null);
  const [eta,     setEta]     = useState("3–5 days");
  const [error,   setError]   = useState<string | null>(null);
  const [reward,  setReward]  = useState<RewardResult | null>(null);
  // Captured before clear() empties the cart, so the "done" screen still
  // knows whether the completed order needed physical delivery.
  const [orderWasPhysical, setOrderWasPhysical] = useState(false);

  const firstItem = items[0];
  // Single-SKU cart (lib/cart.tsx), so every item shares this product's type.
  const hasPhysicalItems = items.some((item) => (item.productType ?? "physical") === "physical");
  const pricing = firstItem
    ? (() => {
        const base = calculateOrder(
          subtotal,
          firstItem.category,
          firstItem.id,
          city || "other",
          hasPhysicalItems ? "physical" : "digital",
          appliedVoucher
        );
        const discountRatio = appliedVoucher ? base.discountedPrice / base.originalPrice : 1;
        const discounted = subtotal * discountRatio;
        const discount = subtotal - discounted;
        const total = discounted + base.deliveryFee;
        return { ...base, originalPrice: subtotal, discountedPrice: discounted, discount, total, totalKes: Math.round(total * 130) };
      })()
    : null;

  function resetAndClose() {
    setStep("cart");
    setPayMode("crypto");
    setName(""); setPhone(""); setCity(""); setLocation("");
    setCurrency("cUSD"); setWalletAddress(null); setTxHash(null);
    setMpesaPhone(""); setCheckoutRequestId(null); setMpesaReceipt(null);
    setVoucherInput(""); setAppliedVoucher(null); setVoucherCode("");
    setOrderId(null); setError(null); setReward(null); setOrderWasPhysical(false);
    onClose();
  }

  async function applyVoucher() {
    if (!voucherInput.trim() || !merchantId) return;
    const res = await fetch(`/api/shop/vouchers/lookup?code=${voucherInput.trim().toUpperCase()}&merchant_id=${merchantId}`);
    if (!res.ok) { setError("Voucher not found or already used."); return; }
    const { template } = await res.json();
    setAppliedVoucher(template);
    setVoucherCode(voucherInput.trim().toUpperCase());
    setError(null);
  }

  const connectWallet = useCallback(async (): Promise<string | null> => {
    if (!window.ethereum) { setError("No wallet detected. Open in MiniPay or install MetaMask."); return null; }
    try {
      const accounts = await window.ethereum.request({ method: "eth_requestAccounts" }) as string[];
      const chainId  = await window.ethereum.request({ method: "eth_chainId" }) as string;
      if (chainId !== CELO_CHAIN_ID_HEX) {
        try { await window.ethereum.request({ method: "wallet_switchEthereumChain", params: [{ chainId: CELO_CHAIN_ID_HEX }] }); }
        catch { await window.ethereum.request({ method: "wallet_addEthereumChain", params: [CELO_NETWORK_PARAMS] }); }
      }
      setWalletAddress(accounts[0]);
      return accounts[0];
    } catch (e) { setError(e instanceof Error ? e.message : "Wallet error"); return null; }
  }, []);

  async function createOrders(overrides: {
    tx_hash?: string;
    currency?: TokenSymbol;
    mpesa_checkout_id?: string;
  }) {
    const results = await Promise.all(
      items.map((item) =>
        fetch("/api/shop/orders", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            product_id:       item.id,
            voucher_code:     voucherCode || undefined,
            recipient_name:   name,
            phone,
            city,
            location_details: location || undefined,
            ...overrides,
          }),
        }).then((r) => r.json() as Promise<{
          order?: { id?: string; eta?: string };
          reward?: RewardResult;
          error?: string;
        }>)
      )
    );
    const failed = results.find((r) => r.error);
    if (failed) { setError(failed.error ?? "Order failed."); setStep("error"); return; }
    const rewards = results.map((r) => r.reward).filter((r): r is RewardResult => !!r);
    const issuedMiles = rewards.reduce((sum, r) => sum + (r.issued ? r.miles : 0), 0);
    const pending = rewards.some((r) => r.pending);
    const firstReason = rewards.find((r) => r.reason)?.reason;

    setOrderId(results[0]?.order?.id ?? null);
    setEta(results[0]?.order?.eta ?? "3–5 days");
    setReward(
      issuedMiles > 0
        ? { issued: true, miles: issuedMiles, ...(firstReason ? { reason: firstReason } : {}) }
        : pending
          ? { issued: false, miles: 0, pending: true }
          : rewards[0] ?? null
    );
    setOrderWasPhysical(hasPhysicalItems);
    setStep("done");
    clear();
  }

  async function payCrypto() {
    if (!pricing || !firstItem?.merchantWallet) { setError("Merchant wallet not configured."); return; }
    setStep("paying"); setError(null);
    const addr = walletAddress ?? await connectWallet();
    if (!addr) { setStep("review"); return; }

    const token = TOKENS[currency];
    const amountWei = toTokenUnits(pricing.total, token.decimals);
    const data = encodeERC20Transfer(firstItem.merchantWallet, amountWei);

    try {
      const hash = await window.ethereum!.request({
        method: "eth_sendTransaction",
        params: [{ from: addr, to: token.address, data, gas: "0x186a0" }],
      }) as string;
      setTxHash(hash);
      await createOrders({ tx_hash: hash, currency });
    } catch (e: unknown) {
      if ((e as { code?: number })?.code === 4001) setError("Transaction rejected.");
      else setError(e instanceof Error ? e.message : "Payment failed.");
      setStep("review");
    }
  }

  async function initMpesa() {
    if (!pricing) return;
    setStep("paying"); setError(null);

    const res = await fetch("/api/payments/mpesa/initiate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        phone:         mpesaPhone,
        amount_usd:    pricing.total,
        merchant_name: merchantName ?? "AkibaHub",
      }),
    });

    const data = await res.json();
    if (!res.ok) { setError(data.error ?? "Failed to initiate M-Pesa"); setStep("review"); return; }

    setCheckoutRequestId(data.checkoutRequestId);
    setMpesaAmountKes(data.amountKes);
    setMpesaMpesaPhone(mpesaPhone);
    setStep("mpesa-wait");
    pollMpesa(data.checkoutRequestId);
  }

  async function pollMpesa(reqId: string, attempt = 0) {
    if (attempt > 20) { setError("M-Pesa payment timed out. Try again."); setStep("error"); return; }

    const res  = await fetch(`/api/payments/mpesa/status?id=${reqId}`);
    const data = await res.json();

    if (data.status === "success") {
      setMpesaReceipt(data.receiptNumber);
      await createOrders({ mpesa_checkout_id: reqId });
    } else if (data.status === "failed") {
      setError(data.reason ?? "M-Pesa payment failed");
      setStep("error");
    } else {
      setTimeout(() => pollMpesa(reqId, attempt + 1), 4000);
    }
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={step === "cart" ? resetAndClose : undefined} />

      <div className="relative flex h-full w-full max-w-md flex-col bg-white shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-akiba-line px-5 py-4">
          <div>
            <h2 className="font-sterling text-lg font-semibold text-akiba-ink">
              {step === "done" ? "Order placed!" : step === "cart" ? "Your cart" : step === "delivery" ? "Delivery" : step === "mpesa-wait" ? "Confirm on phone" : step === "review" ? "Review & pay" : "Processing…"}
            </h2>
            {merchantName && step === "cart" && <p className="text-xs text-akiba-muted">{merchantName}</p>}
          </div>
          <button onClick={resetAndClose} className="rounded-full p-1.5 hover:bg-akiba-card">
            <X className="h-5 w-5 text-akiba-muted" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5">

          {/* ── CART ── */}
          {step === "cart" && (
            items.length === 0 ? (
              <div className="flex flex-col items-center py-16 text-center">
                <ShoppingBag className="mb-4 h-12 w-12 text-akiba-line" />
                <p className="font-medium text-akiba-ink">Your cart is empty</p>
                <p className="mt-1 text-sm text-akiba-muted">Browse merchants to add items</p>
                <button onClick={resetAndClose} className="mt-5 rounded-full bg-akiba-teal px-5 py-2 text-sm font-semibold text-white">Browse shop</button>
              </div>
            ) : (
              <>
                <div className="space-y-3 mb-5">
                  {items.map((item) => (
                    <div key={item.id} className="flex gap-3 rounded-2xl border border-akiba-line bg-white p-3">
                      <div className="flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-akiba-card">
                        {item.imageUrl
                          // eslint-disable-next-line @next/next/no-img-element
                          ? <img src={item.imageUrl} alt={item.name} className="h-full w-full object-cover" />
                          : <ShoppingBag className="h-6 w-6 text-akiba-muted" />}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-akiba-ink truncate">{item.name}</p>
                        <p className="text-sm text-akiba-muted">${item.price.toFixed(2)}</p>
                        <div className="mt-2 flex items-center gap-2">
                          <button onClick={() => setQty(item.id, item.qty - 1)} className="flex h-6 w-6 items-center justify-center rounded-full border border-akiba-line hover:border-akiba-teal/40"><Minus className="h-3 w-3" /></button>
                          <span className="w-6 text-center text-sm font-semibold">{item.qty}</span>
                          <button onClick={() => setQty(item.id, item.qty + 1)} className="flex h-6 w-6 items-center justify-center rounded-full border border-akiba-line hover:border-akiba-teal/40"><Plus className="h-3 w-3" /></button>
                          <button onClick={() => remove(item.id)} className="ml-auto text-akiba-muted hover:text-red-400"><Trash2 className="h-4 w-4" /></button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>

                <div className="rounded-xl border border-akiba-line bg-akiba-card p-3 mb-5">
                  <div className="flex justify-between text-sm">
                    <span className="text-akiba-muted">{count} item{count !== 1 ? "s" : ""}</span>
                    <span className="font-semibold text-akiba-ink">${subtotal.toFixed(2)}</span>
                  </div>
                  <p className="mt-1 text-xs text-akiba-teal">Rewards issued after verified purchase</p>
                </div>

                <button onClick={() => setStep("delivery")} className="w-full rounded-xl bg-akiba-teal py-3 text-sm font-semibold text-white hover:bg-[#1E7E8D]">
                  Proceed to checkout →
                </button>
              </>
            )
          )}

          {/* ── DELIVERY ── */}
          {step === "delivery" && (
            <div className="space-y-4">
              {/* Payment mode toggle */}
              <div>
                <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-akiba-muted">Pay with</label>
                <div className="grid grid-cols-2 gap-2 mb-3">
                  <button onClick={() => setPayMode("crypto")}
                    className={clsx("flex items-center justify-center gap-2 rounded-xl border py-2.5 text-sm font-semibold transition",
                      payMode === "crypto" ? "border-akiba-teal bg-akiba-tint text-akiba-teal" : "border-akiba-line bg-white text-akiba-muted hover:border-akiba-teal/40")}>
                    <Wallet className="h-4 w-4" /> Crypto
                  </button>
                  <button onClick={() => setPayMode("mpesa")}
                    className={clsx("flex items-center justify-center gap-2 rounded-xl border py-2.5 text-sm font-semibold transition",
                      payMode === "mpesa" ? "border-green-500 bg-green-50 text-green-700" : "border-akiba-line bg-white text-akiba-muted hover:border-green-300")}>
                    <Smartphone className="h-4 w-4" /> M-Pesa
                  </button>
                </div>

                {payMode === "crypto" && (
                  <div className="grid grid-cols-3 gap-2">
                    {(Object.keys(TOKENS) as TokenSymbol[]).map((sym) => (
                      <button key={sym} onClick={() => setCurrency(sym)}
                        className={clsx("rounded-xl border py-2 text-sm font-semibold transition",
                          currency === sym ? "border-akiba-teal bg-akiba-tint text-akiba-teal" : "border-akiba-line bg-white text-akiba-muted hover:border-akiba-teal/40")}>
                        {sym}
                      </button>
                    ))}
                  </div>
                )}

                {payMode === "mpesa" && (
                  <input
                    type="tel"
                    placeholder="M-Pesa phone e.g. 0712345678"
                    value={mpesaPhone}
                    onChange={(e) => setMpesaPhone(e.target.value)}
                    className="w-full rounded-xl border border-green-200 bg-green-50 px-4 py-2.5 text-sm outline-none focus:border-green-400"
                  />
                )}
              </div>

              <div>
                <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-akiba-muted">
                  {hasPhysicalItems ? "Delivery details" : "Contact details"}
                </label>
                <div className="space-y-2">
                  <input type="text" placeholder="Recipient name" value={name} onChange={(e) => setName(e.target.value)}
                    className="w-full rounded-xl border border-akiba-line px-4 py-2.5 text-sm outline-none focus:border-akiba-teal" />
                  <input type="tel" placeholder="Phone number" value={phone} onChange={(e) => setPhone(e.target.value)}
                    className="w-full rounded-xl border border-akiba-line px-4 py-2.5 text-sm outline-none focus:border-akiba-teal" />
                  {hasPhysicalItems && (
                    <>
                      <div className="relative">
                        <select value={city} onChange={(e) => setCity(e.target.value)}
                          className="w-full appearance-none rounded-xl border border-akiba-line px-4 py-2.5 text-sm outline-none focus:border-akiba-teal">
                          <option value="">Select city</option>
                          {DELIVERY_CITIES.map((c) => <option key={c} value={c.toLowerCase()}>{c}</option>)}
                        </select>
                        <ChevronDown className="pointer-events-none absolute right-3 top-3 h-4 w-4 text-akiba-muted" />
                      </div>
                      <textarea placeholder="Delivery address / location" value={location} onChange={(e) => setLocation(e.target.value)}
                        rows={2} className="w-full resize-none rounded-xl border border-akiba-line px-4 py-2.5 text-sm outline-none focus:border-akiba-teal" />
                    </>
                  )}
                </div>
              </div>

              <div>
                <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-akiba-muted">Voucher code (optional)</label>
                {appliedVoucher ? (
                  <div className="flex items-center justify-between rounded-xl border border-akiba-teal/30 bg-akiba-tint px-4 py-2.5">
                    <div className="flex items-center gap-2">
                      <Tag className="h-4 w-4 text-akiba-teal" />
                      <span className="text-sm font-medium text-akiba-teal font-mono">{voucherCode}</span>
                    </div>
                    <button onClick={() => { setAppliedVoucher(null); setVoucherCode(""); setVoucherInput(""); }} className="text-xs text-akiba-muted hover:text-akiba-ink">Remove</button>
                  </div>
                ) : (
                  <div className="flex gap-2">
                    <input type="text" placeholder="e.g. AKIBA2024" value={voucherInput}
                      onChange={(e) => setVoucherInput(e.target.value.toUpperCase())}
                      className="flex-1 rounded-xl border border-akiba-line px-4 py-2.5 font-mono text-sm outline-none focus:border-akiba-teal" />
                    <button onClick={applyVoucher} className="rounded-xl border border-akiba-teal px-4 py-2.5 text-sm font-semibold text-akiba-teal hover:bg-akiba-tint">Apply</button>
                  </div>
                )}
              </div>

              {error && <p className="flex items-center gap-1.5 text-sm text-red-500"><AlertCircle className="h-4 w-4" />{error}</p>}

              <div className="flex gap-3 pt-2">
                <button onClick={() => setStep("cart")} className="rounded-xl border border-akiba-line px-4 py-3 text-sm font-semibold text-akiba-muted hover:border-akiba-teal/40">← Back</button>
                <button onClick={() => {
                  if (!name || !phone || (hasPhysicalItems && !city)) { setError("Fill in all delivery fields."); return; }
                  if (payMode === "mpesa" && !mpesaPhone) { setError("Enter your M-Pesa phone number."); return; }
                  setError(null); setStep("review");
                }} className="flex-1 rounded-xl bg-akiba-teal py-3 text-sm font-semibold text-white hover:bg-[#1E7E8D]">
                  Review order →
                </button>
              </div>
            </div>
          )}

          {/* ── REVIEW ── */}
          {step === "review" && pricing && (
            <div className="space-y-4">
              <div className="rounded-2xl border border-akiba-line bg-akiba-card p-4 space-y-2 text-sm">
                <div className="flex justify-between"><span className="text-akiba-muted">Subtotal ({count} items)</span><span>${pricing.originalPrice.toFixed(2)}</span></div>
                {pricing.discount > 0 && <div className="flex justify-between text-akiba-teal"><span>Voucher ({voucherCode})</span><span>-${pricing.discount.toFixed(2)}</span></div>}
                <div className="flex justify-between">
                  <span className="text-akiba-muted">{hasPhysicalItems ? `Delivery (${city})` : "Digital delivery"}</span>
                  <span>{hasPhysicalItems ? `$${pricing.deliveryFee.toFixed(2)}` : "Free"}</span>
                </div>
                <div className="flex justify-between border-t border-akiba-line pt-2 font-semibold text-akiba-ink">
                  <span>Total</span>
                  <span>
                    {payMode === "mpesa"
                      ? `KES ${Math.ceil(pricing.total * 130).toLocaleString()}`
                      : `${formatUSD(pricing.total)} in ${currency}`}
                  </span>
                </div>
              </div>

              <div className="rounded-xl border border-akiba-line bg-white p-3 text-sm space-y-1">
                <p className="flex items-center gap-2"><Truck className="h-4 w-4 text-akiba-teal" /><span className="font-medium">{hasPhysicalItems ? pricing.eta : "Instant digital delivery"}</span></p>
                <p className="pl-6 text-akiba-muted">
                  {name} · {phone}{hasPhysicalItems ? <> · <span className="capitalize">{city}</span></> : null}
                </p>
              </div>

              {/* Payment method info */}
              {payMode === "crypto" && (
                walletAddress ? (
                  <div className="flex items-center gap-2 rounded-xl border border-akiba-teal/30 bg-akiba-tint px-4 py-2.5 text-sm">
                    <Wallet className="h-4 w-4 text-akiba-teal" />
                    <span className="font-mono text-akiba-teal">{walletAddress.slice(0, 6)}…{walletAddress.slice(-4)}</span>
                    <span className="ml-auto text-xs text-akiba-muted">Connected</span>
                  </div>
                ) : (
                  <button onClick={connectWallet} className="flex w-full items-center justify-center gap-2 rounded-xl border border-akiba-line bg-white py-2.5 text-sm font-semibold text-akiba-ink hover:border-akiba-teal/40">
                    <Wallet className="h-4 w-4" /> Connect wallet
                  </button>
                )
              )}

              {payMode === "mpesa" && (
                <div className="flex items-center gap-2 rounded-xl border border-green-200 bg-green-50 px-4 py-2.5 text-sm">
                  <Smartphone className="h-4 w-4 text-green-600" />
                  <span className="text-green-700">STK push to <strong>{mpesaPhone}</strong></span>
                </div>
              )}

              {error && <p className="flex items-center gap-1.5 text-sm text-red-500"><AlertCircle className="h-4 w-4" />{error}</p>}

              <div className="flex gap-3 pt-2">
                <button onClick={() => setStep("delivery")} className="rounded-xl border border-akiba-line px-4 py-3 text-sm font-semibold text-akiba-muted">← Back</button>
                {payMode === "crypto" ? (
                  <button onClick={payCrypto} disabled={!walletAddress}
                    className="flex-1 rounded-xl bg-akiba-teal py-3 text-sm font-semibold text-white hover:bg-[#1E7E8D] disabled:opacity-40">
                    Pay {formatUSD(pricing.total)} in {currency}
                  </button>
                ) : (
                  <button onClick={initMpesa}
                    className="flex-1 rounded-xl bg-green-600 py-3 text-sm font-semibold text-white hover:bg-green-700">
                    Send M-Pesa prompt
                  </button>
                )}
              </div>
            </div>
          )}

          {/* ── PAYING (crypto) ── */}
          {step === "paying" && (
            <div className="flex flex-col items-center py-16 text-center">
              <Loader2 className="mb-4 h-10 w-10 animate-spin text-akiba-teal" />
              <p className="font-semibold text-akiba-ink">Processing payment…</p>
              <p className="mt-1 text-sm text-akiba-muted">Confirm in your wallet, then we&apos;ll verify on-chain.</p>
              {txHash && <a href={`https://explorer.celo.org/mainnet/tx/${txHash}`} target="_blank" rel="noopener noreferrer" className="mt-3 text-xs text-akiba-teal underline">View on Celo Explorer</a>}
            </div>
          )}

          {/* ── M-PESA WAIT ── */}
          {step === "mpesa-wait" && (
            <div className="flex flex-col items-center py-12 text-center">
              <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-green-50">
                <Smartphone className="h-8 w-8 text-green-600" />
              </div>
              <p className="font-semibold text-akiba-ink">Check your phone</p>
              <p className="mt-2 text-sm text-akiba-muted">
                An M-Pesa prompt has been sent to <strong>{mpesaMpesaPhone}</strong>.<br />
                Enter your PIN to complete payment of <strong>KES {mpesaAmountKes.toLocaleString()}</strong>.
              </p>
              <div className="mt-6 flex items-center gap-2 text-sm text-akiba-muted">
                <Loader2 className="h-4 w-4 animate-spin" />
                Waiting for confirmation…
              </div>
              <button onClick={() => { setStep("review"); setError("Payment cancelled."); }} className="mt-4 text-xs text-akiba-muted underline">
                Cancel
              </button>
            </div>
          )}

          {/* ── DONE ── */}
          {step === "done" && (
            <div className="flex flex-col items-center py-10 text-center">
              <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-akiba-tint">
                <CheckCircle2 className="h-9 w-9 text-akiba-teal" />
              </div>
              <h3 className="font-sterling text-2xl font-semibold text-akiba-ink">Order placed!</h3>
              {orderWasPhysical && (
                <p className="mt-2 text-sm text-akiba-muted">Estimated delivery: <span className="font-semibold text-akiba-ink">{eta}</span></p>
              )}
              {reward?.issued && reward.miles > 0 && (
                <div className="mt-4 flex items-center gap-2 rounded-full bg-akiba-teal/10 px-5 py-2.5">
                  <MilesAmount amount={reward.miles} size="md" prefix="+" className="text-akiba-teal" />
                  <span className="text-sm text-akiba-muted">earned</span>
                </div>
              )}
              {reward?.pending && (
                <div className="mt-4 flex items-center gap-2 rounded-full bg-gray-100 px-5 py-2.5 text-sm font-semibold text-akiba-muted">
                  <MilesIcon className="h-4 w-4" />
                  Reward pending confirmation
                </div>
              )}
              {mpesaReceipt && <p className="mt-3 text-xs text-akiba-muted font-mono">M-Pesa: {mpesaReceipt}</p>}
              {orderId && <p className="mt-1 text-xs text-akiba-muted">Order: <span className="font-mono">{orderId.slice(0, 8)}</span></p>}
              <div className="mt-6 flex w-full gap-3">
                <a href="/me/orders" className="flex-1 rounded-xl border border-akiba-line py-2.5 text-sm font-semibold text-akiba-ink hover:border-akiba-teal/40">View orders</a>
                <button onClick={resetAndClose} className="flex-1 rounded-xl bg-akiba-teal py-2.5 text-sm font-semibold text-white">Continue</button>
              </div>
            </div>
          )}

          {/* ── ERROR ── */}
          {step === "error" && (
            <div className="flex flex-col items-center py-16 text-center">
              <AlertCircle className="mb-4 h-10 w-10 text-red-400" />
              <p className="font-semibold text-akiba-ink">Something went wrong</p>
              <p className="mt-1 text-sm text-red-500">{error}</p>
              <button onClick={() => setStep("review")} className="mt-6 rounded-xl bg-akiba-ink px-6 py-2.5 text-sm font-semibold text-white">Try again</button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
