import { redirect } from "next/navigation";
import { requireAdminSession } from "@/lib/auth";
import { PageHeader } from "@/components/shell/PageHeader";
import { QueueLoadError } from "@/components/queue/QueueLoadError";
import { UnifiedQueueView } from "@/components/queue/UnifiedQueueView";
import { hasPermission } from "@/types";
import { getPendingQueueItems } from "@/lib/unifiedQueue";

export default async function UnifiedQueuePage() {
  const session = await requireAdminSession();
  if (!session) redirect("/login");

  let items: Awaited<ReturnType<typeof getPendingQueueItems>> = [];
  let failed = false;
  try {
    items = await getPendingQueueItems(session.role);
  } catch {
    failed = true;
  }

  return (
    <div>
      <PageHeader title="Queue" />
      <div className="p-4 sm:p-6">
        {failed ? (
          <QueueLoadError />
        ) : (
          <UnifiedQueueView
            items={items}
            canBrowseVisits={hasPermission(session.role, "discovery.read")}
          />
        )}
      </div>
    </div>
  );
}
