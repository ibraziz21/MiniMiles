import { requireMerchantSession } from "@/lib/auth";
import { supabase } from "@/lib/supabase";
import { redirect } from "next/navigation";
import { TopBar } from "@/components/layout/TopBar";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import Link from "next/link";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { VoucherTemplate } from "@/types";
import { VoucherTabs } from "@/components/vouchers/VoucherTabs";
import { channelLabel, HUB_CHANNEL } from "@/lib/voucherChannels";

function discountLabel(t: VoucherTemplate): string {
  if (t.voucher_type === "free") return "Free item";
  if (t.voucher_type === "percent_off") return `${t.discount_percent}% off`;
  if (t.voucher_type === "fixed_off") return `$${t.discount_cusd} off`;
  return "—";
}

// Derived display states — merchant-ux-spec.md §7.1: Scheduled/Exhausted
// don't need new DB states, they're computed from the program's own state,
// dates, and inventory.
type VoucherStatus = "draft" | "scheduled" | "live" | "paused" | "exhausted" | "ended";

function deriveStatus(program: {
  state: string;
  start_at: string | null;
  end_at: string | null;
  total_cap: number | null;
  consumed: number;
} | null): VoucherStatus {
  if (!program) return "draft";
  if (program.state === "draft") return "draft";
  if (program.state === "ended") return "ended";
  if (program.state === "paused") return "paused";
  if (program.total_cap != null && program.consumed >= program.total_cap) return "exhausted";
  if (program.start_at && new Date(program.start_at) > new Date()) return "scheduled";
  return "live";
}

const STATUS_STYLES: Record<VoucherStatus, string> = {
  draft: "bg-gray-100 text-gray-600",
  scheduled: "bg-blue-100 text-blue-700",
  live: "bg-green-100 text-green-700",
  paused: "bg-yellow-100 text-yellow-700",
  exhausted: "bg-orange-100 text-orange-700",
  ended: "bg-red-100 text-red-600",
};

export default async function VouchersPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const session = await requireMerchantSession();
  if (!session) redirect("/login");
  const { status: statusFilter } = await searchParams;

  const { data: rawTemplates } = await supabase
    .from("spend_voucher_templates")
    .select("id,title,voucher_type,miles_cost,discount_percent,discount_cusd,applicable_category,linked_product_id,retail_value_cusd,active,expires_at,global_cap")
    .eq("partner_id", session.partnerId)
    .order("created_at", { ascending: false });

  const templates = (rawTemplates ?? []) as VoucherTemplate[];
  const templateIds = templates.map((t) => t.id);

  const [productsRes, inventoryRes] = await Promise.all([
    templateIds.length
      ? supabase.from("merchant_products").select("id,name").in(
          "id",
          [...new Set(templates.map((t) => t.linked_product_id).filter(Boolean))] as string[]
        )
      : Promise.resolve({ data: [] as { id: string; name: string }[] }),
    templateIds.length
      ? supabase
          .from("v_program_inventory")
          .select("program_id,template_id,state,total_cap,start_at,end_at,program_consumed,channel,channel_active,channel_cap,channel_remaining")
          .in("template_id", templateIds)
      : Promise.resolve({ data: [] as any[] }),
  ]);

  const productNames: Record<string, string> = {};
  for (const p of productsRes.data ?? []) productNames[p.id] = p.name;

  // One program per template (the flow creates exactly one; take the most
  // recently touched row set if legacy data has more than one).
  const programByTemplate = new Map<string, { program_id: string; state: string; total_cap: number | null; start_at: string | null; end_at: string | null; consumed: number; channels: any[] }>();
  for (const row of (inventoryRes.data ?? []) as any[]) {
    if (!row.template_id) continue;
    let entry = programByTemplate.get(row.template_id);
    if (!entry || entry.program_id !== row.program_id) {
      entry = { program_id: row.program_id, state: row.state, total_cap: row.total_cap, start_at: row.start_at, end_at: row.end_at, consumed: row.program_consumed, channels: [] };
      programByTemplate.set(row.template_id, entry);
    }
    if (row.channel) entry.channels.push(row);
  }

  const redeemedIds = templateIds.length
    ? await supabase.from("issued_vouchers").select("program_id,status").in(
        "program_id",
        [...programByTemplate.values()].map((p) => p.program_id)
      )
    : { data: [] as { program_id: string; status: string }[] };
  const redemptionsByProgram = new Map<string, number>();
  for (const row of redeemedIds.data ?? []) {
    if (row.status === "redeemed") redemptionsByProgram.set(row.program_id, (redemptionsByProgram.get(row.program_id) ?? 0) + 1);
  }

  const rows = templates.map((t) => {
    const program = programByTemplate.get(t.id) ?? null;
    const status = deriveStatus(program);
    const hubChannel = program?.channels.find((c) => c.channel === HUB_CHANNEL);
    const additionalChannels = (program?.channels ?? []).filter((c) => c.channel !== HUB_CHANNEL && c.channel_active);
    return {
      template: t,
      status,
      distributed: program?.consumed ?? 0,
      total: program?.total_cap ?? null,
      hubRemaining: hubChannel?.channel_remaining ?? null,
      additionalChannels,
      redemptions: program ? redemptionsByProgram.get(program.program_id) ?? 0 : 0,
      linkedProductName: t.linked_product_id ? productNames[t.linked_product_id] ?? null : null,
      startAt: program?.start_at ?? null,
      endAt: program?.end_at ?? null,
    };
  });

  const filtered = statusFilter && statusFilter !== "all" ? rows.filter((r) => r.status === statusFilter) : rows;
  const canEdit = ["owner", "manager"].includes(session.role);

  const FILTERS: { value: string; label: string }[] = [
    { value: "all", label: "All" },
    { value: "draft", label: "Draft" },
    { value: "scheduled", label: "Scheduled" },
    { value: "live", label: "Live" },
    { value: "paused", label: "Paused" },
    { value: "ended", label: "Ended" },
  ];

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <TopBar
        title="Vouchers"
        subtitle={`${filtered.length} voucher${filtered.length !== 1 ? "s" : ""}`}
        actions={
          canEdit ? (
            <Link href="/vouchers/create">
              <Button size="sm" className="gap-1.5">
                <Plus className="h-4 w-4" /> Create voucher
              </Button>
            </Link>
          ) : undefined
        }
      />
      <VoucherTabs />
      <div className="flex-1 overflow-y-auto p-6 space-y-4">
        <div className="flex gap-2">
          {FILTERS.map((f) => (
            <Link
              key={f.value}
              href={f.value === "all" ? "/vouchers" : `/vouchers?status=${f.value}`}
              className={`rounded-full px-3 py-1 text-xs font-medium ${
                (statusFilter ?? "all") === f.value ? "bg-[#238D9D] text-white" : "bg-gray-100 text-gray-600 hover:bg-gray-200"
              }`}
            >
              {f.label}
            </Link>
          ))}
        </div>

        <Card>
          <CardContent className="p-0">
            {filtered.length === 0 ? (
              <div className="py-16 text-center text-sm text-gray-500">
                Create a voucher customers can purchase with Miles in the Akiba Hub, then optionally distribute it through challenges, games, raffles, or grants.
                {canEdit && (
                  <>
                    {" "}
                    <Link href="/vouchers/create" className="text-[#238D9D] hover:underline">Create one →</Link>
                  </>
                )}
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-100 text-left text-xs font-medium uppercase tracking-wide text-gray-500">
                      <th className="px-5 py-3">Voucher</th>
                      <th className="px-5 py-3">Miles price</th>
                      <th className="px-5 py-3">Status</th>
                      <th className="px-5 py-3">Availability</th>
                      <th className="px-5 py-3">Distributed / Total</th>
                      <th className="px-5 py-3">Hub remaining</th>
                      <th className="px-5 py-3">Channels</th>
                      <th className="px-5 py-3">Redemptions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {filtered.map(({ template: t, status, distributed, total, hubRemaining, additionalChannels, redemptions, linkedProductName, startAt, endAt }) => (
                      <tr key={t.id} className="hover:bg-gray-50 cursor-pointer" onClick={undefined}>
                        <td className="px-5 py-3">
                          <Link href={`/vouchers/${t.id}`} className="font-medium text-gray-900 hover:text-[#238D9D]">{t.title}</Link>
                          <div className="text-xs text-gray-400">{discountLabel(t)} · {linkedProductName ? `📦 ${linkedProductName}` : t.applicable_category ?? "All products"}</div>
                        </td>
                        <td className="px-5 py-3 text-gray-700">{t.miles_cost}</td>
                        <td className="px-5 py-3">
                          <Badge className={STATUS_STYLES[status]}>{status.charAt(0).toUpperCase() + status.slice(1)}</Badge>
                        </td>
                        <td className="px-5 py-3 text-xs text-gray-500">
                          {startAt ? new Date(startAt).toLocaleDateString() : "Immediately"} → {endAt ? new Date(endAt).toLocaleDateString() : "No end"}
                        </td>
                        <td className="px-5 py-3 text-gray-700">{distributed}{total != null ? ` / ${total}` : ""}</td>
                        <td className="px-5 py-3 text-gray-700">{hubRemaining != null ? hubRemaining : "—"}</td>
                        <td className="px-5 py-3">
                          <div className="flex flex-wrap gap-1">
                            {additionalChannels.length === 0 ? (
                              <span className="text-xs text-gray-300">—</span>
                            ) : (
                              additionalChannels.map((c) => (
                                <span key={c.channel} className="inline-flex items-center rounded-full bg-[#238D9D11] px-2 py-0.5 text-[10px] font-medium text-[#238D9D]">
                                  {channelLabel(c.channel)}
                                </span>
                              ))
                            )}
                          </div>
                        </td>
                        <td className="px-5 py-3 text-gray-700">{redemptions}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
