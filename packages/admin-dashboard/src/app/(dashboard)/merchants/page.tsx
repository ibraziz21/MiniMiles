import { hasPermission } from "@/types";
import { requireAdminSession } from "@/lib/auth";
import { supabase } from "@/lib/supabase";
import { QueueLoadError } from "@/components/queue/QueueLoadError";
import { redirect } from "next/navigation";
import { MerchantAdminHeader } from "@/components/merchants/MerchantAdminHeader";
import { PageHeader } from "@/components/shell/PageHeader";
import { MerchantsListView } from "@/components/merchants/MerchantsListView";

async function readAll<T>(
  read: (
    from: number,
    to: number
  ) => PromiseLike<{ data: T[] | null; error: unknown }>
) {
  const data: T[] = [];
  for (let from = 0; ; from += 500) {
    const result = await read(from, from + 499);
    if (result.error) throw new Error("Could not load merchants");
    data.push(...(result.data ?? []));
    if ((result.data?.length ?? 0) < 500) break;
  }
  return { data, error: null };
}

async function getMerchants() {
  const [
    partnersRes,
    subscriptionsRes,
    vouchersRes,
    teamRes,
    settingsRes,
    locationsRes,
  ] = await Promise.all([
    readAll((from, to) =>
      supabase
        .from("partners")
        .select("id,slug,name,country,image_url,logo_url,banner_url,status")
        .order("name")
        .order("id")
        .range(from, to)
    ),
    readAll((from, to) =>
      supabase
        .from("partner_subscriptions")
        .select("partner_id,plan,status,created_at")
        .order("created_at", { ascending: false })
        .order("id")
        .range(from, to)
    ),
    readAll((from, to) =>
      supabase
        .from("spend_voucher_templates")
        .select("partner_id,lifecycle_state,active")
        .order("id")
        .range(from, to)
    ),
    readAll((from, to) =>
      supabase
        .from("merchant_users")
        .select("partner_id")
        .order("id")
        .range(from, to)
    ),
    readAll((from, to) =>
      supabase
        .from("partner_settings")
        .select("partner_id,directory_status")
        .order("partner_id")
        .range(from, to)
    ),
    readAll((from, to) =>
      supabase
        .from("merchant_locations")
        .select("partner_id,locality,city,address_line_1")
        .eq("active", true)
        .eq("is_primary", true)
        .order("id")
        .range(from, to)
    ),
  ]);

  if (
    [
      partnersRes,
      subscriptionsRes,
      vouchersRes,
      teamRes,
      settingsRes,
      locationsRes,
    ].some((result) => result.error)
  )
    throw new Error("Could not load merchants");
  const subscriptionMap: Record<string, { plan: string; status: string }> = {};
  for (const subscription of subscriptionsRes.data ?? []) {
    if (!subscriptionMap[subscription.partner_id]) {
      subscriptionMap[subscription.partner_id] = {
        plan: subscription.plan,
        status: subscription.status,
      };
    }
  }

  const voucherMap: Record<string, { total: number; active: number }> = {};
  for (const voucher of vouchersRes.data ?? []) {
    if (!voucherMap[voucher.partner_id])
      voucherMap[voucher.partner_id] = { total: 0, active: 0 };
    voucherMap[voucher.partner_id].total++;
    if (voucher.lifecycle_state === "published" && voucher.active) {
      voucherMap[voucher.partner_id].active++;
    }
  }

  const teamMap: Record<string, number> = {};
  for (const u of teamRes.data ?? [])
    teamMap[u.partner_id] = (teamMap[u.partner_id] ?? 0) + 1;

  return (partnersRes.data ?? []).map((p) => ({
    ...p,
    image_url: p.banner_url || p.image_url || p.logo_url || null,
    directory_status:
      settingsRes.data?.find((row) => row.partner_id === p.id)
        ?.directory_status ?? null,
    location:
      locationsRes.data
        ?.filter((row) => row.partner_id === p.id)
        .map(
          (row) =>
            [row.locality, row.city].filter(Boolean).join(", ") ||
            row.address_line_1
        )
        .filter(Boolean)
        .join(" · ") ||
      p.country ||
      "",
    subscription: subscriptionMap[p.id] ?? null,
    voucher_types: voucherMap[p.id]?.total ?? 0,
    active_voucher_types: voucherMap[p.id]?.active ?? 0,
    team_count: teamMap[p.id] ?? 0,
  }));
}

export default async function MerchantsPage() {
  const session = await requireAdminSession("merchants.read");
  if (!session) redirect("/login");

  let merchants;
  try {
    merchants = await getMerchants();
  } catch {
    return (
      <>
        <PageHeader title="Merchants" />
        <div className="p-4">
          <QueueLoadError title="Couldn’t load merchants" />
        </div>
      </>
    );
  }

  return (
    <div className="min-h-[calc(100dvh-88px)] bg-[#FAF8FF]">
      <MerchantAdminHeader
        title="Merchants"
        directory
        name={session.name}
        role={session.role}
      />
      <div className="mx-auto max-w-5xl p-4 sm:p-6">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
          <h1 className="text-3xl font-semibold tracking-tight">Merchants</h1>
          <span className="rounded-full bg-[#EAEDFF] px-3 py-1 text-xs font-medium text-primary-strong">
            {
              merchants.filter(
                (m) =>
                  m.status !== "archived" &&
                  m.directory_status === "pending_review"
              ).length
            }{" "}
            pending review
          </span>
        </div>
        <MerchantsListView
          merchants={merchants}
          canManage={hasPermission(session.role, "merchants.write")}
        />
      </div>
    </div>
  );
}
