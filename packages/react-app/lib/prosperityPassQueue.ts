import { supabase } from "@/lib/supabaseClient";

export type ProsperityPassJobRow = {
  id: string;
  idempotency_key: string;
  user_address: string;
  points: number;
  status: "pending" | "processing" | "completed" | "failed";
  superchain_id: string | null;
  safe_address: string | null;
  burn_tx_hash: string | null;
  tx_hash: string | null;
  refund_tx_hash: string | null;
  last_error: string | null;
  attempts: number;
};

function isDuplicateError(error: any) {
  return error?.code === "23505";
}

export async function getProsperityPassJob(idempotencyKey: string): Promise<ProsperityPassJobRow | null> {
  const { data, error } = await supabase
    .from("prosperity_pass_jobs")
    .select("*")
    .eq("idempotency_key", idempotencyKey)
    .maybeSingle();

  if (error) throw error;
  return data as ProsperityPassJobRow | null;
}

export async function ensureProsperityPassJob(opts: {
  idempotencyKey: string;
  userAddress: string;
  points: number;
}) {
  const { data, error } = await supabase
    .from("prosperity_pass_jobs")
    .insert({
      idempotency_key: opts.idempotencyKey,
      user_address: opts.userAddress.toLowerCase(),
      points: opts.points,
      status: "pending",
    })
    .select("*")
    .single();

  if (error && !isDuplicateError(error)) throw error;
  if (data) return data as ProsperityPassJobRow;

  const raced = await getProsperityPassJob(opts.idempotencyKey);
  if (!raced) throw new Error(`Failed to create prosperity pass job ${opts.idempotencyKey}`);
  return raced;
}
