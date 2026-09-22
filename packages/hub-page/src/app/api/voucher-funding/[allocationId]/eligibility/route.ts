/**
 * GET /api/voucher-funding/:allocationId/eligibility
 *
 * Proxies to Akiba-Platform's GET /api/v1/voucher-funding-allocations/:id/eligibility,
 * forwarding the signed-in member's own Supabase session token — same
 * forward-the-session pattern as the claim route. Lets the offer card show
 * why a member doesn't qualify *before* they try to claim, instead of only
 * after (akiba-funded-voucher-admin-spec.md §12.2).
 */
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getServerEnv } from "@/lib/env.server";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ allocationId: string }> },
) {
  const { allocationId } = await params;
  const supabase = await createClient();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { akiba } = getServerEnv();
  if (!akiba.apiUrl) {
    return NextResponse.json({ error: "Service unavailable" }, { status: 503 });
  }

  let upstream: Response;
  try {
    upstream = await fetch(`${akiba.apiUrl}/api/v1/voucher-funding-allocations/${allocationId}/eligibility`, {
      headers: { Authorization: `Bearer ${session.access_token}`, "Cache-Control": "no-store" },
      cache: "no-store",
    });
  } catch (err) {
    console.error("[voucher-funding eligibility] Platform unreachable:", err);
    return NextResponse.json({ error: "Could not check eligibility right now." }, { status: 502 });
  }

  const data = await upstream.json().catch(() => null) as
    | { success?: boolean; data?: { eligible: boolean; alreadyClaimed: boolean; requirementsRemaining: string[]; allocationAvailable: boolean }; error?: { message?: string } }
    | null;

  if (!upstream.ok || !data?.success) {
    return NextResponse.json(
      { error: data?.error?.message ?? "Could not check eligibility." },
      { status: upstream.status || 502 },
    );
  }

  return NextResponse.json(data.data, { headers: { "Cache-Control": "no-store, private" } });
}
