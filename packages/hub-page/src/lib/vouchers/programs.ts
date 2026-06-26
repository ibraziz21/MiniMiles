/**
 * Trusted server-only adapter for all non-purchase voucher issuance.
 * Never import this in client components.
 *
 * sponsor and funding_type are loaded from the voucher_program under DB lock —
 * callers cannot override them. Removing those fields from this interface
 * is intentional; the RPC enforces program-level trust.
 */
import { createAdminClient } from "@/lib/supabase/admin";
import { generateSecureCode } from "./codes";

export type ProgramChannel =
  | "claw"
  | "raffle"
  | "giveaway"
  | "merchant_grant"
  | "akiba_grant";

export interface IssueProgramInput {
  programId:        string;
  channel:          ProgramChannel;
  sourceRef:        string;
  recipientAddress: string | null;
  hubUserId?:       string;
  evidence:         Record<string, unknown>;
  actorId:          string;
}

export interface IssueProgramResult {
  ok:          boolean;
  voucherId?:  string;
  code?:       string;
  error?:      string;
  httpStatus?: number;
}

const ERROR_MAP: Record<string, { status: number; message: string }> = {
  PROGRAM_NOT_FOUND:      { status: 404, message: "Program not found" },
  PROGRAM_NOT_ACTIVE:     { status: 409, message: "Program is not active" },
  PROGRAM_NOT_STARTED:    { status: 409, message: "Program has not started yet" },
  PROGRAM_ENDED:          { status: 409, message: "Program has ended" },
  TEMPLATE_INACTIVE:      { status: 409, message: "Voucher template is no longer active" },
  TEMPLATE_EXPIRED:       { status: 409, message: "Voucher template has expired" },
  CHANNEL_NOT_FOUND:      { status: 400, message: "Channel not configured for this program" },
  CHANNEL_INACTIVE:       { status: 409, message: "Channel is inactive" },
  SOURCE_REF_CONFLICT:    { status: 409, message: "This win has already been claimed by a different account" },
  TOTAL_CAP_EXCEEDED:     { status: 409, message: "No vouchers remaining in this program" },
  CHANNEL_CAP_EXCEEDED:   { status: 409, message: "No vouchers remaining in this channel" },
  RECIPIENT_REQUIRED:     { status: 400, message: "Recipient address or Hub user ID required" },
  NO_LINKED_WALLET:       { status: 400, message: "No linked wallet — connect a wallet to claim wins" },
};

export async function issueVoucherFromProgram(
  input: IssueProgramInput
): Promise<IssueProgramResult> {
  const admin = createAdminClient();
  const code = generateSecureCode();

  const { data, error } = await admin.rpc("issue_voucher_from_program", {
    p_program_id:        input.programId,
    p_channel:           input.channel,
    p_source_ref:        input.sourceRef,
    p_recipient_address: input.recipientAddress,
    p_hub_user_id:       input.hubUserId ?? null,
    p_code:              code,
    p_evidence:          input.evidence,
    p_actor_id:          input.actorId,
  });

  if (error) {
    const msg = error.message ?? "";
    for (const [key, mapped] of Object.entries(ERROR_MAP)) {
      if (msg.includes(key)) {
        return { ok: false, error: mapped.message, httpStatus: mapped.status };
      }
    }
    console.error("[issueVoucherFromProgram] RPC error:", error);
    return { ok: false, error: "Issuance failed — please try again", httpStatus: 500 };
  }

  const row = Array.isArray(data) ? data[0] : null;
  if (!row || !row.ok) {
    return { ok: false, error: "Issuance failed", httpStatus: 500 };
  }

  return { ok: true, voucherId: row.voucher_id as string, code: row.code as string };
}
