// Voucher detail — the operational home for one voucher (merchant-ux-spec.md
// §9). id is the spend_voucher_templates row (the merchant-facing "voucher");
// its distribution program is looked up via v_program_inventory.template_id
// rather than requiring a separate program id in the URL, since the wizard
// (vouchers/create) always creates exactly one program per voucher.
import { requireMerchantSession } from "@/lib/auth";
import { supabase } from "@/lib/supabase";
import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { TopBar } from "@/components/layout/TopBar";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Pencil } from "lucide-react";
import type { VoucherTemplate } from "@/types";
import ProgramActions from "../programs/[id]/ProgramActions";
import SettlementTermsForm from "../programs/[id]/SettlementTermsForm";
import { channelLabel, HUB_CHANNEL } from "@/lib/voucherChannels";

const STATE_COLORS: Record<string, string> = {
  draft:  "bg-gray-100 text-gray-600",
  active: "bg-green-100 text-green-700",
  paused: "bg-yellow-100 text-yellow-700",
  ended:  "bg-red-100 text-red-600",
};

const TRANSITIONS: Record<string, string[]> = {
  draft:  ["active"],
  active: ["paused", "ended"],
  paused: ["active", "ended"],
  ended:  [],
};

interface InventoryRow {
  program_id: string;
  program_name: string;
  state: string;
  total_cap: number | null;
  program_consumed: number;
  program_remaining: number | null;
  channel: string;
  channel_cap: number | null;
  channel_consumed: number;
  channel_remaining: number | null;
  channel_active: boolean;
  start_at: string | null;
  end_at: string | null;
}

function discountLabel(t: VoucherTemplate): string {
  if (t.voucher_type === "free") return "Free item";
  if (t.voucher_type === "percent_off") return `${t.discount_percent}% off`;
  if (t.voucher_type === "fixed_off") return `$${t.discount_cusd} off`;
  return "—";
}

export default async function VoucherDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await requireMerchantSession();
  if (!session) redirect("/login");

  const canEdit = ["owner", "manager"].includes(session.role);

  const { data: template } = await supabase
    .from("spend_voucher_templates")
    .select("id,title,voucher_type,miles_cost,discount_percent,discount_cusd,applicable_category,linked_product_id,retail_value_cusd,active,expires_at,cooldown_seconds")
    .eq("id", id)
    .eq("partner_id", session.partnerId)
    .maybeSingle();

  if (!template) notFound();
  const t = template as unknown as VoucherTemplate;

  const { data: inventoryRows } = await supabase
    .from("v_program_inventory")
    .select("program_id,program_name,state,total_cap,program_consumed,program_remaining,channel,channel_cap,channel_consumed,channel_remaining,channel_active,start_at,end_at")
    .eq("template_id", id);

  const rows = (inventoryRows ?? []) as InventoryRow[];
  const program = rows[0] ?? null;
  const channels = rows.filter((r) => r.channel);
  const hubChannel = channels.find((c) => c.channel === HUB_CHANNEL);
  const additionalChannels = channels.filter((c) => c.channel !== HUB_CHANNEL);

  const settlement = program
    ? (
        await supabase
          .from("voucher_program_settlement_terms")
          .select("funding_party_type,funding_party_reference,settlement_currency,reimbursement_rate")
          .eq("program_id", program.program_id)
          .maybeSingle()
      ).data
    : null;

  const audit = program
    ? (
        (
          await supabase
            .from("merchant_audit_log")
            .select("id,action,metadata,created_at")
            .eq("partner_id", session.partnerId)
            .ilike("action", "program.%")
            .order("created_at", { ascending: false })
            .limit(50)
        ).data ?? []
      ).filter((a) => (a.metadata as Record<string, unknown> | null)?.program_id === program.program_id).slice(0, 20)
    : [];

  const nextStates = program ? TRANSITIONS[program.state] ?? [] : [];

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <TopBar
        title={t.title}
        subtitle={program ? `Distribution: ${program.state}` : "Draft — no distribution created yet"}
        actions={
          <div className="flex items-center gap-2">
            {canEdit && (
              <Link href={`/vouchers/${id}/edit`}>
                <Button variant="outline" size="sm" className="gap-1.5"><Pencil className="h-3.5 w-3.5" /> Edit offer</Button>
              </Link>
            )}
            {canEdit && program && nextStates.length > 0 && (
              <ProgramActions programId={program.program_id} currentState={program.state} nextStates={nextStates} />
            )}
          </div>
        }
      />

      <div className="flex-1 overflow-y-auto p-6 space-y-5">
        {/* Summary cards */}
        <div className="grid grid-cols-4 gap-4">
          <SummaryCard label="Total quantity" value={program?.total_cap ?? "Unlimited"} />
          <SummaryCard label="Distributed" value={program?.program_consumed ?? 0} />
          <SummaryCard label="Remaining" value={program?.program_remaining ?? "∞"} />
          <SummaryCard label="Redeemed" value={channels.reduce((s, c) => s + c.channel_consumed, 0) > 0 ? "See Redemptions tab" : 0} />
        </div>

        {/* Offer */}
        <Card>
          <CardHeader><CardTitle className="text-base">Offer</CardTitle></CardHeader>
          <CardContent className="grid grid-cols-2 gap-4 text-sm">
            <Field label="Benefit" value={discountLabel(t)} />
            <Field label="Miles price" value={t.miles_cost} />
            <Field label="Scope" value={t.linked_product_id ? "Specific product" : t.applicable_category ?? "All products"} />
            <Field label="Cooldown" value={`${t.cooldown_seconds}s`} />
            <Field label="Expiry" value={t.expires_at ? new Date(t.expires_at).toLocaleDateString() : "No expiry"} />
            <Field label="Status" value={t.active ? "Active" : "Inactive"} />
          </CardContent>
        </Card>

        {/* Distribution — Hub card first, marked Default, then additional channels */}
        <Card>
          <CardHeader><CardTitle className="text-base">Distribution</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            {!program ? (
              <p className="text-sm text-gray-400">No distribution created — this voucher is a draft.</p>
            ) : (
              <>
                <div className="rounded-lg border-2 border-[#238D9D33] bg-[#238D9D08] p-4">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-gray-900">{channelLabel(HUB_CHANNEL)}</span>
                    <span className="rounded-full bg-[#238D9D] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white">Default</span>
                  </div>
                  <div className="mt-2 grid grid-cols-3 gap-3 text-xs text-gray-500">
                    <div>Cap: <strong className="text-gray-800">{hubChannel?.channel_cap ?? "∞"}</strong></div>
                    <div>Used: <strong className="text-gray-800">{hubChannel?.channel_consumed ?? 0}</strong></div>
                    <div>Remaining: <strong className="text-gray-800">{hubChannel?.channel_remaining ?? "∞"}</strong></div>
                  </div>
                </div>
                {additionalChannels.map((c) => (
                  <div key={c.channel} className="rounded-lg border border-gray-200 p-4">
                    <span className={`font-medium ${c.channel_active ? "text-gray-900" : "text-gray-400"}`}>
                      {channelLabel(c.channel)}{!c.channel_active && " (paused)"}
                    </span>
                    <div className="mt-2 grid grid-cols-3 gap-3 text-xs text-gray-500">
                      <div>Cap: <strong className="text-gray-800">{c.channel_cap ?? "∞"}</strong></div>
                      <div>Used: <strong className="text-gray-800">{c.channel_consumed}</strong></div>
                      <div>Remaining: <strong className="text-gray-800">{c.channel_remaining ?? "∞"}</strong></div>
                    </div>
                  </div>
                ))}
              </>
            )}
          </CardContent>
        </Card>

        {/* Settlement */}
        <Card>
          <CardHeader><CardTitle className="text-base">Settlement</CardTitle></CardHeader>
          <CardContent>
            {!program ? (
              <p className="text-sm text-gray-400">Configure settlement once this voucher has a distribution.</p>
            ) : canEdit && program.state === "draft" ? (
              <SettlementTermsForm
                programId={program.program_id}
                initial={{
                  funding_party_type: (settlement?.funding_party_type ?? "merchant") as "merchant" | "sponsor" | "none",
                  funding_party_reference: settlement?.funding_party_reference ?? null,
                  reimbursement_rate: Number(settlement?.reimbursement_rate ?? 1),
                }}
              />
            ) : (
              <div className="grid grid-cols-3 gap-3 text-sm">
                <Field label="Funding party" value={settlement?.funding_party_type ?? "Not configured"} />
                <Field label="Reimbursement rate" value={settlement ? `${Number(settlement.reimbursement_rate) * 100}%` : "—"} />
                <Field label="Currency" value={settlement?.settlement_currency ?? "—"} />
              </div>
            )}
          </CardContent>
        </Card>

        {/* Activity */}
        {audit.length > 0 && (
          <Card>
            <CardHeader><CardTitle className="text-base">Activity</CardTitle></CardHeader>
            <CardContent className="space-y-2">
              {audit.map((a) => (
                <div key={a.id} className="flex items-start gap-3 text-xs">
                  <span className="shrink-0 text-gray-400">{new Date(a.created_at).toLocaleString("en-KE")}</span>
                  <span className="font-medium capitalize text-gray-700">{a.action.replace(/\./g, " · ")}</span>
                </div>
              ))}
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}

function SummaryCard({ label, value }: { label: string; value: string | number }) {
  return (
    <Card>
      <CardContent className="p-4">
        <p className="text-xs uppercase tracking-wide text-gray-400">{label}</p>
        <p className="mt-1 text-xl font-semibold text-gray-900">{value}</p>
      </CardContent>
    </Card>
  );
}

function Field({ label, value }: { label: string; value: string | number }) {
  return (
    <div>
      <p className="text-xs uppercase tracking-wide text-gray-400">{label}</p>
      <p className="mt-1 font-medium capitalize">{value}</p>
    </div>
  );
}
