export default function OverviewLoading() {
  return (
    <div
      role="status"
      aria-label="Loading overview"
      className="space-y-5 p-4 sm:p-6"
    >
      <span className="sr-only">Loading overview…</span>
      <div className="h-10 w-44 rounded-control bg-border/60 motion-safe:animate-pulse" />
      <div className="grid gap-4 lg:grid-cols-3" aria-hidden="true">
        <div className="h-96 rounded-card bg-[#242225]/10 motion-safe:animate-pulse lg:col-span-2" />
        <div className="h-64 rounded-card bg-primary/10 motion-safe:animate-pulse" />
      </div>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3" aria-hidden="true">
        {[0, 1, 2, 3, 4].map((i) => (
          <div
            key={i}
            className="h-28 rounded-card bg-white motion-safe:animate-pulse"
          />
        ))}
      </div>
    </div>
  );
}
