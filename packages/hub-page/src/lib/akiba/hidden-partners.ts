/**
 * Test/legacy merchant partners hidden from all consumer-facing surfaces.
 *
 * These rows couldn't be deleted from the shared database (immutable
 * ledger/audit guards), so they're display-filtered instead. Only real pilot
 * partners should ever render on the Pass.
 *
 * Remove entries here once the corresponding rows are actually purged
 * (see Akiba-Platform/supabase/maintenance/clear-test-merchants.sql).
 */
export const HIDDEN_PARTNER_IDS: string[] = [
  "4e229b5d-4676-4f73-8399-6ed86e0205d9", // Leshan Technologies (test)
  "568e8527-22d9-44dc-bea7-091ed2a2f53c", // Brew House (draft test)
  "81fb8bb8-4944-499a-80ce-c6b974441412", // auto-provisioned account artifact
  "b011be94-ebf6-4131-84c4-3b94d8485e18", // Leshan Group (merchant@example.com)
];

/** PostgREST `not in` filter value: `(id1,id2,…)` */
export const HIDDEN_PARTNER_FILTER = `(${HIDDEN_PARTNER_IDS.join(",")})`;

export function isHiddenPartner(partnerId: string | null | undefined): boolean {
  return !!partnerId && HIDDEN_PARTNER_IDS.includes(partnerId);
}
