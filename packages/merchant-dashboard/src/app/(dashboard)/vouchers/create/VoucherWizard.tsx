"use client";

// The single guided voucher journey (merchant-ux-spec.md §5), replacing the
// old two-step NewVoucherForm (template) + NewProgramForm (program) flow.
// VoucherTemplate/VoucherProgram stay separate DB rows (spec §0) — this
// component just creates both in one submit, in the merchant's mental model
// order: offer → availability → Hub (automatic) → additional channels →
// settlement → review.
import { useMemo, useState, FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PRODUCT_CATEGORIES } from "@/types";
import type { MerchantProduct } from "@/types";
import { ADDITIONAL_CHANNELS, HUB_CHANNEL, type AdditionalChannel } from "@/lib/voucherChannels";

const STEPS = [
  "Offer",
  "Miles & availability",
  "Hub Miles Purchase",
  "Additional channels",
  "Settlement",
  "Review & publish",
] as const;

interface ChannelAlloc {
  selected: boolean;
  qty: string;
}

export default function VoucherWizard({ products }: { products: MerchantProduct[] }) {
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [submitting, setSubmitting] = useState<"draft" | "publish" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [stepError, setStepError] = useState<string | null>(null);

  // Step 1 — offer
  const [title, setTitle] = useState("");
  const [voucherType, setVoucherType] = useState<"percent_off" | "fixed_off" | "free">("percent_off");
  const [discountPercent, setDiscountPercent] = useState("");
  const [discountCusd, setDiscountCusd] = useState("");
  const [scope, setScope] = useState<"all" | "category" | "product">("all");
  const [applicableCategory, setApplicableCategory] = useState("");
  const [linkedProductId, setLinkedProductId] = useState("");
  const [retailValueCusd, setRetailValueCusd] = useState("");
  const [expiresAt, setExpiresAt] = useState("");

  // Step 2 — miles & availability
  const [milesCost, setMilesCost] = useState("200");
  const [totalQuantity, setTotalQuantity] = useState("");
  const [startAt, setStartAt] = useState("");
  const [endAt, setEndAt] = useState("");
  const [cooldownSeconds, setCooldownSeconds] = useState("86400");

  // Step 4 — additional channels
  const [channels, setChannels] = useState<Record<AdditionalChannel, ChannelAlloc>>({
    weekly_leaderboard_challenge: { selected: false, qty: "" },
    claw: { selected: false, qty: "" },
    raffle: { selected: false, qty: "" },
    giveaway: { selected: false, qty: "" },
    merchant_grant: { selected: false, qty: "" },
  });

  // Step 5 — settlement
  const [fundingPartyType, setFundingPartyType] = useState<"merchant" | "sponsor" | "none">("merchant");
  const [fundingPartyReference, setFundingPartyReference] = useState("");
  const [reimbursementRate, setReimbursementRate] = useState("1");

  const selectedProduct = products.find((p) => p.id === linkedProductId) ?? null;

  const totalQty = totalQuantity ? parseInt(totalQuantity, 10) : null;
  const additionalTotal = useMemo(
    () =>
      (Object.values(channels) as ChannelAlloc[])
        .filter((c) => c.selected)
        .reduce((sum, c) => sum + (c.qty ? parseInt(c.qty, 10) || 0 : 0), 0),
    [channels]
  );
  const hubQuantity = totalQty != null ? totalQty - additionalTotal : null;

  function benefitPreview(): string {
    if (voucherType === "free") return "a free item";
    if (voucherType === "percent_off") return discountPercent ? `${discountPercent}% off` : "a percentage off";
    return discountCusd ? `$${discountCusd} off` : "a fixed amount off";
  }

  function validateStep(i: number): string | null {
    if (i === 0) {
      if (!title.trim()) return "Voucher name is required.";
      if (voucherType === "percent_off" && (!discountPercent || Number(discountPercent) <= 0 || Number(discountPercent) > 100)) {
        return "Discount percent must be between 1 and 100.";
      }
      if (voucherType === "fixed_off" && (!discountCusd || Number(discountCusd) <= 0)) {
        return "Discount amount must be greater than 0.";
      }
      if (scope === "category" && !applicableCategory) return "Select a category.";
      if (scope === "product" && !linkedProductId) return "Select a product.";
    }
    if (i === 1) {
      if (!milesCost || Number(milesCost) <= 0) return "Miles price must be a positive number.";
      // Total quantity is required to publish, not to save a draft (spec §5 Step 2) —
      // enforced at publish time in handleSubmit instead of here.
      if (startAt && endAt && new Date(startAt) >= new Date(endAt)) return "Start date must be before end date.";
    }
    if (i === 3) {
      if (totalQty != null && hubQuantity != null && hubQuantity < 1) {
        return "Additional channel allocations must leave at least one voucher for the Hub.";
      }
      for (const [ch, alloc] of Object.entries(channels) as [AdditionalChannel, ChannelAlloc][]) {
        if (alloc.selected && (!alloc.qty || Number(alloc.qty) <= 0)) {
          return `Enter a quantity for ${ch.replace(/_/g, " ")}.`;
        }
      }
    }
    if (i === 4) {
      if (fundingPartyType === "sponsor" && !fundingPartyReference.trim()) return "Sponsor reference is required.";
      if (fundingPartyType !== "none" && (Number(reimbursementRate) < 0 || Number(reimbursementRate) > 1)) {
        return "Reimbursement rate must be between 0 and 1.";
      }
    }
    return null;
  }

  function goToStep(target: number) {
    if (target > step) {
      for (let i = step; i < target; i++) {
        const err = validateStep(i);
        if (err) {
          setStep(i);
          setStepError(err);
          return;
        }
      }
    }
    setStepError(null);
    setStep(target);
  }

  async function handleSubmit(mode: "draft" | "publish") {
    setError(null);

    if (mode === "publish" && (!totalQty || totalQty <= 0)) {
      setStep(1);
      setStepError("Total quantity is required to publish.");
      return;
    }
    for (let i = 0; i < STEPS.length - 1; i++) {
      const err = validateStep(i);
      if (err) {
        setStep(i);
        setStepError(err);
        return;
      }
    }

    setSubmitting(mode);
    try {
      const templatePayload: Record<string, unknown> = {
        title: title.trim(),
        voucher_type: voucherType,
        miles_cost: parseInt(milesCost, 10),
        cooldown_seconds: parseInt(cooldownSeconds, 10) || 0,
        global_cap: null, // enforcement lives at program.total_cap per merchant-ux-spec.md §3
        expires_at: expiresAt || null,
        active: true,
        applicable_category: scope === "category" ? applicableCategory || null : null,
        linked_product_id: scope === "product" ? linkedProductId || null : null,
        retail_value_cusd: scope === "product" && retailValueCusd ? parseFloat(retailValueCusd) : null,
      };
      if (voucherType === "percent_off") templatePayload.discount_percent = parseFloat(discountPercent);
      if (voucherType === "fixed_off") templatePayload.discount_cusd = parseFloat(discountCusd);

      const templateRes = await fetch("/api/merchant/voucher-templates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(templatePayload),
      });
      const templateJson = await templateRes.json();
      if (!templateRes.ok) throw new Error(templateJson.error ?? "Failed to create voucher offer");
      const templateId = templateJson.template.id as string;

      const additionalChannelPayload = (Object.entries(channels) as [AdditionalChannel, ChannelAlloc][])
        .filter(([, v]) => v.selected)
        .map(([ch, v]) => ({ channel: ch, cap: parseInt(v.qty, 10), active: true }));

      // Hub Miles Purchase is always included, automatic, and gets the
      // remainder — merchant-ux-spec.md §5 Step 3, §6.
      const hubCap = totalQty != null ? Math.max(totalQty - additionalTotal, totalQty > 0 ? 1 : 0) : null;
      const channelPayload = [
        { channel: HUB_CHANNEL, cap: hubCap, active: true },
        ...additionalChannelPayload,
      ];

      const programRes = await fetch("/api/programs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: title.trim(),
          template_id: templateId,
          total_cap: totalQty,
          start_at: startAt || null,
          end_at: endAt || null,
          channels: channelPayload,
          funding_party_type: fundingPartyType,
          funding_party_reference: fundingPartyType === "sponsor" ? fundingPartyReference.trim() || null : null,
          settlement_currency: "cUSD",
          reimbursement_rate: fundingPartyType === "none" ? 0 : Number(reimbursementRate),
        }),
      });
      const programJson = await programRes.json();
      if (!programRes.ok) throw new Error(programJson.error ?? "Failed to create distribution");
      const programId = programJson.program_id as string;

      if (mode === "publish") {
        const publishRes = await fetch(`/api/programs/${programId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ state: "active" }),
        });
        const publishJson = await publishRes.json();
        if (!publishRes.ok) throw new Error(publishJson.error ?? "Voucher created as draft, but publishing failed");
      }

      router.push(`/vouchers/${templateId}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setSubmitting(null);
    }
  }

  return (
    <div className="max-w-2xl space-y-6">
      {/* Step indicator */}
      <div className="flex flex-wrap gap-2">
        {STEPS.map((label, i) => (
          <button
            key={label}
            type="button"
            onClick={() => goToStep(i)}
            className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
              i === step
                ? "bg-[#238D9D] text-white"
                : i < step
                ? "bg-[#238D9D22] text-[#238D9D]"
                : "bg-gray-100 text-gray-400"
            }`}
          >
            {i + 1}. {label}
          </button>
        ))}
      </div>

      {stepError && <div className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">{stepError}</div>}
      {error && <div className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}

      <form onSubmit={(e: FormEvent) => e.preventDefault()} className="space-y-4">
        {step === 0 && (
          <div className="space-y-4">
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-gray-700">Voucher name *</label>
              <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Free Wireless Earbuds" />
            </div>

            <div className="space-y-1.5">
              <label className="text-sm font-medium text-gray-700">Benefit type *</label>
              <select
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                value={voucherType}
                onChange={(e) => setVoucherType(e.target.value as typeof voucherType)}
              >
                <option value="percent_off">Percentage off</option>
                <option value="fixed_off">Fixed amount off</option>
                <option value="free">Free item</option>
              </select>
            </div>

            {voucherType === "percent_off" && (
              <div className="space-y-1.5">
                <label className="text-sm font-medium text-gray-700">Discount percent *</label>
                <Input type="number" min="1" max="100" value={discountPercent} onChange={(e) => setDiscountPercent(e.target.value)} placeholder="e.g. 10" />
              </div>
            )}
            {voucherType === "fixed_off" && (
              <div className="space-y-1.5">
                <label className="text-sm font-medium text-gray-700">Discount amount (cUSD) *</label>
                <Input type="number" step="0.01" min="0.01" value={discountCusd} onChange={(e) => setDiscountCusd(e.target.value)} placeholder="e.g. 5.00" />
              </div>
            )}

            <div className="space-y-1.5">
              <label className="text-sm font-medium text-gray-700">Applies to</label>
              <div className="flex gap-2">
                {(["all", "category", "product"] as const).map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => setScope(s)}
                    className={`flex-1 rounded-lg border px-3 py-2 text-xs font-medium transition-colors ${
                      scope === s ? "bg-[#238D9D] text-white border-[#238D9D]" : "bg-white text-gray-600 border-gray-200 hover:border-[#238D9D]"
                    }`}
                  >
                    {s === "all" ? "All products" : s === "category" ? "A category" : "Specific product"}
                  </button>
                ))}
              </div>
            </div>

            {scope === "category" && (
              <div className="space-y-1.5">
                <label className="text-sm font-medium text-gray-700">Category *</label>
                <select className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm" value={applicableCategory} onChange={(e) => setApplicableCategory(e.target.value)}>
                  <option value="">Select a category…</option>
                  {PRODUCT_CATEGORIES.map((c) => (
                    <option key={c} value={c}>{c.charAt(0).toUpperCase() + c.slice(1)}</option>
                  ))}
                </select>
              </div>
            )}

            {scope === "product" && (
              <div className="space-y-3">
                <div className="space-y-1.5">
                  <label className="text-sm font-medium text-gray-700">Product *</label>
                  <select
                    className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                    value={linkedProductId}
                    onChange={(e) => {
                      const prod = products.find((p) => p.id === e.target.value);
                      setLinkedProductId(e.target.value);
                      if (prod) setRetailValueCusd(String(prod.price_cusd));
                    }}
                  >
                    <option value="">{products.length === 0 ? "No products found — add products first" : "Select a product…"}</option>
                    {products.map((p) => (
                      <option key={p.id} value={p.id}>{p.name} — ${Number(p.price_cusd).toFixed(2)}{!p.active ? " (inactive)" : ""}</option>
                    ))}
                  </select>
                  {selectedProduct && (
                    <p className="text-xs text-gray-400">Category: {selectedProduct.category ?? "—"} · Price: ${Number(selectedProduct.price_cusd).toFixed(2)} cUSD</p>
                  )}
                </div>
              </div>
            )}

            <div className="space-y-1.5">
              <label className="text-sm font-medium text-gray-700">Expiry date</label>
              <Input type="date" value={expiresAt} onChange={(e) => setExpiresAt(e.target.value)} />
            </div>

            <p className="rounded-lg bg-gray-50 px-4 py-3 text-sm text-gray-600">
              Customers will see: <strong>{title || "Your voucher"}</strong> — {benefitPreview()}.
            </p>
          </div>
        )}

        {step === 1 && (
          <div className="space-y-4">
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-gray-700">Miles price *</label>
              <Input type="number" min="0" value={milesCost} onChange={(e) => setMilesCost(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-gray-700">Total quantity {"*"}</label>
              <Input type="number" min="1" value={totalQuantity} onChange={(e) => setTotalQuantity(e.target.value)} placeholder="Required to publish — a voucher may remain a draft without it" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <label className="text-sm font-medium text-gray-700">Start date</label>
                <Input type="datetime-local" value={startAt} onChange={(e) => setStartAt(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium text-gray-700">End date</label>
                <Input type="datetime-local" value={endAt} onChange={(e) => setEndAt(e.target.value)} />
              </div>
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-gray-700">Per-customer cooldown (seconds)</label>
              <Input type="number" min="0" value={cooldownSeconds} onChange={(e) => setCooldownSeconds(e.target.value)} placeholder="86400" />
            </div>
          </div>
        )}

        {step === 2 && (
          <div className="rounded-xl border-2 border-[#238D9D33] bg-[#238D9D08] p-5 space-y-2">
            <div className="flex items-center gap-2">
              <span className="text-sm font-semibold text-gray-900">Hub Miles Purchase</span>
              <span className="rounded-full bg-[#238D9D] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white">Default</span>
            </div>
            <p className="text-sm text-gray-600">
              Customers can buy this voucher with Miles in the Akiba Hub. This is included automatically when the voucher is published.
            </p>
            <div className="grid grid-cols-2 gap-4 pt-2 text-sm">
              <div>
                <p className="text-xs text-gray-400 uppercase tracking-wide">Miles price</p>
                <p className="font-medium">{milesCost || "—"}</p>
              </div>
              <div>
                <p className="text-xs text-gray-400 uppercase tracking-wide">Quantity available</p>
                <p className="font-medium">{hubQuantity != null ? Math.max(hubQuantity, 0) : "Set total quantity first"}</p>
              </div>
              <div className="col-span-2">
                <p className="text-xs text-gray-400 uppercase tracking-wide">Availability window</p>
                <p className="font-medium">{startAt ? new Date(startAt).toLocaleString() : "Immediately"} → {endAt ? new Date(endAt).toLocaleString() : "No end date"}</p>
              </div>
            </div>
          </div>
        )}

        {step === 3 && (
          <div className="space-y-3">
            <p className="text-sm text-gray-500">Choose zero or more additional channels. Winner selection and ranking are managed by the platform runtime — you only allocate quantity.</p>
            {ADDITIONAL_CHANNELS.map(({ value, label, description }) => (
              <div key={value} className="rounded-lg border border-gray-200 p-3">
                <div className="flex items-center gap-3">
                  <input
                    type="checkbox"
                    id={`ch-${value}`}
                    checked={channels[value].selected}
                    onChange={() => setChannels((prev) => ({ ...prev, [value]: { ...prev[value], selected: !prev[value].selected } }))}
                    className="h-4 w-4 rounded border-gray-300 text-[#238D9D] focus:ring-[#238D9D]"
                  />
                  <label htmlFor={`ch-${value}`} className="flex-1 text-sm font-medium text-gray-700">{label}</label>
                  {channels[value].selected && (
                    <Input
                      type="number"
                      min="1"
                      placeholder="Quantity"
                      value={channels[value].qty}
                      onChange={(e) => setChannels((prev) => ({ ...prev, [value]: { ...prev[value], qty: e.target.value } }))}
                      className="w-32"
                    />
                  )}
                </div>
                <p className="mt-1 pl-7 text-xs text-gray-400">{description}</p>
              </div>
            ))}
            {totalQty != null && (
              <p className={`text-sm ${hubQuantity != null && hubQuantity < 1 ? "text-red-600" : "text-gray-500"}`}>
                Hub Miles Purchase will receive the remainder: {Math.max(totalQty - additionalTotal, 0)} of {totalQty}.
              </p>
            )}
          </div>
        )}

        {step === 4 && (
          <div className="space-y-4">
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-gray-700">Funding party *</label>
              <select className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm" value={fundingPartyType} onChange={(e) => setFundingPartyType(e.target.value as typeof fundingPartyType)}>
                <option value="merchant">Merchant-funded</option>
                <option value="sponsor">Sponsor-funded</option>
                <option value="none">No reimbursement</option>
              </select>
            </div>
            {fundingPartyType === "sponsor" && (
              <div className="space-y-1.5">
                <label className="text-sm font-medium text-gray-700">Sponsor reference *</label>
                <Input value={fundingPartyReference} onChange={(e) => setFundingPartyReference(e.target.value)} placeholder="Sponsor agreement or account reference" />
              </div>
            )}
            {fundingPartyType !== "none" && (
              <div className="space-y-1.5">
                <label className="text-sm font-medium text-gray-700">Reimbursement rate *</label>
                <Input type="number" min="0" max="1" step="0.0001" value={reimbursementRate} onChange={(e) => setReimbursementRate(e.target.value)} />
                <p className="text-xs text-gray-400">1.0 reimburses 100% of the validated discount. Currency: cUSD.</p>
              </div>
            )}
          </div>
        )}

        {step === 5 && (
          <div className="space-y-3 text-sm">
            <SummaryRow label="Customer offer" value={`${title || "—"} — ${benefitPreview()}`} />
            <SummaryRow label="Miles price" value={milesCost || "—"} />
            <SummaryRow label="Availability window" value={`${startAt ? new Date(startAt).toLocaleString() : "Immediately"} → ${endAt ? new Date(endAt).toLocaleString() : "No end date"}`} />
            <SummaryRow label="Total quantity" value={totalQty != null ? String(totalQty) : "Not set — required to publish"} />
            <SummaryRow label="Hub quantity" value={hubQuantity != null ? String(Math.max(hubQuantity, 0)) : "—"} />
            <SummaryRow
              label="Additional channels"
              value={
                (Object.entries(channels) as [AdditionalChannel, ChannelAlloc][]).filter(([, v]) => v.selected).length === 0
                  ? "None"
                  : (Object.entries(channels) as [AdditionalChannel, ChannelAlloc][])
                      .filter(([, v]) => v.selected)
                      .map(([ch, v]) => `${ADDITIONAL_CHANNELS.find((c) => c.value === ch)?.label}: ${v.qty || 0}`)
                      .join(", ")
              }
            />
            <SummaryRow label="Funding" value={`${fundingPartyType}${fundingPartyType !== "none" ? ` · ${Number(reimbursementRate) * 100}% reimbursed` : ""}`} />
          </div>
        )}

        <div className="flex items-center justify-between pt-2">
          <Button type="button" variant="outline" onClick={() => goToStep(Math.max(step - 1, 0))} disabled={step === 0}>
            Back
          </Button>
          {step < STEPS.length - 1 ? (
            <Button type="button" onClick={() => goToStep(step + 1)}>Next</Button>
          ) : (
            <div className="flex gap-2">
              <Button type="button" variant="outline" disabled={submitting !== null} onClick={() => handleSubmit("draft")}>
                {submitting === "draft" ? "Saving…" : "Save draft"}
              </Button>
              <Button type="button" disabled={submitting !== null} onClick={() => handleSubmit("publish")}>
                {submitting === "publish" ? "Publishing…" : "Publish voucher"}
              </Button>
            </div>
          )}
        </div>
      </form>
    </div>
  );
}

function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-4 border-b border-gray-50 py-2">
      <span className="text-gray-400">{label}</span>
      <span className="text-right font-medium text-gray-800">{value}</span>
    </div>
  );
}
