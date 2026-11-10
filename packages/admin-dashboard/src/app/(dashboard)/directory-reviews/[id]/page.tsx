import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft, ExternalLink } from "lucide-react";
import { PageHeader } from "@/components/shell/PageHeader";
import { MerchantProfilePreview } from "@/components/merchants/MerchantProfilePreview";
import { DirectoryReviewActions } from "@/components/merchants/DirectoryReviewActions";
import { requireAdminSession } from "@/lib/auth";
import {
  directoryStatusLabel,
  type DirectoryStatus,
} from "@/lib/merchant-directory-review";
import { queueReturnPath, reviewHref } from "@/lib/queueNavigation";
import { openingHoursRows, safePublicUrl } from "@/lib/reviewPresentation";
import { supabase } from "@/lib/supabase";
import { hasPermission } from "@/types";

function eatDate(value: string) {
  return (
    new Date(value).toLocaleString("en-KE", {
      day: "numeric",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      timeZone: "Africa/Nairobi",
    }) + " EAT"
  );
}

interface CompletenessItem {
  code: string;
  field: string;
  message: string;
}

interface CompletenessSection {
  key: string;
  label: string;
  complete: boolean;
  missing: CompletenessItem[];
}

interface DirectoryCompleteness {
  complete: boolean;
  completedCount: number;
  requiredCount: number;
  sections: CompletenessSection[];
}

interface Category {
  slug: string;
  name: string;
}

interface Offering {
  id: string;
  name: string;
  description: string | null;
}

interface Location {
  id: string;
  name: string;
  locationType: string;
  addressLine1: string | null;
  addressLine2: string | null;
  building: string | null;
  floorOrUnit: string | null;
  landmark: string | null;
  locality: string | null;
  city: string | null;
  countyOrRegion: string | null;
  postalCode: string | null;
  countryCode: string | null;
  latitude: number | null;
  longitude: number | null;
  mapsUrl: string | null;
  publicPhone: string | null;
  publicEmail: string | null;
  publicWhatsapp: string | null;
  timezone: string | null;
  openingHours: unknown;
  isPrimary: boolean;
  acceptsAkibaPass: boolean;
  acceptsVouchers: boolean;
  isPubliclyConfirmed: boolean;
}

interface Product {
  id: string;
  name: string;
  description: string | null;
  priceCusd: number;
  category: string | null;
  productType: string | null;
}

interface DirectoryPreview {
  id: string;
  slug: string;
  name: string;
  shortDescription: string | null;
  description: string | null;
  logoUrl: string | null;
  bannerUrl: string | null;
  websiteUrl: string | null;
  operatingModel: string;
  storeActive: boolean;
  contacts: {
    phone: string | null;
    email: string | null;
    whatsapp: string | null;
    instagram: string | null;
    facebook: string | null;
  };
  primaryCategory: Category | null;
  categories: Category[];
  coreOfferings: Offering[];
  locations: Location[];
  products: Product[];
  merchantMedia?: Array<{
    id: string;
    imageUrl: string;
    altText: string | null;
    title: string | null;
  }>;
  directoryStatus: DirectoryStatus;
}

interface SettingsRow {
  partner_id: string;
  directory_status: DirectoryStatus;
  directory_submitted_at: string | null;
  directory_published_at: string | null;
  directory_updated_at: string | null;
  partners: {
    name: string;
    slug: string;
    status: string;
    type: string;
  } | null;
}

interface ReviewEvent {
  id: string;
  from_status: string | null;
  to_status: string;
  action: string;
  affected_sections: string[];
  merchant_safe_message: string | null;
  internal_note: string | null;
  actor_type: string;
  actor_user_id: string | null;
  created_at: string;
}

interface VoucherTemplate {
  id: string;
  title: string;
  miles_cost: number;
  active: boolean;
}

function nonEmpty(values: Array<string | null | undefined>): string {
  return values.filter(Boolean).join(", ");
}

function profileHref(slug: string): string | null {
  const hubOrigin = process.env.NEXT_PUBLIC_HUB_URL?.replace(/\/$/, "");
  return hubOrigin ? `${hubOrigin}/merchants/${slug}` : null;
}

async function getReviewDetail(id: string) {
  const [settingsRes, completenessRes, previewRes, vouchersRes, eventsRes] =
    await Promise.all([
      supabase
        .from("partner_settings")
        .select(
          "partner_id, directory_status, directory_submitted_at, directory_published_at, directory_updated_at, partners(name, slug, status, type)"
        )
        .eq("partner_id", id)
        .maybeSingle(),
      supabase.rpc("compute_merchant_directory_completeness", {
        p_partner_id: id,
      }),
      supabase.rpc("preview_merchant_directory", { p_partner_id: id }),
      supabase
        .from("spend_voucher_templates")
        .select("id, title, miles_cost, active")
        .eq("partner_id", id)
        .order("title"),
      supabase
        .from("merchant_directory_review_events")
        .select(
          "id, from_status, to_status, action, affected_sections, merchant_safe_message, internal_note, actor_type, actor_user_id, created_at"
        )
        .eq("partner_id", id)
        .order("created_at", { ascending: false }),
    ]);

  if (settingsRes.error || completenessRes.error || previewRes.error) {
    console.error("[directory-reviews] detail failed", {
      settings: settingsRes.error?.message,
      completeness: completenessRes.error?.message,
      preview: previewRes.error?.message,
    });
    throw new Error("Profile sources unavailable");
  }
  if (!settingsRes.data) return null;
  if (!previewRes.data || !completenessRes.data)
    throw new Error("Profile sources unavailable");

  return {
    settings: settingsRes.data as unknown as SettingsRow,
    completeness: completenessRes.data as unknown as DirectoryCompleteness,
    preview: previewRes.data as unknown as DirectoryPreview,
    vouchers: (vouchersRes.data ?? []) as VoucherTemplate[],
    events: (eventsRes.data ?? []) as ReviewEvent[],
    eventsError: Boolean(eventsRes.error),
    vouchersError: Boolean(vouchersRes.error),
  };
}

export default async function DirectoryReviewDetailPage({
  params,
  searchParams,
}: {
  params: { id: string };
  searchParams: { returnTo?: string | string[]; preview?: string };
}) {
  const session = await requireAdminSession("merchants.read");
  if (!session) redirect("/login");
  const back = queueReturnPath(searchParams.returnTo);
  let detail;
  try {
    detail = await getReviewDetail(params.id);
  } catch {
    return (
      <div>
        <PageHeader title="Merchant review" />
        <div className="space-y-4 p-4 sm:p-6">
          <Link
            href={back}
            className="inline-flex min-h-11 items-center text-sm text-primary"
          >
            {back.startsWith("/merchants/")
              ? "Back to merchant"
              : "Back to queue"}
          </Link>
          <div
            role="alert"
            className="rounded-card border border-border bg-white p-5"
          >
            <h2 className="text-lg font-semibold text-ink">
              Couldn’t load this profile
            </h2>
            <a
              href={reviewHref(params.id, back)}
              className="mt-3 inline-flex min-h-11 items-center text-primary underline"
            >
              Try again
            </a>
          </div>
        </div>
      </div>
    );
  }
  if (!detail) notFound();
  const { settings, completeness, preview, vouchers, events } = detail;
  const canWrite = hasPermission(session.role, "merchants.write");
  const previewOnly = searchParams.preview === "1";
  const reviewUrl = reviewHref(params.id, back);
  if (previewOnly)
    return (
      <div>
        <PageHeader title="Profile preview" />
        <MerchantProfilePreview profile={preview} reviewUrl={reviewUrl} />
      </div>
    );
  const media = [
    preview.bannerUrl && {
      url: safePublicUrl(preview.bannerUrl),
      label: "Cover photo",
    },
    preview.logoUrl && {
      url: safePublicUrl(preview.logoUrl),
      label: "Business logo",
    },
  ].filter((item): item is { url: string; label: string } =>
    Boolean(item && item.url)
  );
  const nextRes =
    canWrite && !previewOnly
      ? await supabase
          .from("partner_settings")
          .select("partner_id, partners(name)")
          .eq("directory_status", "pending_review")
          .neq("partner_id", params.id)
          .order("directory_submitted_at")
          .limit(1)
      : null;
  const nextRow = nextRes?.data?.[0];
  const nextMerchant = nextRow
    ? {
        id: nextRow.partner_id as string,
        name:
          (nextRow.partners as unknown as { name: string } | null)?.name ??
          "Next merchant",
      }
    : null;
  const missing = completeness.sections.flatMap((section) => section.missing);
  const publicHref = profileHref(preview.slug);
  const website = safePublicUrl(preview.websiteUrl);
  return (
    <div>
      <PageHeader title={previewOnly ? "Profile preview" : "Merchant review"} />
      <div className="mx-auto max-w-4xl space-y-5 p-4 pb-24 sm:p-6 sm:pb-24 lg:pb-6">
        <Link
          href={previewOnly ? reviewUrl : back}
          className="inline-flex min-h-11 items-center gap-2 rounded-control text-sm font-medium text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          {back.startsWith("/directory-reviews") ? "Merchant reviews" : "Queue"}
        </Link>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="break-words text-2xl font-semibold tracking-tight text-ink">
              {preview.name}
            </h2>
            <p className="mt-2 text-sm text-ink-muted">
              {settings.directory_status === "pending_review"
                ? `${
                    settings.directory_published_at
                      ? "Profile update"
                      : "New profile"
                  } · `
                : ""}
              {directoryStatusLabel(settings.directory_status)}
              {settings.directory_submitted_at
                ? ` · Submitted ${eatDate(settings.directory_submitted_at)}`
                : ""}
            </p>
          </div>
          {!previewOnly && (
            <Link
              href={`${reviewUrl}&preview=1`}
              className="inline-flex min-h-11 items-center gap-2 rounded-control bg-primary/10 px-3 text-sm font-medium text-primary-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            >
              Preview profile
              <ExternalLink className="h-4 w-4" aria-hidden="true" />
            </Link>
          )}
        </div>
        {settings.directory_status === "pending_review" &&
          settings.directory_published_at && (
            <p className="text-sm text-ink-muted">
              Showing submitted details. The previous version isn’t available
              for comparison.
            </p>
          )}
        {!previewOnly && missing.length > 0 && (
          <div className="rounded-control border border-warning/30 bg-warning/5 p-4">
            <h3 className="font-medium text-ink">Missing information</h3>
            <ul className="mt-2 list-disc space-y-1 pl-4 text-sm text-ink-muted">
              {missing.map((item) => (
                <li key={`${item.code}-${item.field}`}>{item.message}</li>
              ))}
            </ul>
          </div>
        )}
        {media.length > 0 && (
          <section
            aria-labelledby="photos-title"
            className="border-t border-border pt-5"
          >
            <h3
              id="photos-title"
              className="mb-3 text-lg font-semibold text-ink"
            >
              Photos
            </h3>
            <div className="grid grid-cols-2 gap-3">
              {media.map((photo) => (
                <a
                  key={photo.label}
                  href={photo.url}
                  target="_blank"
                  rel="noreferrer"
                  aria-label={`Open ${photo.label.toLowerCase()} in a new tab`}
                  className="overflow-hidden rounded-control border border-border bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={photo.url}
                    alt={`${preview.name} ${photo.label.toLowerCase()}`}
                    width={480}
                    height={320}
                    className="aspect-[3/2] w-full object-cover"
                  />
                  <span className="block px-3 py-2 text-sm text-ink-muted">
                    {photo.label}
                  </span>
                </a>
              ))}
            </div>
          </section>
        )}
        <section className="border-t border-border pt-5">
          <h3 className="text-lg font-semibold text-ink">Description</h3>
          <p className="mt-3 whitespace-pre-line break-words text-base leading-relaxed text-ink-muted">
            {preview.description ??
              preview.shortDescription ??
              "No description supplied."}
          </p>
          {preview.categories.length > 0 && (
            <p className="mt-3 text-sm text-ink-muted">
              {preview.categories.map((category) => category.name).join(", ")}
            </p>
          )}
        </section>
        <section className="border-t border-border pt-5">
          <h3 className="text-lg font-semibold text-ink">Locations & hours</h3>
          {preview.locations.length ? (
            <div className="divide-y divide-border">
              {preview.locations.map((location) => (
                <div key={location.id} className="space-y-3 py-4">
                  <h4 className="font-medium text-ink">
                    {location.name}
                    {location.isPrimary ? " · Primary" : ""}
                  </h4>
                  <p className="break-words text-base leading-relaxed text-ink-muted">
                    {nonEmpty([
                      location.addressLine1,
                      location.addressLine2,
                      location.building,
                      location.floorOrUnit,
                      location.locality,
                      location.city,
                      location.countyOrRegion,
                      location.countryCode,
                    ]) || "No address supplied."}
                  </p>
                  {location.landmark && (
                    <p className="text-sm text-ink-muted">
                      {location.landmark}
                    </p>
                  )}
                  {safePublicUrl(location.mapsUrl) && (
                    <a
                      href={safePublicUrl(location.mapsUrl)!}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex min-h-11 items-center gap-1 text-sm font-medium text-primary"
                    >
                      Open map
                      <ExternalLink className="h-4 w-4" aria-hidden="true" />
                    </a>
                  )}
                  <dl className="space-y-1 text-sm text-ink-muted">
                    {openingHoursRows(location.openingHours).map((row) => (
                      <div key={row.day} className="flex justify-between gap-3">
                        <dt>{row.day}</dt>
                        <dd>{row.hours}</dd>
                      </div>
                    ))}
                  </dl>
                  {location.publicPhone && (
                    <p className="break-words text-sm text-ink-muted">
                      Phone: {location.publicPhone}
                    </p>
                  )}
                  {location.publicEmail && (
                    <p className="break-words text-sm text-ink-muted">
                      Email: {location.publicEmail}
                    </p>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <p className="mt-3 text-base text-ink-muted">
              No public branch supplied.
            </p>
          )}
        </section>
        <section className="border-t border-border pt-5">
          <h3 className="text-lg font-semibold text-ink">Contact details</h3>
          <dl className="mt-3 space-y-3 text-base text-ink-muted">
            {Object.entries(preview.contacts ?? {})
              .filter(([, value]) => value)
              .map(([label, value]) => (
                <div key={label}>
                  <dt className="text-sm capitalize">{label}</dt>
                  <dd className="break-words text-ink">{value}</dd>
                </div>
              ))}
            {website && (
              <div>
                <dt className="text-sm">Website</dt>
                <dd>
                  <a
                    href={website}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex min-h-11 items-center break-all text-primary underline"
                  >
                    {website}
                  </a>
                </dd>
              </div>
            )}
            {!Object.values(preview.contacts ?? {}).some(Boolean) &&
              !website && <p>No public contact supplied.</p>}
          </dl>
        </section>
        {preview.coreOfferings.length > 0 && (
          <section className="border-t border-border pt-5">
            <h3 className="text-lg font-semibold text-ink">Offerings</h3>
            <ul className="mt-3 space-y-3">
              {preview.coreOfferings.map((item) => (
                <li key={item.id}>
                  <p className="font-medium text-ink">{item.name}</p>
                  {item.description && (
                    <p className="mt-1 text-sm text-ink-muted">
                      {item.description}
                    </p>
                  )}
                </li>
              ))}
            </ul>
          </section>
        )}
        {!previewOnly && (
          <>
            <section
              aria-label="Review decision"
              className="rounded-card border border-border bg-white p-4 sm:p-5"
            >
              {canWrite ? (
                <DirectoryReviewActions
                  key={params.id}
                  merchantId={params.id}
                  merchantName={preview.name}
                  status={settings.directory_status}
                  canPublish={
                    completeness.complete &&
                    settings.partners?.status === "active"
                  }
                  profilePreviewHref={`${reviewUrl}&preview=1`}
                  returnTo={back}
                  nextMerchant={nextMerchant}
                />
              ) : (
                <p className="text-sm text-ink-muted">
                  Read-only access. An operations admin must make this decision.
                </p>
              )}
            </section>
            <details className="rounded-card border border-border bg-white p-4">
              <summary className="flex min-h-11 cursor-pointer items-center text-sm font-medium text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">
                More details & history
              </summary>
              <div className="space-y-5 pt-3">
                <div className="flex flex-wrap gap-3">
                  <Link
                    href={`/merchants/${params.id}`}
                    className="inline-flex min-h-11 items-center text-sm font-medium text-primary"
                  >
                    Merchant account
                  </Link>
                  {publicHref && settings.directory_status === "published" && (
                    <a
                      href={publicHref}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex min-h-11 items-center text-sm font-medium text-primary"
                    >
                      View public profile
                    </a>
                  )}
                </div>
                <div>
                  <h3 className="font-medium text-ink">Vouchers</h3>
                  {detail.vouchersError ? (
                    <p className="mt-2 text-sm text-ink-muted">
                      Vouchers unavailable.
                    </p>
                  ) : vouchers.length ? (
                    <ul className="mt-2 space-y-2 text-sm text-ink-muted">
                      {vouchers.map((voucher) => (
                        <li key={voucher.id}>
                          {voucher.title} · {voucher.miles_cost} Miles ·{" "}
                          {voucher.active ? "Active" : "Inactive"}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="mt-2 text-sm text-ink-muted">
                      No vouchers offered.
                    </p>
                  )}
                </div>
                <div>
                  <h3 className="font-medium text-ink">Review history</h3>
                  {detail.eventsError ? (
                    <p className="mt-2 text-sm text-ink-muted">
                      History unavailable.
                    </p>
                  ) : events.length ? (
                    <ul className="mt-2 divide-y divide-border">
                      {events.map((event) => (
                        <li key={event.id} className="space-y-1 py-3">
                          <p className="text-sm font-medium text-ink">
                            {directoryStatusLabel(event.action)} ·{" "}
                            {directoryStatusLabel(event.to_status)}
                          </p>
                          <p className="text-xs text-ink-muted">
                            {eatDate(event.created_at)}
                          </p>
                          {event.merchant_safe_message && (
                            <p className="text-sm text-ink">
                              {event.merchant_safe_message}
                            </p>
                          )}
                          {event.internal_note && (
                            <p className="text-sm text-ink-muted">
                              Internal note: {event.internal_note}
                            </p>
                          )}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="mt-2 text-sm text-ink-muted">
                      No review history yet.
                    </p>
                  )}
                </div>
              </div>
            </details>
          </>
        )}
      </div>
    </div>
  );
}
