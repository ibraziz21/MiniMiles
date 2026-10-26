export default function UsageLoading() {
  return <div role="status" className="space-y-4 p-4 sm:p-6">
    <p className="text-sm text-ink-muted">Loading earning details…</p>
    <div aria-hidden="true" className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      {[0, 1, 2, 3].map(key => <div key={key} className="h-32 rounded-card border border-border bg-surface-subtle" />)}
    </div>
  </div>;
}
