// GET /api/internal/verified-discovery-shadow-report
// Shadow/canary comparison tooling (verified-discovery-market-readiness-
// hardening-spec.md §12 Phase B: "Compare eligibility, ranking, labels,
// items and cover photo with a complete reference query. Investigate every
// case where V2 would expose more content than the canonical eligibility
// result.").
//
// V1 is the live path members see today (lib/home/verifiedDiscovery.ts,
// already rebuilt on the canonical eligibility projection — see 090). V2 is
// the full-corpus SQL snapshot (091). Both independently implement the same
// Ranking V1 rule (unique-contributor dedup, banding, label/item
// thresholds) — one in TypeScript, one in PL/pgSQL — so comparing their
// live outputs is exactly the right check for the two to have silently
// drifted apart. This diffs them for every partner currently eligible
// enough to have a snapshot, force-recomputing each snapshot first so the
// comparison reflects current truth rather than whatever the worker last
// got to. Internal/ops only; nothing here is served publicly, and running
// it changes no public-facing behavior.
import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getVerifiedDiscoveryPartnerAggregates } from "@/lib/home/verifiedDiscovery";
import { isInternalWorkerRequest } from "@/lib/internalWorkerAuth";

type SnapshotRow = {
  partner_id: string;
  active_positive_unique_count: number;
  public_count_band: string | null;
  qualified_experience_labels: unknown;
  qualified_recommended_items: unknown;
  cover_photo_id: string | null;
  generated_at: string;
  suppression_reason: string | null;
};

function v1BandLabel(count: number): string {
  return count < 5 ? "new" : String(count);
}

function sameSet(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const setB = new Set(b);
  return a.every((item) => setB.has(item));
}

function isSupersetOf(superset: string[], subset: string[]): boolean {
  const set = new Set(superset);
  return subset.every((item) => set.has(item)) && superset.length > subset.length;
}

export async function GET(request: Request) {
  if (!isInternalWorkerRequest(request, true)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const admin = createAdminClient();

  const { data: snapshotPartners, error: partnersError } = await admin
    .from("merchant_discovery_public_snapshots")
    .select("partner_id");
  if (partnersError) {
    console.error("[verified-discovery-shadow-report] snapshot partner lookup failed:", partnersError.message);
    return NextResponse.json({ error: "Shadow report is unavailable" }, { status: 503 });
  }

  const partnerIds = [...new Set((snapshotPartners ?? []).map((row: { partner_id: string }) => row.partner_id))];

  // Force a fresh recompute per partner so this always diffs current truth,
  // independent of how recently the scheduled worker last ran.
  for (const partnerId of partnerIds) {
    const { error: recomputeError } = await admin.rpc("recompute_merchant_discovery_snapshot", { p_partner_id: partnerId });
    if (recomputeError) {
      console.error("[verified-discovery-shadow-report] recompute failed for", partnerId, recomputeError.message);
    }
  }

  const [{ data: snapshotRows, error: snapshotError }, v1Aggregates] = await Promise.all([
    admin
      .from("merchant_discovery_public_snapshots")
      .select("partner_id, active_positive_unique_count, public_count_band, qualified_experience_labels, qualified_recommended_items, cover_photo_id, generated_at, suppression_reason")
      .in("partner_id", partnerIds),
    getVerifiedDiscoveryPartnerAggregates(),
  ]);
  if (snapshotError) {
    console.error("[verified-discovery-shadow-report] snapshot read failed:", snapshotError.message);
    return NextResponse.json({ error: "Shadow report is unavailable" }, { status: 503 });
  }

  const mismatches: Array<{
    partnerId: string;
    field: "band" | "lovedLabels" | "recommendedItems" | "coverPhotoId";
    v1: unknown;
    v2: unknown;
    direction: "v2_shows_more" | "v2_shows_less" | "different";
  }> = [];
  let comparable = 0;

  for (const row of (snapshotRows ?? []) as SnapshotRow[]) {
    const v1 = v1Aggregates.get(row.partner_id);
    // A V2 row suppressed (merchant unpublished, no eligible photo) with no
    // V1 aggregate at all is agreement, not a gap — both sides show nothing.
    if (row.suppression_reason) {
      if (v1) {
        mismatches.push({
          partnerId: row.partner_id, field: "coverPhotoId",
          v1: v1.coverPhotoId, v2: null, direction: "v2_shows_less",
        });
      }
      continue;
    }
    if (!v1) {
      // V2 thinks this merchant is eligible; V1's live aggregation found
      // nothing at all for it. This is exactly the dangerous direction the
      // spec calls out: V2 would expose content V1 does not.
      mismatches.push({
        partnerId: row.partner_id, field: "coverPhotoId",
        v1: null, v2: row.cover_photo_id, direction: "v2_shows_more",
      });
      continue;
    }
    comparable++;

    const v2Band = row.public_count_band ?? "new";
    const v1Band = v1BandLabel(v1.uniqueContributorCount);
    if (v2Band !== v1Band) {
      mismatches.push({
        partnerId: row.partner_id, field: "band", v1: v1Band, v2: v2Band,
        direction: v2Band !== "new" && v1Band === "new" ? "v2_shows_more" : "different",
      });
    }

    const v2Labels = Array.isArray(row.qualified_experience_labels) ? row.qualified_experience_labels as string[] : [];
    if (!sameSet(v1.lovedLabels, v2Labels)) {
      mismatches.push({
        partnerId: row.partner_id, field: "lovedLabels", v1: v1.lovedLabels, v2: v2Labels,
        direction: isSupersetOf(v2Labels, v1.lovedLabels) ? "v2_shows_more"
          : isSupersetOf(v1.lovedLabels, v2Labels) ? "v2_shows_less" : "different",
      });
    }

    const v2Items = Array.isArray(row.qualified_recommended_items) ? row.qualified_recommended_items as string[] : [];
    if (!sameSet(v1.recommendedItems, v2Items)) {
      mismatches.push({
        partnerId: row.partner_id, field: "recommendedItems", v1: v1.recommendedItems, v2: v2Items,
        direction: isSupersetOf(v2Items, v1.recommendedItems) ? "v2_shows_more"
          : isSupersetOf(v1.recommendedItems, v2Items) ? "v2_shows_less" : "different",
      });
    }

    if (v1.coverPhotoId !== row.cover_photo_id) {
      mismatches.push({
        partnerId: row.partner_id, field: "coverPhotoId", v1: v1.coverPhotoId, v2: row.cover_photo_id,
        direction: v1.coverPhotoId && !row.cover_photo_id ? "v2_shows_less"
          : !v1.coverPhotoId && row.cover_photo_id ? "v2_shows_more" : "different",
      });
    }
  }

  const unsafeMismatches = mismatches.filter((m) => m.direction === "v2_shows_more");
  if (unsafeMismatches.length > 0) {
    console.error("[verified-discovery-shadow-report] unsafe mismatch", {
      count: unsafeMismatches.length,
      // Partner ids and field values stay in the authenticated response;
      // the alert log contains aggregate telemetry only.
      partnersCompared: comparable,
    });
  }

  return NextResponse.json(
    {
      partnersCompared: comparable,
      snapshotPartnerCount: partnerIds.length,
      mismatches,
      unsafeMismatchCount: unsafeMismatches.length,
      // §12 Phase B's cutover gate: "zero unsafe mismatches" for seven
      // consecutive days. This endpoint only ever reports one point in
      // time — healthy here is necessary, not sufficient, for that gate.
      healthy: unsafeMismatches.length === 0,
    },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}
