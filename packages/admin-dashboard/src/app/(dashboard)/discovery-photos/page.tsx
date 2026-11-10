import Link from "next/link";
import { redirect, notFound } from "next/navigation";
import { ArrowLeft, ChevronRight, ImageIcon } from "lucide-react";
import { PageHeader } from "@/components/shell/PageHeader";
import { QueueLoadError } from "@/components/queue/QueueLoadError";
import {
  DiscoveryPhotoActions,
  DiscoveryPhotoPreview,
  DiscoverySuppressionActions,
} from "@/components/discovery/DiscoveryPhotoActions";
import { requireAdminSession } from "@/lib/auth";
import { supabase } from "@/lib/supabase";
import { hasPermission } from "@/types";
import {
  moderationReturnPath,
  moderationPage,
  validModerationId,
} from "@/lib/moderationNavigation";

type Photo = {
  id: string;
  submitted_at: string;
  approved_at: string | null;
  suppressed_at: string | null;
  moderation_status: string;
  partners: { name: string } | null;
};
const fields =
  "id, submitted_at, approved_at, suppressed_at, moderation_status, partners!inner(name)";
const date = (value: string) =>
  new Date(value).toLocaleString("en-KE", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Africa/Nairobi",
  }) + " EAT";
export default async function DiscoveryPhotosPage({
  searchParams,
}: {
  searchParams: {
    photo?: string;
    tab?: string;
    q?: string;
    page?: string;
    returnTo?: string;
  };
}) {
  const session = await requireAdminSession("discovery.read");
  if (!session) redirect("/login");
  const canWrite = hasPermission(session.role, "discovery.write");
  const tab = searchParams.tab === "reviewed" ? "reviewed" : "pending";
  const page = moderationPage(searchParams.page);
  const q = (searchParams.q ?? "").trim().slice(0, 100);
  const params = new URLSearchParams();
  if (tab !== "pending") params.set("tab", tab);
  if (q) params.set("q", q);
  if (page > 1) params.set("page", String(page));
  const self = `/discovery-photos${params.size ? `?${params}` : ""}`;
  const back = moderationReturnPath(searchParams.returnTo, self);
  if (searchParams.photo) {
    if (!validModerationId(searchParams.photo)) notFound();
    const { data, error } = await supabase
      .from("merchant_visit_photos")
      .select(fields)
      .eq("id", searchParams.photo)
      .maybeSingle();
    if (error)
      return (
        <>
          <PageHeader title="Review photo" />
          <div className="p-4">
            <QueueLoadError />
          </div>
        </>
      );
    if (!data) notFound();
    const photo = data as unknown as Photo;
    return (
      <>
        <PageHeader title="Review photo" />
        <div className="mx-auto max-w-3xl space-y-4 p-4 sm:p-6">
          <Link
            href={back}
            className="inline-flex min-h-11 items-center gap-2 rounded-control text-sm font-medium text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          >
            <ArrowLeft className="h-4 w-4" aria-hidden="true" />
            Back to reviews
          </Link>
          <div>
            <h2 className="break-words text-xl font-semibold text-ink">
              {photo.partners?.name ?? "Unknown merchant"}
            </h2>
            <p className="mt-1 text-sm text-ink-muted">
              {photo.moderation_status.replaceAll("_", " ")} ·{" "}
              {date(photo.submitted_at)}
            </p>
          </div>
          <DiscoveryPhotoPreview photoId={photo.id} reviewLink large />
          <p className="text-sm leading-relaxed text-ink-muted">
            Approved photos can appear in public discovery when the visit is
            eligible.
          </p>
          <section
            aria-label="Photo decision"
            className="rounded-card border border-border bg-white p-4"
          >
            {canWrite ? (
              photo.moderation_status === "pending" ? (
                <DiscoveryPhotoActions key={photo.id} photoId={photo.id} />
              ) : photo.moderation_status === "approved" ? (
                <DiscoverySuppressionActions
                  photoId={photo.id}
                  suppressed={photo.suppressed_at !== null}
                />
              ) : (
                <p className="text-sm text-ink-muted">
                  This photo has already been reviewed.
                </p>
              )
            ) : (
              <p className="text-sm text-ink-muted">Read-only access</p>
            )}
          </section>
        </div>
      </>
    );
  }
  let query = supabase
    .from("merchant_visit_photos")
    .select(fields, { count: "exact" })
    .in(
      "moderation_status",
      tab === "pending" ? ["pending"] : ["approved", "rejected"]
    )
    .order("submitted_at", { ascending: tab === "pending" })
    .order("id")
    .range((page - 1) * 25, page * 25 - 1);
  if (q) query = query.ilike("partners.name", `%${q.replace(/[%_]/g, "")}%`);
  const [result, pending] = await Promise.all([
    query,
    supabase
      .from("merchant_visit_photos")
      .select("id", { count: "exact", head: true })
      .eq("moderation_status", "pending"),
  ]);
  const photos = (result.data ?? []) as unknown as Photo[];
  function pageHref(value: number) {
    const next = new URLSearchParams(params);
    if (value > 1) next.set("page", String(value));
    else next.delete("page");
    return `/discovery-photos${next.size ? `?${next}` : ""}`;
  }
  return (
    <>
      <PageHeader title="Photo reviews" />
      <div className="mx-auto max-w-4xl space-y-4 p-4 sm:p-6">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-2xl font-semibold tracking-tight text-ink">
            Photos
          </h2>
          <span className="text-sm tabular-nums text-ink-muted">
            {pending.error
              ? "Count unavailable"
              : `${pending.count ?? 0} pending`}
          </span>
        </div>
        <form className="flex gap-2" action="/discovery-photos">
          <label className="min-w-0 flex-1">
            <span className="sr-only">Search merchant photos</span>
            <input
              type="search"
              name="q"
              defaultValue={q}
              placeholder="Search merchant…"
              className="h-11 w-full rounded-control border border-border bg-white px-3 text-base text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            />
          </label>
          <input type="hidden" name="tab" value={tab} />
          <button className="min-h-11 rounded-control bg-primary px-4 text-sm font-medium text-white hover:bg-primary-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">
            Search
          </button>
        </form>
        <nav aria-label="Photo status" className="flex flex-wrap gap-2">
          {["pending", "reviewed"].map((value) => (
            <Link
              key={value}
              href={`/discovery-photos?tab=${value}${
                q ? `&q=${encodeURIComponent(q)}` : ""
              }`}
              aria-current={tab === value ? "page" : undefined}
              className={`inline-flex min-h-11 items-center rounded-full px-4 text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${
                tab === value
                  ? "bg-primary text-white"
                  : "bg-white text-ink-muted"
              }`}
            >
              {value === "pending" ? "Pending" : "Reviewed"}
            </Link>
          ))}
          <Link
            href={`/discovery-reports?returnTo=${encodeURIComponent(self)}`}
            className="inline-flex min-h-11 items-center rounded-full bg-white px-4 text-sm font-medium text-ink-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          >
            Reported content
          </Link>
        </nav>
        {result.error ? (
          <QueueLoadError />
        ) : !photos.length ? (
          <div className="rounded-card border border-border bg-white p-8 text-center">
            <ImageIcon
              className="mx-auto mb-3 h-8 w-8 text-primary"
              aria-hidden="true"
            />
            <h3 className="text-lg font-semibold text-ink">
              {q
                ? "No matching photos"
                : tab === "pending"
                ? "No pending photos"
                : "No reviewed photos"}
            </h3>
          </div>
        ) : (
          <ul className="divide-y divide-border overflow-hidden rounded-card border border-border bg-white">
            {photos.map((photo) => (
              <li key={photo.id}>
                <Link
                  href={`/discovery-photos?photo=${
                    photo.id
                  }&returnTo=${encodeURIComponent(self)}`}
                  className="flex min-h-24 items-center gap-3 p-4 hover:bg-surface-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary"
                >
                  <DiscoveryPhotoPreview photoId={photo.id} />
                  <span className="min-w-0 flex-1">
                    <span className="block break-words text-base font-medium text-ink">
                      {photo.partners?.name ?? "Unknown merchant"}
                    </span>
                    <span className="mt-1 block text-sm text-ink-muted">
                      {date(photo.submitted_at)}
                    </span>
                    {tab === "reviewed" && (
                      <span className="mt-1 block text-sm text-ink-muted">
                        {photo.suppressed_at
                          ? "Hidden"
                          : photo.moderation_status}
                      </span>
                    )}
                  </span>
                  <ChevronRight
                    className="h-5 w-5 shrink-0 text-ink-muted"
                    aria-hidden="true"
                  />
                </Link>
              </li>
            ))}
          </ul>
        )}
        {!result.error && (
          <nav
            aria-label="Photo pages"
            className="flex items-center justify-between gap-3 text-sm"
          >
            {page > 1 ? (
              <Link
                href={pageHref(page - 1)}
                className="inline-flex min-h-11 items-center text-primary underline"
              >
                Previous
              </Link>
            ) : (
              <span />
            )}
            <span className="text-ink-muted">
              Page {page} · {result.count ?? 0} photos
            </span>
            {page * 25 < (result.count ?? 0) ? (
              <Link
                href={pageHref(page + 1)}
                className="inline-flex min-h-11 items-center text-primary underline"
              >
                Next
              </Link>
            ) : (
              <span />
            )}
          </nav>
        )}
      </div>
    </>
  );
}
