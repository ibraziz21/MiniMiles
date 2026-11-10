import Link from "next/link";
import { redirect, notFound } from "next/navigation";
import { requireAdminSession } from "@/lib/auth";
import { memberSupport } from "@/lib/memberSupport";
import { VoucherHeader } from "@/components/vouchers/VoucherHeader";
import { voucherCard, VoucherFacts } from "@/components/vouchers/VoucherUi";
import { voucherDateTime } from "@/lib/voucherPresentation";
export default async function MemberDetail({
  params,
  searchParams,
}: {
  params: { id: string };
  searchParams: { page?: string };
}) {
  const session = await requireAdminSession("users.read");
  if (!session) redirect("/login");
  if (!/^[0-9a-f-]{36}$/i.test(params.id)) notFound();
  const data = await memberSupport(params.id).catch(() => undefined);
  const header = (
    <VoucherHeader
      title="Member detail"
      backHref="/users"
      name={session.name}
      role={session.role}
    />
  );
  if (data === undefined)
    return (
      <div>
        {header}
        <p role="alert" className="p-5">
          Member data could not be verified.
        </p>
      </div>
    );
  if (data === null) notFound();
  const n = Number(searchParams.page ?? 1),
    page = Number.isSafeInteger(n) && n > 0 ? n : 1;
  return (
    <div className="min-h-screen bg-[#FAF8FF]">
      {header}
      <div className="mx-auto max-w-2xl space-y-5 p-4 sm:p-6">
        <section className={voucherCard}>
          <h2 className="break-words text-xl font-semibold">
            @{data.profile.username}
          </h2>
          <p className="mt-2 break-all text-xs text-ink-muted">
            {data.profile.canonical_id}
          </p>
          <p className="mt-4 text-sm">
            Joined {voucherDateTime(data.user?.created_at)}
          </p>
        </section>
        <section className={voucherCard}>
          <VoucherFacts
            items={[
              { label: "Phone", value: data.user?.phone || "Not provided" },
              { label: "Email", value: data.user?.email || "Not provided" },
              {
                label: "Off-chain Miles",
                value: data.balance.toLocaleString(),
              },
              {
                label: "Active vouchers",
                value: data.vouchers.filter(
                  (v) =>
                    v.status === "issued" &&
                    (!v.expires_at || Date.parse(v.expires_at) > Date.now())
                ).length,
              },
            ]}
          />
        </section>
        <section className={voucherCard}>
          <h3 className="mb-4 font-semibold">Voucher activity</h3>
          {data.vouchers.slice((page - 1) * 25, page * 25).map((v) => (
            <Link
              key={v.id}
              href={`/vouchers/issued/${v.id}`}
              className="block border-t border-[#EAEDFF] py-3 text-sm"
            >
              <span className="break-all font-medium">{v.code}</span>
              <span className="ml-2 text-ink-muted">{v.status}</span>
              <span className="mt-1 block text-xs text-ink-muted">
                {voucherDateTime(v.created_at)}
              </span>
            </Link>
          ))}
          <nav
            className="flex justify-between text-sm text-primary"
            aria-label="Voucher activity pages"
          >
            {page > 1 && (
              <Link className="py-3" href={`?page=${page - 1}`}>
                Previous
              </Link>
            )}
            {data.vouchers.length > page * 25 && (
              <Link className="py-3" href={`?page=${page + 1}`}>
                Next
              </Link>
            )}
          </nav>
        </section>
        <section className={voucherCard}>
          <h3 className="font-semibold">Merchant Miles activity</h3>
          {data.ledger
            .filter((l) => l.partner_id)
            .slice(0, 50)
            .map((l) => (
              <p key={l.id} className="mt-3 text-sm">
                {l.direction === "credit" ? "+" : "−"}
                {l.amount} Miles · {voucherDateTime(l.created_at)}
              </p>
            ))}
          <p className="mt-3 text-xs text-ink-muted">
            Latest 50 merchant ledger entries
          </p>
        </section>
        {data.deletions.map((d) => (
          <Link
            key={d.id}
            href={`/account-deletions/${d.id}`}
            className="block rounded-card bg-white p-4 text-sm text-primary"
          >
            Deletion request · {d.status}
          </Link>
        ))}
      </div>
    </div>
  );
}
