/* eslint-disable @next/next/no-img-element -- Merchant-hosted media uses dynamic public asset URLs. */
import { requireAdminSession } from "@/lib/auth";
import { supabase } from "@/lib/supabase";
import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { MerchantAdminHeader } from "@/components/merchants/MerchantAdminHeader";
import { safePublicUrl } from "@/lib/reviewPresentation";
import { PageHeader } from "@/components/shell/PageHeader";
import { QueueLoadError } from "@/components/queue/QueueLoadError";
import { Badge } from "@/components/ui/badge";
import { formatDate, formatDateTime, formatNumber } from "@/lib/utils";
import { AddMerchantNote } from "@/components/merchants/AddMerchantNote";
import { RemoveMerchantControl } from "@/components/merchants/RemoveMerchantControl";
import { GrantTrialControl } from "@/components/merchants/GrantTrialControl";
import {
  ArrowLeft,
  ChevronRight,
  Store,
  MapPin,
  Zap,
  ExternalLink,
  Ticket,
  CreditCard,
  NotebookPen,
  Users,
  SlidersHorizontal,
  CalendarClock,
  ReceiptText,
  History,
  ShieldCheck,
} from "lucide-react";
import { hasPermission } from "@/types";
import { directoryStatusLabel } from "@/lib/merchant-directory-review";
import { merchantReturnPath } from "@/lib/merchantNavigation";
async function getMerchantDetail(id: string) {
  const [
    partnerRes,
    settingsRes,
    subscriptionRes,
    vouchersRes,
    teamRes,
    notesRes,
    eventsRes,
    locationRes,
    previewRes,
  ] = await Promise.all([
    supabase.from("partners").select("*").eq("id", id).maybeSingle(),
    supabase
      .from("partner_settings")
      .select(
        "directory_status, directory_submitted_at, directory_published_at, directory_updated_at"
      )
      .eq("partner_id", id)
      .maybeSingle(),
    supabase
      .from("partner_subscriptions")
      .select(
        "plan,status,billing_period,included_monthly_miles,miles_issued_current_period,overage_miles_current_period,period_end,next_renewal_at"
      )
      .eq("partner_id", id)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase
      .from("spend_voucher_templates")
      .select("id, title, active, lifecycle_state, miles_cost")
      .eq("partner_id", id),
    supabase
      .from("merchant_users")
      .select("id, email, name, role, is_active")
      .eq("partner_id", id),
    supabase
      .from("merchant_admin_notes")
      .select("id, note, created_at, admin_user_id")
      .eq("partner_id", id)
      .order("created_at", { ascending: false }),
    supabase
      .from("merchant_directory_review_events")
      .select(
        "id, from_status, to_status, action, merchant_safe_message, internal_note, actor_type, created_at"
      )
      .eq("partner_id", id)
      .order("created_at", { ascending: false })
      .limit(50),
    supabase
      .from("merchant_locations")
      .select("address_line_1,locality,city")
      .eq("partner_id", id)
      .eq("active", true)
      .eq("is_primary", true)
      .limit(1)
      .maybeSingle(),
    supabase.rpc("preview_merchant_directory", { p_partner_id: id }),
  ]);

  if (
    [
      partnerRes,
      settingsRes,
      subscriptionRes,
      vouchersRes,
      teamRes,
      eventsRes,
      locationRes,
    ].some((result) => result.error)
  )
    throw new Error("Could not load merchant");
  if (!partnerRes.data) return null;

  const authorIds = [
    ...new Set(
      (notesRes.data ?? []).map((note) => note.admin_user_id).filter(Boolean)
    ),
  ];
  const authors = authorIds.length
    ? await supabase
        .from("admin_users")
        .select("id,name,email")
        .in("id", authorIds)
    : { data: [], error: null };
  return {
    partner: partnerRes.data,
    preview: (Array.isArray(previewRes.data)
      ? previewRes.data[0]
      : previewRes.data) as {
      logoUrl?: string;
      bannerUrl?: string;
      description?: string;
      primaryCategory?: { name: string };
      merchantMedia?: Array<{
        id: string;
        imageUrl: string;
        title: string | null;
        altText: string | null;
      }>;
    } | null,
    location: locationRes.data,
    settings: settingsRes.data ?? null,
    subscription: subscriptionRes.data ?? null,
    voucher_templates: vouchersRes.data ?? [],
    team: teamRes.data ?? [],
    notesUnavailable: Boolean(notesRes.error),
    notes: (notesRes.data ?? []).map((note) => ({
      ...note,
      admin_users:
        authors.data?.find((author) => author.id === note.admin_user_id) ??
        null,
    })),
    events: eventsRes.data ?? [],
  };
}

export default async function MerchantDetailPage({
  params,
  searchParams,
}: {
  params: { id: string };
  searchParams: { view?: string; filter?: string; returnTo?: string };
}) {
  const session = await requireAdminSession("merchants.read");
  if (!session) redirect("/login");
  let detail;
  try {
    detail = await getMerchantDetail(params.id);
  } catch {
    return (
      <>
        <PageHeader title="Merchant" />
        <div className="p-4">
          <QueueLoadError title="Couldn’t load merchant" />
        </div>
      </>
    );
  }
  if (!detail) notFound();
  const {
    partner,
    location,
    settings,
    subscription,
    voucher_templates,
    team,
    notes,
    events,
  } = detail;
  const canManage = hasPermission(session.role, "merchants.write");
  const view = [
    "subscription",
    "activity",
    "vouchers",
    "team",
    "profile",
  ].includes(searchParams.view ?? "")
    ? searchParams.view!
    : "overview";
  const back = merchantReturnPath(searchParams.returnTo);
  const base = `/merchants/${params.id}?returnTo=${encodeURIComponent(back)}`;
  const href = (value: string) => `${base}&view=${value}`;
  const address =
    [location?.address_line_1, location?.locality, location?.city]
      .filter(Boolean)
      .join(", ") ||
    partner.country ||
    "Location not supplied";
  const activeVouchers = voucher_templates.filter(
    (v) => v.active && v.lifecycle_state === "published"
  ).length;
  const typedNotes = notes as unknown as Array<{
    id: string;
    note: string;
    created_at: string;
    admin_users?: { name: string | null; email: string } | null;
  }>;
  const activity = [
    ...typedNotes.map((n) => ({
      id: `note-${n.id}`,
      kind: "notes",
      title: n.admin_users?.name ?? n.admin_users?.email ?? "Staff note",
      body: n.note,
      date: n.created_at,
    })),
    ...events.map((e) => ({
      id: `event-${e.id}`,
      kind: "actions",
      title: e.action.replaceAll("_", " "),
      body: [e.merchant_safe_message, e.internal_note]
        .filter(Boolean)
        .join("\n"),
      date: e.created_at,
    })),
  ].sort((a, b) => Date.parse(b.date) - Date.parse(a.date));
  const cover = safePublicUrl(
    detail.preview?.bannerUrl || partner.banner_url || partner.image_url
  );
  const logo = safePublicUrl(
    detail.preview?.logoUrl || partner.logo_url || partner.image_url
  );
  const media = (detail.preview?.merchantMedia ?? []).filter((item) =>
    safePublicUrl(item.imageUrl)
  );
  const section =
    "rounded-card bg-white p-5 shadow-[0_2px_3px_rgba(19,27,46,0.03)]";
  const merchantSections = [
    {
      id: "profile",
      title: "Public profile",
      description: "Customer view in discovery",
      icon: ExternalLink,
    },
    {
      id: "vouchers",
      title: "Vouchers",
      description: `${activeVouchers} active merchant vouchers`,
      icon: Ticket,
    },
    {
      id: "subscription",
      title: "Subscription",
      description: "Plan details, billing status & renewal",
      icon: CreditCard,
    },
    {
      id: "activity",
      title: "Notes & history",
      description: "Staff notes and profile decisions",
      icon: NotebookPen,
    },
    {
      id: "team",
      title: "Team",
      description: `${team.length} members`,
      icon: Users,
    },
  ];
  return (
    <div className="min-h-[calc(100dvh-88px)] bg-[#FAF8FF]">
      <MerchantAdminHeader
        backHref={view === "overview" ? back : base}
        name={session.name}
        role={session.role}
        title={
          view === "overview"
            ? "Merchant Detail"
            : view === "activity"
            ? "Notes & history"
            : view === "subscription"
            ? "Merchant Subscription"
            : view === "profile"
            ? "Public profile"
            : view === "team"
            ? "Merchant team"
            : "Merchant vouchers"
        }
      />
      <div className="mx-auto max-w-3xl space-y-4 p-4 sm:p-6">
        <section
          className={
            view === "overview" || view === "profile"
              ? `${section} !p-0 overflow-hidden`
              : "px-1"
          }
        >
          {(view === "overview" || view === "profile") && cover && (
            <div className="relative">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={cover}
                alt={`${partner.name} cover`}
                width={960}
                height={480}
                className="h-44 w-full object-cover sm:h-64"
              />
              {detail.preview?.primaryCategory?.name && (
                <span className="absolute bottom-3 left-4 flex items-center gap-2 rounded-full bg-white/95 px-3 py-1 text-xs font-medium">
                  <Store className="h-4 w-4 text-primary" aria-hidden="true" />
                  {detail.preview.primaryCategory.name}
                </span>
              )}
            </div>
          )}
          <div
            className={
              view === "overview" || view === "profile" ? "p-5" : "py-3"
            }
          >
            <div className="flex items-center gap-3">
              {view !== "overview" &&
                view !== "profile" &&
                (logo ? (
                  /* eslint-disable-next-line @next/next/no-img-element */ <img
                    src={logo}
                    alt=""
                    width={44}
                    height={44}
                    className="h-11 w-11 rounded-control object-cover"
                  />
                ) : (
                  <span className="flex h-11 w-11 items-center justify-center rounded-control bg-[#E2E7FF]">
                    <Store className="h-5 w-5 text-primary" />
                  </span>
                ))}
              <div className="min-w-0">
                <h2
                  className={`${
                    view === "overview" || view === "profile"
                      ? "text-2xl"
                      : "text-lg"
                  } break-words font-semibold tracking-tight text-ink`}
                >
                  {partner.name}
                </h2>
                <p className="mt-2 flex items-start gap-2 text-sm text-ink-muted">
                  <MapPin
                    className="mt-0.5 h-4 w-4 shrink-0"
                    aria-hidden="true"
                  />
                  {address}
                </p>
              </div>
            </div>
            {view === "overview" && (
              <div className="mt-5 grid grid-cols-2 gap-3 text-sm">
                <div className="rounded-control bg-[#F2F3FF] p-3">
                  <p className="text-xs text-ink-muted">Profile</p>
                  <p className="mt-1 font-medium text-primary-strong">
                    {partner.status === "archived"
                      ? "Archived"
                      : settings?.directory_status
                      ? directoryStatusLabel(settings.directory_status)
                      : "Not submitted"}
                  </p>
                </div>
                <div className="rounded-control bg-[#F2F3FF] p-3">
                  <p className="text-xs text-ink-muted">Subscription</p>
                  <p className="mt-1 font-medium capitalize">
                    {subscription
                      ? `${subscription.status.replaceAll("_", " ")} (${
                          subscription.plan
                        })`
                      : "None"}
                  </p>
                </div>
              </div>
            )}
          </div>
        </section>
        {view === "overview" && (
          <>
            {subscription && (
              <section className={section}>
                <div className="flex items-center gap-2 text-sm font-medium">
                  <Zap className="h-4 w-4 text-primary" aria-hidden="true" />
                  Miles activity
                </div>
                <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="text-sm text-ink-muted">
                      Miles issued this billing period
                    </p>
                    <p className="mt-1 text-3xl font-semibold tabular-nums">
                      {formatNumber(
                        subscription.miles_issued_current_period ?? 0
                      )}{" "}
                      <span className="text-base font-medium text-primary">
                        Miles
                      </span>
                    </p>
                  </div>
                  <Link
                    href={href("subscription")}
                    className="inline-flex min-h-11 items-center gap-2 text-sm font-medium text-primary"
                  >
                    View plan usage
                    <ChevronRight className="h-4 w-4" />
                  </Link>
                </div>
              </section>
            )}
            {partner.status === "archived" ? (
              <Badge variant="secondary">Archived merchant</Badge>
            ) : (
              canManage && (
                <details className="rounded-control bg-[#DAE2FD] px-4 py-2">
                  <summary className="flex min-h-11 cursor-pointer items-center gap-3 text-sm font-medium focus-visible:outline-primary">
                    <SlidersHorizontal
                      className="h-5 w-5 text-primary"
                      aria-hidden="true"
                    />
                    Manage merchant actions
                    <ChevronRight className="ml-auto h-4 w-4" />
                  </summary>
                  <div className="py-3">
                    <RemoveMerchantControl
                      id={params.id}
                      name={partner.name}
                      imageUrl={logo}
                      location={address}
                    />
                  </div>
                </details>
              )
            )}
            <nav
              aria-label="Merchant sections"
              className="divide-y divide-[#EAEDFF] overflow-hidden rounded-card bg-white shadow-sm"
            >
              {merchantSections.map(
                ({ id, title, description, icon: Icon }) => (
                  <Link
                    key={id}
                    href={href(id)}
                    className="flex min-h-20 items-center gap-3 px-4 py-4 hover:bg-[#F2F3FF] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary"
                  >
                    <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-control bg-[#F2F3FF]">
                      <Icon
                        className="h-5 w-5 text-primary"
                        aria-hidden="true"
                      />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block font-medium">{title}</span>
                      <span className="block text-sm text-ink-muted">
                        {description}
                      </span>
                    </span>
                    <ChevronRight
                      className="h-4 w-4 shrink-0 text-ink-muted"
                      aria-hidden="true"
                    />
                  </Link>
                )
              )}
            </nav>
          </>
        )}
        {view === "subscription" && (
          <>
            <section className={section}>
              <div className="flex items-center justify-between gap-2">
                <p className="text-xs font-medium text-ink-muted">
                  Current plan
                </p>
                {subscription && (
                  <span className="rounded-full bg-[#D9F9FC] px-3 py-1 text-xs capitalize text-primary-strong">
                    {subscription.status.replaceAll("_", " ")}
                  </span>
                )}
              </div>
              <h3 className="mt-2 text-2xl font-semibold capitalize">
                {subscription ? `${subscription.plan} plan` : "No subscription"}
              </h3>
              {subscription && (
                <>
                  <p className="mt-5 flex items-center gap-3 text-sm">
                    <CalendarClock
                      className="h-5 w-5 text-primary"
                      aria-hidden="true"
                    />
                    {subscription.status === "trialing"
                      ? `Trial ends ${
                          subscription.period_end
                            ? formatDate(subscription.period_end)
                            : "not supplied"
                        }`
                      : subscription.next_renewal_at
                      ? `Renews ${formatDate(subscription.next_renewal_at)}`
                      : "Renewal not scheduled"}
                    <span className="capitalize text-ink-muted">
                      ({subscription.billing_period ?? "Term not supplied"})
                    </span>
                  </p>
                  <dl className="mt-6 space-y-4 text-sm">
                    <div className="flex justify-between gap-3">
                      <dt>Active vouchers</dt>
                      <dd className="font-medium">{activeVouchers}</dd>
                    </div>
                    <div className="flex justify-between gap-3">
                      <dt>Directory listing</dt>
                      <dd className="font-medium text-primary-strong">
                        {settings?.directory_status
                          ? directoryStatusLabel(settings.directory_status)
                          : "Not submitted"}
                      </dd>
                    </div>
                    <div>
                      <div className="flex justify-between gap-3">
                        <dt>Miles issued this period</dt>
                        <dd className="font-medium">
                          {formatNumber(
                            subscription.miles_issued_current_period ?? 0
                          )}{" "}
                          /{" "}
                          {formatNumber(
                            subscription.included_monthly_miles ?? 0
                          )}
                        </dd>
                      </div>
                      <progress
                        aria-label="Miles allowance usage"
                        value={subscription.miles_issued_current_period ?? 0}
                        max={Math.max(
                          1,
                          subscription.included_monthly_miles ?? 0
                        )}
                        className="mt-3 h-2 w-full overflow-hidden rounded-full [&::-webkit-progress-bar]:bg-[#EAEDFF] [&::-webkit-progress-value]:bg-primary [&::-moz-progress-bar]:bg-primary"
                      />
                    </div>
                    <div className="flex justify-between gap-3 text-ink-muted">
                      <dt>Overage Miles</dt>
                      <dd>
                        {formatNumber(
                          subscription.overage_miles_current_period ?? 0
                        )}
                      </dd>
                    </div>
                  </dl>
                </>
              )}
            </section>
            {hasPermission(session.role, "finance.read") && (
              <>
                <h3 className="px-2 pt-2 text-sm font-medium text-ink-muted">
                  Billing & history
                </h3>
                {[
                  [
                    "history",
                    "Payment history",
                    "Review recorded subscription payments",
                    ReceiptText,
                  ],
                  [
                    "queue",
                    "Payment reviews",
                    "Reconcile submitted payments",
                    CreditCard,
                  ],
                ].map(([value, title, description, Icon]) => {
                  const RowIcon = Icon as typeof CreditCard;
                  return (
                    <Link
                      key={String(value)}
                      href={`/finance/subscriptions?merchant=${params.id}&view=${value}`}
                      className={`${section} flex items-center gap-3`}
                    >
                      <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-control bg-[#EAEDFF]">
                        <RowIcon
                          className="h-5 w-5 text-primary"
                          aria-hidden="true"
                        />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block font-medium">
                          {String(title)}
                        </span>
                        <span className="block text-sm text-ink-muted">
                          {String(description)}
                        </span>
                      </span>
                      <ChevronRight
                        className="h-4 w-4 shrink-0 text-ink-muted"
                        aria-hidden="true"
                      />
                    </Link>
                  );
                })}
              </>
            )}
            {partner.status !== "archived" && (
              <>
                <h3 className="px-2 pt-2 text-sm font-medium text-ink-muted">
                  Administration
                </h3>
                <section className={section}>
                  <GrantTrialControl
                    merchantId={params.id}
                    merchantName={partner.name}
                    location={address}
                    imageUrl={logo}
                    canManage={canManage}
                    subscriptionStatus={subscription?.status}
                  />
                </section>
              </>
            )}
          </>
        )}
        {view === "activity" && (
          <>
            {detail.notesUnavailable && (
              <div role="alert" className={`${section} text-sm text-ink-muted`}>
                Staff notes are unavailable. Profile decisions are still shown.
              </div>
            )}
            {canManage && !detail.notesUnavailable && (
              <details className={section}>
                <summary className="flex min-h-11 cursor-pointer items-center justify-center gap-2 rounded-control bg-primary px-4 text-sm font-medium text-white focus-visible:outline-primary">
                  Add note
                </summary>
                <div className="pt-3">
                  <AddMerchantNote merchantId={params.id} />
                </div>
              </details>
            )}
            <nav aria-label="Activity type" className="flex flex-wrap gap-2">
              {[
                ["all", "All"],
                ["notes", "Notes"],
                ["actions", "Actions"],
              ].map(([id, label]) => (
                <Link
                  key={id}
                  href={`${href("activity")}&filter=${id}`}
                  aria-current={
                    (searchParams.filter ?? "all") === id ? "page" : undefined
                  }
                  className={`inline-flex min-h-11 items-center rounded-full px-4 text-sm ${
                    (searchParams.filter ?? "all") === id
                      ? "bg-primary text-white"
                      : "bg-[#F2F3FF] text-ink-muted"
                  }`}
                >
                  {label}
                </Link>
              ))}
            </nav>
            <ul className="space-y-5 pt-4">
              {activity
                .filter(
                  (a) =>
                    !["notes", "actions"].includes(searchParams.filter ?? "") ||
                    a.kind === searchParams.filter
                )
                .map((a) => (
                  <li
                    key={a.id}
                    className="relative ml-4 border-l border-[#DAE2FD] py-2 pl-6"
                  >
                    <span className="absolute -left-4 top-1 flex h-8 w-8 items-center justify-center rounded-full bg-[#EAEDFF] text-primary">
                      {a.kind === "notes" ? (
                        <NotebookPen className="h-4 w-4" aria-hidden="true" />
                      ) : (
                        <History className="h-4 w-4" aria-hidden="true" />
                      )}
                    </span>
                    <p className="font-medium capitalize">{a.title}</p>
                    {a.body && (
                      <p className="mt-2 whitespace-pre-wrap break-words text-sm text-ink">
                        {a.body}
                      </p>
                    )}
                    <p className="mt-2 text-xs text-ink-muted">
                      {formatDateTime(a.date)}
                    </p>
                  </li>
                ))}
            </ul>
            {!activity.filter(
              (a) =>
                !["notes", "actions"].includes(searchParams.filter ?? "") ||
                a.kind === searchParams.filter
            ).length && (
              <p className="p-4 text-sm text-ink-muted">
                {detail.notesUnavailable
                  ? "No profile decisions in this view. Staff notes could not be loaded."
                  : "No activity in this view."}
              </p>
            )}
            <p className="text-xs text-ink-muted">
              Includes up to 50 recent profile decisions.
            </p>
          </>
        )}
        {view === "profile" && (
          <section className={`${section} space-y-4`}>
            {detail.preview?.description && (
              <p className="text-sm leading-6 text-ink-muted">
                {detail.preview.description}
              </p>
            )}
            {media.length > 0 && (
              <div className="grid grid-cols-2 gap-3">
                {media.map((item) => (
                  <a
                    key={item.id}
                    href={item.imageUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="overflow-hidden rounded-control focus-visible:ring-2 focus-visible:ring-primary"
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={item.imageUrl}
                      alt={
                        item.altText || item.title || `${partner.name} photo`
                      }
                      width={400}
                      height={300}
                      className="aspect-[4/3] w-full object-cover"
                    />
                    {item.title && (
                      <span className="block py-2 text-sm">{item.title}</span>
                    )}
                  </a>
                ))}
              </div>
            )}
            {settings?.directory_status ? (
              <>
                <p className="font-medium">
                  {directoryStatusLabel(settings.directory_status)}
                </p>
                <dl className="grid gap-3 text-sm">
                  {[
                    ["Submitted", settings.directory_submitted_at],
                    ["Published", settings.directory_published_at],
                    ["Updated", settings.directory_updated_at],
                  ].map(([label, value]) => (
                    <div key={label}>
                      <dt className="text-ink-muted">{label}</dt>
                      <dd>{value ? formatDateTime(value) : "Not yet"}</dd>
                    </div>
                  ))}
                </dl>
                <Link
                  href={`/directory-reviews/${
                    params.id
                  }?preview=1&returnTo=${encodeURIComponent(href("profile"))}`}
                  className="inline-flex min-h-11 items-center text-sm font-medium text-primary"
                >
                  Preview profile
                </Link>
                <Link
                  href={`/directory-reviews/${
                    params.id
                  }?returnTo=${encodeURIComponent(href("profile"))}`}
                  className="block py-3 text-sm font-medium text-primary"
                >
                  Open profile review
                </Link>
              </>
            ) : (
              <p className="text-sm text-ink-muted">
                This merchant has not submitted a public profile.
              </p>
            )}
          </section>
        )}
        {view === "vouchers" && (
          <ul className="space-y-2">
            {voucher_templates.map((v) => (
              <li key={v.id} className={section}>
                <p className="font-medium">{v.title}</p>
                <p className="mt-1 text-sm capitalize text-ink-muted">
                  {v.lifecycle_state.replaceAll("_", " ")} ·{" "}
                  {v.active ? "Active" : "Inactive"} ·{" "}
                  {formatNumber(v.miles_cost)} Miles
                </p>
              </li>
            ))}
            {!voucher_templates.length && (
              <li className={`${section} text-sm text-ink-muted`}>
                No voucher templates.
              </li>
            )}
          </ul>
        )}
        {view === "team" && (
          <ul className="space-y-2">
            {team.map((u) => (
              <li key={u.id} className={`${section} break-words`}>
                <p className="font-medium">{u.name ?? u.email}</p>
                <p className="mt-1 text-sm text-ink-muted">{u.email}</p>
                <p className="mt-1 text-xs capitalize text-ink-muted">
                  {u.role} · {u.is_active ? "Active" : "Inactive"}
                </p>
              </li>
            ))}
            {!team.length && (
              <li className={`${section} text-sm text-ink-muted`}>
                No team members.
              </li>
            )}
          </ul>
        )}
      </div>
    </div>
  );
}
