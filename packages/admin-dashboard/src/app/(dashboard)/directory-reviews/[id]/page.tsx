import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import {
  ArrowLeft,
  CheckCircle2,
  ExternalLink,
  Globe2,
  MapPin,
  Store,
  XCircle,
} from "lucide-react";
import { TopBar } from "@/components/layout/TopBar";
import { DirectoryReviewActions } from "@/components/merchants/DirectoryReviewActions";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { requireAdminSession } from "@/lib/auth";
import {
  directoryStatusLabel,
  type DirectoryStatus,
} from "@/lib/merchant-directory-review";
import { supabase } from "@/lib/supabase";
import { hasPermission } from "@/types";
import { formatDateTime } from "@/lib/utils";

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

const STATUS_VARIANT: Record<string, "success" | "warning" | "destructive" | "secondary" | "outline"> = {
  pending_review: "warning",
  changes_requested: "destructive",
  published: "success",
  paused: "secondary",
  suspended: "destructive",
  draft: "outline",
};

function nonEmpty(values: Array<string | null | undefined>): string {
  return values.filter(Boolean).join(", ");
}

function profileHref(slug: string): string | null {
  const hubOrigin = process.env.NEXT_PUBLIC_HUB_URL?.replace(/\/$/, "");
  return hubOrigin ? `${hubOrigin}/merchants/${slug}` : null;
}

async function getReviewDetail(id: string) {
  const [settingsRes, completenessRes, previewRes, vouchersRes, eventsRes] = await Promise.all([
    supabase
      .from("partner_settings")
      .select(
        "partner_id, directory_status, directory_submitted_at, directory_published_at, directory_updated_at, partners(name, slug, status, type)",
      )
      .eq("partner_id", id)
      .maybeSingle(),
    supabase.rpc("compute_merchant_directory_completeness", { p_partner_id: id }),
    supabase.rpc("preview_merchant_directory", { p_partner_id: id }),
    supabase
      .from("spend_voucher_templates")
      .select("id, title, miles_cost, active")
      .eq("partner_id", id)
      .order("title"),
    supabase
      .from("merchant_directory_review_events")
      .select(
        "id, from_status, to_status, action, affected_sections, merchant_safe_message, internal_note, actor_type, actor_user_id, created_at",
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
    return null;
  }
  if (!settingsRes.data || !previewRes.data) return null;

  return {
    settings: settingsRes.data as unknown as SettingsRow,
    completeness: completenessRes.data as unknown as DirectoryCompleteness,
    preview: previewRes.data as unknown as DirectoryPreview,
    vouchers: (vouchersRes.data ?? []) as VoucherTemplate[],
    events: (eventsRes.data ?? []) as ReviewEvent[],
  };
}

export default async function DirectoryReviewDetailPage({
  params,
}: {
  params: { id: string };
}) {
  const session = await requireAdminSession("merchants.read");
  if (!session) redirect("/login");

  const detail = await getReviewDetail(params.id);
  if (!detail) notFound();

  const { settings, completeness, preview, vouchers, events } = detail;
  const canWrite = hasPermission(session.role, "merchants.write");
  const publicHref = profileHref(preview.slug);
  const hasContact = Object.values(preview.contacts ?? {}).some(Boolean);

  return (
    <div>
      <TopBar
        title={preview.name}
        subtitle={`Public profile · ${directoryStatusLabel(settings.directory_status)}`}
      />
      <div className="space-y-6 p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Link
            href="/directory-reviews"
            className="inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-900"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            Back to profile reviews
          </Link>
          <div className="flex items-center gap-2">
            <Link
              href={`/merchants/${params.id}`}
              className="text-sm font-medium text-[#176B78] hover:text-[#125762]"
            >
              Merchant account
            </Link>
            {publicHref && settings.directory_status === "published" && (
              <a
                href={publicHref}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 text-sm font-medium text-[#176B78] hover:text-[#125762]"
              >
                Open in Hub <ExternalLink className="h-3.5 w-3.5" />
              </a>
            )}
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm text-slate-500">Directory status</CardTitle>
            </CardHeader>
            <CardContent>
              <Badge variant={STATUS_VARIANT[settings.directory_status] ?? "secondary"}>
                {directoryStatusLabel(settings.directory_status)}
              </Badge>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm text-slate-500">Completeness</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-2xl font-semibold text-slate-950">
                {completeness.completedCount}/{completeness.requiredCount}
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm text-slate-500">Submitted</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm font-medium text-slate-900">
                {formatDateTime(settings.directory_submitted_at)}
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm text-slate-500">Account eligibility</CardTitle>
            </CardHeader>
            <CardContent>
              {settings.partners?.status === "active" && settings.partners?.type === "merchant" ? (
                <span className="inline-flex items-center gap-1.5 text-sm font-medium text-emerald-600">
                  <CheckCircle2 className="h-4 w-4" /> Active merchant
                </span>
              ) : (
                <span className="inline-flex items-center gap-1.5 text-sm font-medium text-red-600">
                  <XCircle className="h-4 w-4" /> Not eligible
                </span>
              )}
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Completeness checks</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
            {completeness.sections.map((section) => (
              <div
                key={section.key}
                className={`rounded-lg border p-3 ${
                  section.complete
                    ? "border-emerald-200 bg-emerald-50"
                    : "border-red-200 bg-red-50"
                }`}
              >
                <div className="flex items-center gap-2">
                  {section.complete ? (
                    <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                  ) : (
                    <XCircle className="h-4 w-4 text-red-600" />
                  )}
                  <p className="text-sm font-medium text-slate-900">{section.label}</p>
                </div>
                {section.missing.map((item) => (
                  <p key={item.code} className="mt-2 text-xs text-red-700">{item.message}</p>
                ))}
              </div>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Business identity</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-col gap-5 sm:flex-row">
              <div className="flex h-24 w-24 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-slate-200 bg-slate-50">
                {preview.logoUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={preview.logoUrl} alt="" className="h-full w-full object-cover" />
                ) : (
                  <Store className="h-8 w-8 text-slate-300" />
                )}
              </div>
              <div className="space-y-3">
                <div>
                  <p className="text-lg font-semibold text-slate-950">{preview.name}</p>
                  <p className="text-sm text-slate-500">/{preview.slug}</p>
                </div>
                <p className="text-sm font-medium text-slate-700">{preview.shortDescription ?? "—"}</p>
                <p className="max-w-4xl whitespace-pre-wrap text-sm leading-6 text-slate-600">
                  {preview.description ?? "No description supplied."}
                </p>
                <div className="flex flex-wrap gap-2">
                  <Badge variant="secondary">{preview.operatingModel}</Badge>
                  <Badge variant={preview.storeActive ? "success" : "outline"}>
                    Storefront {preview.storeActive ? "active" : "inactive"}
                  </Badge>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        <div className="grid gap-6 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>Categories</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-wrap gap-2">
              {preview.categories.map((category) => (
                <Badge
                  key={category.slug}
                  variant={category.slug === preview.primaryCategory?.slug ? "default" : "secondary"}
                >
                  {category.name}
                  {category.slug === preview.primaryCategory?.slug ? " · Primary" : ""}
                </Badge>
              ))}
              {preview.categories.length === 0 && (
                <p className="text-sm text-slate-400">No categories supplied.</p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Public contact</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              {!hasContact && <p className="text-slate-400">No public contact supplied.</p>}
              {preview.contacts.phone && <p><span className="text-slate-500">Phone:</span> {preview.contacts.phone}</p>}
              {preview.contacts.email && <p><span className="text-slate-500">Email:</span> {preview.contacts.email}</p>}
              {preview.contacts.whatsapp && <p><span className="text-slate-500">WhatsApp:</span> {preview.contacts.whatsapp}</p>}
              {preview.websiteUrl && (
                <p>
                  <span className="text-slate-500">Website:</span>{" "}
                  <a href={preview.websiteUrl} target="_blank" rel="noreferrer" className="text-[#176B78] hover:underline">
                    {preview.websiteUrl}
                  </a>
                </p>
              )}
              {preview.contacts.instagram && <p><span className="text-slate-500">Instagram:</span> {preview.contacts.instagram}</p>}
              {preview.contacts.facebook && <p><span className="text-slate-500">Facebook:</span> {preview.contacts.facebook}</p>}
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Core offerings ({preview.coreOfferings.length})</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {preview.coreOfferings.map((offering) => (
              <div key={offering.id} className="rounded-lg border border-slate-100 p-3">
                <p className="text-sm font-medium text-slate-900">{offering.name}</p>
                {offering.description && (
                  <p className="mt-1 text-xs leading-5 text-slate-500">{offering.description}</p>
                )}
              </div>
            ))}
            {preview.coreOfferings.length === 0 && (
              <p className="text-sm text-slate-400">No core offerings supplied.</p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Locations and branches ({preview.locations.length})</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {preview.locations.map((location) => (
              <div key={location.id} className="rounded-xl border border-slate-200 p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <MapPin className="h-4 w-4 text-[#238D9D]" />
                      <p className="font-medium text-slate-900">{location.name}</p>
                      {location.isPrimary && <Badge>Primary</Badge>}
                    </div>
                    <p className="mt-2 text-sm text-slate-600">
                      {nonEmpty([
                        location.addressLine1,
                        location.addressLine2,
                        location.building,
                        location.floorOrUnit,
                        location.locality,
                        location.city,
                        location.countyOrRegion,
                        location.postalCode,
                        location.countryCode,
                      ]) || "No address supplied"}
                    </p>
                    {location.landmark && (
                      <p className="mt-1 text-xs text-slate-500">Landmark: {location.landmark}</p>
                    )}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Badge variant={location.isPubliclyConfirmed ? "success" : "destructive"}>
                      {location.isPubliclyConfirmed ? "Public location confirmed" : "Not confirmed"}
                    </Badge>
                    {location.acceptsAkibaPass && <Badge variant="secondary">Akiba Pass</Badge>}
                    {location.acceptsVouchers && <Badge variant="secondary">Vouchers</Badge>}
                  </div>
                </div>

                <div className="mt-3 grid gap-3 text-xs text-slate-600 md:grid-cols-2">
                  <div>
                    <p>Phone: {location.publicPhone ?? "—"}</p>
                    <p>Email: {location.publicEmail ?? "—"}</p>
                    <p>WhatsApp: {location.publicWhatsapp ?? "—"}</p>
                  </div>
                  <div>
                    <p>Coordinates: {location.latitude != null && location.longitude != null ? `${location.latitude}, ${location.longitude}` : "—"}</p>
                    <p>Timezone: {location.timezone ?? "—"}</p>
                    {location.mapsUrl && (
                      <a href={location.mapsUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-[#176B78] hover:underline">
                        Open map <ExternalLink className="h-3 w-3" />
                      </a>
                    )}
                  </div>
                </div>
                <details className="mt-3">
                  <summary className="cursor-pointer text-xs font-medium text-slate-600">
                    Inspect opening hours
                  </summary>
                  <pre className="mt-2 overflow-x-auto rounded-lg bg-slate-50 p-3 text-xs text-slate-600">
                    {JSON.stringify(location.openingHours ?? {}, null, 2)}
                  </pre>
                </details>
              </div>
            ))}
            {preview.locations.length === 0 && (
              <div className="flex items-center gap-2 text-sm text-slate-400">
                <Globe2 className="h-4 w-4" />
                Online-only profile; no public branch supplied.
              </div>
            )}
          </CardContent>
        </Card>

        <div className="grid gap-6 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>Storefront products ({preview.products.length})</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {preview.products.map((product) => (
                <div key={product.id} className="flex items-start justify-between gap-3 rounded-lg border border-slate-100 p-3">
                  <div>
                    <p className="text-sm font-medium text-slate-900">{product.name}</p>
                    <p className="text-xs text-slate-500">{product.category ?? product.productType ?? "Uncategorised"}</p>
                  </div>
                  <p className="whitespace-nowrap text-sm font-medium text-slate-700">${product.priceCusd}</p>
                </div>
              ))}
              {preview.products.length === 0 && (
                <p className="text-sm text-slate-400">
                  No active products, or the merchant storefront is inactive.
                </p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Voucher templates ({vouchers.length})</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {vouchers.map((voucher) => (
                <div key={voucher.id} className="flex items-center justify-between rounded-lg border border-slate-100 p-3">
                  <div>
                    <p className="text-sm font-medium text-slate-900">{voucher.title}</p>
                    <p className="text-xs text-slate-500">{voucher.miles_cost} miles</p>
                  </div>
                  <Badge variant={voucher.active ? "success" : "secondary"}>
                    {voucher.active ? "Active" : "Inactive"}
                  </Badge>
                </div>
              ))}
              {vouchers.length === 0 && <p className="text-sm text-slate-400">No vouchers offered.</p>}
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Review decision</CardTitle>
          </CardHeader>
          <CardContent>
            {canWrite ? (
              <DirectoryReviewActions merchantId={params.id} status={settings.directory_status} />
            ) : (
              <p className="text-sm text-slate-500">
                You have read-only access. An operations admin must make the review decision.
              </p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Profile review history</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {events.map((event) => (
              <div key={event.id} className="rounded-lg border border-slate-100 bg-slate-50 p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-sm font-medium text-slate-900">
                    {directoryStatusLabel(event.action)}
                    <span className="ml-2 font-normal text-slate-500">
                      {event.from_status ? `${directoryStatusLabel(event.from_status)} → ` : ""}
                      {directoryStatusLabel(event.to_status)}
                    </span>
                  </p>
                  <p className="text-xs text-slate-400">{formatDateTime(event.created_at)}</p>
                </div>
                <p className="mt-1 text-xs text-slate-400">
                  Actor: {directoryStatusLabel(event.actor_type)}
                  {event.actor_user_id ? ` · ${event.actor_user_id}` : ""}
                </p>
                {event.affected_sections.length > 0 && (
                  <p className="mt-2 text-xs text-slate-600">
                    Sections: {event.affected_sections.map(directoryStatusLabel).join(", ")}
                  </p>
                )}
                {event.merchant_safe_message && (
                  <p className="mt-2 text-sm text-slate-700">
                    <span className="font-medium">Merchant message:</span> {event.merchant_safe_message}
                  </p>
                )}
                {event.internal_note && (
                  <p className="mt-2 text-sm text-slate-600">
                    <span className="font-medium">Internal note:</span> {event.internal_note}
                  </p>
                )}
              </div>
            ))}
            {events.length === 0 && <p className="text-sm text-slate-400">No review events yet.</p>}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
