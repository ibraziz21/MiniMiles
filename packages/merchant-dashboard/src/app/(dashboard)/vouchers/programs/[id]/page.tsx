import { requireMerchantSession } from "@/lib/auth";
import { supabase } from "@/lib/supabase";
import { redirect, notFound } from "next/navigation";
import { TopBar } from "@/components/layout/TopBar";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import ProgramActions from "./ProgramActions";
import SettlementTermsForm from "./SettlementTermsForm";

const STATE_COLORS: Record<string, string> = {
  draft:  "bg-gray-100 text-gray-600",
  active: "bg-green-100 text-green-700",
  paused: "bg-yellow-100 text-yellow-700",
  ended:  "bg-red-100 text-red-600",
};

const CHANNEL_LABELS: Record<string, string> = {
  miles_purchase: "Miles Purchase",
  claw:           "Claw Game",
  raffle:         "Raffle",
  giveaway:       "Giveaway",
  merchant_grant: "Merchant Grant",
  akiba_grant:    "Akiba Grant",
};

// Valid state transitions
const TRANSITIONS: Record<string, string[]> = {
  draft:  ["active"],
  active: ["paused", "ended"],
  paused: ["active", "ended"],
  ended:  [],
};

interface InventoryRow {
  channel:           string;
  channel_cap:       number | null;
  channel_consumed:  number;
  channel_remaining: number | null;
  channel_active:    boolean;
}

interface AuditRow {
  id:               string;
  action:           string;
  merchant_user_id: string;
  metadata:         Record<string, unknown> | null;
  created_at:       string;
}

export default async function ProgramDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await requireMerchantSession();
  if (!session) redirect("/login");

  const canEdit = ["owner", "manager"].includes(session.role);

  // Fetch program with template to verify merchant ownership
  const { data: program } = await supabase
    .from("voucher_programs")
    .select(`
      id, name, state, total_cap, funding_type, sponsor, start_at, end_at, created_at,
      spend_voucher_templates ( id, title, partner_id )
    `)
    .eq("id", id)
    .maybeSingle();

  if (!program) notFound();

  const tmpl = program.spend_voucher_templates as unknown as { id: string; title: string; partner_id: string } | null;
  if (!tmpl || tmpl.partner_id !== session.partnerId) notFound();

  // Fetch inventory from view
  const { data: inventoryRows } = await supabase
    .from("v_program_inventory")
    .select("channel,channel_cap,channel_consumed,channel_remaining,channel_active")
    .eq("program_id", id);

  const channels = (inventoryRows ?? []) as InventoryRow[];
  const { data: settlementTerms } = await supabase
    .from("voucher_program_settlement_terms")
    .select("funding_party_type,funding_party_reference,settlement_currency,reimbursement_rate,active")
    .eq("program_id", id)
    .maybeSingle();

  // Total consumed
  const totalConsumed = channels.reduce((sum, ch) => sum + (ch.channel_consumed ?? 0), 0);

  // Fetch audit log
  const { data: auditRows } = await supabase
    .from("merchant_audit_log")
    .select("id,action,merchant_user_id,metadata,created_at")
    .eq("partner_id", session.partnerId)
    .ilike("action", "program.%")
    .order("created_at", { ascending: false })
    .limit(20);

  const audit = (auditRows ?? []) as AuditRow[];
  const nextStates = TRANSITIONS[program.state] ?? [];

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <TopBar
        title={program.name}
        subtitle={`Template: ${tmpl.title}`}
        actions={
          canEdit && nextStates.length > 0 ? (
            <ProgramActions programId={id} currentState={program.state} nextStates={nextStates} />
          ) : undefined
        }
      />

      <div className="flex-1 overflow-y-auto p-6 space-y-5">
        {/* Overview */}
        <Card>
          <CardHeader><CardTitle className="text-base">Overview</CardTitle></CardHeader>
          <CardContent className="grid grid-cols-2 gap-4 text-sm">
            <div>
              <p className="text-xs text-gray-400 uppercase tracking-wide">Status</p>
              <span className={`inline-block mt-1 text-xs px-2 py-0.5 rounded-full font-medium capitalize ${STATE_COLORS[program.state] ?? ""}`}>
                {program.state}
              </span>
            </div>
            <div>
              <p className="text-xs text-gray-400 uppercase tracking-wide">Total Cap</p>
              <p className="mt-1 font-medium">{program.total_cap ?? "Unlimited"}</p>
            </div>
            <div>
              <p className="text-xs text-gray-400 uppercase tracking-wide">Consumed</p>
              <p className="mt-1 font-medium">{totalConsumed}</p>
            </div>
            <div>
              <p className="text-xs text-gray-400 uppercase tracking-wide">Remaining</p>
              <p className="mt-1 font-medium">
                {program.total_cap != null ? Math.max(0, program.total_cap - totalConsumed) : "∞"}
              </p>
            </div>
            <div>
              <p className="text-xs text-gray-400 uppercase tracking-wide">Start</p>
              <p className="mt-1">{program.start_at ? new Date(program.start_at).toLocaleDateString() : "Immediately"}</p>
            </div>
            <div>
              <p className="text-xs text-gray-400 uppercase tracking-wide">End</p>
              <p className="mt-1">{program.end_at ? new Date(program.end_at).toLocaleDateString() : "No end"}</p>
            </div>
            {program.sponsor && (
              <div className="col-span-2">
                <p className="text-xs text-gray-400 uppercase tracking-wide">Sponsor</p>
                <p className="mt-1">{program.sponsor}</p>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-base">Settlement Terms</CardTitle></CardHeader>
          <CardContent>
            {canEdit && program.state === "draft" ? (
              <SettlementTermsForm
                programId={id}
                initial={{
                  funding_party_type: (settlementTerms?.funding_party_type ?? "merchant") as "merchant" | "sponsor" | "none",
                  funding_party_reference: settlementTerms?.funding_party_reference ?? null,
                  reimbursement_rate: Number(settlementTerms?.reimbursement_rate ?? 1),
                }}
              />
            ) : (
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div><p className="text-xs text-gray-400">Funding party</p><p className="capitalize">{settlementTerms?.funding_party_type ?? "Not configured"}</p></div>
                <div><p className="text-xs text-gray-400">Reimbursement rate</p><p>{settlementTerms ? `${Number(settlementTerms.reimbursement_rate) * 100}%` : "—"}</p></div>
                <div><p className="text-xs text-gray-400">Currency</p><p>{settlementTerms?.settlement_currency ?? "—"}</p></div>
                <div><p className="text-xs text-gray-400">Reference</p><p>{settlementTerms?.funding_party_reference ?? "—"}</p></div>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Channel inventory */}
        <Card>
          <CardHeader><CardTitle className="text-base">Channel Inventory</CardTitle></CardHeader>
          <CardContent>
            {channels.length === 0 ? (
              <p className="text-sm text-gray-400">No channels configured.</p>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-100 text-left text-xs text-gray-400 uppercase tracking-wide">
                    <th className="pb-2 pr-4">Channel</th>
                    <th className="pb-2 pr-4">Cap</th>
                    <th className="pb-2 pr-4">Used</th>
                    <th className="pb-2 pr-4">Remaining</th>
                    <th className="pb-2">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {channels.map((ch) => (
                    <tr key={ch.channel} className="border-b border-gray-50 last:border-0">
                      <td className="py-2 pr-4 font-medium text-gray-700">
                        {CHANNEL_LABELS[ch.channel] ?? ch.channel}
                      </td>
                      <td className="py-2 pr-4 text-gray-500">{ch.channel_cap ?? "∞"}</td>
                      <td className="py-2 pr-4">{ch.channel_consumed}</td>
                      <td className="py-2 pr-4">{ch.channel_remaining != null ? ch.channel_remaining : "∞"}</td>
                      <td className="py-2">
                        <span className={`text-xs px-2 py-0.5 rounded-full ${ch.channel_active ? "bg-green-50 text-green-600" : "bg-gray-100 text-gray-400"}`}>
                          {ch.channel_active ? "Active" : "Paused"}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </CardContent>
        </Card>

        {/* Audit log */}
        {audit.length > 0 && (
          <Card>
            <CardHeader><CardTitle className="text-base">Audit Log</CardTitle></CardHeader>
            <CardContent className="space-y-2">
              {audit.map((a) => (
                <div key={a.id} className="flex items-start gap-3 text-xs">
                  <span className="text-gray-400 shrink-0">
                    {new Date(a.created_at).toLocaleString("en-KE")}
                  </span>
                  <span className="font-medium text-gray-700 capitalize">{a.action.replace(/\./g, " · ")}</span>
                  {a.metadata && (
                    <span className="text-gray-400 truncate max-w-xs">
                      {JSON.stringify(a.metadata)}
                    </span>
                  )}
                </div>
              ))}
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
