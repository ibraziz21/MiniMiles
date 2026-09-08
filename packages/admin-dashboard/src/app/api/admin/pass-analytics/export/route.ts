import { NextResponse } from "next/server";
import { adminIdForWrite, requireAdminSession } from "@/lib/auth";
import { writeAdminAuditLog } from "@/lib/audit";
import {
  csvCell,
  defaultPassAnalyticsRange,
  passAnalyticsUtcBounds,
  validatePassAnalyticsRange,
} from "@/lib/passAnalytics";
import { supabase } from "@/lib/supabase";

type ExportPass = {
  user_id: string;
  email: string;
  signup_src: string | null;
  created_at: string;
  onboarding_seen_at: string | null;
  regenerated_at: string | null;
};

async function fetchPasses(startsAt: string, endsAt: string): Promise<ExportPass[]> {
  const pageSize = 1000;
  const rows: ExportPass[] = [];

  for (let from = 0; ; from += pageSize) {
    const { data, error } = await supabase
      .from("hub_user_passes")
      .select("user_id, email, signup_src, created_at, onboarding_seen_at, regenerated_at")
      .gte("created_at", startsAt)
      .lt("created_at", endsAt)
      .order("created_at", { ascending: true })
      .range(from, from + pageSize - 1);
    if (error) throw error;
    const page = (data ?? []) as ExportPass[];
    rows.push(...page);
    if (page.length < pageSize) break;
  }

  return rows;
}

export async function GET(request: Request) {
  const session = await requireAdminSession("users.read");
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const url = new URL(request.url);
  const fallback = defaultPassAnalyticsRange();
  const from = url.searchParams.get("from") ?? fallback.from;
  const to = url.searchParams.get("to") ?? fallback.to;
  const validated = validatePassAnalyticsRange(from, to);
  if (!validated.ok) {
    return NextResponse.json({ error: validated.error }, { status: 400 });
  }

  const { startsAt, endsAt } = passAnalyticsUtcBounds(validated.value);
  let rows: ExportPass[];
  try {
    rows = await fetchPasses(startsAt, endsAt);
  } catch (error) {
    console.error("[pass-analytics/export] query failed", error);
    return NextResponse.json({ error: "Could not export Pass signups" }, { status: 500 });
  }

  const headers = [
    "user_id",
    "email",
    "signup_source",
    "joined_at",
    "onboarding_seen_at",
    "pass_regenerated_at",
  ];
  const csvRows = rows.map((row) => [
    row.user_id,
    row.email,
    row.signup_src?.trim() || "Direct / unknown",
    row.created_at,
    row.onboarding_seen_at ?? "",
    row.regenerated_at ?? "",
  ]);
  const csv = [headers, ...csvRows].map((row) => row.map(csvCell).join(",")).join("\n");

  void writeAdminAuditLog({
    adminUserId: adminIdForWrite(session),
    action: "pass_analytics.export_csv",
    targetType: "pass_analytics",
    metadata: { from, to, rowCount: rows.length },
  });

  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="akiba-pass-signups-${from}-to-${to}.csv"`,
      "Cache-Control": "private, no-store",
    },
  });
}
