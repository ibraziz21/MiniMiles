import { redirect } from "next/navigation";
import {
  Building2,
  ExternalLink,
  Mail,
  Megaphone,
  MessageSquare,
  Store,
} from "lucide-react";
import { requireAdminSession } from "@/lib/auth";
import { supabase } from "@/lib/supabase";
import { formatDateTime } from "@/lib/utils";
import { TopBar } from "@/components/layout/TopBar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { LeadStatusSelect } from "@/components/leads/LeadStatusSelect";

type LeadKind = "partner" | "merchant";
type LeadStatus = "new" | "contacted" | "qualified" | "closed";

type BusinessLead = {
  id: string;
  name: string;
  email: string;
  company: string;
  country: string;
  role: string | null;
  website: string | null;
  message: string;
  source: string;
  status: LeadStatus;
  created_at: string;
};

type LeadResult = {
  leads: BusinessLead[];
  error: string | null;
};

const leadSelect =
  "id, name, email, company, country, role, website, message, source, status, created_at";

async function getLeads(tableName: "partner_leads" | "merchant_leads"): Promise<LeadResult> {
  const { data, error } = await supabase
    .from(tableName)
    .select(leadSelect)
    .order("created_at", { ascending: false })
    .limit(100);

  if (error) {
    return {
      leads: [],
      error: `${tableName}: ${error.message}`,
    };
  }

  return {
    leads: (data ?? []) as BusinessLead[],
    error: null,
  };
}

function countOpen(leads: BusinessLead[]) {
  return leads.filter((lead) => lead.status !== "closed").length;
}

function countNew(leads: BusinessLead[]) {
  return leads.filter((lead) => lead.status === "new").length;
}

export default async function LeadsPage() {
  const session = await requireAdminSession("leads.read");
  if (!session) redirect("/login");

  const [partnerResult, merchantResult] = await Promise.all([
    getLeads("partner_leads"),
    getLeads("merchant_leads"),
  ]);

  const totalLeads = partnerResult.leads.length + merchantResult.leads.length;
  const totalOpen = countOpen(partnerResult.leads) + countOpen(merchantResult.leads);
  const errors = [partnerResult.error, merchantResult.error].filter(Boolean);

  return (
    <div>
      <TopBar
        title="Lead Inbox"
        subtitle={`${totalOpen} open lead${totalOpen !== 1 ? "s" : ""} from website forms`}
      />

      <div className="space-y-6 p-6">
        {errors.length > 0 ? (
          <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
            Apply the website lead SQL migrations, then refresh this page.
            <div className="mt-1 font-mono text-xs">{errors.join(" | ")}</div>
          </div>
        ) : null}

        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <LeadStat
            label="Total leads"
            value={totalLeads}
            sub="Latest 100 from each table"
            icon={MessageSquare}
          />
          <LeadStat
            label="Open leads"
            value={totalOpen}
            sub="Not closed"
            icon={Mail}
          />
          <LeadStat
            label="Partner new"
            value={countNew(partnerResult.leads)}
            sub="Campaign inquiries"
            icon={Megaphone}
          />
          <LeadStat
            label="Merchant new"
            value={countNew(merchantResult.leads)}
            sub="Store inquiries"
            icon={Store}
          />
        </div>

        <LeadTable
          kind="partner"
          title="Partner Leads"
          description="Growth tests, partner quests, sponsored raffles, and campaign inquiries."
          leads={partnerResult.leads}
        />

        <LeadTable
          kind="merchant"
          title="Merchant Leads"
          description="Store listings, voucher campaigns, fulfilment coverage, and merchant setup inquiries."
          leads={merchantResult.leads}
        />
      </div>
    </div>
  );
}

function LeadStat({
  label,
  value,
  sub,
  icon: Icon,
}: {
  label: string;
  value: number;
  sub: string;
  icon: React.ElementType;
}) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm font-medium text-slate-500">{label}</CardTitle>
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#238D9D]/10">
            <Icon className="h-4 w-4 text-[#238D9D]" />
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <p className="text-2xl font-bold text-slate-900">{value}</p>
        <p className="mt-1 text-xs text-slate-500">{sub}</p>
      </CardContent>
    </Card>
  );
}

function LeadTable({
  kind,
  title,
  description,
  leads,
}: {
  kind: LeadKind;
  title: string;
  description: string;
  leads: BusinessLead[];
}) {
  const Icon = kind === "partner" ? Megaphone : Store;

  return (
    <section className="rounded-xl border border-slate-200 bg-white">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-5 py-4">
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-slate-100">
            <Icon className="h-5 w-5 text-slate-500" />
          </div>
          <div>
            <h2 className="font-semibold text-slate-950">{title}</h2>
            <p className="mt-1 text-sm text-slate-500">{description}</p>
          </div>
        </div>
        <Badge variant="secondary">{leads.length} total</Badge>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-100 bg-slate-50 text-xs font-medium uppercase tracking-wider text-slate-400">
              <th className="w-[28%] px-4 py-3 text-left">Lead</th>
              <th className="w-[28%] px-4 py-3 text-left">Message</th>
              <th className="px-4 py-3 text-left">Submitted</th>
              <th className="px-4 py-3 text-left">Status</th>
              <th className="px-4 py-3 text-right">Action</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {leads.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-slate-400">
                  No {kind} leads yet.
                </td>
              </tr>
            ) : null}

            {leads.map((lead) => (
              <tr key={lead.id} className="align-top transition-colors hover:bg-slate-50">
                <td className="px-4 py-4">
                  <div className="flex items-start gap-3">
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[#238D9D]/10">
                      <Building2 className="h-4 w-4 text-[#238D9D]" />
                    </div>
                    <div className="min-w-0">
                      <p className="font-medium text-slate-950">{lead.company}</p>
                      <p className="mt-0.5 text-xs text-slate-500">
                        {lead.name}
                        {lead.role ? `, ${lead.role}` : ""}
                      </p>
                      <p className="mt-0.5 text-xs text-slate-400">{lead.country}</p>
                      {lead.website ? (
                        <a
                          href={normalizeUrl(lead.website)}
                          target="_blank"
                          rel="noreferrer"
                          className="mt-1 inline-flex items-center gap-1 text-xs font-medium text-[#238D9D] hover:underline"
                        >
                          Website <ExternalLink className="h-3 w-3" />
                        </a>
                      ) : null}
                    </div>
                  </div>
                </td>
                <td className="px-4 py-4">
                  <p className="max-w-xl whitespace-pre-wrap text-sm leading-6 text-slate-600">
                    {lead.message}
                  </p>
                  <p className="mt-2 text-xs text-slate-400">{lead.source}</p>
                </td>
                <td className="px-4 py-4 text-sm text-slate-500">
                  {formatDateTime(lead.created_at)}
                </td>
                <td className="px-4 py-4">
                  <div className="space-y-2">
                    <StatusBadge status={lead.status} />
                    <LeadStatusSelect
                      kind={kind}
                      leadId={lead.id}
                      initialStatus={lead.status}
                    />
                  </div>
                </td>
                <td className="px-4 py-4 text-right">
                  <Button asChild size="sm">
                    <a href={mailtoHref(kind, lead)}>
                      <Mail className="h-3.5 w-3.5" />
                      Email
                    </a>
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function StatusBadge({ status }: { status: LeadStatus }) {
  const variant =
    status === "new"
      ? "default"
      : status === "contacted"
        ? "warning"
        : status === "qualified"
          ? "success"
          : "secondary";

  return (
    <Badge variant={variant} className="capitalize">
      {status}
    </Badge>
  );
}

function mailtoHref(kind: LeadKind, lead: BusinessLead) {
  const subject =
    kind === "partner"
      ? "AkibaMiles partner campaign inquiry"
      : "AkibaMiles merchant setup inquiry";
  const body = [
    `Hi ${lead.name},`,
    "",
    "Thanks for reaching out to AkibaMiles. I wanted to follow up on your inquiry.",
    "",
    `Company: ${lead.company}`,
    `Country: ${lead.country}`,
    "",
  ].join("\n");

  return `mailto:${lead.email}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

function normalizeUrl(value: string) {
  if (value.startsWith("http://") || value.startsWith("https://")) return value;
  return `https://${value}`;
}
