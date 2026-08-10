// Celo attribution tag (ERC-8021) for onchain builder reward attribution.
// https://github.com/celo-org/attribution-tags/blob/main/BUILDERS.md
import { toDataSuffix, type AttributionTagSuffix } from "@celo/attribution-tags";
import { concat, type Hex } from "viem";

/** MiniMiles' assigned attribution code. */
export const CELO_ATTRIBUTION_CODE = "celo_u7gkqc3b";

/**
 * Static, non-hostname-derived, so this is safe to compute once at module
 * scope (including during SSR) rather than lazily inside a client effect.
 */
export const CELO_ATTRIBUTION_SUFFIX: AttributionTagSuffix = toDataSuffix(
  CELO_ATTRIBUTION_CODE,
);

/**
 * Builds the `dataSuffix` for a writeContract call, folding in an optional
 * extra suffix (e.g. a Divvi referral tag) so a single transaction can carry
 * both attribution schemes.
 */
export function withCeloAttribution(extraSuffix?: Hex | null): Hex {
  return extraSuffix
    ? concat([extraSuffix, CELO_ATTRIBUTION_SUFFIX])
    : CELO_ATTRIBUTION_SUFFIX;
}
