import { NextResponse } from "next/server";
import { writeAdminAuditLog } from "@/lib/audit";
import { adminIdForWrite, requireAdminSession } from "@/lib/auth";
import { supabase } from "@/lib/supabase";

const GATE_TYPES = new Set([
  "min_usdt_balance",
  "prosperity_pass_holder",
  "daily_5tx_completed",
]);

function normalizeGates(raw: unknown) {
  if (!Array.isArray(raw)) throw new Error("gates must be an array");

  return raw.map((gate) => {
    if (!gate || typeof gate !== "object") throw new Error("Invalid gate");

    const record = gate as Record<string, unknown>;
    const type = String(record.type);
    if (!GATE_TYPES.has(type)) throw new Error("Invalid gate type");

    if (type === "min_usdt_balance") {
      const minUsd = Number(record.minUsd);
      if (!Number.isFinite(minUsd) || minUsd <= 0) throw new Error("Invalid minUsd");
      return { type, minUsd };
    }

    return { type };
  });
}

export async function PUT(req: Request) {
  const session = await requireAdminSession("orders.write");
  if (!session) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  let body: { roundId?: unknown; mode?: unknown; enabled?: unknown; gates?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const roundId = Number(body.roundId);
  if (!Number.isInteger(roundId) || roundId <= 0) {
    return NextResponse.json({ error: "Valid roundId is required" }, { status: 400 });
  }

  let gates;
  try {
    gates = normalizeGates(body.gates);
  } catch (err: any) {
    return NextResponse.json({ error: err?.message ?? "Invalid gates" }, { status: 400 });
  }

  const adminUserId = adminIdForWrite(session);
  const values = {
    round_id: roundId,
    mode: body.mode === "any" ? "any" : "all",
    gates,
    enabled: body.enabled !== false,
    updated_by: adminUserId,
    created_by: adminUserId,
  };

  const { data, error } = await supabase
    .from("raffle_requirements")
    .upsert(values, { onConflict: "round_id" })
    .select("id, round_id, mode, gates, enabled")
    .single();

  if (error) {
    return NextResponse.json(
      { error: "Failed to save raffle requirements" },
      { status: 500 },
    );
  }

  void writeAdminAuditLog({
    adminUserId,
    action: "games.raffle.requirements_upserted",
    targetType: "raffle_round",
    targetId: String(roundId),
    metadata: values,
  });

  return NextResponse.json({ ok: true, requirement: data });
}
