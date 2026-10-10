import { redirect } from "next/navigation";
import { AlertCircle } from "lucide-react";
import { PageHeader } from "@/components/shell/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { DiscoveryPhotoActions, DiscoveryPhotoPreview, DiscoverySuppressionActions } from "@/components/discovery/DiscoveryPhotoActions";
import { requireAdminSession } from "@/lib/auth";
import { supabase } from "@/lib/supabase";
import { hasPermission } from "@/types";
import { formatDateTime } from "@/lib/utils";

// First-party visit-photo moderation queue
// (verified-discovery-acquisition-v1-spec.md §13.2, §13.3). Only photos
// that have finished processing (EXIF-stripped, transcoded) reach
// `pending` here — nothing below is public until approved, and nothing
// approved here is served publicly until Stage 3's public-rendering wiring
// exists.
interface PhotoRow {
  id: string;
  partner_id: string;
  submitted_at: string;
  partners: { name: string } | null;
}

interface ApprovedPhotoRow {
  id: string;
  partner_id: string;
  approved_at: string | null;
  suppressed_at: string | null;
  partners: { name: string } | null;
}

async function getPendingPhotos(): Promise<{ rows: PhotoRow[]; error: string | null }> {
  const { data, error } = await supabase
    .from("merchant_visit_photos")
    .select("id, partner_id, submitted_at, partners(name)")
    .eq("moderation_status", "pending")
    .order("submitted_at", { ascending: true })
    .limit(50);

  if (error) {
    console.error("[discovery-photos] queue failed", error.message);
    return { rows: [], error: "The photo moderation queue could not be loaded." };
  }
  return { rows: (data ?? []) as unknown as PhotoRow[], error: null };
}

// Live (approved) photos — the emergency-suppression surface (hardening
// spec §7.1/§8.3). Anything here can currently appear in a public verified-
// visit gallery or the Discovery spotlight.
async function getApprovedPhotos(): Promise<{ rows: ApprovedPhotoRow[]; error: string | null }> {
  const { data, error } = await supabase
    .from("merchant_visit_photos")
    .select("id, partner_id, approved_at, suppressed_at, partners(name)")
    .eq("moderation_status", "approved")
    .order("approved_at", { ascending: false })
    .limit(50);

  if (error) {
    console.error("[discovery-photos] approved queue failed", error.message);
    return { rows: [], error: "The live photo list could not be loaded." };
  }
  return { rows: (data ?? []) as unknown as ApprovedPhotoRow[], error: null };
}

export default async function DiscoveryPhotosPage() {
  const session = await requireAdminSession("discovery.read");
  if (!session) redirect("/login");

  const [{ rows, error }, { rows: approvedRows, error: approvedError }] = await Promise.all([
    getPendingPhotos(),
    getApprovedPhotos(),
  ]);
  const canWrite = hasPermission(session.role, "discovery.write");

  return (
    <div>
      <PageHeader title="Discovery Photos" subtitle="First-party visit photos awaiting moderation" />
      <div className="space-y-6 p-4 sm:p-6">
        {error && (
          <div className="flex items-center gap-3 rounded-card border border-danger/30 bg-danger/5 px-4 py-3 text-sm text-danger">
            <AlertCircle className="h-4 w-4 shrink-0" />
            {error}
          </div>
        )}

        <Card>
          <CardHeader>
            <CardTitle>Pending ({rows.length})</CardTitle>
          </CardHeader>
          <CardContent>
            {rows.length === 0 ? (
              <EmptyState message="Queue is clear. Newly processed photos will appear here." isHealthy />
            ) : (
              <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                {rows.map((row) => (
                  <div key={row.id} className="flex flex-col gap-3 rounded-card border border-border p-4">
                    <DiscoveryPhotoPreview photoId={row.id} />
                    <div>
                      <p className="text-sm font-medium text-ink">{row.partners?.name ?? "Unknown merchant"}</p>
                      <p className="text-xs text-ink-muted">Submitted {formatDateTime(row.submitted_at)}</p>
                    </div>
                    {canWrite ? (
                      <DiscoveryPhotoActions photoId={row.id} />
                    ) : (
                      <p className="text-xs text-ink-muted">Read-only access</p>
                    )}
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Live ({approvedRows.length})</CardTitle>
          </CardHeader>
          <CardContent>
            {approvedError && (
              <div className="mb-4 flex items-center gap-3 rounded-card border border-danger/30 bg-danger/5 px-4 py-3 text-sm text-danger">
                <AlertCircle className="h-4 w-4 shrink-0" />
                {approvedError}
              </div>
            )}
            {approvedRows.length === 0 ? (
              <EmptyState message="Nothing approved yet." isHealthy={false} />
            ) : (
              <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                {approvedRows.map((row) => {
                  const suppressed = row.suppressed_at !== null;
                  return (
                    <div key={row.id} className="flex flex-col gap-3 rounded-card border border-border p-4">
                      <DiscoveryPhotoPreview photoId={row.id} />
                      <div>
                        <p className="text-sm font-medium text-ink">{row.partners?.name ?? "Unknown merchant"}</p>
                        <p className="text-xs text-ink-muted">
                          Approved {row.approved_at ? formatDateTime(row.approved_at) : "—"}
                          {suppressed && <span className="ml-1 font-semibold text-danger">· Suppressed</span>}
                        </p>
                      </div>
                      {canWrite ? (
                        <DiscoverySuppressionActions photoId={row.id} suppressed={suppressed} />
                      ) : (
                        <p className="text-xs text-ink-muted">Read-only access</p>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
