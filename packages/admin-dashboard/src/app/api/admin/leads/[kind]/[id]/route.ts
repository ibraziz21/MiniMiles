import { NextResponse } from "next/server";
import { adminIdForWrite, requireAdminSession } from "@/lib/auth";
import { supabase } from "@/lib/supabase";
import { writeAdminAuditLog } from "@/lib/audit";

const leadTables = {
  partner: "partner_leads",
  merchant: "merchant_leads",
} as const;

const leadStatuses = new Set(["new", "contacted", "qualified", "closed"]);

type LeadKind = keyof typeof leadTables;

export async function PATCH(
  request: Request,
  { params }: { params: { kind: string; id: string } },
) {
  const session = await requireAdminSession("leads.write");
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  if (!isLeadKind(params.kind)) {
    return NextResponse.json({ error: "Invalid lead type." }, { status: 400 });
  }

  let body: { status?: unknown };
  try {
    body = (await request.json()) as { status?: unknown };
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  if (typeof body.status !== "string" || !leadStatuses.has(body.status)) {
    return NextResponse.json({ error: "Invalid lead status." }, { status: 400 });
  }

  const tableName = leadTables[params.kind];
  const { error } = await supabase
    .from(tableName)
    .update({ status: body.status })
    .eq("id", params.id);

  if (error) {
    console.error("[admin-leads] Failed to update lead status", {
      kind: params.kind,
      id: params.id,
      error,
    });
    return NextResponse.json({ error: "Failed to update lead." }, { status: 500 });
  }

  void writeAdminAuditLog({
    adminUserId: adminIdForWrite(session),
    action: "lead.status_updated",
    targetType: `${params.kind}_lead`,
    targetId: params.id,
    metadata: { status: body.status },
  });

  return NextResponse.json({ ok: true });
}

function isLeadKind(value: string): value is LeadKind {
  return value === "partner" || value === "merchant";
}
