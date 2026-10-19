/** Server-only configuration shared by manual admission and execution. */
export function adminExecutionConfigBlockers(env: NodeJS.ProcessEnv = process.env): string[] {
  const blockers: string[] = [];
  if (env.ACCOUNT_DELETION_ADMIN_EXECUTION_ENABLED !== "true") blockers.push("admin_execution_disabled");
  if (env.ACCOUNT_DELETION_EXPIRY_ENABLED !== "true") blockers.push("retention_expiry_disabled");
  if (env.ACCOUNT_DELETION_EMAIL_PROVIDER?.trim().toLowerCase() !== "resend" || !env.RESEND_API_KEY?.trim()) blockers.push("email_transport_unavailable");
  if (!env.ACCOUNT_DELETION_CONTACT_KEY_V1 || Buffer.from(env.ACCOUNT_DELETION_CONTACT_KEY_V1.trim(), "base64").length !== 32) blockers.push("contact_encryption_unavailable");
  return blockers;
}
