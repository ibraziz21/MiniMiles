// POST /api/crackpot/attempt/upsell
// Unlock 3 more attempts after the free 3 are exhausted.
// Version A: burns 30 Miles (stand-in for $0.05 USD until payment provider wired)
// Version B: pulls $0.10 USDT from player → treasury (same rate as standard entry)

import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabaseClient";
import { safeBurnMiniPoints } from "@/lib/minipoints";
import { collectUsdtEntry } from "@/lib/server/crackpotUsdt";
import {
  type CrackPotCycle,
  type CrackPotAttempt,
  FREE_ATTEMPTS_PER_CYCLE,
  UPSELL_ATTEMPTS_PER_PURCHASE,
  UPSELL_COST_MILES,
  UPSELL_COST_USDT,
  HOUSE_RAKE_USDT,
} from "@/lib/crackpotTypes";

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { address, version = "miles" } = body as { address: string; version?: string };

    if (!address || typeof address !== "string") {
      return NextResponse.json({ error: "address required" }, { status: 400 });
    }
    if (version !== "miles" && version !== "usdt") {
      return NextResponse.json({ error: "invalid version" }, { status: 400 });
    }
    const playerAddress = address.toLowerCase();
    const isUsdt = version === "usdt";

    const { data: cycle } = await supabase
      .from("crackpot_cycles")
      .select("id, status, expires_at, pot_balance, pot_cap")
      .eq("status", "active")
      .eq("version", version)
      .maybeSingle();

    if (!cycle) return NextResponse.json({ error: "No active cycle" }, { status: 404 });
    const c = cycle as Pick<CrackPotCycle, "id" | "status" | "expires_at" | "pot_balance" | "pot_cap">;

    if (new Date(c.expires_at) < new Date()) {
      return NextResponse.json({ error: "Cycle has expired" }, { status: 409 });
    }

    const { data: attempts } = await supabase
      .from("crackpot_attempts")
      .select("id, is_paid, status")
      .eq("cycle_id", c.id)
      .eq("player_address", playerAddress);

    const allAttempts = (attempts ?? []) as Pick<CrackPotAttempt, "id" | "is_paid" | "status">[];
    const freeUsed = allAttempts.filter((a) => !a.is_paid).length;

    if (freeUsed < FREE_ATTEMPTS_PER_CYCLE) {
      return NextResponse.json({ error: "You still have free attempts remaining" }, { status: 400 });
    }

    const paidUnlocked = allAttempts.filter((a) => a.is_paid).length;
    const packsAlreadyBought = Math.ceil(paidUnlocked / UPSELL_ATTEMPTS_PER_PURCHASE);
    const paidRemaining = packsAlreadyBought * UPSELL_ATTEMPTS_PER_PURCHASE - paidUnlocked;

    if (paidRemaining > 0) {
      return NextResponse.json({ error: "You still have paid attempts remaining", paidAttemptsRemaining: paidRemaining }, { status: 400 });
    }

    const packLabel = `crackpot-upsell-${c.id}-pack${packsAlreadyBought + 1}`;

    if (isUsdt) {
      await collectUsdtEntry({
        from: playerAddress as `0x${string}`,
        amountUsd: UPSELL_COST_USDT,
        reason: packLabel,
      });
      // Same 50/50 split as regular entry — $0.05 → pot
      const potIncrement = Math.round(UPSELL_COST_USDT * (1 - HOUSE_RAKE_USDT) * 100);
      const newBalance = Math.min(c.pot_balance + potIncrement, c.pot_cap);
      await supabase.from("crackpot_cycles").update({ pot_balance: newBalance }).eq("id", c.id);
    } else {
      await safeBurnMiniPoints({
        from: playerAddress as `0x${string}`,
        points: UPSELL_COST_MILES,
        reason: packLabel,
      });
    }

    return NextResponse.json({
      success: true,
      attemptsUnlocked: UPSELL_ATTEMPTS_PER_PURCHASE,
    });
  } catch (err: any) {
    console.error("[crackpot/attempt/upsell]", err);
    const msg = err?.message ?? "Internal error";
    if (msg.includes("Insufficient USDT allowance")) {
      return NextResponse.json({ error: msg, code: "insufficient_allowance" }, { status: 402 });
    }
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
