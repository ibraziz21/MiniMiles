import { NextResponse } from "next/server";
import { adminIdForWrite, requireAdminSession } from "@/lib/auth";
import { supabase } from "@/lib/supabase";
import { isUuid } from "@/lib/subscriptionPayments";

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const session = await requireAdminSession("merchants.write");
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!isUuid(params.id)) return NextResponse.json({ error: "Invalid merchant id" }, { status: 400 });
  const body = await req.json().catch(() => null);
  if (typeof body?.confirmationName !== "string" || typeof body?.reason !== "string"
    || body.reason.trim().length < 3 || body.reason.trim().length > 1000) {
    return NextResponse.json({ error: "Enter the merchant name and a reason of 3–1,000 characters." }, { status: 400 });
  }
  const { data, error } = await supabase.rpc("admin_archive_merchant", {
    p_partner_id: params.id,
    p_admin_id: adminIdForWrite(session),
    p_confirmation_name: body.confirmationName.trim(),
    p_reason: body.reason.trim(),
  });
  if (error) return NextResponse.json({ error: "Could not remove the merchant. Please try again." }, { status: 500 });
  if (data === "OK" || data === "ALREADY_ARCHIVED") return NextResponse.json({ ok: true });
  if (data === "NOT_FOUND") return NextResponse.json({ error: "Merchant not found" }, { status: 404 });
  return NextResponse.json({ error: data === "NAME_MISMATCH" ? "The merchant name does not match." : "Could not remove the merchant." }, { status: 409 });
}
