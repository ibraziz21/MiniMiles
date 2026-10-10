/**
 * Account-deletion processing worker (AKIBA-MOB-002 §8.2, §8.3).
 *
 * At-least-once and step-idempotent: each step appends a `step_completed`
 * event, and a replay skips any step already marked. A worker that dies
 * mid-run releases its lease and the next pass resumes where it stopped
 * rather than redoing destructive work or abandoning it.
 *
 * Four guards make this safe to have in the repository before the retention
 * policy is signed off:
 *
 *   1. `assertInventoryApproved()` — §9 forbids processing while any
 *      inventory row is TBD. Today 13 are, so this throws and no member data
 *      is touched, anywhere.
 *   2. A missing step executor is a *failure*, never a skip. If a row is
 *      approved but the code that acts on it hasn't been written, the
 *      request fails with `step_executor_missing` and stays in the
 *      reconciliation queue. Reporting an account deleted while silently
 *      retaining a class must be impossible.
 *   3. `STEP_ORDER` is explicit and validated against the inventory at run
 *      time. Ordering here is a correctness requirement, not a preference —
 *      none of the relevant foreign keys cascade, so a step in the wrong
 *      place fails on a constraint rather than deleting the wrong thing.
 *   4. No provider message, Postgres message, or row value is ever logged.
 *      Only a bounded step id, target name, and SQLSTATE.
 */
import type { PostgrestError, SupabaseClient } from "@supabase/supabase-js";

import { createAdminClient } from "@/lib/supabase/admin";
import { resolveHubQuestCanonical } from "@/lib/akiba/canonicalPartnerQuests";
import {
  assertInventoryApproved,
  executableInventoryRows,
} from "@/lib/akiba/accountDeletionPolicy";
import { decryptCompletionContact } from "@/lib/akiba/accountDeletionContact";

const PHOTO_SOURCE_BUCKET = "discovery-visit-photos";
const PHOTO_DERIVED_BUCKET = "discovery-visit-photos-derived";

/** `in` lists are chunked so a member with many rows can't blow the query. */
const ID_CHUNK = 100;

type Admin = SupabaseClient;

export type DeletionRequestRow = {
  id: string;
  hub_user_id: string;
  status: string;
  attempts: number;
  completion_contact_ciphertext: string | null;
  completion_contact_key_version: string | null;
};

export type ProcessOutcome =
  | { requestId: string; result: "completed"; stepsRun: string[] }
  | { requestId: string; result: "failed"; failureCode: string; stepsRun: string[] };

export type WorkerRunSummary = {
  claimed: number;
  completed: number;
  failed: number;
  outcomes: ProcessOutcome[];
  completionEmails: { claimed: number; delivered: number; failed: number; skipped: number };
};

type StepContext = { admin: Admin; userId: string; requestId: string };
type StepExecutor = (context: StepContext) => Promise<void>;

/**
 * A step failed. Carries only what is safe to log: which step, which target,
 * and the SQLSTATE. Never the Postgres or provider message — those can quote
 * a row value, which is the very data this workflow exists to remove.
 */
class StepFailure extends Error {
  constructor(
    readonly target: string,
    readonly sqlState: string | null,
  ) {
    super(`target=${target} sqlstate=${sqlState ?? "unknown"}`);
    this.name = "StepFailure";
  }
}

function sqlStateOf(error: PostgrestError | { code?: string } | null): string | null {
  return error && typeof error.code === "string" ? error.code : null;
}

function chunk<T>(values: T[], size = ID_CHUNK): T[][] {
  const out: T[][] = [];
  for (let index = 0; index < values.length; index += size) {
    out.push(values.slice(index, index + size));
  }
  return out;
}

async function deleteWhere(admin: Admin, table: string, column: string, value: string): Promise<void> {
  const { error } = await admin.from(table).delete().eq(column, value);
  if (error) throw new StepFailure(table, sqlStateOf(error));
}

async function deleteIn(admin: Admin, table: string, column: string, values: string[]): Promise<void> {
  if (values.length === 0) return;
  for (const batch of chunk(values)) {
    const { error } = await admin.from(table).delete().in(column, batch);
    if (error) throw new StepFailure(table, sqlStateOf(error));
  }
}

async function selectColumn<T>(
  admin: Admin,
  table: string,
  columns: string,
  column: string,
  value: string,
): Promise<T[]> {
  const { data, error } = await admin.from(table).select(columns).eq(column, value);
  if (error) throw new StepFailure(table, sqlStateOf(error));
  return (data ?? []) as T[];
}

/**
 * Executors for the inventory rows whose action is unambiguous from the
 * schema. Rows whose action is still a policy question have none on purpose
 * — guessing the fields to keep would either destroy required evidence or
 * retain personal data, and guard 2 above turns the absence into a visible
 * failure rather than a silent skip.
 */
const STEP_EXECUTORS: Record<string, StepExecutor> = {
  member_photo_objects: async ({ admin, userId }) => {
    const photos = await selectColumn<{
      private_source_key: string | null;
      thumbnail_key: string | null;
      display_key: string | null;
    }>(admin, "merchant_visit_photos", "private_source_key, thumbnail_key, display_key", "hub_user_id", userId);

    const sourceKeys = photos.map((row) => row.private_source_key).filter(Boolean) as string[];
    const derivedKeys = photos
      .flatMap((row) => [row.thumbnail_key, row.display_key])
      .filter(Boolean) as string[];

    // Keys live on the photo rows, so the objects have to go while those
    // rows still exist — and before Auth deletion, which Supabase refuses
    // while the user still owns Storage objects.
    for (const [bucket, keys] of [
      [PHOTO_SOURCE_BUCKET, sourceKeys],
      [PHOTO_DERIVED_BUCKET, derivedKeys],
    ] as const) {
      for (const batch of chunk(keys)) {
        const { error } = await admin.storage.from(bucket).remove(batch);
        if (error) throw new StepFailure(`storage:${bucket}`, null);
      }
    }
  },

  profile_contact: async ({ admin, userId }) => {
    await deleteWhere(admin, "hub_user_profiles", "user_id", userId);

    // The username lives in a canonical-keyed projection, not on the
    // profile row — deleting only hub_user_profiles would leave it published.
    const canonicalId = await resolveHubQuestCanonical({ hubUserId: userId, email: null });
    if (canonicalId) {
      await deleteWhere(admin, "leaderboard_username_changes", "canonical_id", canonicalId);
      await deleteWhere(admin, "leaderboard_profiles", "canonical_id", canonicalId);
    }
  },

  saved_merchants: async ({ admin, userId }) => {
    await deleteWhere(admin, "hub_user_saved_merchants", "hub_user_id", userId);
    await deleteWhere(admin, "hub_notification_preferences", "hub_user_id", userId);
  },

  push_registrations: async ({ admin, userId }) => {
    const subscriptions = await selectColumn<{ id: string }>(
      admin,
      "web_push_subscriptions",
      "id",
      "hub_user_id",
      userId,
    );

    // Deliveries first: web_push_deliveries.subscription_id has no ON DELETE
    // action, and a campaign job's deliveries can reference this member's
    // subscription even though the job itself belongs to nobody.
    await deleteIn(
      admin,
      "web_push_deliveries",
      "subscription_id",
      subscriptions.map((row) => row.id),
    );
    await deleteWhere(admin, "web_push_jobs", "hub_user_id", userId);
    await deleteWhere(admin, "web_push_subscriptions", "hub_user_id", userId);
  },

  wallet_links: async ({ admin, userId }) => {
    // Severs Akiba's association only. Nothing here touches the wallet or
    // the chain, which §4.7 requires and §9 records as immutable.
    await deleteWhere(admin, "wallet_link_challenges", "hub_user_id", userId);
    await deleteWhere(admin, "hub_user_wallets", "user_id", userId);
  },

  deletion_challenges: async ({ admin, userId }) => {
    await deleteWhere(admin, "account_deletion_challenges", "hub_user_id", userId);
  },

  auth_identity: async ({ admin, userId }) => {
    // Last, and soft: the deletion request and its events keep a foreign key
    // to this row as evidence that the request was made and honoured.
    const { error } = await admin.auth.admin.deleteUser(userId, true);
    if (error) throw new StepFailure("auth.users", null);
  },
};

/**
 * Execution order, leaves of the foreign-key graph first. None of the
 * relevant constraints cascade, so this is a correctness requirement:
 *
 *   discovery_contribution_requests
 *   └── merchant_discovery_contributions
 *       ├── merchant_visit_photos
 *       │   ├── photo_processing_jobs
 *       │   └── discovery_moderation_audit_events   (append-only, retained)
 *       └── merchant_discovery_contribution_items
 *   merchant_discovery_item_mentions → discovery_contribution_requests
 *   web_push_deliveries → web_push_subscriptions
 *   hub_referrals → hub_user_passes
 *
 * `member_photo_objects` leads because the Storage keys live on rows that
 * later steps remove. `auth_identity` is last because every other step
 * depends on the identity still resolving.
 */
export const STEP_ORDER: readonly string[] = [
  "member_photo_objects",
  "published_photos",
  "unpublished_contributions",
  "profile_contact",
  "saved_merchants",
  "push_registrations",
  "wallet_links",
  // Everything that references issued_vouchers resolves before the voucher
  // rows themselves — ledger holds, spend intents, redemptions, quotes and
  // skill-game prize deliveries all point at them.
  "reward_ledger",
  "settlement_evidence",
  "earning_events",
  "skill_game_prizes",
  "active_vouchers",
  "fraud_risk",
  "referrals",
  "pass_credentials",
  "notification_history",
  "deletion_record",
  "deletion_challenges",
  "auth_identity",
];

export class StepOrderMismatchError extends Error {
  constructor(readonly missing: string[]) {
    super(`STEP_ORDER is missing a position for inventory row(s): ${missing.join(", ")}`);
    this.name = "StepOrderMismatchError";
  }
}

/**
 * Inventory rows in execution order.
 *
 * Throws when an executable inventory row has no position in `STEP_ORDER`:
 * adding a data class without placing it in the foreign-key order would
 * otherwise run it at an arbitrary point, and none of the relevant
 * constraints cascade. The reverse — an id in `STEP_ORDER` that is no longer
 * in the inventory — is harmless and simply skipped, so it is not an error.
 */
export function orderedSteps(): { id: string; action: string }[] {
  const rows = executableInventoryRows();
  const ordered = new Set(STEP_ORDER);

  const missing = rows.map((row) => row.id).filter((id) => !ordered.has(id));
  if (missing.length > 0) throw new StepOrderMismatchError(missing);

  return STEP_ORDER.flatMap((id) => {
    const row = rows.find((candidate) => candidate.id === id);
    return row ? [{ id: row.id, action: row.action }] : [];
  });
}

/** Whether a step's executor has been written yet — see guard 2 above. */
export function hasStepExecutor(id: string): boolean {
  return id in STEP_EXECUTORS;
}

async function completedSteps(admin: Admin, requestId: string): Promise<Set<string>> {
  const { data, error } = await admin
    .from("account_deletion_events")
    .select("metadata")
    .eq("request_id", requestId)
    .eq("event_type", "step_completed");
  if (error) throw new StepFailure("account_deletion_events", sqlStateOf(error));

  const steps = new Set<string>();
  for (const row of data ?? []) {
    const step = (row.metadata as { step?: unknown } | null)?.step;
    if (typeof step === "string") steps.add(step);
  }
  return steps;
}

async function appendEvent(
  admin: Admin,
  requestId: string,
  eventType: string,
  metadata: Record<string, string | number | boolean> = {},
): Promise<void> {
  const { error } = await admin
    .from("account_deletion_events")
    .insert({ request_id: requestId, event_type: eventType, actor_kind: "worker", metadata });
  if (error) {
    console.error(
      `[accountDeletionWorker] event insert failed request=${requestId} event=${eventType} sqlstate=${
        sqlStateOf(error) ?? "unknown"
      }`,
    );
  }
}

/**
 * Completion-email transport.
 *
 * No email provider is configured in this package — hub-page has never sent
 * transactional email, only web push — so this reports "not configured"
 * rather than pretending to deliver. `isCompletionEmailConfigured` lets the
 * worker skip the delivery pass entirely instead of burning retries against
 * a transport that cannot exist, and the pending count stays visible in
 * `account_deletion_reconciliation`.
 *
 * Wiring a provider means implementing these two functions and nothing else:
 * the claim, lease, backoff, give-up and contact-purge paths are already in
 * place and already retry independently of request processing.
 */
export function isCompletionEmailConfigured(): boolean {
  return false;
}

export async function sendCompletionEmail(
  contact: string,
): Promise<{ delivered: boolean; failureCode?: string }> {
  void contact;
  return { delivered: false, failureCode: "email_transport_not_configured" };
}

async function processRequest(admin: Admin, row: DeletionRequestRow): Promise<ProcessOutcome> {
  const context: StepContext = { admin, userId: row.hub_user_id, requestId: row.id };
  const alreadyDone = await completedSteps(admin, row.id);
  const stepsRun: string[] = [];

  async function fail(failureCode: string): Promise<ProcessOutcome> {
    await admin.rpc("finish_account_deletion_request", {
      p_request_id: row.id,
      p_outcome: "failed",
      p_failure_code: failureCode,
    });
    return { requestId: row.id, result: "failed", failureCode, stepsRun };
  }

  for (const step of orderedSteps()) {
    if (alreadyDone.has(step.id)) continue;

    const executor = STEP_EXECUTORS[step.id];
    if (!executor) {
      await appendEvent(admin, row.id, "step_blocked", { step: step.id, action: step.action });
      return fail("step_executor_missing");
    }

    try {
      await executor(context);
    } catch (error) {
      // Bounded fields only. A Postgres or provider message can quote a row
      // value (§8.3), so neither the log line nor the stored failure code
      // may carry one.
      const detail = error instanceof StepFailure ? error.message : "unexpected";
      console.error(`[accountDeletionWorker] step=${step.id} failed request=${row.id} ${detail}`);
      await appendEvent(admin, row.id, "step_failed", {
        step: step.id,
        sqlstate: error instanceof StepFailure ? (error.sqlState ?? "unknown") : "unknown",
      });
      return fail(`step_failed:${step.id}`);
    }

    await appendEvent(admin, row.id, "step_completed", { step: step.id });
    stepsRun.push(step.id);
  }

  await admin.rpc("finish_account_deletion_request", {
    p_request_id: row.id,
    p_outcome: "completed",
    p_failure_code: null,
  });

  // The completion email is NOT attempted here. It is claimed separately, so
  // a mail outage retries on its own schedule without reopening a request
  // that is already (correctly) terminal.
  return { requestId: row.id, result: "completed", stepsRun };
}

async function deliverOneCompletionEmail(admin: Admin, row: DeletionRequestRow): Promise<boolean> {
  const contact = decryptCompletionContact(
    row.completion_contact_ciphertext,
    row.completion_contact_key_version,
  );

  if (!contact) {
    // Unreadable or missing: there is nothing to deliver to, and holding the
    // bytes any longer serves no purpose.
    await admin.rpc("purge_account_deletion_contact", { p_request_id: row.id, p_delivered: false });
    await appendEvent(admin, row.id, "completion_email_skipped", { reason: "contact_unreadable" });
    return false;
  }

  const delivery = await sendCompletionEmail(contact);
  if (delivery.delivered) {
    await admin.rpc("purge_account_deletion_contact", { p_request_id: row.id, p_delivered: true });
    return true;
  }

  await admin.rpc("record_account_deletion_completion_email_failure", {
    p_request_id: row.id,
    p_failure_code: delivery.failureCode ?? "unknown",
  });
  return false;
}

/**
 * Delivery pass for completed requests whose email has not gone out. Runs
 * independently of request processing (§8.2 step 13).
 */
export async function processPendingCompletionEmails(
  admin: Admin,
  limit = 5,
): Promise<{ claimed: number; delivered: number; failed: number; skipped: number }> {
  if (!isCompletionEmailConfigured()) {
    // Claiming would only increment attempt counters toward the give-up
    // threshold and purge contacts that a future provider could still use.
    return { claimed: 0, delivered: 0, failed: 0, skipped: 1 };
  }

  const { data, error } = await admin.rpc("claim_account_deletion_completion_emails", {
    p_limit: limit,
  });
  if (error) {
    console.error(
      `[accountDeletionWorker] completion-email claim failed sqlstate=${sqlStateOf(error) ?? "unknown"}`,
    );
    return { claimed: 0, delivered: 0, failed: 0, skipped: 0 };
  }

  const rows = (data ?? []) as DeletionRequestRow[];
  let delivered = 0;
  for (const row of rows) {
    if (await deliverOneCompletionEmail(admin, row)) delivered += 1;
  }

  return { claimed: rows.length, delivered, failed: rows.length - delivered, skipped: 0 };
}

/**
 * Claims and processes up to `limit` requests, then attempts any pending
 * completion emails. Throws InventoryNotApprovedError before claiming
 * anything when the retention inventory is incomplete.
 */
export async function processAccountDeletionRequests(
  limit = 1,
  leaseSeconds = 900,
): Promise<WorkerRunSummary> {
  assertInventoryApproved();
  // Fail before any destructive work if the order and the inventory disagree.
  orderedSteps();

  const admin = createAdminClient();
  const { data, error } = await admin.rpc("claim_account_deletion_requests", {
    p_limit: limit,
    p_lease_seconds: leaseSeconds,
  });
  if (error) throw new StepFailure("claim_account_deletion_requests", sqlStateOf(error));

  const rows = (data ?? []) as DeletionRequestRow[];
  const outcomes: ProcessOutcome[] = [];
  for (const row of rows) {
    outcomes.push(await processRequest(admin, row));
  }

  const completionEmails = await processPendingCompletionEmails(admin);

  return {
    claimed: rows.length,
    completed: outcomes.filter((outcome) => outcome.result === "completed").length,
    failed: outcomes.filter((outcome) => outcome.result === "failed").length,
    outcomes,
    completionEmails,
  };
}
