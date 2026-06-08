// GET /api/admin/pretium/export
//
// Returns a CSV of all users who have submitted Pretium quests,
// with signup and transact status for each. Send this to Pretium daily
// for them to verify actual completion.
//
// Auth: Bearer <ADMIN_QUEUE_SECRET>  or  ?secret=<ADMIN_QUEUE_SECRET>
//
// CSV columns:
//   email, wallet_address,
//   signup_status, signup_submitted_at,
//   transact_status, transact_submitted_at

import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
);

const ADMIN_SECRET = process.env.ADMIN_QUEUE_SECRET ?? "";

function isAuthorized(req: Request): boolean {
  if (!ADMIN_SECRET) return false;
  const bearer = req.headers.get("authorization");
  if (bearer === `Bearer ${ADMIN_SECRET}`) return true;
  const url = new URL(req.url);
  return url.searchParams.get("secret") === ADMIN_SECRET;
}

function toCsv(rows: Record<string, string>[]): string {
  if (rows.length === 0) return "";
  const headers = Object.keys(rows[0]);
  const escape = (v: string) => `"${v.replace(/"/g, '""')}"`;
  const lines = [
    headers.join(","),
    ...rows.map((r) => headers.map((h) => escape(r[h] ?? "")).join(",")),
  ];
  return lines.join("\r\n");
}

export async function GET(req: Request) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  // Fetch all submissions, group by user
  const { data, error } = await supabase
    .from("pretium_quest_submissions")
    .select("user_address, email, quest_type, status, submitted_at")
    .order("user_address")
    .order("quest_type");

  if (error) {
    console.error("[pretium/export] db error:", error);
    return NextResponse.json({ error: "db-error" }, { status: 500 });
  }

  // Pivot: one row per user with signup + transact columns
  const byUser = new Map<string, Record<string, string>>();

  for (const row of data ?? []) {
    const addr = row.user_address as string;
    if (!byUser.has(addr)) {
      byUser.set(addr, {
        email: row.email as string,
        wallet_address: addr,
        signup_status: "",
        signup_submitted_at: "",
        transact_status: "",
        transact_submitted_at: "",
      });
    }
    const entry = byUser.get(addr)!;
    if (row.quest_type === "signup") {
      entry.signup_status = row.status as string;
      entry.signup_submitted_at = row.submitted_at as string;
    } else if (row.quest_type === "transact") {
      entry.transact_status = row.status as string;
      entry.transact_submitted_at = row.submitted_at as string;
    }
  }

  const csv = toCsv(Array.from(byUser.values()));
  const date = new Date().toISOString().slice(0, 10);

  return new Response(csv, {
    status: 200,
    headers: {
      "Content-Type": "text/csv",
      "Content-Disposition": `attachment; filename="pretium_quests_${date}.csv"`,
    },
  });
}
