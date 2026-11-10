export default function QueueLoading() {
  return (
    <div
      role="status"
      aria-label="Loading reviews"
      className="space-y-4 p-4 sm:p-6"
    >
      <span className="sr-only">Loading reviews…</span>
      <div
        aria-hidden="true"
        className="h-10 w-40 rounded-control bg-border/60 motion-safe:animate-pulse"
      />
      {[0, 1, 2].map((i) => (
        <div
          key={i}
          aria-hidden="true"
          className="h-20 rounded-card bg-white motion-safe:animate-pulse"
        />
      ))}
    </div>
  );
}
