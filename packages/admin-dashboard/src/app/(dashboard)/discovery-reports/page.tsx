import Link from "next/link";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/shell/PageHeader";
import { DiscoveryPhotoPreview } from "@/components/discovery/DiscoveryPhotoActions";
import { DiscoveryReportActions } from "@/components/discovery/DiscoveryReportActions";
import { requireAdminSession, adminIdForWrite } from "@/lib/auth";
import { supabase } from "@/lib/supabase";
import { REPORT_REASONS } from "@/lib/discoveryReports";
import { hasPermission } from "@/types";

export const dynamic = "force-dynamic";
const LIMIT = 25;
const STATUSES = ["pending", "actioned", "dismissed"] as const;
type Report = { id: string; contribution_id: string; photo_id: string | null; reason_code: string; status: string; created_at: string; resolved_at: string | null; resolved_by: string | null; resolution_note: string | null };
const date = (value: string) => new Date(value).toLocaleString("en-GB", { timeZone: "Africa/Nairobi" });

export default async function DiscoveryReportsPage({ searchParams }: { searchParams: { status?: string; page?: string } }) {
  const session = await requireAdminSession("discovery.read");
  if (!session) redirect("/login");
  const status = STATUSES.find(s => s === searchParams.status) ?? "pending";
  const parsedPage = Number(searchParams.page ?? 1);
  const page = Number.isSafeInteger(parsedPage) && parsedPage > 0 && parsedPage <= 10000 ? parsedPage : 1;
  const canWrite = hasPermission(session.role, "discovery.write") && Boolean(adminIdForWrite(session));
  const [queue, pending, oldest] = await Promise.all([
    supabase.from("merchant_verified_visit_reports").select("id,contribution_id,photo_id,reason_code,status,created_at,resolved_at,resolved_by,resolution_note", { count: "exact" }).eq("status", status).order("created_at", { ascending: status === "pending" }).order("id").range((page-1)*LIMIT, page*LIMIT-1),
    supabase.from("merchant_verified_visit_reports").select("id", { count: "exact", head: true }).eq("status", "pending"),
    supabase.from("merchant_verified_visit_reports").select("created_at").eq("status", "pending").order("created_at").limit(1),
  ]);
  const reports = (queue.data ?? []) as Report[];
  const ids = [...new Set(reports.map(r => r.contribution_id))];
  const visits = ids.length ? await supabase.from("merchant_discovery_contributions").select("id,partner_id,experience_option_ids,suppressed_at,withdrawn_at").in("id", ids) : { data: [], error: null };
  const partnerIds = [...new Set((visits.data ?? []).map(v => v.partner_id))];
  const cardResults = await Promise.all(partnerIds.map(id => supabase.rpc("eligible_public_merchant_visit_cards", { p_partner_id: id })));
  type Card = { contribution_id: string; favorite_order: string | null; experience_option_ids: string[]; template_snapshot: { experience_options?: { id: string; publicLabel: string }[] } };
  const cards = cardResults.flatMap(result => (result.data ?? []) as Card[]);
  const photos = ids.length ? await supabase.from("merchant_visit_photos").select("id,contribution_id,moderation_status,suppressed_at").in("contribution_id", ids).order("id") : { data: [], error: null };
  const merchants = partnerIds.length ? await supabase.from("partners").select("id,name").in("id", partnerIds) : { data: [], error: null };
  const failed = queue.error || pending.error || oldest.error || visits.error || cardResults.some(r => r.error) || photos.error || merchants.error;
  const next = (queue.count ?? 0) > page*LIMIT;
  return <>
    <PageHeader title="Content reports" subtitle="Review member reports and record moderation decisions" />
    <div className="mx-auto w-full max-w-5xl space-y-5 p-4 sm:p-6">
      <p className="text-sm text-ink-muted">Pending reports: <strong className="text-ink">{pending.error ? "Unavailable" : pending.count ?? 0}</strong>{oldest.data?.[0] && <> · Oldest received {date(oldest.data[0].created_at)} EAT</>}</p>
      <nav aria-label="Report status" className="flex flex-wrap gap-2">{STATUSES.map(s => <Link key={s} href={`/discovery-reports?status=${s}`} aria-current={s === status ? "page" : undefined} className={`inline-flex min-h-11 items-center rounded-control border px-4 text-sm capitalize focus-visible:outline-primary ${s === status ? "border-primary bg-primary text-white" : "border-border bg-surface text-ink"}`}>{s}</Link>)}</nav>
      {!canWrite && <p className="text-sm text-ink-muted">Read-only view. A named admin with discovery write permission can resolve reports.</p>}
      {failed ? <div role="alert" className="rounded-panel border border-danger p-4"><p>Reports could not be loaded. No decisions have been changed.</p><Link className="inline-flex min-h-11 items-center text-primary underline" href={`/discovery-reports?status=${status}&page=${page}`}>Retry loading reports</Link></div> : <>
        {!reports.length && <p className="rounded-panel border border-border bg-surface p-6">No {status} reports on this page.</p>}
        {reports.map(report => {
          const visit = visits.data?.find(v => v.id === report.contribution_id);
          const card = cards.find(c => c.contribution_id === report.contribution_id);
          const labels = card?.experience_option_ids.map(id => card.template_snapshot?.experience_options?.find(option => option.id === id)?.publicLabel ?? id) ?? visit?.experience_option_ids ?? [];
          const images = photos.data?.filter(p => p.contribution_id === report.contribution_id) ?? [];
          return <article key={report.id} aria-label={`Report: ${REPORT_REASONS[report.reason_code] ?? report.reason_code}`} className="space-y-4 overflow-hidden rounded-panel border border-border bg-surface p-4 sm:p-5">
            <header><h2 className="text-lg font-semibold">{REPORT_REASONS[report.reason_code] ?? report.reason_code}</h2><p className="text-sm text-ink-muted">Reported {date(report.created_at)} EAT</p></header>
            <p className="break-words text-sm font-medium">{merchants.data?.find(m => m.id === visit?.partner_id)?.name ?? "Merchant unavailable"}</p>
            <p className="break-all text-xs text-ink-muted">Visit {report.contribution_id}</p>
            <p className="text-sm">{visit?.suppressed_at ? "Visit hidden by moderation" : visit?.withdrawn_at ? "Visit withdrawn by member" : card ? "Visit currently eligible for public discovery" : "Visit is not currently publicly eligible"}</p>
            {card?.favorite_order && <p className="break-words text-sm">Favourite order: {card.favorite_order}</p>}
            {labels.length > 0 && <p className="break-words text-sm">Experience: {labels.join(", ")}</p>}
            <div className="flex flex-wrap gap-4">{images.map(photo => <figure key={photo.id} className="w-32 space-y-1"><DiscoveryPhotoPreview photoId={photo.id} reviewLink /><figcaption className="text-xs text-ink-muted">{photo.id === report.photo_id ? "Reported photo · " : ""}{photo.suppressed_at ? "Hidden" : photo.moderation_status}</figcaption></figure>)}</div>
            {report.status === "pending" && canWrite ? <DiscoveryReportActions reportId={report.id} hasPhoto={Boolean(report.photo_id && images.some(p => p.id === report.photo_id))} /> : report.resolved_at && <div className="space-y-1 border-t border-border pt-3 text-sm"><p>{report.status} {date(report.resolved_at)} EAT</p><p className="break-all">Moderator: {report.resolved_by}</p><p className="break-all">Decision: {report.resolution_note}</p></div>}
          </article>;
        })}
        <nav aria-label="Report pages" className="flex min-h-11 items-center justify-between gap-4">
          {page > 1 ? <Link className="inline-flex min-h-11 items-center text-primary underline" href={`/discovery-reports?status=${status}&page=${page-1}`}>Previous page</Link> : <span />}
          <span className="text-sm">Page {page} · {queue.count ?? 0} reports</span>
          {next ? <Link className="inline-flex min-h-11 items-center text-primary underline" href={`/discovery-reports?status=${status}&page=${page+1}`}>Next page</Link> : <span />}
        </nav>
      </>}
    </div>
  </>;
}
