import { NextResponse } from "next/server";
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

    // Reset failed + stuck-processing jobs back to pending
    await Promise.all([
      supabase
        .from("minipoint_mint_jobs")
        .update({ status: "pending", attempts: 0, last_error: null })
        .eq("status", "failed"),
      supabase
        .from("minipoint_mint_jobs")
        .update({ status: "pending" })
        .eq("status", "processing"),
    ]);

    const { data: counts } = await supabase
      .from("minipoint_mint_jobs")
      .select("status")
      .in("status", ["pending", "processing", "failed"]);

    return NextResponse.json({
      success: true,
      message: "Stale jobs reset to pending. Backend worker will drain automatically.",
      pending: counts?.filter((r) => r.status === "pending").length ?? 0,
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
