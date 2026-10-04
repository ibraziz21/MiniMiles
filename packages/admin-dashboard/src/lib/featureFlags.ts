/**
 * Akiba-funded voucher admin kill switch
 * (akiba-funded-voucher-launch-hardening-spec.md §3). Production default is
 * `false` — same env-var name as the Hub and Platform-side flags by
 * convention, but each surface reads its own process.env; there is no shared
 * config source.
 */
export function akibaFundedVouchersAdminFlag(): boolean {
  return process.env.AKIBA_FUNDED_VOUCHERS_ADMIN_ENABLED === "true";
}

/**
 * Funded-voucher Finance console kill switch (batching, submission, payment,
 * reversal, reconciliation-incident resolution). Production default `false`,
 * same convention as the Admin flag above. Does not gate
 * `/api/admin/settlements` or any other legacy voucher-settlement route —
 * those are a separate, unrelated liability system.
 *
 * Akiba-Platform owns the current funded reimbursement batch and reversal
 * mutations and applies the same environment flag server-side. This helper
 * is reserved for the Admin Finance UI when that surface is added.
 */
export function akibaFundedVouchersFinanceFlag(): boolean {
  return process.env.AKIBA_FUNDED_VOUCHERS_FINANCE_ENABLED === "true";
}
