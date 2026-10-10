// GET /api/v1/me/account-deletion-summary — AKIBA-MOB-002 §7.1.
// Self-only, and a fresh projection every time: §5.2 forbids the app
// trusting balance or voucher counts passed through navigation, because the
// member is about to make an irreversible decision based on them.
//
// Counts only. No wallet address, voucher code, ledger row, or risk state
// leaves this route — the screen needs "how much will I lose", not an
// inventory of it.
import { requireActor, UnauthorizedError } from "@/lib/auth/requestActor";
import { apiSuccess, apiError } from "@/lib/api/v1/response";
import {
  AccountDeletionError,
  getAccountDeletionSummary,
} from "@/lib/akiba/accountDeletion";
import { mapDeletionError } from "@/lib/akiba/accountDeletionErrors";

export async function GET(request: Request) {
  let actor;
  try {
    actor = await requireActor(request);
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return apiError(request, error.code, error.message, error.status);
    }
    throw error;
  }

  try {
    const summary = await getAccountDeletionSummary(actor);
    const response = apiSuccess(request, summary);
    response.headers.set("Cache-Control", "private, no-store");
    return response;
  } catch (error) {
    if (error instanceof AccountDeletionError) {
      const mapped = mapDeletionError(error.code);
      return apiError(request, mapped.code, mapped.message, mapped.status, {
        retryable: mapped.retryable,
      });
    }
    throw error;
  }
}
