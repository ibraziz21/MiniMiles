// POST /api/internal/verified-discovery-rebuild
// Operational tool (verified-discovery-market-readiness-hardening-spec.md
// §8.3: "rebuild one merchant or the full pilot cohort without exposing
// private data"). Body { partnerId? }: a single merchant recomputes
// immediately and synchronously; omitting it rebuilds every merchant
// currently enrolled in the pilot. Internal/ops only — this does not change
// what any public surface serves (the snapshot it rebuilds is still
// shadow-mode, §12 Phase B), and the response never contains anything more
// than partner ids already known to the caller.
import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isInternalWorkerRequest } from "@/lib/internalWorkerAuth";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function POST(request: Request) {
  if (!isInternalWorkerRequest(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json().catch(() => ({})) as { partnerId?: string };
  if (body.partnerId !== undefined && !UUID_PATTERN.test(body.partnerId)) {
    return NextResponse.json({ error: "Invalid partnerId." }, { status: 400 });
  }

  const admin = createAdminClient();

  if (body.partnerId) {
    const { error } = await admin.rpc("recompute_merchant_discovery_snapshot", { p_partner_id: body.partnerId });
    if (error) {
      console.error("[verified-discovery-rebuild] recompute failed:", error.message);
      return NextResponse.json({ error: "Rebuild failed" }, { status: 500 });
    }
    return NextResponse.json({ ok: true, rebuilt: [body.partnerId] });
  }

  const { data: settingsRows, error: settingsError } = await admin
    .from("merchant_discovery_settings")
    .select("partner_id")
    .eq("contributions_enabled", true);
  if (settingsError) {
    console.error("[verified-discovery-rebuild] cohort lookup failed:", settingsError.message);
    return NextResponse.json({ error: "Rebuild failed" }, { status: 500 });
  }

  const partnerIds = (settingsRows ?? []).map((row: { partner_id: string }) => row.partner_id);
  const rebuilt: string[] = [];
  const failed: string[] = [];
  for (const partnerId of partnerIds) {
    const { error } = await admin.rpc("recompute_merchant_discovery_snapshot", { p_partner_id: partnerId });
    if (error) {
      console.error("[verified-discovery-rebuild] recompute failed for", partnerId, error.message);
      failed.push(partnerId);
    } else {
      rebuilt.push(partnerId);
    }
  }

  return NextResponse.json({ ok: failed.length === 0, rebuilt, failed });
}
