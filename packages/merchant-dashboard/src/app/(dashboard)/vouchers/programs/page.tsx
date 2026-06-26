import { requireMerchantSession } from "@/lib/auth";
import { supabase } from "@/lib/supabase";
import { redirect } from "next/navigation";
import { TopBar } from "@/components/layout/TopBar";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import Link from "next/link";
import { Plus } from "lucide-react";

const STATE_COLORS: Record<string, string> = {
  draft:  "bg-gray-100 text-gray-600",
  active: "bg-green-100 text-green-700",
  paused: "bg-yellow-100 text-yellow-700",
  ended:  "bg-red-100 text-red-600",
};

const CHANNEL_LABELS: Record<string, string> = {
  miles_purchase: "Miles",
  claw:           "Claw",
  raffle:         "Raffle",
  giveaway:       "Giveaway",
  merchant_grant: "Grant",
  akiba_grant:    "Akiba",
};

interface InventoryRow {
  program_id:        string;
  program_name:      string;
  state:             string;
  total_cap:         number | null;
  program_consumed:  number;
  program_remaining: number | null;
  channel:           string;
  channel_cap:       number | null;
  channel_consumed:  number;
  channel_remaining: number | null;
  channel_active:    boolean;
}

export default async function ProgramsPage() {
  const session = await requireMerchantSession();
  if (!session) redirect("/login");

  const canEdit = ["owner", "manager"].includes(session.role);

  // Fetch programs whose templates belong to this partner
  const { data: templateRows } = await supabase
    .from("spend_voucher_templates")
    .select("id")
    .eq("partner_id", session.partnerId);
  const templateIds = (templateRows ?? []).map((t: { id: string }) => t.id);

  let programs: InventoryRow[] = [];
  if (templateIds.length > 0) {
    const { data } = await supabase
      .from("v_program_inventory")
      .select("*")
      .in("template_id", templateIds)
      .order("program_name");
    programs = (data ?? []) as InventoryRow[];
  }

  // Group by program
  const programMap = new Map<string, { meta: InventoryRow; channels: InventoryRow[] }>();
  for (const row of programs) {
    if (!programMap.has(row.program_id)) {
      programMap.set(row.program_id, { meta: row, channels: [] });
    }
    if (row.channel) programMap.get(row.program_id)!.channels.push(row);
  }
  const programGroups = [...programMap.values()];

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <TopBar
        title="Voucher Programs"
        subtitle={`${programGroups.length} program${programGroups.length !== 1 ? "s" : ""}`}
        actions={
          canEdit ? (
            <Link href="/vouchers/programs/new">
              <Button size="sm" className="gap-1.5">
                <Plus className="h-4 w-4" /> New Program
              </Button>
            </Link>
          ) : undefined
        }
      />

      <div className="flex-1 overflow-y-auto p-6 space-y-4">
        {programGroups.length === 0 ? (
          <Card>
            <CardContent className="py-16 text-center text-sm text-gray-500">
              No programs yet.{" "}
              {canEdit && (
                <Link href="/vouchers/programs/new" className="text-[#238D9D] hover:underline">
                  Create one →
                </Link>
              )}
            </CardContent>
          </Card>
        ) : (
          programGroups.map(({ meta, channels }) => (
            <Card key={meta.program_id}>
              <CardContent className="p-5">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-gray-900">{meta.program_name}</span>
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium capitalize ${STATE_COLORS[meta.state] ?? STATE_COLORS.draft}`}>
                        {meta.state}
                      </span>
                    </div>
                    <div className="mt-1 text-sm text-gray-500">
                      Total: <strong>{meta.program_consumed}</strong>
                      {meta.total_cap != null && <> / {meta.total_cap} · {meta.program_remaining} remaining</>}
                    </div>
                  </div>
                  {canEdit && (
                    <Link href={`/vouchers/programs/${meta.program_id}`}>
                      <Button variant="outline" size="sm">Manage</Button>
                    </Link>
                  )}
                </div>

                {channels.length > 0 && (
                  <div className="mt-4 overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="border-b border-gray-100 text-left text-gray-400 uppercase tracking-wide">
                          <th className="pb-1 pr-4">Channel</th>
                          <th className="pb-1 pr-4">Cap</th>
                          <th className="pb-1 pr-4">Used</th>
                          <th className="pb-1">Remaining</th>
                        </tr>
                      </thead>
                      <tbody>
                        {channels.map((ch) => (
                          <tr key={ch.channel} className="border-b border-gray-50 last:border-0">
                            <td className="py-1.5 pr-4">
                              <span className={`font-medium ${ch.channel_active ? "text-gray-700" : "text-gray-300"}`}>
                                {CHANNEL_LABELS[ch.channel] ?? ch.channel}
                                {!ch.channel_active && " (paused)"}
                              </span>
                            </td>
                            <td className="py-1.5 pr-4 text-gray-500">{ch.channel_cap ?? "∞"}</td>
                            <td className="py-1.5 pr-4 text-gray-700">{ch.channel_consumed}</td>
                            <td className="py-1.5 text-gray-700">
                              {ch.channel_remaining != null ? ch.channel_remaining : "∞"}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </CardContent>
            </Card>
          ))
        )}
      </div>
    </div>
  );
}
