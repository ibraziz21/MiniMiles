// Get-or-create the stable Akiba Pass ID for a Hub user — extracted from
// app/(protected)/me/page.tsx so /pass and /welcome's QR reveal slide create
// the same row (and fire the same first-time quest action) as /me does.
import { createAdminClient } from "@/lib/supabase/admin";
import { emitQuestAction } from "@/lib/akiba/quest-events";

export type PassResult = {
  publicPassId: string | null;
  /** True only when this call just inserted the row (first-ever pass). */
  isNew: boolean;
};

export async function getOrCreatePass(opts: {
  userId: string;
  email: string | null;
  walletAddress: string | null;
}): Promise<PassResult> {
  const { userId, email, walletAddress } = opts;
  if (!email) return { publicPassId: null, isNew: false };

  const admin = createAdminClient();

  const { data: existing } = await admin
    .from("hub_user_passes")
    .select("public_pass_id")
    .eq("user_id", userId)
    .maybeSingle();

  if (existing) {
    return { publicPassId: existing.public_pass_id, isNew: false };
  }

  const { data: inserted } = await admin
    .from("hub_user_passes")
    .insert({ user_id: userId, email })
    .select("public_pass_id")
    .single();

  if (inserted?.public_pass_id) {
    await emitQuestAction({
      actionName: "pass_signup",
      userId,
      walletAddress,
      idempotencyKey: `quest-pass_signup-${userId}`,
      metadata: { email },
    });
  }

  return { publicPassId: inserted?.public_pass_id ?? null, isNew: true };
}
