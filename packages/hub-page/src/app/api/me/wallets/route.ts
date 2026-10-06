import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { listLinkedWallets } from "@/lib/akiba/wallets";

// Direct linking (POST) was removed in favor of the two-step verified flow
// (production-readiness-security-spec.md §3.2): POST /api/me/wallets/challenge
// then POST /api/me/wallets/verify. A bare address here was never proof of
// ownership. See src/app/(protected)/me/WalletSection.tsx for the client
// flow that signs the challenge.

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const wallets = await listLinkedWallets(user.id);
    return NextResponse.json(wallets.map((w) => ({
      ecosystem: w.ecosystem,
      address: w.address,
      is_primary: w.isPrimary,
      linked_at: w.linkedAt,
      verification_status: w.verificationStatus,
    })));
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unknown error" }, { status: 500 });
  }
}
