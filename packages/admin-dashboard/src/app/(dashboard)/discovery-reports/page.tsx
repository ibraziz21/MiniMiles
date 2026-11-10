import Link from "next/link";
import { redirect, notFound } from "next/navigation";
import { ArrowLeft, ChevronRight, Flag } from "lucide-react";
import { PageHeader } from "@/components/shell/PageHeader";
import { QueueLoadError } from "@/components/queue/QueueLoadError";
import { DiscoveryPhotoPreview } from "@/components/discovery/DiscoveryPhotoActions";
import { DiscoveryReportActions } from "@/components/discovery/DiscoveryReportActions";
import { requireAdminSession, adminIdForWrite } from "@/lib/auth";
import { supabase } from "@/lib/supabase";
import { REPORT_REASONS } from "@/lib/discoveryReports";
import {
  moderationPage,
  moderationReturnPath,
  validModerationId,
} from "@/lib/moderationNavigation";
import { hasPermission } from "@/types";

export const dynamic = "force-dynamic";
type Report = {
  id: string;
  contribution_id: string;
  photo_id: string | null;
  reason_code: string;
  status: string;
  created_at: string;
  resolved_at: string | null;
  resolved_by: string | null;
  resolution_note: string | null;
};
type Card = {
  contribution_id: string;
  favorite_order: string | null;
  experience_option_ids: string[];
  template_snapshot: {
    experience_options?: Array<{ id: string; publicLabel: string }>;
  };
};
const date = (value: string) =>
  new Date(value).toLocaleString("en-KE", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Africa/Nairobi",
  }) + " EAT";
export default async function DiscoveryReportsPage({
  searchParams,
}: {
  searchParams: {
    status?: string;
    page?: string;
    report?: string;
    returnTo?: string;
  };
}) {
  const session = await requireAdminSession("discovery.read");
  if (!session) redirect("/login");
  const status = ["pending", "actioned", "dismissed"].includes(
    searchParams.status ?? ""
  )
    ? searchParams.status!
    : "pending";
  const page = moderationPage(searchParams.page);
  const selected = searchParams.report;
  if (selected && !validModerationId(selected)) notFound();
  const self = `/discovery-reports?status=${status}&page=${page}`;
  const back = moderationReturnPath(searchParams.returnTo, self);
  let query = supabase
    .from("merchant_verified_visit_reports")
    .select(
      "id,contribution_id,photo_id,reason_code,status,created_at,resolved_at,resolved_by,resolution_note",
      { count: "exact" }
    );
  query = selected
    ? query.eq("id", selected)
    : query
        .eq("status", status)
        .order("created_at", { ascending: status === "pending" })
        .order("id")
        .range((page - 1) * 25, page * 25 - 1);
  const queue = await query;
  const reports = (queue.data ?? []) as Report[];
  if (selected && !queue.error && !reports.length) notFound();
  const ids = [...new Set(reports.map((report) => report.contribution_id))];
  const visits = ids.length
    ? await supabase
        .from("merchant_discovery_contributions")
        .select("id,partner_id,suppressed_at,withdrawn_at")
        .in("id", ids)
    : { data: [], error: null };
  const partnerIds = [
    ...new Set((visits.data ?? []).map((visit) => visit.partner_id)),
  ];
  const [merchants, photos, ...cardResults] = await Promise.all([
    partnerIds.length
      ? supabase.from("partners").select("id,name").in("id", partnerIds)
      : Promise.resolve({ data: [], error: null }),
    ids.length
      ? supabase
          .from("merchant_visit_photos")
          .select("id,contribution_id,moderation_status,suppressed_at")
          .in("contribution_id", ids)
          .order("id")
      : Promise.resolve({ data: [], error: null }),
    ...partnerIds.map((id) =>
      supabase.rpc("eligible_public_merchant_visit_cards", { p_partner_id: id })
    ),
  ]);
  const cards = cardResults.flatMap((result) => (result.data ?? []) as Card[]);
  const failed = Boolean(
    queue.error ||
      visits.error ||
      merchants.error ||
      photos.error ||
      cardResults.some((result) => result.error)
  );
  const canWrite =
    hasPermission(session.role, "discovery.write") &&
    Boolean(adminIdForWrite(session));
  return (
    <>
      <PageHeader title={selected ? "Review report" : "Reported content"} />
      <div className="mx-auto max-w-3xl space-y-4 p-4 sm:p-6">
        <Link
          href={selected ? back : "/discovery-photos"}
          className="inline-flex min-h-11 items-center gap-2 rounded-control text-sm font-medium text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          {selected ? "Back to reviews" : "Photo reviews"}
        </Link>
        {!selected && (
          <nav aria-label="Report status" className="flex flex-wrap gap-2">
            {["pending", "actioned", "dismissed"].map((value) => (
              <Link
                key={value}
                href={`/discovery-reports?status=${value}`}
                aria-current={status === value ? "page" : undefined}
                className={`inline-flex min-h-11 items-center rounded-full px-4 text-sm capitalize focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${
                  status === value
                    ? "bg-primary text-white"
                    : "bg-white text-ink-muted"
                }`}
              >
                {value === "actioned" ? "Content hidden" : value}
              </Link>
            ))}
          </nav>
        )}
        {failed ? (
          <QueueLoadError />
        ) : !selected ? (
          <>
            <ul className="space-y-2">
              {reports.map((report) => (
                <li key={report.id}>
                  <Link
                    href={`/discovery-reports?report=${
                      report.id
                    }&returnTo=${encodeURIComponent(self)}`}
                    className="flex min-h-20 items-center gap-3 rounded-card border border-border bg-white p-4 hover:bg-surface-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                  >
                    <Flag
                      className="h-5 w-5 shrink-0 text-primary"
                      aria-hidden="true"
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block break-words font-medium text-ink">
                        {merchants.data?.find(
                          (merchant) =>
                            merchant.id ===
                            visits.data?.find(
                              (visit) => visit.id === report.contribution_id
                            )?.partner_id
                        )?.name ?? "Merchant unavailable"}
                      </span>
                      <span className="mt-1 block text-sm text-ink-muted">
                        {REPORT_REASONS[report.reason_code] ??
                          report.reason_code}
                      </span>
                      <span className="mt-1 block text-xs text-ink-muted">
                        {date(report.created_at)}
                      </span>
                    </span>
                    <ChevronRight
                      className="h-5 w-5 shrink-0 text-ink-muted"
                      aria-hidden="true"
                    />
                  </Link>
                </li>
              ))}
            </ul>
            {!reports.length && (
              <p className="rounded-card border border-border bg-white p-8 text-center text-base text-ink-muted">
                No {status} reports.
              </p>
            )}
            <nav
              aria-label="Report pages"
              className="flex items-center justify-between gap-3 text-sm"
            >
              {page > 1 ? (
                <Link
                  href={`/discovery-reports?status=${status}&page=${page - 1}`}
                  className="inline-flex min-h-11 items-center text-primary underline"
                >
                  Previous
                </Link>
              ) : (
                <span />
              )}
              <span className="text-ink-muted">
                Page {page} · {queue.count ?? 0} reports
              </span>
              {page * 25 < (queue.count ?? 0) ? (
                <Link
                  href={`/discovery-reports?status=${status}&page=${page + 1}`}
                  className="inline-flex min-h-11 items-center text-primary underline"
                >
                  Next
                </Link>
              ) : (
                <span />
              )}
            </nav>
          </>
        ) : (
          reports.map((report) => {
            const visit = visits.data?.find(
              (visit) => visit.id === report.contribution_id
            );
            const card = cards.find(
              (card) => card.contribution_id === report.contribution_id
            );
            const images =
              photos.data?.filter(
                (photo) => photo.contribution_id === report.contribution_id
              ) ?? [];
            const reported = images.filter(
              (photo) => photo.id === report.photo_id
            );
            const labels =
              card?.experience_option_ids.map(
                (id) =>
                  card.template_snapshot?.experience_options?.find(
                    (option) => option.id === id
                  )?.publicLabel ?? id
              ) ?? [];
            return (
              <article key={report.id} className="space-y-5">
                <header>
                  <h2 className="break-words text-xl font-semibold text-ink">
                    {merchants.data?.find(
                      (merchant) => merchant.id === visit?.partner_id
                    )?.name ?? "Merchant unavailable"}
                  </h2>
                  <p className="mt-1 text-sm text-ink-muted">
                    Reported {date(report.created_at)} · {report.status}
                  </p>
                </header>
                <section className="border-t border-border pt-4">
                  <h3 className="text-lg font-semibold text-ink">
                    Reported content
                  </h3>
                  {card?.favorite_order && (
                    <p className="mt-3 break-words text-base leading-relaxed text-ink">
                      Favourite order: {card.favorite_order}
                    </p>
                  )}
                  {labels.length > 0 && (
                    <p className="mt-2 break-words text-base text-ink-muted">
                      {labels.join(", ")}
                    </p>
                  )}
                  {!card && (
                    <p className="mt-3 text-sm text-ink-muted">
                      Public visit text is unavailable.
                    </p>
                  )}
                  <div className="mt-4 space-y-3">
                    {reported.map((photo) => (
                      <DiscoveryPhotoPreview
                        key={photo.id}
                        photoId={photo.id}
                        large
                        reviewLink
                      />
                    ))}
                  </div>
                </section>
                <section className="border-t border-border pt-4">
                  <h3 className="text-lg font-semibold text-ink">
                    Report reason
                  </h3>
                  <p className="mt-2 text-base text-ink-muted">
                    {REPORT_REASONS[report.reason_code] ?? report.reason_code}
                  </p>
                </section>
                <details className="rounded-card border border-border bg-white p-4">
                  <summary className="flex min-h-11 cursor-pointer items-center text-sm font-medium text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">
                    More details
                  </summary>
                  <p className="mt-2 text-sm text-ink-muted">
                    {visit?.suppressed_at
                      ? "Visit hidden by moderation"
                      : visit?.withdrawn_at
                      ? "Visit withdrawn by member"
                      : card
                      ? "Visit is eligible for public discovery"
                      : "Visit is not currently publicly eligible"}
                  </p>
                  <div className="mt-3 flex flex-wrap gap-3">
                    {images
                      .filter((photo) => photo.id !== report.photo_id)
                      .map((photo) => (
                        <DiscoveryPhotoPreview
                          key={photo.id}
                          photoId={photo.id}
                          reviewLink
                        />
                      ))}
                  </div>
                  {report.resolved_at && (
                    <p className="mt-3 break-words text-sm text-ink-muted">
                      Resolved {date(report.resolved_at)} ·{" "}
                      {report.resolution_note}
                    </p>
                  )}
                </details>
                {report.status === "pending" ? (
                  canWrite ? (
                    <DiscoveryReportActions
                      reportId={report.id}
                      hasPhoto={reported.length > 0}
                    />
                  ) : (
                    <p className="text-sm text-ink-muted">
                      Read-only access. A named moderator is required to resolve
                      reports.
                    </p>
                  )
                ) : (
                  <p className="text-sm text-ink-muted">
                    This report has been resolved.
                  </p>
                )}
              </article>
            );
          })
        )}
      </div>
    </>
  );
}
