# Spec: Next Reward Progress V1

**Package:** `packages/hub-page`  
**Primary surfaces:** signed-in home and `/me`  
**Status:** Proposed for product and engineering review  
**Product direction:** Make a member's Miles balance understandable as progress toward a useful merchant outcome  
**Related specs:** `home-redesign-spec.md`, `merchant-directory-in-store-discovery-spec.md`, `merchant-shopping-quests-spec.md`

---

## 0. Executive decision

Akiba Pass will translate a member's current Miles balance into progress toward
one real, currently available merchant voucher.

V1 automatically selects the **closest relevant reward** using data Akiba
already has. It does not ask the member to configure a goal before the feature
becomes useful.

The member sees:

```text
Next reward

10% off at Akiba Store
180 / 2,000 Miles                         9%
[██░░░░░░░░░░░░░░░░░░]

1,820 Miles to go

Ways to get closer
- Tell us where you shop                  +50 Miles
- Play today's skill games                Up to +120 Miles
- Shop with Akiba merchants               Miles vary by active offer
```

When the balance is sufficient, the same card becomes an immediate conversion
surface:

```text
Reward available

You have enough for 10% off at Akiba Store.
[Get voucher]
```

V1 does **not** persist a member-selected goal. The response and component
contracts must nevertheless preserve a clean seam for a later “Make this my
goal” release.

## 1. Product problem

The current balance is technically correct but does not answer the questions a
member actually has:

- What can I get with these Miles?
- How close am I to something useful?
- What can I do next to get there?
- Are my games, quests and shopping contributing to the same outcome?

A token balance without an attainable outcome is abstract. Next Reward makes
the balance concrete without moving Akiba back to a wallet-first home page.

The feature supports the core loop:

```text
Shop / play / complete a verified action
  -> earn Miles
  -> see visible progress
  -> unlock a merchant benefit
  -> redeem
  -> return
```

## 2. Goals and non-goals

### Goals

- Turn the current balance into progress toward one truthful merchant reward.
- Recommend a reward automatically using current availability, Miles cost,
  country context and verified merchant affinity.
- Show the exact Miles gap and a simple progress indicator.
- Show truthful actions that may help the member get closer.
- Distinguish exact rewards from variable or maximum possible earnings.
- Convert the card into a voucher-acquisition CTA when the goal is affordable.
- Keep merchant discovery above progress on home.
- Work for email-only members as well as members with a verified wallet.
- Fail quietly when balance, inventory or recommendation inputs are
  unavailable.

### Non-goals

- User-selected or pinned goals.
- Reserving voucher inventory for a member.
- Predicting how many days or shopping trips remain.
- Displaying “Shop KES X more” without a verified Platform earning preview.
- Converting a generic Miles balance into a fixed KES value.
- Claiming total money saved across all channels.
- Comparing percent-off, fixed-off and free-item vouchers through a fabricated
  universal value score.
- New streaks, badges, levels or daily check-in mechanics.
- Quest delivery, pending-state or failure-recovery UI outside `/quests`.
- A new top-level navigation destination.
- Machine-learning recommendations.

## 3. Product principles

1. **Outcome before token.** Lead with the benefit and merchant, not the Miles
   balance.
2. **Automatic before configurable.** V1 is useful without setup.
3. **Closest relevant reward.** Do not recommend an irrelevant voucher solely
   because it is cheap.
4. **Truth before motivation.** “Up to”, “after verification” and variable
   earnings are labelled explicitly.
5. **No silent promises.** A recommendation is not a reservation.
6. **One clear goal.** Show one primary reward and link to the existing voucher
   catalog for alternatives.
7. **Shopping remains primary.** The home placement follows merchant discovery;
   it does not replace search or merchant rails.
8. **Verified behavior beats proxy behavior.** Completed purchases may inform
   relevance; profile views and clicks do not become affinity in V1.
9. **No dead-end recommendations.** Do not suggest an action that depends on
   first acquiring or redeeming the target voucher.

## 4. Current data inventory

V1 may use only the following existing sources or small projections of them.

| Need | Current source | V1 use |
|---|---|---|
| Combined Miles balance | `getUserBalance()` | Progress numerator and affordability |
| Canonically available voucher IDs | `list_available_voucher_template_ids_hub` | Hard inventory/eligibility filter |
| Voucher cost and benefit | `spend_voucher_templates` | Target, gap and user-facing benefit |
| Published merchant | `partners` + `partner_settings.directory_status` | Hard merchant visibility filter |
| Merchant country context | `partners.country` and structured merchant locations | Relevance signal only unless explicit availability scope exists |
| Member country | `hub_user_profiles.country`, with existing legacy profile fallback | Relevance signal |
| Verified merchant affinity | completed `merchant_transactions` through `getPurchaseAffinity()` | Recommendation tie-breaker |
| Quest reward and state | `getHubQuestStatuses()` + local launch catalog | Exact “ways to earn” rows |
| Remaining game plays | games status BFF | Potential game-earn row |
| Game reward ceiling | current game rules, exposed through one shared server contract | “Up to” calculation only |
| Voucher acquisition | existing `GetVoucherButton` quote/confirm flow | Affordable-state CTA |

### 4.1 Data explicitly excluded from V1 ranking

- General analytics clicks and merchant profile views.
- Legacy profile `interests` such as games, quests, DeFi and raffles. These are
  not merchant-category preferences and must not be presented as such.
- Raw wallet balances or wallet presence as a relevance signal.
- Unverified wallet links.
- Ratings, social signals, inferred friendships or speculative popularity.
- Product prices that are not comparable to the target voucher.

### 4.2 Country limitations

Current merchant country/location data describes a merchant or branch. It does
not necessarily prove that a voucher is legally or operationally limited to
that country.

Therefore V1 uses country as a **ranking reason**, not a hard eligibility
filter, unless the voucher or merchant contract contains an explicit service
region. Copy may say “Available from a merchant in Kenya” when supported. It
must not say “Available only in Kenya” unless that restriction is explicit.

Online merchants with no explicit service-region restriction remain eligible,
but the card labels them “Online” rather than claiming a country match.

## 5. Information architecture

### 5.1 Signed-in home

Evolve the existing compact `RewardsSnapshot`. Keep it after merchant discovery
and limited-time offers.

The home card contains:

- eyebrow: `Next reward`, `Reward available`, or `Your rewards`;
- voucher benefit;
- merchant name and logo when available;
- current Miles / required Miles;
- progress bar and exact Miles remaining;
- one highest-priority way to earn;
- primary CTA;
- existing compact Pass and active-voucher access where space permits.

Home does not show a full list of earning actions. Its secondary CTA is
`See how to get there`, which links to the progress section on `/me`.

Recommended anchor:

```text
/me#next-reward
```

### 5.2 `/me`

Render the full Next Reward panel directly below the current balance card and
before Pass/wallet/security quick actions.

The panel contains:

- selected automatic recommendation;
- selection explanation;
- full progress state;
- up to three ways to get closer;
- `View all vouchers` secondary action;
- affordable-state `Get voucher` action.

Do not create `/me/progress` in V1. A dedicated route becomes justified only
when Akiba adds pinned goals, goal history, savings history or multiple active
reward journeys.

### 5.3 Voucher catalog

The existing `/vouchers` page remains the canonical place to compare and
acquire other vouchers. Links from the progress card may include the selected
template as a query or anchor only if the catalog can honor it accessibly.

## 6. Recommendation contract

### 6.1 Candidate eligibility

A voucher is a V1 candidate only when all of the following are true:

- returned by `list_available_voucher_template_ids_hub` for the current member;
- template is active;
- template is not expired;
- global and per-user availability rules pass through the canonical RPC;
- merchant is active, published and not hidden/test inventory;
- voucher has a positive finite `miles_cost`;
- merchant identity, name and slug are present;
- the voucher is not already owned in an active state where acquiring another
  would violate its cooldown or ownership rules.

Do not reproduce availability policy in TypeScript. The canonical RPC remains
the hard filter.

### 6.2 Recommendation pool

For each eligible candidate, derive:

```ts
type RewardCandidate = {
  templateId: string;
  merchantId: string;
  merchantSlug: string;
  merchantName: string;
  merchantLogoUrl: string | null;
  operatingModel: "physical" | "hybrid" | "online";
  countryCode: string | null;
  title: string;
  benefitLabel: string;
  milesCost: number;
  expiresAt: string | null;
  gapMiles: number;
  affordable: boolean;
  countryMatch: boolean;
  hasPurchaseAffinity: boolean;
};
```

`benefitLabel` must reuse the canonical voucher/deal label helper. Do not build
a second copy system for percent, fixed and free rewards.

### 6.3 Deterministic selection

Selection is deterministic and explainable:

1. Partition candidates into affordable and locked.
2. If at least one candidate is affordable, select from the affordable pool.
3. Otherwise select from the locked pool.
4. Build a relevant subset containing candidates that have at least one of:
   - an exact member-country match;
   - verified completed-purchase affinity;
   - online availability with no explicit incompatible region.
5. If the relevant subset is non-empty, rank within it. Otherwise rank all
   candidates as a truthful fallback.
6. Sort by:
   1. `gapMiles` ascending;
   2. `hasPurchaseAffinity` descending;
   3. `countryMatch` descending;
   4. `expiresAt` ascending, with `null` last;
   5. merchant name ascending;
   6. template ID ascending.

This makes the lowest remaining Miles gap the primary optimization while
allowing country and verified preference to break close/equal choices.

V1 does not compare the economic quality of unlike voucher types. A 10%
discount is not assumed to be worth more or less than a fixed discount without
purchase context.

### 6.4 Explanation label

Return exactly one primary explanation:

| Condition | Label |
|---|---|
| Affordable | `Available with your current balance` |
| Purchase affinity | `You have shopped here before` |
| Country match | `Available from a merchant in {country}` |
| Online candidate | `Available online` |
| Fallback | `Easiest available reward to unlock` |

Use `Recommended for you` only when country or completed-purchase affinity
changed the selected candidate. Otherwise use `Easiest reward to unlock`.

## 7. Progress calculation

Given integer `balance` and positive integer `milesCost`:

```ts
gapMiles = Math.max(milesCost - balance, 0);
progressPercent = Math.min(100, Math.max(0, Math.floor((balance / milesCost) * 100)));
affordable = gapMiles === 0;
```

Display the raw values as the primary accessible description:

```text
180 of 2,000 Miles. 1,820 Miles remaining. 9 percent complete.
```

The visual progress bar is supplementary and uses:

- `role="progressbar"`;
- `aria-valuemin="0"`;
- `aria-valuemax={milesCost}`;
- `aria-valuenow={Math.min(balance, milesCost)}`;
- a visible percentage only when it adds clarity.

When balance exceeds the target, show `100%` and `Reward available`; do not
show surplus Miles as progress beyond the target.

## 8. Ways to get closer

V1 shows at most three rows, ordered by confidence and immediacy.

### 8.1 Quest actions

Use the authenticated canonical quest status.

| Quest state | Progress treatment |
|---|---|
| `eligible` | `Claim {X} Miles` — exact amount |
| `needs_action` | `{Action} → {X} Miles after verification` |
| `reward_pending` / `verifying` | Omit |
| `completed` | Omit |
| `reward_failed` | Omit; recovery remains on `/quests` |
| `service_unavailable` | Omit |

The progress feature maps only `eligible` and `needs_action` quests into the
`waysToEarn` DTO. It does not extend that DTO with pending, failed or recovery
states.

Pending/verifying rewards are not included in progress until they are actually
credited to the balance. Failed rewards are operational/recovery states, not a
new way to earn. The canonical `/quests` experience remains responsible for
showing and recovering both conditions.

Exclude a quest when its required action depends on first acquiring or
redeeming the selected target. For example, do not recommend “Use your first
voucher” as the path to acquiring a member's first voucher goal.

### 8.2 Skill games

When games are enabled and the status service is available, show:

```text
Play today's skill games — up to +{potentialMiles} Miles
```

Where:

```ts
potentialMiles = sum(playsRemaining * maxRewardMilesPerPlay);
```

The game reward ceiling must come from one shared server-owned game rule or
status response. Do not add a third hard-coded `12` to the progress feature.

The UI must say `up to`. Game outcomes are not guaranteed and must never be
used to claim that the member will reach the target.

### 8.3 Shopping

Until Platform exposes a verified earn-preview contract, V1 may show only:

```text
Shop with Akiba merchants — Miles vary by active offer
```

The CTA opens `/merchants`.

V1 must not show:

- `Shop KES 2,000 more`;
- `One more purchase to go`;
- an estimated Miles award;
- a time-to-goal estimate.

These claims require exact merchant eligibility/rate data that Hub does not
currently possess.

### 8.4 Ordering

Order earning rows as follows:

1. already eligible/claimable exact quest reward;
2. uncompleted exact quest reward with a valid action;
3. available game potential;
4. generic merchant-shopping action.

Prefer actions whose exact reward is large enough to close the current gap,
but never imply that completion is automatic before verification.

## 9. UI states and copy

### 9.1 Locked reward

```text
Next reward

10% off at Akiba Store
180 / 2,000 Miles
1,820 Miles to go

Easiest available reward to unlock

[See how to get there] [View all vouchers]
```

### 9.2 Affordable reward

```text
Reward available

You have enough for 10% off at Akiba Store.

[Get voucher] [View other rewards]
```

Use the existing quote/confirm acquisition flow. Do not bypass balance,
availability, cooldown or ownership checks from the recommendation card.

### 9.3 No eligible reward

```text
Your rewards

You have {balance} Miles.
New merchant rewards will appear here when available.

[Explore merchants]
```

Do not render `0 Miles` if the balance lookup failed.

### 9.4 Balance unavailable

```text
Reward progress is temporarily unavailable.

[View vouchers]
```

Do not calculate a fake zero balance or a misleading gap.

### 9.5 Recommendation unavailable, balance available

Keep the balance and existing rewards quick actions. Omit the target and
progress bar.

### 9.6 Target becomes unavailable

V1 recommendations are computed from live inventory on each server render, so
the automatic target may change between visits. The UI does not claim that the
previous automatic recommendation was saved.

Pinned-goal behavior is deferred and will require explicit unavailable-goal
copy rather than a silent replacement.

## 10. Server contract and code map

### 10.1 Shared server module

Add:

```text
src/lib/akiba/nextReward.ts
```

Primary contract:

```ts
type NextRewardProgress = {
  selectionMode: "automatic";
  recommendationLabel:
    | "recommended_for_you"
    | "easiest_to_unlock"
    | "available_now";
  balance: number;
  target: {
    templateId: string;
    merchantId: string;
    merchantSlug: string;
    merchantName: string;
    merchantLogoUrl: string | null;
    title: string;
    benefitLabel: string;
    milesCost: number;
    expiresAt: string | null;
    explanation: string;
  } | null;
  progress: {
    gapMiles: number;
    percent: number;
    affordable: boolean;
  } | null;
  waysToEarn: Array<
    | {
        kind: "quest";
        key: string;
        label: string;
        miles: number;
        certainty: "exact_after_verification";
        href: string;
      }
    | {
        kind: "game";
        label: string;
        potentialMiles: number;
        certainty: "up_to";
        href: "/games";
      }
    | {
        kind: "shopping";
        label: string;
        certainty: "variable";
        href: "/merchants";
      }
  >;
};
```

The module accepts authenticated `hubUserId` and email, resolves all identity
and profile data server-side, and never accepts a browser-supplied balance,
country, wallet or candidate voucher ID.

### 10.2 Home feed

Extend the authenticated home response with `nextReward`. Signed-out responses
must return `nextReward: null`.

The Next Reward query must fail independently. A voucher or Platform outage
must not take down search, merchant rails or Pass access.

### 10.3 Components

Add or refactor:

```text
src/components/home/NextRewardCard.tsx
src/components/akiba/NextRewardPanel.tsx
src/components/akiba/RewardProgressBar.tsx
```

Reuse one presentational model across home and `/me`; home selects a compact
variant and `/me` selects a detailed variant.

### 10.4 No new public mutation endpoint

V1 has no goal-selection write, so it adds no goal mutation API or database
table. Voucher acquisition continues through the existing voucher quote and
confirm endpoints.

### 10.5 Rollout gate

Add a server-side cohort gate following the existing Hub quests/games rollout
shape:

```text
NEXT_REWARD_ENABLED
NEXT_REWARD_ROLLOUT_PERCENT
NEXT_REWARD_ALLOWLIST
```

The gate is evaluated from the authenticated member's email, falling back to
`hubUserId`, through a deterministic hash bucket. The allowlist bypasses the
percentage only when the global toggle is enabled.

When the member is outside the cohort:

- home renders the existing `RewardsSnapshot` unchanged;
- `/me` renders no Next Reward panel;
- no recommendation, quest or game-status reads are made for this feature;
- no disabled/coming-soon placeholder is shown.

This is a rollout and rollback mechanism, not a permanent user setting or an
A/B-test assignment service. Move the percentage to 100 after the rollout
gates pass, while retaining the global kill switch for safe rollback.

## 11. Analytics and success measures

The product-specific `track()` hook is currently a production no-op. Wiring a
production analytics destination is a launch dependency for evaluating this
feature.

Required events:

- `next_reward_view { surface, template_id, merchant_id, state,
  recommendation_label, progress_bucket }`
- `next_reward_primary_tap { surface, template_id, action }`
- `next_reward_earn_path_tap { surface, template_id, path_kind, quest_key? }`
- `next_reward_all_vouchers_tap { surface, template_id? }`
- `next_reward_unavailable { reason }`
- `next_reward_voucher_acquired { template_id, merchant_id, source_surface }`

Do not include balance, exact gap, country, email, wallet or raw coordinates in
general analytics. `progress_bucket` is one of:

```text
0_24 | 25_49 | 50_74 | 75_99 | affordable
```

Primary metric:

> Percentage of members who view Next Reward and acquire or redeem the
> recommended voucher within 30 days.

Supporting metrics:

- progress-card click-through rate;
- ways-to-earn action rate;
- recommended-voucher acquisition rate;
- affordable-state conversion rate;
- first earn-to-first voucher acquisition time;
- percentage of signed-in members with at least one eligible target;
- distribution of recommended merchants and templates;
- target changes caused by inventory churn.

Guardrails:

- no reduction in home merchant-search or merchant-card engagement;
- no unsupported Miles, savings or time-to-goal claims;
- no material increase in home server latency or error rate;
- no recommendation of unavailable/expired inventory;
- no winner-take-all recommendation pattern caused solely by one cheap voucher.

## 12. Savings and value history

V1 does not show “You have saved KES X.”

Akiba currently has enough data to know the face benefit of some vouchers and
the applied discount on some Hub online orders. It does not have one canonical,
complete actual-savings record across online checkout and in-store redemption.

Before adding total savings, introduce or confirm a canonical event containing:

```text
voucher_id
hub_user_id / canonical participant
merchant_id
redemption channel
currency
actual gross amount
actual discount amount
redeemed_at
```

Until then, V1 may show `10% off`, `$5 off` or `Free item` as the voucher's
defined benefit. It must not turn those definitions into an accumulated money-
saved total.

## 13. Privacy, security and integrity

- Resolve every personal signal server-side from the authenticated Hub user.
- Use verified wallets only where wallet aliases are required.
- Reuse canonical voucher availability and acquisition checks.
- Do not reveal another member's availability, balance, country or affinity
  through shared cache.
- Authenticated progress responses are `private, no-store`.
- Do not log email, wallet, balance, exact gap or country.
- Do not infer sensitive preferences from merchant categories.
- Recommendation is advisory. The voucher quote endpoint remains authoritative
  at acquisition time.
- Never say inventory is reserved.

## 14. Delivery plan

### Slice 0 — measurement and shared rules

- Connect the product analytics hook to a production destination.
- Add the global toggle, allowlist and deterministic percentage rollout gate.
- Centralize the skill-game maximum reward in a shared server-owned rule or
  return it from the game status BFF.
- Confirm merchant country/location completeness for published voucher
  merchants.
- Confirm that the voucher availability RPC is safe and performant for home
  use.

### Slice 1 — recommendation service

- Add `nextReward.ts` and its types.
- Load canonical availability, balance, country and purchase affinity.
- Implement deterministic candidate mapping and selection.
- Implement partial-failure behavior.
- Unit test every ranking and fallback rule.

### Slice 2 — `/me` detailed panel

- Add the full panel below Balance.
- Add exact progress math and accessible progress bar.
- Add up to three truthful earning paths.
- Reuse the existing voucher acquisition flow.

### Slice 3 — compact home card

- Evolve `RewardsSnapshot` to include the compact recommendation.
- Keep it after merchant discovery.
- Preserve Pass and active-voucher access.
- Add analytics and performance checks.

### Slice 4 — controlled rollout

- Enable the global toggle with a staff/internal allowlist and 0% cohort.
- Confirm recommendation truth, latency and analytics for allowlisted members.
- Roll out to 10% of signed-in members.
- Increase to 50% after inventory and error guardrails hold.
- Increase to 100% only when every active market has a useful fallback state.
- Roll back immediately through `NEXT_REWARD_ENABLED=false` if required.

## 15. Test plan

### Selection

- affordable candidate wins over locked candidates;
- lowest gap wins within the relevant candidate pool;
- purchase affinity breaks equal-gap ties;
- country match breaks remaining equal-gap ties;
- online candidate remains eligible without a false country claim;
- unavailable, expired, hidden and unpublished inventory is excluded;
- deterministic tie-breakers return the same target on repeat requests;
- another member's availability never enters the candidate pool.

### Progress

- zero balance;
- partial progress;
- exact target balance;
- balance above target;
- large values and formatting;
- invalid/zero Miles cost is excluded;
- failed balance read never renders as zero.

### Ways to earn

- eligible quest is shown as exact/claimable;
- needs-action quest says after verification;
- pending, verifying, completed, failed and unavailable quests are omitted;
- circular voucher quest is excluded;
- game potential uses remaining plays and shared maximum;
- games are omitted when rollout or service is unavailable;
- shopping action never contains a KES or Miles projection.

### UI and accessibility

- compact and detailed variants;
- progressbar semantics;
- 320 px mobile layout;
- long merchant and voucher names;
- no eligible reward state;
- recommendation outage with balance still available;
- voucher becomes unavailable between render and acquisition;
- keyboard and screen-reader operation;
- reduced motion;
- home search and merchant discovery remain before the card.

## 16. Acceptance criteria

- A signed-in member with an eligible voucher sees one real merchant benefit,
  current balance, required Miles and exact remaining gap.
- A member who can afford the target can enter the existing voucher acquisition
  flow directly.
- The selected voucher passes canonical availability rules at render time and
  is revalidated at acquisition time.
- Country and completed-purchase affinity influence selection only when backed
  by current data.
- Recommendation copy explains why the target was chosen without exposing a
  raw score.
- Every earning path is labelled exact-after-verification, up-to or variable.
- No shopping amount, time-to-goal or total-savings claim is fabricated.
- Signed-out users receive no personal recommendation.
- A progress-service failure does not break home, merchant discovery, Pass or
  `/me` balance access.
- Product analytics can measure view-to-acquisition behavior in production.
- A member outside the rollout cohort receives the existing home and `/me`
  experience and causes no Next Reward upstream reads.

## 17. Deferred goal-selection seam

A later release may add:

```text
Make this my goal
Choose another goal
Change goal
```

That release will require an authenticated, server-owned record such as:

```text
hub_user_reward_goals
  hub_user_id
  voucher_template_id
  status: active | achieved | abandoned | unavailable
  selected_at
  ended_at
```

Pinned-goal rules must include:

- one active goal per member;
- no implied inventory reservation;
- no silent replacement when the goal becomes unavailable;
- explicit alternative suggestions;
- completion when the voucher is acquired, not merely when balance reaches the
  threshold;
- member-selected goal outranks automatic recommendation until it ends.

V1's `selectionMode: "automatic"` and target DTO deliberately allow this future
state without redesigning the card.

## 18. Definition of done

Next Reward V1 is complete when a signed-in member can understand, in one
glance:

1. what real merchant reward their Miles are moving toward;
2. how far away it is;
3. why Akiba selected it;
4. which currently supported actions may help them progress; and
5. how to acquire it immediately once affordable.

The experience should feel motivating because it is specific and attainable,
not because Akiba exaggerates certainty or adds decorative gamification.
