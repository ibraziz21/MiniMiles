# Spec: Hub Home V2 — Intent-First Shopping Companion

**Package:** `packages/hub-page`
**Status:** Proposed for product and engineering review
**Supersedes:** The redemption-first member home previously described in this file
**Related spec:** `docs/merchant-directory-in-store-discovery-spec.md`

---

## 0. Executive decision

Akiba's home page will stop treating a member's existing Miles and Pass as the
main reason to open the product.

The primary journey becomes:

```text
Need → Open Akiba → Express intent → Compare merchants
     → Choose the best overall value → Purchase → Earn → Return
```

The page's first question is:

> What are you looking for today?

The main result of search and discovery is a **merchant decision**, not a
product catalog. Akiba helps the user decide where to buy by combining
relevance, convenience, currently available savings, and verified rewards.

Miles, active vouchers, and the Pass remain one tap away, but they support the
shopping decision instead of defining the page.

## 1. Product truth

The current member home is ordered around assets the user already owns:

1. Pass;
2. Miles balance;
3. deals affordable with that balance;
4. active vouchers.

That is a useful loyalty-wallet dashboard, but it optimizes for a later step in
the loop: redemption. It does not place Akiba at the moment when the user is
choosing where to spend.

Hub V2 is a shopping companion. Its job is not to reproduce a marketplace or
show as many products as possible. Its job is:

> Given what this person needs now, which Akiba merchant offers the strongest
> combination of fit, savings, rewards, convenience, and availability?

## 2. Goals and non-goals

### Goals

- Make expressing purchase intent the dominant action above the fold.
- Route a broad intent such as “burger”, “internet”, or “airtime” to useful
  merchant comparisons.
- Explain why each recommendation is useful without exposing a mysterious
  numeric score.
- Use location only after permission and continue to work without it.
- Personalize progressively as trustworthy signals become available.
- Keep the Pass, Miles, and vouchers easy to reach without letting them
  dominate discovery.
- Create measurable merchant value at the moment of consideration.

### Non-goals

- Building an Amazon-style product catalog on the home page.
- Comparing prices that are not structured, current, and like-for-like.
- Claiming that a user “visited” a merchant based on a profile view,
  directions tap, or location alone.
- Launching ratings before a verified review system exists.
- Displaying a predicted Miles amount when the Platform cannot guarantee it.
- Creating paid or sponsored ranking without a visible label.
- Using friends or social-graph data in the first release.

## 3. Product principles

1. **Intent first.** Search and intent shortcuts precede wallet information.
2. **Merchant first.** Products and offers are evidence for choosing a
   merchant, not the page's organizing unit.
3. **Truth before richness.** Missing price, rating, inventory, or reward data
   is omitted, never guessed.
4. **Explain the recommendation.** Show reasons such as “2.1 km away”,
   “10% voucher available”, or “matches Internet”.
5. **No permission wall.** Location and sign-in improve results but are not
   required for public discovery.
6. **Verified behavior beats proxy behavior.** Purchases, redemptions, and
   Pass scans are stronger ranking signals than impressions or clicks.
7. **Rewards support the decision.** Miles and vouchers appear where they
   change value, plus in a compact account snapshot.
8. **The page remains useful with sparse data.** Every section has a defined
   fallback or disappears cleanly.

## 4. Success measures

The primary success metric is:

> **Merchant decision rate:** percentage of home sessions that lead to a
> high-intent merchant action within the same session.

High-intent actions are:

- directions tap;
- call or WhatsApp tap;
- voucher acquisition start;
- add to cart or checkout start;
- Pass open after viewing a merchant;
- verified purchase, Pass scan, or voucher redemption where attribution is
  available.

Supporting metrics:

- search or intent-shortcut usage rate;
- search result click-through rate;
- zero-result rate;
- time from home view to merchant profile;
- comparison-to-high-intent-action conversion;
- location opt-in rate after the user taps “Near me”;
- repeat home use within 30 days;
- verified purchase/redemption rate from a home discovery session;
- merchant discovery distribution, monitored to catch accidental winner-take-
  all ranking.

Guardrails:

- home error and empty-state rate;
- search latency and feed latency;
- back-navigation and abandonment after location denial;
- no unsupported savings, distance, open/closed, or Miles claims;
- no material reduction in Pass access or active-voucher use.

An analytics provider is a launch dependency for measuring these outcomes.
The current `lib/analytics/track.ts` production no-op is not sufficient for an
experiment or ranking feedback loop.

## 5. Audience and authentication behavior

The home route remains `/` and keeps the existing server-side auth split.

### Signed-in member

Receives the full intent-first experience:

- personal greeting;
- universal intent search;
- popular intent shortcuts;
- personalized or context-ranked merchant sections;
- compact rewards snapshot.

### Signed-out visitor

Receives the same discovery mental model rather than a different product
promise:

- headline: “Find the best place to buy what you need.”
- public intent search;
- popular intents;
- configured featured merchants and new merchants;
- compact sign-up prompt explaining that membership adds Miles, vouchers, and
  personalized recommendations.

Public merchant browsing remains available without an account. Sign-in is
required only when an existing protected action requires it, such as acquiring
a voucher. Preserve the intended destination through authentication.

This replaces the current one-screen visitor pitch in `VisitorLanding.tsx`.

## 6. Home information architecture

The mobile order is fixed:

1. Greeting and intent search.
2. Popular intent shortcuts.
3. Best value for the user.
4. Nearby.
5. Trending and new.
6. Compact rewards snapshot.

Sections 3–5 are conditional. The page must not render empty rails merely to
preserve the layout.

### 6.1 What do I need today?

Signed-in copy:

```text
Welcome back, {firstName} 👋
What are you looking for today?
[ Search merchants or what you need… ]
```

Signed-out copy:

```text
Find the best place to buy what you need.
[ Search merchants or what you need… ]
```

Search covers:

- merchant names;
- controlled merchant categories;
- core offering names;
- branch name, locality, and city;
- active voucher titles and applicable categories;
- active storefront product names only when a merchant supports online
  shopping.

The Phase 1 placeholder is **Search merchants or what you need…**. It does not
promise a particular entity type. The more specific **Search merchants,
services or offers…** may replace it after active offer search is in the
production query. “Products” may be added only after product-name search is
also live.

Submitting search opens the canonical comparison route:

```text
/merchants?q={query}&from=home
```

The first release reuses the directory results page. It does not build a
second search-results experience on home.

Search behavior:

- submit on Enter or search-button tap;
- trim whitespace and cap input at 120 characters;
- preserve the query on the results page and through back navigation;
- show recent searches only on-device and only after explicit use;
- do not send raw query text to general analytics;
- never request location automatically when search receives focus.

### 6.2 Popular today

Show up to eight intent chips. Initial examples:

- Burgers
- Internet
- Fuel
- Groceries
- Gaming
- Airtime
- Coffee
- Gift Cards

These are not hard-coded emoji links in production. Each shortcut is a
configured discovery intent with:

```ts
type DiscoveryIntent = {
  id: string;
  slug: string;
  label: string;
  iconKey: string;
  query: string;
  categorySlug?: string;
  active: boolean;
  sortOrder: number;
  startsAt?: string;
  endsAt?: string;
};
```

Tapping a shortcut opens the merchant comparison route with a stable intent
identifier:

```text
/merchants?q=burger&intent=burgers&from=home_shortcut
```

“Popular today” is acceptable copy only when ordering is backed by current
usage. Until then, label the configured list **Browse by need**. This avoids
presenting editorial choices as live popularity.

### 6.3 What's the best value for me?

Personalized member title: **Deals for you**
Member cold-start fallback: **Worth a look**
Signed-out fallback: **Places to explore**

Show up to six merchant cards. This is a merchant rail, not a voucher rail.
Each card may use one active offer as a reason to choose that merchant.

The member feed can use, when available:

- current query or selected intent;
- explicit interests;
- coarse current location;
- completed purchases;
- verified Pass scans or merchant awards;
- active vouchers;
- current Miles balance;
- currently available voucher templates;
- merchant and branch availability.

It must not use “friends” until a separate consent, privacy, and abuse model is
approved.

Cold-start order:

1. selected intent, if present;
2. location, if enabled;
3. current active offer value;
4. editorially configured merchants;
5. deterministic merchant name as a final tie-breaker.

Use **Deals for you** only when at least one personal signal changed candidate
selection, order, or explanation. Never label a generic cold-start list “for
you”.

### 6.4 Near you

This section appears when:

- the user has enabled location for the current experience; and
- at least one published physical/hybrid merchant has valid coordinates.

Before permission, show a compact opt-in control:

```text
Find value near you
Use your location to compare nearby Akiba merchants.
[ Use my location ]
```

The browser permission prompt is triggered only by that button.

A nearby card prioritizes:

- merchant name and logo;
- nearest branch locality;
- distance;
- open/closed status only when timezone and hours are valid;
- strongest available voucher;
- verified earning summary, if available;
- the reason it matched the active intent.

Example:

```text
Drip Burgers
2.0 km · Open until 10 PM
10% voucher available · Earn Miles here
[ View merchant ]
```

Do not say “Earn 150 Miles” unless the Platform provides a deterministic
preview for the relevant purchase amount and campaign. When only eligibility
is known, use “Earn Miles here”.

Coordinates are ephemeral query inputs. Do not put them in analytics, user
profiles, or long-lived server logs.

If permission is denied, replace the control with a non-blocking city filter.
Do not repeatedly prompt.

### 6.5 Trending and what's new

These are separate concepts and must not be blended.

**Trending this week** requires a seven-day aggregate with minimum-volume and
anti-gaming safeguards. Candidate inputs:

- unique merchant profile viewers;
- unique high-intent actions;
- verified purchases;
- verified Pass scans;
- voucher acquisitions and redemptions.

Verified activity receives more weight than views. Use a minimum cohort before
showing the section, and never expose exact user counts.

Allowed labels must match their data:

- **Most redeemed** — verified redemptions;
- **Popular this week** — qualified discovery and action aggregate;
- **New merchants** — recent `directory_published_at`;
- **Limited-time offers** — active offers with a real end time.

Do not use “Most visited” until Akiba has verified visit events. A directions
tap is intent, not a visit.

Phase 1 ships **New merchants** and **Limited-time offers** if source fields
are available. Live trending ships only after event collection and aggregation
are in production.

### 6.6 What have I already earned?

Rewards appear after discovery in one compact card:

```text
Your rewards
12,450 Miles       3 active vouchers
[ View Pass ]      [ View rewards ]
```

Rules:

- Pass remains available globally through the existing `/pass` navigation/FAB;
- the home card does not render a QR;
- tapping Miles opens `/rewards`;
- tapping active vouchers opens `/vouchers`;
- tapping Pass opens `/pass`;
- omit the active-voucher count when zero;
- do not repeat the old “affordable deals” rail here.

This retains fast till access while keeping the home page focused on purchase
intent.

## 7. Merchant comparison card

All discovery sections use a shared `MerchantValueCard`. The card answers:

1. Is this merchant relevant to what I need?
2. What value can I get?
3. How convenient is it?
4. What should I do next?

Required:

- merchant logo and name;
- primary category or matched core offering;
- one plain-language match reason;
- `View merchant` target.

Conditional:

- nearest branch and distance;
- accurate open/closed status;
- active voucher benefit;
- Miles affordability where a voucher has a Miles cost;
- verified earning availability or deterministic earning preview;
- online/in-store badge.

Example reason chips:

- `Matches Burgers`
- `2.0 km away`
- `10% voucher`
- `You can unlock this`
- `Earn Miles here`
- `Open until 10 PM`
- `New on Akiba`

Do not show:

- a public numeric “Overall Value Score”;
- a crossed-out price without a canonical reference price;
- ratings before verified ratings exist;
- “best price” without like-for-like price coverage;
- “recommended for you” when no personal signal was used.

The card is one accessible link to the merchant profile. Nested offer actions
are avoided in rails; the merchant page owns directions, contact, voucher, and
checkout actions.

## 8. Search and comparison model

Search starts from the user's language but produces merchant candidates.

### 8.1 Candidate retrieval

A merchant is eligible only when the merchant-directory publication contract
passes:

```text
partner is active
AND directory status is published
AND profile completeness passes
```

Query matching considers:

1. exact/prefix merchant name;
2. configured intent aliases;
3. primary/secondary category;
4. core offerings;
5. active offers;
6. branch/locality/city;
7. active storefront products.

Internal contacts, internal notes, delivery cities, inactive offers, and
unpublished merchants are excluded.

Add controlled aliases for common local language and user phrasing, for
example:

```text
wifi, bundles, data → Internet
petrol, diesel → Fuel
nyama choma → relevant food offering
salon, braids → relevant beauty offering
```

Aliases are reviewed configuration, not arbitrary merchant-supplied keyword
stuffing.

### 8.2 Ranking

Ranking is a two-stage process:

1. **Eligibility and relevance:** retrieve merchants that can satisfy the
   intent.
2. **Overall value:** order eligible merchants using reliable contextual
   signals.

Initial conceptual score:

```text
35% intent relevance
20% current offer utility
15% proximity
10% availability
10% user affinity
10% verified popularity/quality
```

These are starting weights for offline evaluation, not a permanent product
truth. For a query, intent relevance is mandatory and cannot be outweighed by
popularity.

Feature rules:

- normalize every feature to `0..1`;
- attach freshness and reliability to computed features;
- treat missing data as unavailable, not as a false zero;
- redistribute the weight of unavailable features across reliable features;
- apply deterministic tie-breakers;
- cap popularity effects so large merchants do not permanently suppress new
  entrants;
- keep sponsored placement out of organic scoring;
- log ranking version and candidate IDs for evaluation, without raw
  coordinates.

`price` is excluded from the general merchant score until Akiba has comparable,
current prices for the same user intent. A voucher discount is an offer signal,
not proof of the lowest final price.

`merchant rating` is excluded until there is a verified review product with a
minimum review count and abuse controls.

### 8.3 Recommendation explanation

For every ranked card, select up to three strongest truthful reasons. The
explanation layer is a separate output from the score:

```ts
type MatchReason =
  | { kind: "intent"; label: string }
  | { kind: "distance"; distanceKm: number }
  | { kind: "voucher"; label: string; templateId: string }
  | { kind: "affordable"; templateId: string }
  | { kind: "earn"; label: string }
  | { kind: "availability"; label: string }
  | { kind: "new"; label: string };
```

If a reason cannot be sourced and refreshed, it cannot be shown.

## 9. Signal readiness

| Signal | Current source | Phase 1 use | Required follow-up |
|---|---|---:|---|
| Merchant/category/core offering | Directory RPCs | Yes | Add intent aliases and relevance rank |
| Location/distance | `merchant_locations` + opt-in coordinates | Yes | Return nearest branch consistently |
| Active voucher | Canonical voucher availability RPC | Yes | Add strongest-offer summary to feed DTO |
| Miles balance | `lib/akiba/balance.ts` | Yes | Use only for affordability explanation |
| Active vouchers held | `lib/akiba/myVouchers.ts` | Yes | Resolve merchant IDs for affinity |
| Interests | `users.interests` | Limited | Map legacy interests to controlled intents |
| Previous Hub orders | `merchant_transactions` | Limited | Resolve user identity and completed status |
| Merchant awards/Pass scans | Platform ledger/events | Not yet | Define partner-attributed read contract |
| Earn rate/preview | Platform campaign engine | Not yet | Add verified eligibility/preview contract |
| Opening status | branch hours/timezone | Yes when valid | Centralize tested open-now calculation |
| Price comparison | No general comparable source | No | Define structured comparable offers |
| Ratings | No verified source | No | Separate ratings/reviews product |
| Trending | No production analytics pipeline | No | Provider + seven-day rollup |
| Friends | No consented social graph | No | Deferred |

The UI must be driven by this table. Product copy cannot move a signal into an
earlier phase than its data contract.

## 10. Server contracts

Home composition is server-owned so clients do not join sensitive tables or
produce inconsistent rankings.

### 10.1 Feed

`GET /api/home/feed`

Optional query:

- `lat`, `lng` after explicit location permission;
- `city`;
- `intent`;
- `limit_per_section`, capped at 10.

Response:

```ts
type HomeFeedResponse = {
  rankingVersion: string;
  generatedAt: string;
  intents: DiscoveryIntent[];
  sections: Array<{
    id: "for_you" | "nearby" | "popular" | "new" | "limited_time";
    title: string;
    personalized: boolean;
    merchants: MerchantValueSummary[];
  }>;
  rewards: null | {
    milesBalance: number;
    activeVoucherCount: number;
    hasPass: boolean;
  };
};

type MerchantValueSummary = {
  id: string;
  slug: string;
  name: string;
  logoUrl: string | null;
  primaryCategory: { slug: string; name: string } | null;
  matchedOffering: string | null;
  operatingModel: "physical" | "hybrid" | "online";
  nearestLocation: null | {
    id: string;
    locality: string | null;
    city: string;
    distanceKm: number | null;
    openStatus: "open" | "closed" | "unknown";
    closesAt: string | null;
  };
  topOffer: null | {
    templateId: string;
    label: string;
    milesCost: number;
    affordable: boolean | null;
    expiresAt: string | null;
  };
  earnSummary: null | {
    label: string;
    deterministic: boolean;
  };
  reasons: MatchReason[];
};
```

Rules:

- signed-out responses contain no rewards and no personal features;
- user-specific voucher availability must not be shared across users through
  cache;
- public and personal sections fail independently;
- a failed personal section does not take down search or generic discovery;
- responses use allowlisted DTOs only;
- raw score and sensitive feature values remain server-side.

### 10.2 Search

Phase 1 submits directly to `/merchants`.

Phase 2 may add:

`GET /api/discovery/suggestions?q={prefix}`

It returns at most eight safe suggestions across merchant, intent, category,
offering, and offer types. It must be rate-limited, keyboard accessible, and
fast enough to meet the performance target below. Suggestions are not a
launch dependency.

### 10.3 Earning summary

Hub must not infer earning amounts from old marketing copy. Akiba Platform
remains the source of truth.

Before deterministic earn amounts are shown, Platform must expose a read-only
contract that answers either:

- the member is eligible to earn at this merchant; or
- for a stated amount and currency, the exact Miles preview and its expiry.

The response must include a campaign/rule identifier and freshness boundary so
Hub can invalidate stale claims.

## 11. Code change map

Existing pieces to retain:

- `src/app/page.tsx` auth split;
- `src/lib/akiba/balance.ts`;
- `src/lib/akiba/myVouchers.ts`;
- `/merchants` and `/merchants/[slug]`;
- canonical voucher availability logic;
- `/pass` and the persistent Pass navigation/FAB;
- shared merchant publication rules.

Replace or refactor:

- `src/app/MemberHome.tsx` — replace Pass-first composition with the member
  discovery shell;
- `src/app/VisitorLanding.tsx` — align signed-out home with public discovery;
- `src/lib/akiba/deals.ts` — stop using affordability as the primary home
  ordering rule; retain helpers where voucher surfaces need them;
- `src/lib/akiba/featuredMerchants.ts` — directory visibility must not depend
  on `store_active`.

New modules:

```text
src/components/home/HomeIntentSearch.tsx
src/components/home/IntentShortcuts.tsx
src/components/home/MerchantValueCard.tsx
src/components/home/MerchantRail.tsx
src/components/home/LocationOptIn.tsx
src/components/home/RewardsSnapshot.tsx
src/lib/home/types.ts
src/lib/home/feed.ts
src/lib/home/ranking.ts
src/lib/home/explanations.ts
src/app/api/home/feed/route.ts
```

Prefer shared merchant types and query functions over creating a second
merchant model. Any extension needed by home should also be useful to the
directory or clearly remain a home-only projection.

## 12. States and failure behavior

### Loading

- render a stable server shell for greeting, search, and shortcuts;
- skeleton only the data rails;
- do not block search while personal feeds load;
- reserve card dimensions to avoid layout shift.

### No matching search results

Show:

- “We couldn't find a merchant for `{query}` yet.”
- nearby categories or corrected intent suggestions;
- an option to browse all merchants.

Do not replace a zero-result query with unrelated “matches”.

### Sparse home feed

- no personalized data: show a generic, accurately labelled section;
- no location: show opt-in or city selection;
- no active offers: show merchant matches without offer badges;
- no trending aggregate: omit Trending;
- no new merchants: omit What's new;
- no rewards data: show links without stale numeric values.

### Errors

- search remains functional if the feed fails;
- each rail can show a small retry without replacing the whole page;
- never render a balance of zero merely because the balance read failed;
- never preserve a stale “Open now”, voucher, or earning claim after its
  freshness window.

## 13. Accessibility and performance

Accessibility:

- search has a persistent visible label or equivalent accessible name;
- all shortcut and filter states are keyboard operable;
- horizontal rails also expose a normal focus order and do not trap scroll;
- card reasons use text, not color alone;
- reduced-motion preference is respected;
- location status and errors use polite live regions;
- touch targets are at least 44 by 44 CSS pixels;
- headings preserve a logical hierarchy.

Performance targets at the 75th percentile on a mid-range mobile device:

- LCP under 2.5 seconds;
- INP under 200 ms;
- CLS under 0.1;
- search submit feedback under 100 ms;
- feed API server response under 500 ms when warm;
- suggestion response under 250 ms when introduced.

Use bounded result sets, parallel server reads, and optimized merchant images.
Do not delay the search shell on balance, voucher, or personalization reads.

## 14. Analytics

Required events:

- `home_view { variant, ranking_version }`
- `home_search_submit { query_length, intent_id?, results_source }`
- `home_intent_tap { intent_id, position }`
- `home_section_view { section_id, personalized }`
- `home_merchant_tap { merchant_id, section_id, position, reason_kinds,
  ranking_version }`
- `home_location_prompt_tap`
- `home_location_result { outcome: granted|denied|unavailable }`
- `home_rewards_tap { target: miles|vouchers|pass }`
- `home_empty_results { intent_id?, query_length }`
- `home_feed_error { section_id|feed }`

Continue the merchant-profile high-intent events already defined by the
directory spec and attach a non-PII discovery-session ID for attribution.

Privacy rules:

- no raw coordinates;
- no phone, email, address, or wallet;
- no raw free-text query in general analytics;
- merchant IDs and controlled intent IDs are allowed;
- any separate short-retention search-quality log requires explicit security
  review, access controls, and a deletion policy.

## 15. Delivery plan

### Phase 0 — data and measurement readiness

1. Connect a production analytics provider.
2. Confirm directory publication, category, offering, location, hours, and
   voucher data completeness.
3. Define controlled home intents and aliases.
4. Add or confirm `directory_published_at` for New merchants.
5. Define the Platform earning-summary contract; do not block Phase 1 on
   deterministic earn amounts.
6. Create a feature flag for `home_intent_v2`.

Exit criteria:

- analytics events can be inspected end to end;
- every home claim maps to a current source;
- incomplete merchants have safe card fallbacks.

### Phase 1 — intent-first MVP

1. Replace the member hero with greeting + search.
2. Add configured Browse by need shortcuts.
3. Send queries and shortcuts to `/merchants`.
4. Add a server-composed merchant rail using published directory merchants,
   active voucher availability, optional location, and Miles affordability.
5. Add location opt-in and Nearby.
6. Add New merchants / Limited-time offers only where data is valid.
7. Replace the compact QR-first card with the rewards snapshot.
8. Align signed-out home with public discovery.

Phase 1 does **not** ship:

- public numeric value scores;
- ratings;
- general price ranking;
- live trending;
- friend signals;
- predicted Miles amounts.

Exit criteria:

- the primary journey works with existing trustworthy data;
- search is the first action;
- no old affordability rail remains above discovery.

### Phase 2 — comparison and explanation

1. Extend search relevance across aliases, offerings, active offers, and
   optional product names.
2. Introduce `MerchantValueCard` across home and directory results.
3. Add strongest-offer and open-status summaries.
4. Add verified earning eligibility/preview when Platform supports it.
5. Add suggestion API if query data shows it is needed.
6. Evaluate ranking offline before changing production weights.

### Phase 3 — personalization and trends

1. Add completed-purchase and verified merchant-interaction affinity.
2. Map explicit interests to controlled intents.
3. Build privacy-safe seven-day popularity aggregates.
4. Launch Trending only after minimum-volume thresholds pass.
5. Add exploration/fairness constraints and monitor merchant distribution.

### Phase 4 — experiment and rollout

1. Internal and staff testing.
2. 10% signed-in member rollout.
3. 50% rollout after guardrails hold.
4. Full member rollout.
5. Signed-out discovery rollout.
6. Remove the old member home after the rollback window.

Compare V2 against the current home on merchant decision rate, verified
conversion, Pass access, voucher use, performance, and error guardrails.

## 16. Acceptance criteria

### Product

- Search is the dominant above-the-fold control on mobile and desktop.
- A member can search a need without first interacting with Pass, balance, or
  vouchers.
- Home results are organized around merchants, not a grid of products.
- Miles, vouchers, and Pass appear in a compact section after discovery.
- Pass remains one tap away globally.
- Every recommendation card states at least one truthful match reason.
- The home never shows an unsupported rating, price-comparison, earning amount,
  popularity claim, or visit claim.

### Search

- Merchant name, controlled category, core offering, location, and active
  offer searches return eligible published merchants.
- Whitespace-only and over-length queries are handled safely.
- Query and filters survive navigation to results and browser back.
- Zero results remain truthful and offer useful recovery paths.
- Unpublished, inactive, and hidden/test merchants never appear.

### Location

- No browser location prompt appears before an explicit user tap.
- Granted location ranks by a valid nearest branch.
- Denied/unavailable location falls back to city/category browsing.
- Coordinates are absent from analytics and user-profile storage.
- Distance and open/closed copy disappear when their inputs are incomplete.

### Personalization and ranking

- Signed-out users receive no personal signals.
- “For you” appears only when at least one personal signal influenced ranking.
- Missing features do not silently penalize merchants.
- Search relevance cannot be overcome by generic popularity.
- Ranking version and card positions are observable for evaluation.
- Paid placement cannot enter an organic section without a visible sponsored
  label.

### Resilience

- Search works when balance, voucher, location, or recommendation reads fail.
- One rail failure does not fail the whole home.
- No failed balance read is rendered as a real zero.
- User-specific voucher availability is not leaked through shared caching.

### Quality

- Keyboard, screen-reader, reduced-motion, and touch-target checks pass.
- Core Web Vitals and API targets in section 13 pass in release testing.
- Mobile layouts work at 320 px width and respect safe areas.
- Automated tests cover ranking determinism, explanation truthfulness, auth
  separation, location fallbacks, and feed partial failures.

## 17. Open decisions

These require product decisions before Phase 1 implementation:

1. Should the signed-out home expose full public search immediately, or keep a
   shorter sign-up-first pitch for the initial experiment? This spec recommends
   public search because it demonstrates the product's real job.
2. Which five to eight controlled intents best represent current merchant
   supply? Do not launch a shortcut that repeatedly produces no useful result.
3. Does `directory_published_at` exist reliably enough for New merchants, or
   does it need a migration/backfill?
4. Which analytics provider owns discovery sessions and ranking evaluation?
5. What event is the canonical proof of an in-store visit: Pass scan, merchant
   award, voucher redemption, or a defined subset?
6. Can Platform expose “Earn Miles here” eligibility before it can expose
   deterministic amount previews?

## 18. Definition of done

The upgrade is complete when a user with a shopping need can open `/`, express
that need immediately, compare eligible merchants using truthful value and
convenience signals, take a high-intent action, and still reach their rewards
and Pass without friction.

The page should feel like a decision tool with rewards built in—not a rewards
wallet with shopping added underneath.
