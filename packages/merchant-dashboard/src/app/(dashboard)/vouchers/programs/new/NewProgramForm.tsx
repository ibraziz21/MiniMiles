"use client";

import { useState, FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { VoucherTemplate } from "@/types";

const CHANNELS = [
  { value: "miles_purchase", label: "Miles Purchase" },
  { value: "claw",           label: "Claw Game" },
  { value: "raffle",         label: "Raffle" },
  { value: "giveaway",       label: "Giveaway" },
  { value: "merchant_grant", label: "Merchant Grant" },
] as const;

type Channel = typeof CHANNELS[number]["value"];

interface ChannelAlloc { cap: string; active: boolean }

interface Props { templates: VoucherTemplate[] }

export default function NewProgramForm({ templates }: Props) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [name,       setName]       = useState("");
  const [templateId, setTemplateId] = useState(templates[0]?.id ?? "");
  const [totalCap,   setTotalCap]   = useState("");
  const [startAt,    setStartAt]    = useState("");
  const [endAt,      setEndAt]      = useState("");
  const [fundingPartyType, setFundingPartyType] = useState<"merchant" | "sponsor" | "none">("merchant");
  const [fundingPartyReference, setFundingPartyReference] = useState("");
  const [reimbursementRate, setReimbursementRate] = useState("1");

  const [channels, setChannels] = useState<Record<Channel, ChannelAlloc>>({
    miles_purchase: { cap: "", active: false },
    claw:           { cap: "", active: false },
    raffle:         { cap: "", active: false },
    giveaway:       { cap: "", active: false },
    merchant_grant: { cap: "", active: false },
  });

  function toggleChannel(ch: Channel) {
    setChannels((prev) => ({
      ...prev,
      [ch]: { ...prev[ch], active: !prev[ch].active },
    }));
  }

  function setChannelCap(ch: Channel, cap: string) {
    setChannels((prev) => ({ ...prev, [ch]: { ...prev[ch], cap } }));
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    const activeChannels = (Object.entries(channels) as [Channel, ChannelAlloc][])
      .filter(([, v]) => v.active)
      .map(([ch, v]) => ({ channel: ch, cap: v.cap ? parseInt(v.cap) : null, active: true }));

    if (activeChannels.length === 0) {
      setError("Select at least one channel");
      setLoading(false);
      return;
    }

    try {
      const res = await fetch("/api/programs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          template_id: templateId,
          total_cap: totalCap ? parseInt(totalCap) : null,
          start_at: startAt || null,
          end_at:   endAt   || null,
          channels: activeChannels,
          funding_party_type: fundingPartyType,
          funding_party_reference:
            fundingPartyType === "sponsor" ? fundingPartyReference.trim() || null : null,
          settlement_currency: "cUSD",
          reimbursement_rate: fundingPartyType === "none" ? 0 : Number(reimbursementRate),
        }),
      });

      const json = await res.json() as { error?: string; program_id?: string };
      if (!res.ok) throw new Error(json.error ?? "Failed to create program");
      router.push(`/vouchers/programs/${json.program_id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      {error && (
        <div className="rounded-md bg-red-50 border border-red-200 text-red-700 text-sm p-3">
          {error}
        </div>
      )}

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">Program name *</label>
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Summer Claw Vouchers"
          required
        />
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">Voucher template *</label>
        <select
          className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#238D9D]"
          value={templateId}
          onChange={(e) => setTemplateId(e.target.value)}
          required
        >
          {templates.map((t) => (
            <option key={t.id} value={t.id}>{t.title}</option>
          ))}
        </select>
        <p className="mt-1 text-xs text-gray-400">Cannot be changed after first issuance.</p>
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">Total cap (optional)</label>
        <Input
          type="number"
          min="1"
          value={totalCap}
          onChange={(e) => setTotalCap(e.target.value)}
          placeholder="Leave blank for unlimited"
        />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Start date (optional)</label>
          <Input type="datetime-local" value={startAt} onChange={(e) => setStartAt(e.target.value)} />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">End date (optional)</label>
          <Input type="datetime-local" value={endAt} onChange={(e) => setEndAt(e.target.value)} />
        </div>
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">Settlement funding party *</label>
        <select
          className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
          value={fundingPartyType}
          onChange={(e) => setFundingPartyType(e.target.value as "merchant" | "sponsor" | "none")}
        >
          <option value="merchant">Merchant funded</option>
          <option value="sponsor">Sponsor funded</option>
          <option value="none">Merchant absorbs discount (no reimbursement)</option>
        </select>
      </div>

      {fundingPartyType === "sponsor" && (
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Sponsor reference *</label>
          <Input
            value={fundingPartyReference}
            onChange={(e) => setFundingPartyReference(e.target.value)}
            placeholder="Sponsor agreement or account reference"
            required
          />
        </div>
      )}

      {fundingPartyType !== "none" && (
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Reimbursement rate *</label>
          <Input
            type="number"
            min="0"
            max="1"
            step="0.0001"
            value={reimbursementRate}
            onChange={(e) => setReimbursementRate(e.target.value)}
            required
          />
          <p className="mt-1 text-xs text-gray-400">1.0 reimburses 100% of the validated discount.</p>
        </div>
      )}

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-2">Channels *</label>
        <div className="space-y-2">
          {CHANNELS.map(({ value, label }) => (
            <div key={value} className="flex items-center gap-3">
              <input
                type="checkbox"
                id={`ch-${value}`}
                checked={channels[value].active}
                onChange={() => toggleChannel(value)}
                className="h-4 w-4 rounded border-gray-300 text-[#238D9D] focus:ring-[#238D9D]"
              />
              <label htmlFor={`ch-${value}`} className="text-sm text-gray-700 w-36">
                {label}
              </label>
              {channels[value].active && (
                <Input
                  type="number"
                  min="1"
                  placeholder="Cap (optional)"
                  value={channels[value].cap}
                  onChange={(e) => setChannelCap(value, e.target.value)}
                  className="w-36"
                />
              )}
            </div>
          ))}
        </div>
      </div>

      <Button type="submit" className="w-full" disabled={loading}>
        {loading ? "Creating…" : "Create Program"}
      </Button>
    </form>
  );
}
