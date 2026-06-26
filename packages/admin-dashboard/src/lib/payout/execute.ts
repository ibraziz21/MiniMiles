import { supabase } from "@/lib/supabase";
import { getPayoutProvider } from "./index";
import { decryptDestinationDetails } from "./encryption";
import { validatePayoutConfig } from "./config";
import { TEST_TIMEOUT_AMOUNT } from "./test-adapter";

const POLLING_WINDOW_MS = 2 * 60 * 60 * 1000; // 2h

export interface ExecuteResult {
  ok: boolean;
  instructionId: string;
  providerReference?: string;
  status?: string;
  error?: string;
}

/**
 * Decrypts the destination, calls the provider, and records the outcome via the
 * settlement RPCs. Credentials are only ever held in-memory inside this call.
 * The instruction must already be in 'pending' state (created or retried).
 *
 * All pre-flight rejections (provider disabled, paused, unconfigured) return
 * immediately WITHOUT mutating any financial state.
 */
export async function executePayoutInstruction(
  instructionId: string,
  actorId: string,
): Promise<ExecuteResult> {
  // Fail closed: refuse to run if encryption key is not configured.
  try {
    validatePayoutConfig();
  } catch (e) {
    return { ok: false, instructionId, error: `CONFIG_ERROR:${(e as Error).message}` };
  }

  // Fetch instruction.
  const { data: inst, error: instErr } = await supabase
    .from("settlement_payout_instructions")
    .select("id, destination_id, provider_name, amount, currency, idempotency_key, state")
    .eq("id", instructionId)
    .single();

  if (instErr || !inst) {
    return { ok: false, instructionId, error: "INSTRUCTION_NOT_FOUND" };
  }
  if (inst.state !== "pending") {
    return { ok: false, instructionId, error: `INSTRUCTION_NOT_PENDING:${inst.state}` };
  }

  // Check provider DB config BEFORE touching any financial state.
  const { data: providerCfg } = await supabase
    .from("payout_provider_config")
    .select("is_enabled, is_paused, pause_reason")
    .eq("provider_name", inst.provider_name)
    .single();

  if (providerCfg) {
    if (!providerCfg.is_enabled) {
      return { ok: false, instructionId, error: `PROVIDER_DISABLED:${inst.provider_name}` };
    }
    if (providerCfg.is_paused) {
      return {
        ok: false,
        instructionId,
        error: `PROVIDER_PAUSED:${inst.provider_name}:${providerCfg.pause_reason ?? "no reason"}`,
      };
    }
  }

  // Instantiate provider adapter — throws in production for test provider.
  let provider;
  try {
    provider = getPayoutProvider(inst.provider_name);
  } catch (e) {
    // Reject before any state mutation.
    return { ok: false, instructionId, error: (e as Error).message };
  }

  // Reject unconfigured providers BEFORE any state mutation.
  if (!provider.isConfigured) {
    return { ok: false, instructionId, error: `PROVIDER_NOT_CONFIGURED:${inst.provider_name}` };
  }

  // All pre-flight checks passed — now we can touch financial state.

  const { data: dest, error: destErr } = await supabase
    .from("merchant_payout_destinations")
    .select("encrypted_destination, destination_type")
    .eq("id", inst.destination_id)
    .single();

  if (destErr || !dest) {
    return { ok: false, instructionId, error: "DESTINATION_NOT_FOUND" };
  }

  let details: Record<string, string>;
  try {
    details = decryptDestinationDetails(
      dest.encrypted_destination as { iv: string; tag: string; ciphertext: string },
    );
  } catch (e) {
    return { ok: false, instructionId, error: `DECRYPT_FAILED:${(e as Error).message}` };
  }

  try {
    const result = await provider.initiatePayout({
      instructionId: inst.id,
      idempotencyKey: inst.idempotency_key,
      destinationDetails: details,
      amount: Number(inst.amount),
      currency: inst.currency,
      reference: inst.idempotency_key,
    });

    if (result.status === "failed") {
      await supabase.rpc("record_payout_failure", {
        p_instruction_id: instructionId,
        p_actor: actorId,
        p_failure_code: result.failureCode ?? "PROVIDER_FAILED",
        p_failure_reason: result.failureReason ?? "Provider returned failed",
      });
      return { ok: false, instructionId, status: "failed", error: result.failureCode };
    }

    const deadline = new Date(Date.now() + POLLING_WINDOW_MS).toISOString();
    await supabase.rpc("record_payout_submission", {
      p_instruction_id: instructionId,
      p_actor: actorId,
      p_provider_reference: result.providerReference,
      p_request_hash: result.requestHash,
      p_response_hash: result.responseHash,
      p_polling_deadline: deadline,
    });

    // Test provider timeout simulation.
    if (Number(inst.amount) === TEST_TIMEOUT_AMOUNT) {
      await supabase.rpc("mark_payout_uncertain", {
        p_instruction_id: instructionId,
        p_actor: actorId,
        p_reason: "provider_timeout",
      });
      return {
        ok: true,
        instructionId,
        providerReference: result.providerReference,
        status: "uncertain",
      };
    }

    return {
      ok: true,
      instructionId,
      providerReference: result.providerReference,
      status: "submitted",
    };
  } catch (e) {
    // Network/timeout: provider state unknown → uncertain.
    await supabase.rpc("mark_payout_uncertain", {
      p_instruction_id: instructionId,
      p_actor: actorId,
      p_reason: `provider_error:${(e as Error).message}`,
    });
    return { ok: false, instructionId, status: "uncertain", error: (e as Error).message };
  }
}
