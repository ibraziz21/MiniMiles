// GET /api/admin/search?q=<term>
//
// Phase 1 of the admin UI overhaul (docs/admin-dashboard-pwa-ui-overhaul-spec.md
// §5.3) wires exactly two real entity types — merchants and members — against
// their existing tables. Other entity types listed in the spec (referral
// code/user/email/ledger reference, subscription payment/invoice id, voucher/
// fund/allocation/program id) are deliberately NOT implemented here; the
// client only ever renders result groups for entities this route actually
// returns, never a fabricated empty group for the rest.

import { NextResponse } from "next/server";
import { requireAdminSession } from "@/lib/auth";
import { hasPermission } from "@/types";
import { supabase } from "@/lib/supabase";

export interface SearchResultItem {
  id: string;
  label: string;
  sublabel?: string;
  href: string;
}

export interface SearchResponse {
  merchants: SearchResultItem[];
  members: SearchResultItem[];
}

export async function GET(req: Request) {
  const session = await requireAdminSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const q = new URL(req.url).searchParams.get("q")?.trim() ?? "";
  if (q.length < 2) {
    return NextResponse.json<SearchResponse>({ merchants: [], members: [] });
  }

  const [merchants, members] = await Promise.all([
    hasPermission(session.role, "merchants.read")
      ? supabase.from("partners").select("id, name").ilike("name", `%${q}%`).limit(8)
      : Promise.resolve({ data: [] as { id: string; name: string }[] }),
    hasPermission(session.role, "users.read")
      ? supabase.from("akiba_users").select("id, username").ilike("username", `%${q}%`).limit(8)
      : Promise.resolve({ data: [] as { id: string; username: string | null }[] }),
  ]);

  return NextResponse.json<SearchResponse>({
    merchants: (merchants.data ?? []).map((m) => ({
      id: m.id,
      label: m.name,
      href: `/merchants/${m.id}`,
    })),
    members: (members.data ?? [])
      .filter((m) => m.username)
      .map((m) => ({
        id: m.id,
        label: m.username as string,
        href: `/users?highlight=${m.id}`,
      })),
  });
}
