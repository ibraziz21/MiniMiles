import { supabase } from "@/lib/supabaseClient";

type PassportOpType = "burn" | "refund";

type PassportOpRow = {
  operation_id: string;
  address: string;
  amount: number;
  type: PassportOpType;
  status: "pending" | "processing" | "completed" | "failed";
  tx_hash: string | null;
  last_error: string | null;
};

/**
 * Poll until the operation is completed by another concurrent request,
 * or until we time out.
 */
async function pollForResult(
  operationId: string,
  maxMs = 8_000
): Promise<string | null> {
  const deadline = Date.now() + maxMs;

  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 500));

    const { data } = await supabase
      .from("passport_ops")
      .select("tx_hash, status")
      .eq("operation_id", operationId)
      .maybeSingle();

    if (data?.tx_hash) return data.tx_hash as string;
    if (data?.status === "failed") return null;
  }

  return null;
}

/**
 * Execute a passport burn or refund exactly once for a given operationId.
 *
 * - If called twice with the same operationId, the second call returns the
 *   cached tx_hash from the first (idempotent).
 * - If two requests arrive concurrently, one wins the DB lock and executes;
 *   the other polls until the first finishes.
 * - If a previous attempt failed with no tx_hash on-chain, the row is reset
 *   to pending so the current call can retry safely.
 */
export async function runPassportOp(opts: {
  operationId: string;
  address: string;
  amount: number;
  type: PassportOpType;
  execute: () => Promise<`0x${string}`>;
}): Promise<`0x${string}`> {
  const { operationId, address, amount, type, execute } = opts;

  // 1. Idempotent insert — creates the row only on first call
  const { error: insertError } = await supabase.from("passport_ops").insert({
    operation_id: operationId,
    address: address.toLowerCase(),
    amount,
    type,
    status: "pending",
  });

  // Unique-constraint violation means row already exists — that's fine
  if (insertError && insertError.code !== "23505") {
    throw insertError;
  }

  // 2. Read current state
  const { data: row, error: readError } = await supabase
    .from("passport_ops")
    .select("*")
    .eq("operation_id", operationId)
    .single();

  if (readError || !row) throw new Error("Failed to read passport op row");

  const op = row as PassportOpRow;

  // 3. Already done — return cached result immediately
  if (op.tx_hash) return op.tx_hash as `0x${string}`;

  // 4. Previous attempt failed before any tx was submitted — reset so we retry
  if (op.status === "failed") {
    await supabase
      .from("passport_ops")
      .update({ status: "pending", last_error: null })
      .eq("operation_id", operationId)
      .eq("status", "failed")
      .is("tx_hash", null);
  }

  // 5. Atomically acquire processing rights
  //    Only one concurrent request can flip status pending → processing
  const { data: claimed } = await supabase
    .from("passport_ops")
    .update({ status: "processing" })
    .eq("operation_id", operationId)
    .eq("status", "pending")
    .select("operation_id")
    .maybeSingle();

  if (!claimed) {
    // Another request won — wait for it to finish and return its tx_hash
    const txHash = await pollForResult(operationId);
    if (txHash) return txHash as `0x${string}`;
    throw new Error(
      "Passport operation timed out waiting for a concurrent request to finish"
    );
  }

  // 6. We hold exclusive rights — execute the on-chain call
  try {
    const txHash = await execute();

    await supabase
      .from("passport_ops")
      .update({ status: "completed", tx_hash: txHash })
      .eq("operation_id", operationId);

    return txHash;
  } catch (err: any) {
    const msg = String(err?.shortMessage ?? err?.message ?? err);

    await supabase
      .from("passport_ops")
      .update({ status: "failed", last_error: msg.slice(0, 2000) })
      .eq("operation_id", operationId);

    throw err;
  }
}
