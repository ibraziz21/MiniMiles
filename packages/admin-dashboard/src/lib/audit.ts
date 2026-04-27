import { supabase } from "./supabase";

export interface AdminAuditParams {
  adminUserId: string;
  action: string;
  targetType?: string;
  targetId?: string;
  metadata?: Record<string, unknown>;
  ipAddress?: string;
}

export async function writeAdminAuditLog(params: AdminAuditParams): Promise<void> {
  const { error } = await supabase.from("admin_audit_logs").insert({
    admin_user_id: params.adminUserId,
    action: params.action,
    target_type: params.targetType ?? null,
    target_id: params.targetId ?? null,
    metadata: params.metadata ?? null,
    ip_address: params.ipAddress ?? null,
  });

  if (error) {
    console.error("[admin-audit] Failed to write audit log:", error.message, params);
  }
}
