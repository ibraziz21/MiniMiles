import { NextResponse } from "next/server";
import { requireAdminSession } from "@/lib/auth";
import { supabase } from "@/lib/supabase";
import { akibaFundedVouchersAdminFlag } from "@/lib/featureFlags";

function maskPhone(value: string | null): string | null {
  if (!value) return null;
  const visible = value.slice(-3);
  return `${"•".repeat(Math.max(4, value.length - 3))}${visible}`;
}

function maskAddress(value: string | null): string | null {
  if (!value) return null;
  return value.length > 12 ? `${value.slice(0, 6)}…${value.slice(-4)}` : value;
}

export async function GET(request: Request) {
  const session = await requireAdminSession("voucher_funds.grant");
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!akibaFundedVouchersAdminFlag()) return NextResponse.json({ error: "Voucher issuance is disabled." }, { status: 503 });

  const query = new URL(request.url).searchParams.get("query")?.trim() ?? "";
  if (query.length < 2 || query.length > 100) return NextResponse.json({ members: [] });

  const exactId = /^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(query) ? query : null;
  const exactAddress = /^0x[0-9a-f]{40}$/i.test(query) ? query.toLowerCase() : null;
  const searches = [
    supabase.from("akiba_users").select("id, username, phone, address, created_at").ilike("username", `%${query.replace(/[%_]/g, "")}%`).limit(8),
    supabase.from("akiba_users").select("id, username, phone, address, created_at").ilike("phone", `%${query.replace(/[%_]/g, "")}%`).limit(8),
  ];
  if (exactId) searches.push(supabase.from("akiba_users").select("id, username, phone, address, created_at").eq("id", exactId).limit(1));
  if (exactAddress) searches.push(supabase.from("akiba_users").select("id, username, phone, address, created_at").eq("address", exactAddress).limit(1));

  const results = await Promise.all(searches);
  const unique = new Map<string, { id: string; username: string | null; phone: string | null; address: string | null; created_at: string | null }>();
  for (const result of results) for (const row of result.data ?? []) unique.set(row.id, row);

  return NextResponse.json({
    members: Array.from(unique.values()).filter((row) => row.username).slice(0, 8).map((row) => ({
      id: row.id,
      username: row.username,
      maskedContact: maskPhone(row.phone) ?? maskAddress(row.address) ?? "Contact not available",
      joinedAt: row.created_at,
    })),
  }, { headers: { "Cache-Control": "private, no-store" } });
}
