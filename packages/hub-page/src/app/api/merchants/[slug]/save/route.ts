import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getPublicMerchant, DirectoryUnavailableError } from "@/lib/merchants/queries";
import { saveMerchant, unsaveMerchant, isMerchantSaved } from "@/lib/merchants/savedMerchants";

export const dynamic = "force-dynamic";

/**
 * Resolves the merchant via the canonical get_public_merchant RPC (same as
 * GET /api/merchants/[slug]) rather than a raw partners lookup, so
 * publication/hidden-partner rules are inherited for free instead of
 * reimplemented here.
 */
async function resolveMerchantId(slug: string, userId: string): Promise<string | null | "unavailable"> {
  try {
    const merchant = await getPublicMerchant(slug, userId);
    return merchant?.id ?? null;
  } catch (err) {
    if (err instanceof DirectoryUnavailableError) return "unavailable";
    throw err;
  }
}

async function getUserId(): Promise<string | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user?.id ?? null;
}

export async function GET(_req: Request, { params }: { params: { slug: string } }) {
  const userId = await getUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const merchantId = await resolveMerchantId(params.slug, userId);
  if (merchantId === "unavailable") return NextResponse.json({ error: "directory_unavailable" }, { status: 503 });
  if (!merchantId) return NextResponse.json({ error: "Merchant not found" }, { status: 404 });

  return NextResponse.json({ saved: await isMerchantSaved(userId, merchantId) });
}

export async function POST(_req: Request, { params }: { params: { slug: string } }) {
  const userId = await getUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const merchantId = await resolveMerchantId(params.slug, userId);
  if (merchantId === "unavailable") return NextResponse.json({ error: "directory_unavailable" }, { status: 503 });
  if (!merchantId) return NextResponse.json({ error: "Merchant not found" }, { status: 404 });

  await saveMerchant(userId, merchantId);
  return NextResponse.json({ saved: true });
}

export async function DELETE(_req: Request, { params }: { params: { slug: string } }) {
  const userId = await getUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const merchantId = await resolveMerchantId(params.slug, userId);
  if (merchantId === "unavailable") return NextResponse.json({ error: "directory_unavailable" }, { status: 503 });
  if (!merchantId) return NextResponse.json({ error: "Merchant not found" }, { status: 404 });

  await unsaveMerchant(userId, merchantId);
  return NextResponse.json({ saved: false });
}
