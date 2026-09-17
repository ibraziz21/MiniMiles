// Route-level Suspense boundary — page.tsx awaits its entire directory
// fetch (listPublicMerchants + categories + cities) before returning any
// markup, so without this a slow backend meant a blank tab, not a skeleton.
export default function Loading() {
  return (
    <main className="mx-auto max-w-7xl px-4 pt-3 pb-2 sm:px-6 sm:pt-8 sm:pb-4 lg:px-8">
      <div className="mb-3 sm:mb-8">
        <div className="h-8 w-40 animate-pulse rounded-lg bg-akiba-card sm:h-9 sm:w-56" />
        <div className="mt-2 h-4 w-64 animate-pulse rounded bg-akiba-card sm:h-5 sm:w-80" />
      </div>

      <div className="mb-4 h-[42px] animate-pulse rounded-xl bg-akiba-card" />

      <div className="grid gap-3 sm:grid-cols-2 sm:gap-5 lg:grid-cols-3" aria-busy="true" aria-label="Loading merchants">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="h-64 animate-pulse rounded-2xl border border-akiba-line bg-akiba-card" />
        ))}
      </div>
    </main>
  );
}
