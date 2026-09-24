/**
 * GET /api/shop/vouchers/loyalty/:templateId/eligibility
 *
 * Proxies to Akiba-Platform's GET /api/v1/voucher-offers/:id/eligibility,
 * forwarding the signed-in member's own Supabase session token — same
 * forward-the-session pattern as the funded-voucher eligibility route
 * (app/api/voucher-funding/[allocationId]/eligibility). Advisory only; the
 * claim route independently re-verifies everything
 * (loyalty-qualified-vouchers-spec.md §14.2).
 */
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getServerEnv } from "@/lib/env.server";
import { getVoucherClaimFriction } from "@/lib/vouchers/claimIntent";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ templateId: string }> },
) {
  const { templateId } = await params;
  const supabase = await createClient();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const claimFriction = await getVoucherClaimFriction(user.id);

  const { akiba } = getServerEnv();
  if (!akiba.apiUrl) {
    return NextResponse.json({ error: "Service unavailable" }, { status: 503 });
  }

  let upstream: Response;
  try {
    upstream = await fetch(`${akiba.apiUrl}/api/v1/voucher-offers/${templateId}/eligibility`, {
      headers: { Authorization: `Bearer ${session.access_token}`, "Cache-Control": "no-store" },
      cache: "no-store",
    });
  } catch (err) {
    console.error("[loyalty voucher eligibility] Platform unreachable:", err);
    return NextResponse.json({ error: "Could not check eligibility right now." }, { status: 502 });
  }

  const data = await upstream.json().catch(() => null) as
    | {
        success?: boolean;
        data?: {
          eligible: boolean; alreadyClaimed: boolean; offerAvailable: boolean;
          acquisition: { mode: "miles" | "free"; milesCost: number; sufficientMiles: boolean };
          qualification: { mode: "any" | "all"; customerCopy: string; progress: unknown[] } | null;
        };
        error?: { code?: string; message?: string };
      }
    | null;

  if (!upstream.ok || !data?.success || !data.data) {
    return NextResponse.json(
      { error: data?.error?.message ?? "Could not check eligibility.", code: data?.error?.code },
      { status: upstream.status || 502 },
    );
  }

  return NextResponse.json(
    { ...data.data, claimFriction },
    { headers: { "Cache-Control": "no-store, private" } },
  );
}
