import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getPublicMerchant } from "@/lib/merchants/queries";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: { slug: string } }) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  try {
    const merchant = await getPublicMerchant(params.slug, user?.id ?? null);
    if (!merchant) return NextResponse.json({ error: "Merchant not found" }, { status: 404 });
    return NextResponse.json({ merchant });
  } catch {
    return NextResponse.json({ error: "directory_unavailable" }, { status: 503 });
  }
}
