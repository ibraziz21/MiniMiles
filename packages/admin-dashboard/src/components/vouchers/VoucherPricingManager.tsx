"use client";

import { useState } from "react";
import { CheckCircle2, Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export type VoucherPricingBand = {
  id: string;
  benefit_key: string;
  display_name: string;
  voucher_type: "percent_off" | "free" | "bogo";
  discount_percent: number | null;
  minimum_miles_price: number;
  maximum_miles_price: number;
  selected_miles_price: number | null;
  effective_from: string;
  effective_to: string | null;
};

export function VoucherPricingManager({
  initialBands,
  canEdit,
}: {
  initialBands: VoucherPricingBand[];
  canEdit: boolean;
}) {
  const [bands, setBands] = useState(initialBands);

  function replaceBand(updated: Partial<VoucherPricingBand> & { benefit_key: string }) {
    setBands((current) => current.map((band) => band.benefit_key === updated.benefit_key
      ? { ...band, ...updated }
      : band));
  }

  if (bands.length === 0) {
    return <p className="rounded-lg bg-amber-50 p-4 text-sm text-amber-800">
      No active voucher pricing bands were found. Apply the Akiba voucher runtime migration first.
    </p>;
  }

  return (
    <div className="grid gap-4 xl:grid-cols-2">
      {bands.map((band) => (
        <BandEditor key={band.benefit_key} band={band} canEdit={canEdit} onSaved={replaceBand} />
      ))}
    </div>
  );
}

function BandEditor({
  band,
  canEdit,
  onSaved,
}: {
  band: VoucherPricingBand;
  canEdit: boolean;
  onSaved: (updated: Partial<VoucherPricingBand> & { benefit_key: string }) => void;
}) {
  const [price, setPrice] = useState(band.selected_miles_price?.toString() ?? "");
  const [reason, setReason] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const parsedPrice = Number(price);
  const priceValid = price.trim() !== ""
    && Number.isInteger(parsedPrice)
    && parsedPrice >= band.minimum_miles_price
    && parsedPrice <= band.maximum_miles_price;

  async function save() {
    setError(null);
    setSaved(false);
    if (!priceValid) {
      setError(`Choose a whole number from ${band.minimum_miles_price} to ${band.maximum_miles_price}.`);
      return;
    }
    if (reason.trim().length < 8) {
      setError("Add a short reason for this pricing decision.");
      return;
    }

    setLoading(true);
    try {
      const response = await fetch("/api/admin/voucher-pricing", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          benefitKey: band.benefit_key,
          selectedMilesPrice: parsedPrice,
          reason: reason.trim(),
        }),
      });
      const data = await response.json() as { error?: string; band?: Partial<VoucherPricingBand> & { benefit_key: string } };
      if (!response.ok || !data.band) {
        setError(data.error ?? "Could not save this price.");
        return;
      }
      onSaved(data.band);
      setReason("");
      setSaved(true);
    } catch {
      setError("Network error. The price was not changed.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="font-semibold text-slate-900">{band.display_name}</p>
          <p className="mt-1 text-xs text-slate-500">Approved band</p>
          <p className="text-lg font-bold text-[#238D9D]">
            {band.minimum_miles_price}–{band.maximum_miles_price} Miles
          </p>
        </div>
        <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${band.selected_miles_price == null
          ? "bg-amber-100 text-amber-800"
          : "bg-emerald-100 text-emerald-800"}`}>
          {band.selected_miles_price == null ? "Price pending" : `${band.selected_miles_price} Miles`}
        </span>
      </div>

      <div className="mt-4 space-y-3 border-t border-slate-100 pt-4">
        <label className="block space-y-1.5">
          <span className="text-xs font-medium text-slate-600">Exact customer price (Miles)</span>
          <Input type="number" step="1" min={band.minimum_miles_price} max={band.maximum_miles_price}
            value={price} onChange={(event) => setPrice(event.target.value)} disabled={!canEdit || loading} />
        </label>
        <label className="block space-y-1.5">
          <span className="text-xs font-medium text-slate-600">Change reason</span>
          <textarea value={reason} onChange={(event) => setReason(event.target.value)}
            placeholder="e.g. Mombasa launch pricing approval"
            maxLength={240} disabled={!canEdit || loading}
            className="min-h-20 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-[#238D9D] disabled:cursor-not-allowed disabled:opacity-50" />
        </label>
        {error && <p className="text-xs text-red-700">{error}</p>}
        {saved && <p className="flex items-center gap-1 text-xs text-emerald-700">
          <CheckCircle2 className="h-3.5 w-3.5" /> New pricing version is active.
        </p>}
        <Button type="button" size="sm" onClick={() => void save()}
          disabled={!canEdit || loading || !priceValid || reason.trim().length < 8}>
          <Save className="h-3.5 w-3.5" /> {loading ? "Saving…" : "Save exact price"}
        </Button>
      </div>
    </div>
  );
}
