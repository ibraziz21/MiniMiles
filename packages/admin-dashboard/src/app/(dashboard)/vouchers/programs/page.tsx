import { redirect } from "next/navigation";
import { requireAdminSession, adminIdForWrite } from "@/lib/auth";
import { supabase } from "@/lib/supabase";
import { TopBar } from "@/components/layout/TopBar";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { formatNumber } from "@/lib/utils";

const STATE_COLORS: Record<string, string> = {
  draft:  "secondary",
  active: "success",
  paused: "warning",
  ended:  "destructive",
};

const FUNDING_LABELS: Record<string, string> = {
  akiba:   "Akiba",
  sponsor: "Sponsor",
  miles:   "Miles",
  free:    "Free",
};

async function getPrograms() {
  const { data } = await supabase
    .from("v_program_inventory")
    .select(`
      program_id, program_name, state, total_cap, funding_type, sponsor,
      program_consumed, program_remaining, channel, channel_cap, channel_consumed, channel_active
    `)
    .order("program_id")
    .order("channel");

  // Group by program_id
  const byProgram = new Map<string, {
    program_id: string; program_name: string; state: string;
    total_cap: number | null; funding_type: string; sponsor: string | null;
    program_consumed: number; program_remaining: number | null;
    channels: Array<{ channel: string; channel_cap: number | null; channel_consumed: number; channel_active: boolean }>;
  }>();

  for (const row of (data ?? [])) {
    const r = row as Record<string, unknown>;
    const pid = r.program_id as string;
    if (!byProgram.has(pid)) {
      byProgram.set(pid, {
        program_id: pid,
        program_name: r.program_name as string,
        state: r.state as string,
        total_cap: r.total_cap as number | null,
        funding_type: r.funding_type as string,
        sponsor: r.sponsor as string | null,
        program_consumed: Number(r.program_consumed ?? 0),
        program_remaining: r.program_remaining != null ? Number(r.program_remaining) : null,
        channels: [],
      });
    }
    if (r.channel) {
      byProgram.get(pid)!.channels.push({
        channel:          r.channel as string,
        channel_cap:      r.channel_cap != null ? Number(r.channel_cap) : null,
        channel_consumed: Number(r.channel_consumed ?? 0),
        channel_active:   Boolean(r.channel_active),
      });
    }
  }
  return [...byProgram.values()];
}

export default async function AdminProgramsPage() {
  const session = await requireAdminSession("vouchers.read");
  if (!session) redirect("/login");

  const programs = await getPrograms();
  const actorId  = adminIdForWrite(session);

  return (
    <div>
      <TopBar
        title="Voucher Programs"
        subtitle="All active, paused and draft programs across merchants and Akiba"
      />
      <div className="p-6 space-y-4">
        {programs.length === 0 && (
          <Card>
            <CardContent className="py-10 text-center text-slate-400 text-sm">
              No voucher programs found. Create one from merchant-dashboard or via the Akiba grant tool.
            </CardContent>
          </Card>
        )}
        {programs.map((p) => (
          <Card key={p.program_id}>
            <CardHeader className="pb-3 flex flex-row items-start justify-between gap-4">
              <div>
                <CardTitle className="text-base">{p.program_name}</CardTitle>
                <p className="text-xs text-slate-400 mt-0.5">
                  {FUNDING_LABELS[p.funding_type] ?? p.funding_type}
                  {p.sponsor ? ` · ${p.sponsor}` : ""}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <Badge variant={(STATE_COLORS[p.state] ?? "secondary") as Parameters<typeof Badge>[0]["variant"]}>
                  {p.state}
                </Badge>
                {actorId && p.state !== "ended" && (
                  <StateActionButtons
                    programId={p.program_id}
                    currentState={p.state}
                    merchantUserId={actorId}
                    partnerId="00000000-0000-0000-0000-000000000000"
                  />
                )}
              </div>
            </CardHeader>
            <CardContent className="space-y-2">
              <div className="flex gap-6 text-sm">
                <span className="text-slate-500">
                  Cap: <strong>{p.total_cap != null ? formatNumber(p.total_cap) : "∞"}</strong>
                </span>
                <span className="text-slate-500">
                  Issued: <strong>{formatNumber(p.program_consumed)}</strong>
                </span>
                {p.program_remaining != null && (
                  <span className="text-slate-500">
                    Remaining: <strong>{formatNumber(p.program_remaining)}</strong>
                  </span>
                )}
              </div>
              {p.channels.length > 0 && (
                <div className="flex flex-wrap gap-2 mt-1">
                  {p.channels.map((ch) => (
                    <span key={ch.channel} className={`text-xs px-2 py-0.5 rounded-full border ${ch.channel_active ? "border-green-200 bg-green-50 text-green-700" : "border-slate-200 bg-slate-50 text-slate-400"}`}>
                      {ch.channel} {ch.channel_cap != null ? `${ch.channel_consumed}/${ch.channel_cap}` : `${ch.channel_consumed}`}
                    </span>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}

// Simple server-action-style state buttons (client-side fetch)
function StateActionButtons({ programId, currentState, merchantUserId, partnerId }: {
  programId: string; currentState: string; merchantUserId: string; partnerId: string;
}) {
  const transitions: Record<string, string[]> = {
    draft:  ["active"],
    active: ["paused", "ended"],
    paused: ["active", "ended"],
  };
  const next = transitions[currentState] ?? [];
  if (next.length === 0) return null;

  return (
    <div className="flex gap-1">
      {next.map((state) => (
        <form key={state} action={`/api/admin/programs/${programId}/state`} method="POST">
          <input type="hidden" name="state"              value={state} />
          <input type="hidden" name="merchant_user_id"   value={merchantUserId} />
          <input type="hidden" name="partner_id"         value={partnerId} />
          <button
            type="submit"
            className="text-xs px-2 py-1 rounded border border-slate-200 hover:bg-slate-50 capitalize"
          >
            {state}
          </button>
        </form>
      ))}
    </div>
  );
}
