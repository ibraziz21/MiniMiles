# Akiba-Platform RPC requests — Discovery Blueprint Phase 2

**Owner of the change:** Akiba-Platform (`list_public_merchants`, `get_public_merchant`)
**Requested by:** Hub discovery redesign, Phase 2 ("Correctness & Contracts")
**Status:** Not implementable from `packages/hub-page` — no SQL for these RPCs exists in this monorepo

Three Phase 2 items require changes to RPCs that live entirely in the separate Akiba-Platform repo. Hub calls them via `admin.rpc(...)` in `src/lib/merchants/queries.ts` but has no access to their implementation or migration chain. This doc records exactly what's needed so the request isn't lost in chat history.

## 1. Country-scoped discovery enforcement

**Requirement:** A member should never see another country's merchants or rewards in Explore or Directory results by default (discovery-blueprint.md §7).

**What's needed:** Confirm whether `list_public_merchants` and `get_public_merchant` already filter by the member's country (via `p_hub_user_id` → the member's resolved country) versus the merchant's country. If not, add that filter server-side inside the RPC.

**Why this can't be a Hub-side fix:** A client-side or Hub-side post-filter over the RPC's already-paginated output is not real enforcement — it just hides rows from the current page without changing which rows exist in the result set or its cursor, and the blueprint is explicit that "UI filtering alone must never enforce" a discovery-scope boundary. (Acquisition-time country revalidation is implemented Hub-side already — see `src/lib/akiba/countryEligibility.ts` and `src/lib/vouchers/issuance.ts` — that's a separate, narrower check at the point a voucher is actually acquired, not a substitute for this one.)

## 2. Opening-hours / open-now status in the list RPC's per-row shape

**Requirement:** Show a truthful "Open now"/"Closed" badge on Directory and Explore cards (discovery-blueprint.md §5).

**Current state:** `get_public_merchant` (the single-merchant detail RPC) already returns full `opening_hours` per location, and Hub already has a tested `isOpenNow` calculator (`src/lib/merchants/opening-hours.ts`) using it — that's why it works correctly on `BranchCard` in the merchant profile page. `list_public_merchants` (the list/summary RPC) does **not** return opening hours or timezone at all today, which is why `src/lib/merchants/enrich.ts`'s `toMerchantValueSummary` hardcodes `nearestLocation.openStatus: "unknown"` for every list-sourced card — that's a truthful placeholder, not a bug.

**What's needed:** Either (a) return each location's `opening_hours` + `timezone` in `list_public_merchants`' row shape so Hub can run the same existing `isOpenNow` calculator client/server-side, or (b) compute and return an already-resolved `open_status`/`closes_at` field directly from the RPC. Either works; (b) is simpler for Hub to consume and keeps the timezone-handling logic in one place (Platform), but either unblocks the same UI.

**Hub-side readiness:** `src/components/merchants/MerchantDirectoryCard.tsx` already has the conditional render logic in place (`nearestLocation.openStatus !== "unknown"`) — it will start showing the badge automatically the first time the DTO carries real data, no Hub code change needed.

## 3. Server-side, pagination-safe affordability filter

**Requirement:** A "merchants where I can afford something" filter on `/merchants` that works correctly with cursor pagination (discovery-blueprint.md §4/§8).

**Current state:** Hub ships a client-side shim today (`hasOffer`-style toggle in `src/app/merchants/MerchantFilters.tsx`, see the `visibleMerchants` filter) that only filters whatever page is already loaded — it can under-fill a page and doesn't reduce the actual result count from the RPC.

**What's needed:** `list_public_merchants` needs either a `p_min_balance`/`p_balance` parameter it can filter or sort by server-side, with cursor semantics that stay correct when combined with that filter (a cursor computed against the unfiltered result set can't be reused against a filtered one without skipping or repeating rows). The member's balance itself is already resolvable Hub-side (`src/lib/merchants/enrich.ts`'s `getSignedInBalance`) and could be passed as a parameter if Platform prefers not to resolve it itself.

---

Until these ship, Hub's existing truthful-by-default behavior (hiding the open/closed badge, keeping the affordability toggle explicitly scoped as a client-side shim, and not attempting country enforcement at the discovery layer) is the correct interim state — better than fabricating any of these three from incomplete data.
