import { redirect } from "next/navigation";
import { requireAdminSession } from "@/lib/auth";
import { PageHeader } from "@/components/shell/PageHeader";
import { UnifiedQueueView } from "@/components/queue/UnifiedQueueView";
import { getQueueItems } from "@/lib/unifiedQueue";

// Permission is enforced per source inside getQueueItems(), not at the page
// level — unlike the old single-source ops-queue page (which required
// "incidents.read" for everyone), this page serves 7 different permission
// domains at once, so a role with e.g. only finance.read and referrals.read
// (no incidents.read) still sees their own permitted sources here.
export default async function UnifiedQueuePage() {
  const session = await requireAdminSession();
  if (!session) redirect("/login");

  const items = await getQueueItems(session.role);

  return (
    <div>
      <PageHeader title="Queue" subtitle="Everything waiting on admin action, across every source" />
      <div className="p-4 sm:p-6">
        <UnifiedQueueView items={items} currentAdminId={session.adminUserId} />
      </div>
    </div>
  );
}
