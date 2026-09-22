import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { listSavedMerchants } from "@/lib/merchants/savedMerchants";

export const dynamic = "force-dynamic";

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  return NextResponse.json({ merchants: await listSavedMerchants(user.id) });
}
