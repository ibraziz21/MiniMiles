import Link from "next/link";
import { redirect } from "next/navigation";
import { requireAdminSession } from "@/lib/auth";
import { supabase } from "@/lib/supabase";
import { PageHeader } from "@/components/shell/PageHeader";
import { Badge } from "@/components/ui/badge";

const LIMIT = 25;
export default async function VerifiedVisitsPage({ searchParams }: { searchParams: { page?: string; visit?: string } }) {
  const session = await requireAdminSession("discovery.read");
  if (!session) redirect("/login");
  const requestedPage = Number(searchParams.page ?? 1);
  const page = Number.isSafeInteger(requestedPage) && requestedPage > 0 && requestedPage <= 10000 ? requestedPage : 1;
  const visit = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(searchParams.visit ?? "") ? searchParams.visit : undefined;
  let query = supabase.from("merchant_discovery_contributions")
    .select("id, partner_id, submitted_at, would_recommend, experience_option_ids, partners(name)", { count: "exact" })
    .is("withdrawn_at", null).is("suppressed_at", null);
  if (visit) query = query.eq("id", visit);
  const { data, count, error } = await query.order("submitted_at", { ascending: false }).order("id").range((page - 1) * LIMIT, page * LIMIT - 1);
  const href = (p: number) => `/verified-visits?page=${p}${visit ? `&visit=${visit}` : ""}`;
  return <>
    <PageHeader title="Verified visits" subtitle="Submitted visit contributions backed by verified earning events" />
    <div className="mx-auto max-w-5xl space-y-4 p-4 sm:p-6">
      <p className="text-sm text-ink-muted">Visits are automatically verified. Images and member reports have separate review queues.</p>
      <div className="flex flex-wrap gap-3">
        <Link href="/discovery-photos" className="inline-flex min-h-11 items-center text-sm font-medium text-primary underline">Image review</Link>
        <Link href="/discovery-reports" className="inline-flex min-h-11 items-center text-sm font-medium text-primary underline">Report reviews</Link>
        {visit && <Link href="/verified-visits" className="inline-flex min-h-11 items-center text-sm font-medium text-primary underline">All verified visits</Link>}
      </div>
      {error ? <p role="alert" className="rounded-card border border-danger/30 p-4">Verified visits could not be loaded. <Link href={href(page)} className="text-primary underline">Retry visits</Link></p> : <>
        <p className="text-sm text-ink-muted">{count ?? 0} verified visit{count === 1 ? "" : "s"}</p>
        {!data?.length ? <p className="rounded-card border border-border bg-surface p-6 text-sm">No verified visits on this page.</p> : <ul className="divide-y divide-border rounded-card border border-border bg-surface">
          {data.map(row => <li key={row.id} className="space-y-2 p-4">
            <div className="flex flex-wrap items-center justify-between gap-2"><h2 className="text-sm font-semibold text-ink">{(row.partners as unknown as { name: string } | null)?.name ?? "Merchant visit"}</h2><Badge variant="success">Verified</Badge></div>
            <p className="text-sm text-ink-muted">{new Date(row.submitted_at).toLocaleString("en-KE", { timeZone: "Africa/Nairobi" })} EAT · {row.would_recommend === null ? "No recommendation supplied" : row.would_recommend ? "Would recommend" : "Would not recommend"}</p>
            <p className="break-all text-xs text-ink-muted">Visit {row.id}</p>
          </li>)}
        </ul>}
        <nav aria-label="Verified visits pages" className="flex justify-between gap-3 text-sm font-medium text-primary">
          {page > 1 && <Link className="inline-flex min-h-11 items-center underline" href={href(page - 1)}>Previous</Link>}
          {(count ?? 0) > page * LIMIT && <Link className="ml-auto inline-flex min-h-11 items-center underline" href={href(page + 1)}>Next</Link>}
        </nav>
      </>}
    </div>
  </>;
}
