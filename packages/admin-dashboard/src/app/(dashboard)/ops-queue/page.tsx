import { redirect } from "next/navigation";
import { requireAdminSession } from "@/lib/auth";
import { PageHeader } from "@/components/shell/PageHeader";
import { UnifiedQueueView } from "@/components/queue/UnifiedQueueView";
import { getQueueItems } from "@/lib/unifiedQueue";

export default async function UnifiedQueuePage() {
  const session = await requireAdminSession();
  if (!session) redirect("/login");

  let items: Awaited<ReturnType<typeof getQueueItems>> = [];
  let failed = false;
  try { items = await getQueueItems(session.role); } catch { failed = true; }

  return (
    <div>
      <PageHeader title="Queue" subtitle="Merchant publishing, image review, report reviews and verified visits" />
      <div className="p-4 sm:p-6">
        {failed ? <p role="alert" className="rounded-card border border-danger/30 p-4 text-sm">The queue could not be loaded. <a href="/ops-queue" className="text-primary underline">Retry queue</a></p> : <UnifiedQueueView items={items} />}
        <p className="mt-4 text-sm text-ink-muted">Shows up to 150 entries per type. Verified visits are automatically verified; publishing, images and reports require review. <a href="/verified-visits" className="text-primary underline">Browse verified visits</a></p>
      </div>
    </div>
  );
}
