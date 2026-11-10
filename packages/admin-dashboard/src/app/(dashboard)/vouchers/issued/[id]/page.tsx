import { isUuid } from "@/lib/subscriptionPayments";
import { redirect, notFound } from "next/navigation";
import { Coffee } from "lucide-react";
import { requireAdminSession, adminIdForWrite } from "@/lib/auth";
import { hasPermission } from "@/types";
import { supabase } from "@/lib/supabase";
import { coreVoucherQuery, type VoucherOffer } from "@/lib/voucherCatalogue";
import {
  voucherKind,
  voucherReturnPath,
  voucherDateTime,
} from "@/lib/voucherPresentation";
import { getVoucherMemberDetails } from "@/lib/voucherMemberDetails";
import { VoucherHeader } from "@/components/vouchers/VoucherHeader";
import {
  voucherCanvas,
  voucherCard,
  VoucherStatus,
  VoucherFacts,
} from "@/components/vouchers/VoucherUi";
import {
  CopyVoucherCode,
  RevokeIssuedVoucher,
} from "@/components/vouchers/IssuedVoucherActions";
import { QueueLoadError } from "@/components/queue/QueueLoadError";
export default async function IssuedVoucherDetail({
  params,
  searchParams,
}: {
  params: { id: string };
  searchParams: { returnTo?: string };
}) {
  const session = await requireAdminSession();
  if (!session) redirect("/login");
  if (!isUuid(params.id)) notFound();
  if (
    !hasPermission(session.role, "vouchers.read") &&
    !hasPermission(session.role, "voucher_funds.read")
  )
    redirect("/overview");
  const back = voucherReturnPath(searchParams.returnTo, "/vouchers/issued");
  const header = (
    <VoucherHeader
      title="Issued Voucher"
      backHref={back}
      name={session.name}
      role={session.role}
    />
  );
  const fail = () => (
    <div className={voucherCanvas}>
      {header}
      <div className="p-4">
        <QueueLoadError title="Couldn’t load issued voucher" />
      </div>
    </div>
  );
  const r = await supabase
    .from("issued_vouchers")
    .select(
      "id,voucher_template_id,code,status,created_at,claimed_at,expires_at,redeemed_at,revoked_at,revoked_reason,voided_at,void_reason,hub_user_id,username_at_claim,funding_allocation_id,funding_mode,acquisition_source"
    )
    .in("status", ["issued", "redeemed", "expired", "revoked"])
    .eq("id", params.id)
    .maybeSingle();
  if (r.error) return fail();
  if (!r.data) notFound();
  const voucher = r.data;
  const t = await coreVoucherQuery()
    .eq("id", voucher.voucher_template_id)
    .maybeSingle();
  if (t.error) return fail();
  if (!t.data) notFound();
  const offer = t.data as VoucherOffer,
    kind = voucherKind(offer);
  if (
    !hasPermission(
      session.role,
      kind === "reimbursable" ? "voucher_funds.read" : "vouchers.read"
    )
  )
    redirect("/vouchers");
  const [merchant, memberDetails, allocation] = await Promise.all([
    supabase
      .from("partners")
      .select("name,banner_url,image_url,logo_url")
      .eq("id", offer.partner_id)
      .maybeSingle(),
    getVoucherMemberDetails([voucher.id]),
    voucher.funding_allocation_id
      ? supabase
          .from("voucher_funding_allocations")
          .select("program_id")
          .eq("id", voucher.funding_allocation_id)
          .maybeSingle()
      : Promise.resolve({ data: null, error: null }),
  ]);
  if (merchant.error) return fail();
  const username =
      memberDetails.get(voucher.id)?.username || voucher.username_at_claim,
    member = username
      ? `@${username}`
      : voucher.hub_user_id
      ? `Member ${voucher.hub_user_id.slice(0, 8)}`
      : "Member unavailable";
  const events = [
    {
      label: voucher.claimed_at
        ? "Voucher claimed by member"
        : "Voucher issued",
      date: voucher.claimed_at || voucher.created_at,
    },
    ...(voucher.redeemed_at
      ? [
          {
            label: `Redeemed at ${merchant.data?.name ?? "merchant"}`,
            date: voucher.redeemed_at,
          },
        ]
      : []),
    ...(voucher.revoked_at
      ? [{ label: "Voucher revoked", date: voucher.revoked_at }]
      : []),
    ...(voucher.voided_at
      ? [{ label: "Voucher voided", date: voucher.voided_at }]
      : []),
  ].sort((a, b) => Date.parse(b.date) - Date.parse(a.date));
  const named =
    process.env.NODE_ENV !== "production" || Boolean(adminIdForWrite(session));
  const canRevoke =
    kind === "reimbursable" &&
    Boolean(allocation.data?.program_id) &&
    voucher.status === "issued" &&
    hasPermission(session.role, "voucher_funds.publish") &&
    named;
  const disabledReason =
    voucher.status === "redeemed"
      ? "Redeemed vouchers cannot be revoked."
      : voucher.status !== "issued"
      ? "Only unredeemed issued vouchers can be revoked."
      : !named
      ? "Sign in with a named admin account to revoke vouchers."
      : kind !== "reimbursable"
      ? "Revocation is only supported here for reimbursable vouchers."
      : !hasPermission(session.role, "voucher_funds.publish")
      ? "You have read-only access to this action."
      : "Funding details are unavailable.";
  return (
    <div className={voucherCanvas}>
      {header}
      <div className="mx-auto max-w-3xl space-y-5 p-4 sm:p-6">
        <section className={`${voucherCard} space-y-4`}>
          {(merchant.data?.banner_url || merchant.data?.image_url) && (
            <img
              src={merchant.data.banner_url || merchant.data.image_url}
              alt={merchant.data.name}
              className="h-40 w-full rounded-control object-cover sm:h-52"
            />
          )}
          <div className="flex items-center justify-between gap-3">
            <p className="flex min-w-0 items-center gap-2 text-sm font-medium text-primary-strong">
              <Coffee className="h-4 w-4 shrink-0" aria-hidden="true" />
              {merchant.data?.name ?? "Merchant unavailable"}
            </p>
            <VoucherStatus status={voucher.status} />
          </div>
          <h2 className="text-xl font-semibold tracking-tight">
            {offer.title}
          </h2>
          <CopyVoucherCode key={voucher.id} code={voucher.code} />
        </section>
        <section className={voucherCard}>
          <h3 className="mb-5 text-sm font-semibold text-ink-muted">
            Voucher summary
          </h3>
          <VoucherFacts
            items={[
              { label: "Member", value: member },
              {
                label: "Issued date",
                value: voucherDateTime(voucher.created_at),
              },
              {
                label: "Expiry date",
                value: voucher.expires_at
                  ? voucherDateTime(voucher.expires_at)
                  : "No expiry",
              },
              ...(voucher.redeemed_at
                ? [
                    {
                      label: "Redeemed date",
                      value: (
                        <span className="text-primary-strong">
                          {voucherDateTime(voucher.redeemed_at)}
                        </span>
                      ),
                    },
                  ]
                : []),
              ...(voucher.revoked_at
                ? [
                    {
                      label: "Revoked date",
                      value: voucherDateTime(voucher.revoked_at),
                    },
                    {
                      label: "Revocation reason",
                      value: voucher.revoked_reason ?? "Not recorded",
                    },
                  ]
                : []),
            ]}
          />
        </section>
        <section className={voucherCard}>
          <h3 className="mb-5 text-sm font-semibold text-ink-muted">
            Activity history
          </h3>
          <ol className="ml-2 space-y-4 border-l-2 border-[#DAE2FD]">
            {events.map((e, i) => (
              <li key={e.label} className="relative pl-5">
                <span
                  className={`absolute -left-[7px] top-1 h-3 w-3 rounded-full ${
                    i === 0 ? "bg-primary" : "bg-[#BDCAC6]"
                  }`}
                />
                <p className="text-sm font-medium">{e.label}</p>
                <p className="mt-1 text-xs text-ink-muted">
                  {voucherDateTime(e.date)}
                </p>
              </li>
            ))}
          </ol>
        </section>
        <RevokeIssuedVoucher
          key={voucher.id}
          title={offer.title}
          code={voucher.code}
          merchant={merchant.data?.name}
          member={member}
          id={voucher.id}
          fundId={allocation.data?.program_id ?? null}
          allowed={canRevoke}
          disabledReason={disabledReason}
        />
      </div>
    </div>
  );
}
