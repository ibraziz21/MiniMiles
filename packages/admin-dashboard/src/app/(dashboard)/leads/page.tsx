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
import { PageHeader } from "@/components/shell/PageHeader";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { MetricCard } from "@/components/ui/metric-card";
import { EmptyState } from "@/components/ui/empty-state";
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
      <PageHeader
        title="Lead Inbox"
        subtitle={`${totalOpen} open lead${totalOpen !== 1 ? "s" : ""} from website forms`}
      />

      <div className="space-y-6 p-4 sm:p-6">
        {errors.length > 0 ? (
          <div className="rounded-card border border-warning/30 bg-warning/5 px-4 py-3 text-sm text-warning">
            Apply the website lead SQL migrations, then refresh this page.
            <div className="mt-1 font-mono text-xs">{errors.join(" | ")}</div>
          </div>
        ) : null}

        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <MetricCard label="Total leads" value={String(totalLeads)} sub="Latest 100 from each table" icon={MessageSquare} />
          <MetricCard label="Open leads" value={String(totalOpen)} sub="Not closed" icon={Mail} />
          <MetricCard label="Partner new" value={String(countNew(partnerResult.leads))} sub="Campaign inquiries" icon={Megaphone} />
          <MetricCard label="Merchant new" value={String(countNew(merchantResult.leads))} sub="Merchant inquiries" icon={Store} />
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
          description="Voucher programs, Miles distribution, redemption, and merchant account inquiries."
          leads={merchantResult.leads}
        />
      </div>
    </div>
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
    <section className="rounded-card border border-border bg-surface">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-5 py-4">
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-control bg-surface-subtle">
            <Icon className="h-5 w-5 text-ink-muted" />
          </div>
          <div>
            <h2 className="font-semibold text-ink">{title}</h2>
            <p className="mt-1 text-sm text-ink-muted">{description}</p>
          </div>
        </div>
        <Badge variant="secondary">{leads.length} total</Badge>
      </div>

      {leads.length === 0 ? (
        <EmptyState message={`No ${kind} leads yet.`} isHealthy className="border-0" />
      ) : (
        <>
          {/* Mobile: cards */}
          <div className="space-y-3 p-4 lg:hidden">
            {leads.map((lead) => (
              <div key={lead.id} className="rounded-card border border-border p-3">
                <div className="flex items-start gap-3">
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-control bg-primary/10">
                    <Building2 className="h-4 w-4 text-primary" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="font-medium text-ink">{lead.company}</p>
                    <p className="mt-0.5 text-xs text-ink-muted">
                      {lead.name}
                      {lead.role ? `, ${lead.role}` : ""} · {lead.country}
                    </p>
                  </div>
                  <StatusBadge status={lead.status} />
                </div>
                <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-ink-muted">{lead.message}</p>
                <p className="mt-1 text-xs text-ink-muted">{lead.source} · {formatDateTime(lead.created_at)}</p>
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <LeadStatusSelect kind={kind} leadId={lead.id} initialStatus={lead.status} />
                  <Button asChild size="sm">
                    <a href={mailtoHref(kind, lead)}>
                      <Mail className="h-3.5 w-3.5" />
                      Email
                    </a>
                  </Button>
                  {lead.website && (
                    <a
                      href={normalizeUrl(lead.website)}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
                    >
                      Website <ExternalLink className="h-3 w-3" />
                    </a>
                  )}
                </div>
              </div>
            ))}
          </div>

          {/* Desktop: table */}
          <div className="hidden overflow-x-auto lg:block">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-surface-subtle text-xs font-medium uppercase tracking-wider text-ink-muted">
                  <th className="w-[28%] px-4 py-3 text-left">Lead</th>
                  <th className="w-[28%] px-4 py-3 text-left">Message</th>
                  <th className="px-4 py-3 text-left">Submitted</th>
                  <th className="px-4 py-3 text-left">Status</th>
                  <th className="px-4 py-3 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {leads.map((lead) => (
                  <tr key={lead.id} className="align-top transition-colors hover:bg-surface-subtle">
                    <td className="px-4 py-4">
                      <div className="flex items-start gap-3">
                        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-control bg-primary/10">
                          <Building2 className="h-4 w-4 text-primary" />
                        </div>
                        <div className="min-w-0">
                          <p className="font-medium text-ink">{lead.company}</p>
                          <p className="mt-0.5 text-xs text-ink-muted">
                            {lead.name}
                            {lead.role ? `, ${lead.role}` : ""}
                          </p>
                          <p className="mt-0.5 text-xs text-ink-muted">{lead.country}</p>
                          {lead.website ? (
                            <a
                              href={normalizeUrl(lead.website)}
                              target="_blank"
                              rel="noreferrer"
                              className="mt-1 inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
                            >
                              Website <ExternalLink className="h-3 w-3" />
                            </a>
                          ) : null}
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-4">
                      <p className="max-w-xl whitespace-pre-wrap text-sm leading-6 text-ink-muted">
                        {lead.message}
                      </p>
                      <p className="mt-2 text-xs text-ink-muted">{lead.source}</p>
                    </td>
                    <td className="px-4 py-4 text-sm text-ink-muted">
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
        </>
      )}
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
