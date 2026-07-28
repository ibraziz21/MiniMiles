import { redirect } from "next/navigation";
import { requireAdminSession } from "@/lib/auth";
import { supabase } from "@/lib/supabase";
import { TopBar } from "@/components/layout/TopBar";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { AssignSponsorForm, type AllocationOption } from "./assign-form";

export const dynamic = "force-dynamic";

const CHANNEL = "weekly_leaderboard_challenge";

async function getAllocations(): Promise<AllocationOption[]> {
  const { data: inventory } = await supabase
    .from("v_program_inventory")
    .select("program_id, program_name, template_id, channel_active, channel_remaining, channel_cap")
    .eq("channel", CHANNEL)
    .eq("channel_active", true);

  const rows = inventory ?? [];
  if (rows.length === 0) return [];

  const templateIds = [...new Set(rows.map((r) => r.template_id).filter(Boolean))];
  const { data: templates } = await supabase
    .from("spend_voucher_templates")
    .select("id, title, partners(name)")
    .in("id", templateIds);

  const templateMap = new Map(
    (templates ?? []).map((t) => [
      t.id,
      { title: t.title, partnerName: (t as unknown as { partners: { name: string } | null }).partners?.name ?? null },
    ]),
  );

  return rows
    .filter((r) => r.channel_cap === null || (r.channel_remaining ?? 0) > 0)
    .map((r) => {
      const template = templateMap.get(r.template_id);
      const label = template
        ? `${template.title}${template.partnerName ? ` · ${template.partnerName}` : ""}`
        : r.program_name;
      return { programId: r.program_id, label, remaining: r.channel_remaining };
    });
}

async function getCurrentCampaign() {
  const today = new Date().toISOString().slice(0, 10);
  const { data } = await supabase
    .from("game_weekly_campaigns")
    .select("id, program_id, merchant_id, week_from, week_to, game_types, active")
    .eq("active", true)
    .lte("week_from", today)
    .gt("week_to", today)
    .maybeSingle();
  return data;
}

export default async function WeeklyChallengeSponsorPage() {
  const session = await requireAdminSession("vouchers.read");
  if (!session) redirect("/login");

  const [allocations, currentCampaign] = await Promise.all([getAllocations(), getCurrentCampaign()]);

  return (
    <div>
      <TopBar
        title="Weekly Leaderboard Challenge"
        subtitle="Assign which merchant allocation sponsors this week's top-3 skill-game prizes"
      />
      <div className="space-y-6 p-6">
        <Card>
          <CardHeader><CardTitle>Current week&apos;s sponsor</CardTitle></CardHeader>
          <CardContent>
            {currentCampaign ? (
              <div className="flex items-center justify-between rounded-lg border border-slate-100 px-3 py-2 text-sm">
                <div>
                  <p className="font-medium text-slate-900">
                    {currentCampaign.program_id ? "Merchant allocation" : "Hand-configured campaign"}
                  </p>
                  <p className="text-xs text-slate-400">
                    {currentCampaign.week_from} → {currentCampaign.week_to} ·{" "}
                    {(currentCampaign.game_types as string[]).join(", ")}
                  </p>
                </div>
                <Badge variant={currentCampaign.program_id ? "success" : "secondary"}>
                  {currentCampaign.program_id ? "Bridged" : "Legacy"}
                </Badge>
              </div>
            ) : (
              <p className="text-sm text-slate-400">No active campaign covers today.</p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Assign this week&apos;s sponsor</CardTitle></CardHeader>
          <CardContent>
            <AssignSponsorForm allocations={allocations} />
            <p className="mt-3 text-xs text-slate-400">
              All 3 leaderboard ranks (per game) win the same voucher from the assigned
              allocation — size its remaining capacity accordingly (≥3 for one game,
              ≥6 for both).
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
