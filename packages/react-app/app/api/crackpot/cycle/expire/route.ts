// POST /api/crackpot/cycle/expire
// Cron endpoint — called every few minutes by Vercel cron or an external scheduler.
// Finds active cycles past their expiry time, marks them dead, and seeds a new cycle.
// Authorization: Bearer ADMIN_QUEUE_SECRET header required.

import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabaseClient";
import { buildNewCycle, getCycleExpiresAt } from "@/lib/server/crackpotEngine";
import { type CrackPotCycle, type CrackPotVersion } from "@/lib/crackpotTypes";
import { contractExpireCycle, contractOpenCycle, ContractVersion } from "@/lib/server/crackpotContract";

export async function POST(req: Request) {
  const secret = process.env.ADMIN_QUEUE_SECRET ?? "";
  if (secret && req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  try {
    // Find active cycles that have expired but are still marked active
    const { data: expiredCycles } = await supabase
      .from("crackpot_cycles")
      .select("*")
      .eq("status", "active")
      .lt("expires_at", new Date().toISOString());

    const expired = (expiredCycles ?? []) as CrackPotCycle[];
    const results: { cycleId: string; action: string }[] = [];

    for (const cycle of expired) {
      const ver = cycle.version as CrackPotVersion;
      const contractVer = ver === "usdt" ? ContractVersion.USDT : ContractVersion.MILES;

      await supabase
        .from("crackpot_cycles")
        .update({ status: "dead" })
        .eq("id", cycle.id)
        .eq("status", "active");

      await supabase
        .from("crackpot_attempts")
        .update({ status: "expired" })
        .eq("cycle_id", cycle.id)
        .eq("status", "active");

      results.push({ cycleId: cycle.id, action: "marked-dead" });

      // Fire contract expire — non-blocking, chain trails by ~5s
      contractExpireCycle(contractVer)
        .catch((e) => console.error(`[crackpot/expire] contractExpireCycle(${ver}) failed:`, e?.message));
    }

    // Seed a new cycle for each version that has no active cycle
    const entropyRes = await fetch("https://blockchain.info/q/latesthash").catch(() => null);
    const entropy = entropyRes?.ok ? await entropyRes.text() : `fallback-${Date.now()}`;

    for (const ver of ["miles", "usdt"] as CrackPotVersion[]) {
      const { data: active } = await supabase
        .from("crackpot_cycles")
        .select("id")
        .eq("status", "active")
        .eq("version", ver)
        .maybeSingle();

      if (!active) {
        const newCycle = buildNewCycle(entropy.trim(), ver);
        const { data: inserted } = await supabase
          .from("crackpot_cycles")
          .insert(newCycle)
          .select("id, expires_at")
          .single();

        if (inserted) {
          results.push({ cycleId: inserted.id, action: `new-${ver}-cycle-seeded` });

          // Open cycle on-chain async
          const contractVer = ver === "usdt" ? ContractVersion.USDT : ContractVersion.MILES;
          const expiresAt = new Date(inserted.expires_at);
          contractOpenCycle(contractVer, expiresAt)
            .catch((e) => console.error(`[crackpot/expire] contractOpenCycle(${ver}) failed:`, e?.message));
        }
      }
    }

    return NextResponse.json({ processed: results.length, results });
  } catch (err: any) {
    console.error("[crackpot/cycle/expire]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
