// Get-or-create the stable Akiba Pass ID for a Hub user — extracted from
// app/(protected)/me/page.tsx so /pass and /welcome's QR reveal slide create
// the same row (and fire the same first-time quest actions) as /me does.
//
// The pass-row insert and the pass_activated internal_event enqueue
// (discovery-quests-spec.md §3.1) happen atomically in one Postgres
// function, create_or_get_hub_pass (044_internal_event_outbox.sql) — a
// plain two-step insert-then-emit from here would have a window where the
// pass exists but the event never got queued. quest-events.ts's
// `pass_signup` emission is a separate, older system (a different
// Platform-side engine) and is left untouched here — this only adds the new
// event, it doesn't replace that one.
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
  /** Acquisition source, e.g. join_qr|organic|minipay_funnel. Only
   *  join-complete/route.ts captures a real value today; every other
   *  caller omits it and gets 'organic'. */
  src?: string;
}): Promise<PassResult> {
  const { userId, email, walletAddress, src } = opts;
  if (!email) return { publicPassId: null, isNew: false };

  const admin = createAdminClient();

  const { data, error } = await admin.rpc("create_or_get_hub_pass", {
    p_user_id: userId,
    p_email: email,
    ...(src ? { p_src: src } : {}),
  });

  if (error) {
    console.error("[pass] create_or_get_hub_pass failed:", error.message);
    return { publicPassId: null, isNew: false };
  }

  const row = Array.isArray(data) ? data[0] : data;
  const publicPassId: string | null = row?.public_pass_id ?? null;
  const isNew: boolean = row?.is_new === true;

  if (isNew && publicPassId) {
    await emitQuestAction({
      actionName: "pass_signup",
      userId,
      walletAddress,
      idempotencyKey: `quest-pass_signup-${userId}`,
      metadata: { email },
    });
  }

  return { publicPassId, isNew };
}
