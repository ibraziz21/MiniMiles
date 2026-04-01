// app/api/mint-jobs/pending/route.ts
//
// Returns today's daily-engagement mint job statuses for the authenticated user.
// Used by the Earn page to show per-quest "Minting…" / "Minted ✓" badges.
import { requireSession } from "@/lib/auth";
import { supabase } from "@/lib/supabaseClient";

export async function GET() {
  try {
    const session = await requireSession();
    if (!session) {
      return Response.json({ success: false }, { status: 401 });
    }

    const today = new Date().toISOString().slice(0, 10);
    const userLc = session.walletAddress.toLowerCase();

    const { data, error } = await supabase
      .from("minipoint_mint_jobs")
      .select("status, points, tx_hash, payload")
      .eq("user_address", userLc)
      .gte("created_at", `${today}T00:00:00.000Z`)
      .order("created_at", { ascending: false });

    if (error) throw error;

    const jobs = (data ?? [])
      .filter(
        (j: any) =>
          j.payload?.kind === "daily_engagement" && j.payload?.questId,
      )
      .map((j: any) => ({
        questId: j.payload.questId as string,
        status: j.status as "pending" | "processing" | "completed" | "failed",
        points: j.points as number,
        txHash: j.tx_hash as string | null,
      }));

    return Response.json({ success: true, jobs });
  } catch (err: any) {
    console.error("[mint-jobs/pending]", err);
    return Response.json(
      { success: false, message: err?.message },
      { status: 500 },
    );
  }
}
