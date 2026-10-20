import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import { decryptCompletionContact } from "./accountDeletionContact";
import { isCompletionEmailConfigured } from "./accountDeletionEmail";
import { deliverOneCompletionEmail } from "./accountDeletionWorker";
import { adminExecutionConfigBlockers } from "./accountDeletionAdminConfig";

export function adminDeletionReadiness(): string[] {
  return adminExecutionConfigBlockers();
}

export async function runAdminAccountDeletion(requestId: string, actorId: string, admin: SupabaseClient = createAdminClient()) {
  const readiness = adminDeletionReadiness();
  if (readiness.length) return { ok: false, blockers: readiness };
  // Capture/validate the encrypted notice destination before any deletion.
  const contact = await admin.from("account_deletion_requests").select("completion_contact_ciphertext,completion_contact_key_version,status").eq("id", requestId).maybeSingle();
  if (contact.error || !contact.data) return { ok: false, blockers: ["request_unavailable"] };
  if (contact.data.status !== "completed" && !decryptCompletionContact(contact.data.completion_contact_ciphertext, contact.data.completion_contact_key_version)) {
    return { ok: false, blockers: ["completion_contact_unreadable"] };
  }
  const begin = await admin.rpc("begin_admin_account_deletion", { p_request: requestId, p_actor: actorId });
  if (begin.error) return { ok: false, blockers: ["request_not_available_or_assigned"] };
  if (!begin.data?.ok) return { ok: false, blockers: begin.data?.blockers ?? ["preflight_failed"] };
  if (begin.data.completed) return { ok: true, alreadyCompleted: true };
  const token = begin.data.runToken as string;
  let failureCode = "storage_cleanup_failed";
  try {
    for (let offset = 0;;) {
      const page = await admin.rpc("admin_deletion_storage_page", { p_request: requestId, p_actor: actorId, p_token: token, p_offset: offset });
      if (page.error || !Array.isArray(page.data)) throw new Error("manifest_unavailable");
      const objects = page.data as { bucket: string; key: string }[];
      if (!objects.length) break;
      for (const bucket of ["discovery-visit-photos", "discovery-visit-photos-derived"]) {
        const keys = objects.filter(object => object.bucket === bucket).map(object => object.key);
        if (keys.length && (await admin.storage.from(bucket).remove(keys)).error) throw new Error("storage_failed");
      }
      if (objects.some(object => !["discovery-visit-photos", "discovery-visit-photos-derived"].includes(object.bucket))) throw new Error("unexpected_bucket");
      offset += objects.length;
    }
    failureCode = "database_cleanup_failed";
    const result = await admin.rpc("finalize_admin_account_deletion", { p_request: requestId, p_actor: actorId, p_token: token });
    if (result.error || !result.data?.ok) {
      await admin.rpc("fail_admin_account_deletion", { p_request: requestId, p_actor: actorId, p_token: token, p_code: "verification_failed" });
      return { ok: false, blockers: result.error ? ["database_cleanup_failed"] : result.data?.blockers ?? ["verification_failed"] };
    }
    // Email failure never reopens completed cleanup. Its separate lease/retry
    // queue and the dashboard preserve the distinction between data and notice.
    let emailDelivered = false;
    try { emailDelivered = await retryAdminDeletionEmail(requestId, admin); } catch { /* cron/dashboard can retry */ }
    return { ok: true, verified: true, emailDelivered };
  } catch {
    // No row values, keys, provider messages or contact addresses in errors.
    await admin.rpc("fail_admin_account_deletion", { p_request: requestId, p_actor: actorId, p_token: token, p_code: failureCode });
    return { ok: false, blockers: [failureCode] };
  }
}

export async function retryAdminDeletionEmail(requestId: string, admin: SupabaseClient = createAdminClient()): Promise<boolean> {
  if (!isCompletionEmailConfigured()) return false;
  const result = await admin.rpc("claim_admin_deletion_completion_email", { p_request: requestId });
  if (result.error || !result.data?.length) return false;
  return deliverOneCompletionEmail(admin, result.data[0]);
}
