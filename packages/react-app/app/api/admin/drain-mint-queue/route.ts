import { NextResponse } from "next/server";
import { processMintQueue } from "@/lib/minipointQueue";
import { supabase } from "@/lib/supabaseClient";

const ADMIN_QUEUE_SECRET = process.env.ADMIN_QUEUE_SECRET ?? "";

function isAuthorized(req: Request) {
  if (!ADMIN_QUEUE_SECRET) return false;

  const bearer = req.headers.get("authorization");
  if (bearer === `Bearer ${ADMIN_QUEUE_SECRET}`) return true;

  const url = new URL(req.url);
  return url.searchParams.get("secret") === ADMIN_QUEUE_SECRET;
}

export async function POST(req: Request) {
  try {
    if (!isAuthorized(req)) {
      return NextResponse.json(
        { success: false, message: "unauthorized" },
        { status: 401 }
      );
    }

    const body = await req.json().catch(() => ({}));
    const requestedMax = Number(body?.maxJobs ?? 20);
    const maxJobs = Math.min(100, Math.max(1, requestedMax));

    // Reset failed + stuck-processing jobs back to pending
    const [{ count: failedReset }, { count: stuckReset }] = await Promise.all([
      supabase
        .from("minipoint_mint_jobs")
        .update({ status: "pending", attempts: 0, last_error: null })
        .eq("status", "failed")
        .select("id", { count: "exact", head: true }),
      supabase
        .from("minipoint_mint_jobs")
        .update({ status: "pending" })
        .eq("status", "processing")
        .select("id", { count: "exact", head: true }),
    ]);

    const result = await processMintQueue({ maxJobs });

    return NextResponse.json({
      success: true,
      acquired: result.acquired,
      processed: result.processed,
      reset: { failed: failedReset ?? 0, stuck: stuckReset ?? 0 },
    });
  } catch (err: any) {
    console.error("[drain-mint-queue]", err);
    return NextResponse.json(
      {
        success: false,
        message: err?.shortMessage ?? err?.message ?? "server-error",
      },
      { status: 500 }
    );
  }
}
