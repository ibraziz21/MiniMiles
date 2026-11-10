import { redirect } from "next/navigation";
import { PageHeader } from "@/components/shell/PageHeader";
import { QueueLoadError } from "@/components/queue/QueueLoadError";
import { MerchantReviewList } from "@/components/merchants/MerchantReviewList";
import { requireAdminSession } from "@/lib/auth";
import { supabase } from "@/lib/supabase";
import type { MerchantReviewRow } from "@/lib/merchantReviewList";

export default async function DirectoryReviewsPage() {
  const session = await requireAdminSession("merchants.read");
  if (!session) redirect("/login");
  const fields =
    "partner_id, directory_status, directory_submitted_at, directory_published_at, directory_updated_at, partners(name)";
  const [pendingResult, historyResult] = await Promise.all([
    supabase
      .from("partner_settings")
      .select(fields)
      .eq("directory_status", "pending_review")
      .order("directory_submitted_at")
      .limit(500),
    supabase
      .from("partner_settings")
      .select(fields)
      .in("directory_status", [
        "published",
        "paused",
        "suspended",
        "changes_requested",
      ])
      .order("directory_updated_at", { ascending: false })
      .limit(100),
  ]);
  const result = {
    data: [...(pendingResult.data ?? []), ...(historyResult.data ?? [])],
    error: pendingResult.error ?? historyResult.error,
  };
  const ids = result.data.map((row) => row.partner_id);
  const locationResults = await Promise.all(
    Array.from({ length: Math.ceil(ids.length / 100) }, (_, index) =>
      supabase
        .from("merchant_locations")
        .select("partner_id, address_line_1, locality, city")
        .in("partner_id", ids.slice(index * 100, (index + 1) * 100))
        .eq("active", true)
        .eq("is_primary", true)
    )
  );
  const locations = {
    data: locationResults.flatMap((result) => result.data ?? []),
    error: locationResults.some((result) => result.error),
  };
  const locationMap = new Map(
    (locations?.data ?? []).map((row) => [
      row.partner_id,
      [row.address_line_1, row.locality, row.city].filter(Boolean).join(", "),
    ])
  );
  const rows: MerchantReviewRow[] = (result.data ?? []).map((row) => ({
    id: row.partner_id,
    name:
      (row.partners as unknown as { name: string } | null)?.name ??
      "Unnamed merchant",
    location: locationMap.get(row.partner_id) ?? "",
    status: row.directory_status,
    submittedAt: row.directory_submitted_at,
    publishedAt: row.directory_published_at,
    updatedAt: row.directory_updated_at,
  }));
  return (
    <div>
      <PageHeader title="Merchant reviews" />
      <div className="mx-auto max-w-4xl p-4 sm:p-6">
        {result.error ? (
          <QueueLoadError />
        ) : (
          <MerchantReviewList
            rows={rows}
            limited={(pendingResult.data?.length ?? 0) === 500}
            locationsUnavailable={Boolean(locations?.error)}
          />
        )}
      </div>
    </div>
  );
}
