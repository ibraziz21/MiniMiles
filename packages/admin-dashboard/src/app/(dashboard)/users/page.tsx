import Link from "next/link";
import { redirect } from "next/navigation";
import { requireAdminSession } from "@/lib/auth";
import { memberDirectory } from "@/lib/memberSupport";
import { VoucherHeader } from "@/components/vouchers/VoucherHeader";
export default async function UsersPage({
  searchParams,
}: {
  searchParams: { q?: string; page?: string };
}) {
  const session = await requireAdminSession("users.read");
  if (!session) redirect("/login");
  const n = Number(searchParams.page ?? 1),
    page = Number.isSafeInteger(n) && n > 0 ? n : 1;
  const result = await memberDirectory(searchParams.q ?? "", page);
  return (
    <div className="min-h-screen bg-[#FAF8FF]">
      <VoucherHeader title="Members" name={session.name} role={session.role} />
      <div className="mx-auto max-w-3xl space-y-5 p-4 sm:p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-2xl font-semibold">Members</h2>
          <Link href="/account-deletions" className="py-3 text-sm text-primary">
            Deletion requests
          </Link>
        </div>
        <form className="flex gap-2">
          <input
            name="q"
            type="search"
            aria-label="Search members"
            placeholder="Username or member ID…"
            defaultValue={searchParams.q}
            className="min-h-12 min-w-0 flex-1 rounded-card border-0 bg-white px-4 text-base"
          />
          <button className="min-h-11 rounded-control bg-[#EAEDFF] px-4 text-sm">
            Search
          </button>
        </form>
        {result.error ? (
          <p role="alert">Members could not be loaded. Refresh to retry.</p>
        ) : (
          <>
            <p className="text-xs text-ink-muted">
              {result.count ?? 0} members · Page {page}
            </p>
            {result.data?.map((u) => (
              <Link
                key={u.canonical_id}
                href={`/users/${u.canonical_id}`}
                className="flex gap-3 rounded-card bg-white p-4 shadow-sm"
              >
                <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-[#D9F9FC] text-primary">
                  {u.username?.slice(0, 2).toUpperCase()}
                </span>
                <span className="min-w-0">
                  <span className="block break-words font-semibold">
                    @{u.username}
                  </span>
                  <span className="mt-1 block break-all text-xs text-ink-muted">
                    {u.canonical_id}
                  </span>
                </span>
              </Link>
            ))}
            {!result.data?.length && <p>No matching members.</p>}
            <nav
              className="flex justify-between gap-3 text-sm text-primary"
              aria-label="Member pages"
            >
              {page > 1 && (
                <Link
                  className="py-3"
                  href={`/users?q=${encodeURIComponent(
                    searchParams.q ?? ""
                  )}&page=${page - 1}`}
                >
                  Previous
                </Link>
              )}
              {(result.count ?? 0) > page * 50 && (
                <Link
                  className="py-3"
                  href={`/users?q=${encodeURIComponent(
                    searchParams.q ?? ""
                  )}&page=${page + 1}`}
                >
                  Next
                </Link>
              )}
            </nav>
          </>
        )}
      </div>
    </div>
  );
}
