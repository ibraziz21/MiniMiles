import { notFound, redirect } from "next/navigation";
import { requireAdminSession } from "@/lib/auth";
import { earningFilters, getEarningBreakdown, isMerchantKey } from "@/lib/earningBreakdown";
import { PageHeader } from "@/components/shell/PageHeader";
import { EarningBreakdownView } from "@/components/usage/EarningBreakdownView";

export default async function MerchantEarningsPage({ params, searchParams }: {
  params: { merchantKey: string }; searchParams: { period?: string; page?: string };
}) {
  const session = await requireAdminSession("users.read");
  if (!session) redirect("/login");
  if (!isMerchantKey(params.merchantKey)) notFound();
  const { period, page } = earningFilters(searchParams);
  const { data, error } = await getEarningBreakdown(period, page, params.merchantKey);
  if (!error && data && !data.merchant_name && data.total_rows === 0) notFound();
  return <>
    <PageHeader title={data?.merchant_name ?? "Merchant earnings"} subtitle="Miles earned and estimated spend by user" />
    <div className="space-y-5 p-4 sm:p-6"><EarningBreakdownView data={data} error={error} period={period} page={page} merchantKey={params.merchantKey} /></div>
  </>;
}
