/**
 * The pending-account lookup behind AKIBA-MOB-002 §7.4.
 *
 * Deliberately its own module with a minimal import graph: this runs on
 * every authenticated `/api/v1` request, so it must not drag the balance,
 * voucher, and profile loaders that the rest of the deletion domain needs
 * into the hot path of every route.
 *
 * Why the check exists at all: Supabase access tokens stay valid until they
 * expire, so a second device holding a token minted before the request would
 * otherwise keep using the account while its data is being deleted. Session
 * state has to be validated server-side, which makes this guard required
 * rather than defence in depth.
 */
import { createAdminClient } from "@/lib/supabase/admin";
import { PENDING_DELETION_STATUSES } from "@/lib/akiba/accountDeletionPolicy";

export type OpenDeletionRequest = {
  id: string;
  status: "requested" | "processing" | "legal_hold" | "failed" | "completed" | "manual_review";
  requested_at: string;
  target_completion_at: string;
};

/** Statuses that both block access and are returned as a receipt. */
const BLOCKING_STATUSES = [...PENDING_DELETION_STATUSES, "completed"] as const;

/**
 * Statuses a member must be shown, which is not the same set as the statuses
 * that lock them out.
 *
 * `manual_review` is the difference. It is a real, accepted request and the
 * member has to be able to read its receipt — but a human will carry it out,
 * possibly days later, so blocking access would recreate exactly the trap
 * accountDeletionAvailability.ts was written to close: an account shut down
 * while nothing is processing it.
 */
const RECEIPT_STATUSES = [...BLOCKING_STATUSES, "manual_review"] as const;

export class DeletionLookupUnavailableError extends Error {
  constructor() {
    super("Could not determine account deletion state");
    this.name = "DeletionLookupUnavailableError";
  }
}

/**
 * The actor's non-cancelled deletion request, or null.
 *
 * Throws rather than returning null when the lookup itself fails: failing
 * open would let a pending account keep using protected routes, which is the
 * one outcome this guard exists to prevent.
 */
export async function findOpenDeletionRequest(userId: string): Promise<OpenDeletionRequest | null> {
  return lookup(userId, BLOCKING_STATUSES as unknown as string[]);
}

/**
 * The actor's request for display and for the retry short-circuit, including
 * one awaiting manual fulfilment. Never use this to decide access — that is
 * `findOpenDeletionRequest`, and the two differ by exactly `manual_review`.
 */
export async function findDeletionReceipt(userId: string): Promise<OpenDeletionRequest | null> {
  return lookup(userId, RECEIPT_STATUSES as unknown as string[]);
}

async function lookup(userId: string, statuses: string[]): Promise<OpenDeletionRequest | null> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("account_deletion_requests")
    .select("id, status, requested_at, target_completion_at")
    .eq("hub_user_id", userId)
    .in("status", statuses)
    .maybeSingle();

  if (error) {
    // Bounded fields only: this runs on every authenticated request, and a
    // Postgres message can quote a row value.
    console.error(`[accountDeletionGuard] lookup failed sqlstate=${error.code ?? "unknown"}`);
    throw new DeletionLookupUnavailableError();
  }

  return (data as OpenDeletionRequest | null) ?? null;
}
