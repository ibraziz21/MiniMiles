// Route-level Suspense boundary — page.tsx awaits the full merchant-profile
// fetch (getPublicMerchant) before returning any markup, so without this a
// slow backend meant a blank tab, not a skeleton.
export default function Loading() {
  return (
    <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8" aria-busy="true" aria-label="Loading merchant profile">
      <div className="mb-6 h-4 w-28 animate-pulse rounded bg-akiba-card" />

      <div className="mb-8 flex items-start gap-3 border-b border-akiba-line pb-6">
        <div className="h-20 w-20 shrink-0 animate-pulse rounded-2xl bg-akiba-card" />
        <div className="min-w-0 flex-1 space-y-2">
          <div className="h-6 w-48 animate-pulse rounded bg-akiba-card" />
          <div className="h-4 w-64 animate-pulse rounded bg-akiba-card" />
          <div className="h-4 w-40 animate-pulse rounded bg-akiba-card" />
        </div>
      </div>

      <div className="grid items-start gap-8 lg:grid-cols-[1fr,320px]">
        <div className="grid gap-3 sm:grid-cols-2">
          {Array.from({ length: 2 }).map((_, i) => (
            <div key={i} className="h-28 animate-pulse rounded-2xl border border-akiba-line bg-akiba-card" />
          ))}
        </div>
        <div className="h-48 animate-pulse rounded-2xl border border-akiba-line bg-akiba-card" />
      </div>
    </main>
  );
}
