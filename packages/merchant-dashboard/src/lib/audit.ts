import { supabase } from "./supabase";

export interface AuditParams {
  merchantUserId: string;
  partnerId: string;
  action: string;
  orderId?: string;
  metadata?: Record<string, unknown>;
}

/**
 * Writes an immutable audit log entry.
 * Fire-and-forget — errors are logged but never thrown (never block the main flow).
 */
export async function writeAuditLog(params: AuditParams): Promise<void> {
  const { error } = await supabase.from("merchant_audit_log").insert({
    merchant_user_id: params.merchantUserId,
    partner_id: params.partnerId,
    action: params.action,
    order_id: params.orderId ?? null,
    metadata: params.metadata ?? null,
  });

  if (error) {
    console.error("[audit] Failed to write audit log:", error.message, params);
  }
}
