# Skill Games Mastery Economy and Direct-Commerce Cleanup v1

**Primary product:** Akiba Pass (`pass.akibamiles.com`)

**Packages:** `packages/hub-page`, `packages/skill-games`, `packages/backend`,
`packages/react-app`, `packages/admin-dashboard`, `packages/merchant-dashboard`,
`packages/hardhat`, `supabase/migrations`

**Status:** Ready for review

**Product direction:** Shopping at participating merchants is the primary way
to earn Miles. Games build habit and reward mastery. Akiba no longer operates a
direct product-shopping, payment, order or fulfilment journey.

---

## 0. Decision

This specification makes two connected changes.

1. Skill games stop paying Miles for every qualifying round. Each game awards
   only the incremental value of the member's best tier that Nairobi day:
   Moderate `1`, Strong `2`, Elite `3` Miles. Five attempts remain available
   for mastery and leaderboard competition.
2. Akiba retires direct commerce. Members discover merchants, earn Miles from
   verified in-store activity, acquire merchant vouchers, and redeem those
   vouchers with merchants. Akiba does not sell merchant products, take product
   payments, create orders, arrange delivery, or provide order tracking.

The product hierarchy is:

1. **Shopping at merchants** — consistent Miles earning.
2. **Games** — a small daily mastery bonus and habit loop.
3. **Leaderboards and campaigns** — valuable merchant-sponsored rewards.
4. **Referrals and promotions** — occasional, controlled boosts.

The internal economy rule is:

> A highly engaged non-shopper must not out-earn an average active shopper from
> ordinary, Akiba-funded rewards. Games reward mastery and habit; shopping at
> merchants remains the primary source of Miles.

For the v1 benchmark, KES 10,000 of eligible merchant spend earns 100 Miles.
Ordinary game earnings are therefore capped at 60 Miles per member per calendar
month.

---

## 1. Terminology

The word “shopping” is ambiguous and must not drive deletions by itself.

| Term | Meaning | v1 decision |
|---|---|---|
| Shop at a merchant | The member pays a merchant using the merchant's normal till or checkout | Core behavior; preserve |
| Verified merchant earning | An eligible merchant records or verifies the purchase and Miles are credited | Core behavior; preserve |
| Merchant discovery | Merchant profiles, branches, hours, directions, contacts and core offerings | Core behavior; preserve |
| Voucher acquisition | A member spends Miles to obtain a merchant voucher | Core behavior; preserve |
| Voucher redemption | A merchant/staff flow validates and redeems a voucher | Core behavior; preserve |
| Direct commerce | Akiba displays purchasable SKUs, takes payment, creates an order or manages fulfilment | Retire |
| Core offering | A non-purchasable description such as “burgers”, “coffee” or “wheel alignment” | Preserve |
| Reward item | A merchant benefit that a voucher may grant, such as “one regular coffee” | Preserve, but separate from products |

This specification does **not** remove language such as “Shop KES 2,000 more”
from Next Reward progress. That copy describes eligible spending at a merchant,
not purchasing goods through Akiba.

---

## 2. Skill-game economy

### 2.1 Scoring stays unchanged

The games remain skill-based and retain their current scoring thresholds.

| Game | Moderate | Strong | Elite |
|---|---:|---:|---:|
| Rule Tap | score `10+` | score `14+` | score `18+` |
| Memory Flip | score `200+` | score `500+` | score `750+` |

Scores below Moderate earn zero Miles but may still be accepted and ranked.
Anti-abuse validation, duration, replay validation and leaderboard ordering are
unchanged unless explicitly changed below.

### 2.2 Daily mastery entitlement

Each game has one mastery entitlement per member per Nairobi calendar day.

| Best tier achieved that day | Total Miles entitled for that game/day |
|---|---:|
| None | 0 |
| Moderate | 1 |
| Strong | 2 |
| Elite | 3 |

Only the positive difference from the member's previous best tier is credited.

Examples:

- Moderate on attempt 1: `+1`; four later Moderate scores: `+0`.
- Moderate, then Strong, then Elite: `+1`, `+1`, `+1`.
- Elite on attempt 1: `+3`; later rounds: `+0`.
- Strong, then Moderate, then Elite: `+2`, `+0`, `+1`.
- A rejected result never changes mastery or produces a reward.

Every accepted attempt may improve the member's score and leaderboard standing
even when it credits no Miles.

### 2.3 Play and value caps

- Five starts per game per Nairobi day.
- Maximum base entitlement per game/day: 3 Miles.
- Maximum base entitlement across the two current games/day: 6 Miles.
- Maximum ordinary skill-game earnings per member/Nairobi calendar month:
  **60 Miles**.
- The monthly cap applies across every Akiba host, wallet and linked identity.
- Miles from leaderboard vouchers do not count toward the game Miles cap
  because they are not Miles.
- A campaign bonus is governed by section 4 and cannot silently bypass the
  ordinary cap.

At the cap, games remain playable and scores remain rankable. The UI says that
the member has reached the month's game-Miles limit; it must not imply that the
round failed or that leaderboard progress stopped.

### 2.4 Free entry

The v1 mastery games are free to enter. A member must never pay a 5-Mile ticket
for a round whose maximum base entitlement is 3 Miles.

For the MiniPay/on-chain adapter:

1. Stop new ticket purchases before the economy cutover.
2. Snapshot outstanding paid tickets and the transaction that funded each.
3. Refund the recorded historical price, currently 5 Miles per valid remaining
   ticket, with idempotency key `skill-game-ticket-refund:<owner>:<snapshot>`.
   These refunds do not count as game earnings.
4. Set the supported on-chain game entry cost to zero before accepting a v1
   round.
5. If free entry and server-side incremental settlement cannot be made safe on
   the current contract path, disable new MiniPay starts and hand off to Akiba
   Pass. Do not run the legacy `5 in / 6-9-12 out` economy beside v1.

Sessions started before the cutover may settle under the terms presented when
they started, but only inside their existing settlement window. New and legacy
economies must never be selectable by the client.

### 2.5 Identity and time

- Day and month boundaries use `Africa/Nairobi` in v1.
- The reward owner is the resolved canonical Akiba member.
- An unlinked wallet temporarily uses a stable wallet-owner key.
- When identities link or merge, game mastery and monthly-cap ownership move to
  the surviving canonical member in the same locked operation.
- If the merged identities already received more than the cap, do not claw back
  past Miles; block additional ordinary game rewards until the next month and
  record a risk/audit event.

Country personalization may later select a local economy/time policy, but v1
does not infer a cap or reward rate from mutable client country settings.

---

## 3. Authoritative reward computation

### 3.1 Separate gameplay from economy policy

`@akiba/skill-games` currently stores `miles` inside gameplay thresholds even
though its own boundary says host economy policy should be separate. Replace
that coupling with:

```ts
type MasteryTier = "none" | "moderate" | "strong" | "elite";

type ScoreBand = {
  tier: Exclude<MasteryTier, "none">;
  label: string;
  minScore: number;
};

type MasteryEconomyV1 = {
  version: "mastery-v1";
  milesByTier: { moderate: 1; strong: 2; elite: 3 };
  attemptsPerGamePerDay: 5;
  monthlyBaseMilesCap: 60;
  timezone: "Africa/Nairobi";
};
```

The shared package owns deterministic scoring and score-to-tier mapping. The
backend owns reward policy, campaign policy, caps and delivery. Clients render
the server's policy/status response and never calculate payable Miles.

Remove the duplicated backend `GAME_CONFIGS` reward thresholds after the
shared score bands have become the only scoring source.

### 3.2 Persistence

Add an economy version to every new session and introduce an authoritative
daily mastery record. Names may follow the canonical migration naming
conventions, but the data contract is:

```sql
skill_game_mastery_days (
  owner_key              text not null,
  game_type              text not null,
  local_date             date not null,
  economy_version        text not null,
  attempts_started       integer not null default 0,
  best_score             integer,
  best_tier              text not null default 'none',
  base_miles_entitled    integer not null default 0,
  base_miles_credited    integer not null default 0,
  updated_at             timestamptz not null,
  primary key (owner_key, game_type, local_date, economy_version)
);

skill_game_monthly_caps (
  owner_key              text not null,
  local_month            date not null,
  economy_version        text not null,
  base_miles_credited    integer not null default 0,
  updated_at             timestamptz not null,
  primary key (owner_key, local_month, economy_version)
);
```

Persist on the session/delivery record:

- `economy_version`;
- `tier_achieved`;
- `previous_best_tier`;
- `base_miles_delta`;
- `campaign_bonus_delta`;
- `cap_limited_miles`;
- `reward_reason` (`new_tier`, `tier_maintained`, `below_threshold`,
  `monthly_cap`, `rejected`);
- applicable campaign ID/version.

Do not rewrite historical session rewards. Historical `6/9/12` rows remain an
accurate record of the policy active at the time.

### 3.3 Atomic finalization

The server-authoritative finish operation must perform the following in one
transaction:

1. Lock the session and reject a second, conflicting finalization.
2. Resolve the reward owner and Nairobi day/month.
3. Validate the server-computed score and accepted state.
4. Lock/create the day's mastery row and month's cap row.
5. Map score to tier.
6. Update the best score independently of reward eligibility.
7. Compute `desired entitlement - already credited entitlement`.
8. Limit the delta by the remaining monthly allowance.
9. Reserve exactly one delivery for a positive delta.
10. Apply any separately budgeted campaign bonus.
11. Return the persisted result and current progress.

The browser must not submit `rewardMiles`, previous tier, monthly total,
country, timezone or campaign multiplier as authority.

The current `finalize_hub_skill_game_session` contract accepts a reward amount
from the service. V1 must move the entitlement and cap calculation into the
locked authoritative boundary, or prove an equivalent locked backend
transaction. A read-then-credit sequence is not acceptable: two simultaneous
Moderate finishes must produce only one Mile in total.

Existing `skill_game_reward_deliveries` and the mint queue remain the durable
delivery mechanism. Zero-delta rounds do not create a mint/ledger delivery.

### 3.4 API response

Game status must include:

```json
{
  "economyVersion": "mastery-v1",
  "dailyCap": 5,
  "playsToday": 2,
  "playsRemaining": 3,
  "bestTierToday": "strong",
  "bestScoreToday": 15,
  "gameMilesToday": 2,
  "gameMilesAvailableToday": 1,
  "gameMilesThisMonth": 24,
  "monthlyGameMilesCap": 60,
  "monthlyGameMilesRemaining": 36,
  "activeEvent": null
}
```

Finish must distinguish the round result from the reward delta:

```json
{
  "score": 18,
  "accepted": true,
  "tierAchieved": "elite",
  "previousBestTier": "strong",
  "milesCreditedThisRound": 1,
  "gameMilesToday": 3,
  "gameMilesThisMonth": 25,
  "rewardReason": "new_tier",
  "leaderboardEligible": true
}
```

---

## 4. Events and leaderboards

### 4.1 Default leaderboard policy

Leaderboards rank accepted scores; they do not create an additional recurring
Miles faucet. The default leaderboard has no Miles prize.

Preferred rewards are merchant-funded and bring the member back to the
merchant network, for example:

- first: free burger;
- second: 20% voucher;
- third: free coffee;
- top ten: merchant-sponsored vouchers.

Use the existing dormant sponsored leaderboard distribution facility. A
campaign must be active, funded, inventory-backed and country-eligible before
the UI mentions a prize. Standings, eligibility and delivery remain separate.

### 4.2 Promotional events

Supported examples include Double Miles Weekend, New Merchant Challenge and a
holiday event. An event may display `2/4/6` only when its complete budget policy
is active.

Each event requires:

- immutable campaign ID and version;
- start/end instants and display timezone;
- eligible games, countries and members;
- multiplier or explicit tier values;
- per-member campaign bonus cap;
- global Miles budget or reserved voucher inventory;
- funding owner (`akiba` or `merchant`);
- kill switch;
- terms/copy and analytics attribution.

For a “double” event, persist reward components separately:

```text
displayed reward = ordinary base component + campaign bonus component
```

The ordinary component remains subject to the 60-Mile monthly cap. The bonus
component is paid only from the event's explicit per-user/global budget. If the
campaign does not explicitly allow a bonus after the ordinary monthly cap, the
UI must not advertise a doubled payout to a capped member.

Budget reservation and reward finalization must be atomic. Exhausted campaigns
fall back to the ordinary mastery entitlement and immediately stop rendering
bonus copy.

---

## 5. Game UX

### 5.1 Intro

Each game explains:

- “5 attempts today”;
- “Your best tier sets today's reward”;
- Moderate `1`, Strong `2`, Elite `3`;
- “Improve your score to earn the difference”;
- current monthly game Miles progress;
- leaderboard and active sponsored prize, if any.

Do not say “win up to 3 Miles per round.” Say “earn up to 3 Miles from your
best [game] tier today.”

### 5.2 Results

Examples:

- **New best · Moderate — +1 Mile**
- **Tier improved · Strong — +1 Mile · 2/3 earned today**
- **Elite mastered — +3 Miles**
- **Elite maintained · No extra Miles · Score submitted to leaderboard**
- **Monthly game Miles complete · Your score still counts**
- **Below Moderate · Try again · 3 attempts left**

The primary “Play again” motivation after earning the day's 3 Miles is score,
rank, streak or sponsored-prize progress—not a suggestion that another round
will mint Miles.

### 5.3 Notifications

Do not send a push notification for every game tier improvement; the result
screen is already immediate and repeated pushes would be noisy. Game earnings
appear in activity and the result state.

Preserve earned-Miles notifications for committed merchant-scan earnings.
Order, delivery and refund notifications remain available only during the
direct-commerce wind-down and are removed after the last supported order is
terminal.

---

## 6. Direct-commerce target experience

### 6.1 What Akiba Pass keeps

- `/merchants` directory and `/merchants/[slug]` profiles.
- Categories, branches, hours, maps/directions and public contact actions.
- Human-readable core offerings without Akiba price, stock or delivery claims.
- “Earn here” rate/eligibility when authoritative merchant configuration is
  available.
- Available merchant vouchers and the member's vouchers.
- Miles-to-voucher acquisition.
- Voucher presentation and merchant/staff redemption.
- Pass QR display and merchant scan earning.
- Committed-earning notifications and Miles activity.
- Next Reward progress based on eligible vouchers and verified merchant
  earning—not Akiba orders.
- Merchant-sponsored game campaigns and leaderboard vouchers.

### 6.2 What Akiba removes

- Product catalogs as purchasable Akiba inventory.
- Product price, stock, quantity and cart controls.
- Akiba checkout.
- Direct stablecoin or M-Pesa product payment initiation.
- Shipping addresses, delivery cities/fees and delivery ETA.
- Order creation, tracking, receipt confirmation and customer disputes for new
  orders.
- Digital-product fulfilment.
- Pending order-based Miles and order-completion reward release.
- Merchant order/product-management surfaces.
- Product-order revenue, invoice and payout views that have no remaining
  voucher-settlement purpose.

The intended merchant CTA is “Visit”, “Directions”, “Call”, “WhatsApp”, “View
voucher” or “Use voucher”—not “Add to cart” or “Buy in Akiba”. An optional link
to a merchant-owned website may remain clearly labelled “Visit website”; Akiba
does not represent or track that external purchase as an Akiba order.

### 6.3 Reward items replace storefront products

Vouchers such as “Free Burger” still need a precise benefit without retaining
a storefront SKU. Introduce a non-purchasable merchant reward-item model or an
equivalent voucher-benefit structure:

```text
merchant_reward_items:
  id, partner_id, name, description, image_url, terms, active
```

It intentionally has no checkout price, stock count, shipping, payment wallet,
product type or fulfilment adapter. Migrate voucher references from
`linked_product_id` to `reward_item_id`; keep the old field read-only until all
active/historical vouchers are safe. A voucher's immutable issuance snapshot
continues to describe exactly what the member is owed even if the reward item
later changes.

Do not delete `merchant_products` until active voucher references and historical
orders have been migrated or archived.

---

## 7. Surface cleanup

### 7.1 Akiba Pass (`packages/hub-page`)

| Current surface | v1 action |
|---|---|
| `/merchants` | Preserve; discovery-first |
| `/merchants/[slug]` | Remove `ProductGrid`/Shop Online; retain offerings, branches and vouchers |
| `/shop` | Permanent redirect to `/merchants` |
| `/shop/[slug]` | Permanent redirect to `/merchants/[slug]`, preserving useful query params |
| `CartProvider`, `CartButton`, `CartDrawer`, `AddToCart`, cart library | Remove after new checkout is disabled |
| `/me/orders` | Read-only wind-down for existing orders, then redirect to `/me/activity` |
| order quick actions/recovery banner | Remove after reconciliation gate passes |
| `/api/shop/orders*` | Disable writes, reconcile, then remove |
| `/api/payments/mpesa/initiate` | Disable immediately at commerce cutover |
| M-Pesa callback/status | Keep only for pending-payment wind-down, then remove |
| `/api/shop/merchants*` | Remove after clients use `/api/merchants*` |
| `/api/shop/vouchers*` | Preserve behavior under canonical `/api/vouchers*`; temporary aliases only |
| order/refund push templates | Remove after final historical order reaches a terminal state |

Update site metadata and copy from “Shop from merchants” to “Earn at
merchants, play and unlock rewards.” Remove the obsolete in-app Leshan
storefront campaign or convert it into a merchant profile/voucher campaign.

### 7.2 MiniPay mini-app (`packages/react-app`)

| Current surface | v1 action |
|---|---|
| `/spend` / Deals | Keep only as voucher/reward discovery or hand off to Pass; no products/orders |
| `/vouchers` | Preserve voucher wallet; replace order checkout with in-store use/presentation |
| `VoucherOrderSheet` | Remove; it must not create a product order |
| `OrderTrackingSheet` | Read-only wind-down, then remove |
| `/api/Spend/orders*` | Disable writes, reconcile, then remove |
| `/api/Spend/deals` and voucher issue/read endpoints | Preserve, preferably rename away from `Spend` casing in a compatibility release |
| `/api/Spend/merchants*` | Remove or replace with Pass merchant links/read-only discovery |
| `/merchant` embedded merchant/order administration | Remove from the consumer mini-app |
| order pricing, cancellation and Miles-release helpers/tests | Archive/delete after wind-down |

The MiniPay “Deals” tab may remain a lightweight acquisition surface, but its
primary calls to action are “Get voucher”, “View in Pass” and “Use at merchant”.

### 7.3 Merchant and admin surfaces

The current merchant dashboard is not retained as a general commerce product.

- Remove orders, product inventory, delivery, billing and direct-order finance
  features after wind-down.
- Move merchant directory/profile administration and campaign/voucher program
  administration into Admin where appropriate.
- Preserve the merchant/staff voucher scan contract until a smaller supported
  cashier surface or Platform service owns it.
- Do not archive `packages/merchant-dashboard` until Pass resolution,
  merchant-scan earning, voucher inspect/redeem and settlement paths have
  replacement owners and end-to-end tests.
- Merchant settlement reporting that remains necessary for voucher redemption
  is not “direct shopping” and must not be deleted with order revenue reports.

### 7.4 Documentation

This document supersedes direct-commerce decisions in:

- `merchant-directory-in-store-discovery-spec.md` where it describes an
  optional Akiba storefront;
- `order-lifecycle-completion-spec.md` except as a wind-down/reconciliation
  contract for historical orders;
- `paid-order-recovery-spec.md` except for already-confirmed payments;
- `packages/react-app/docs/voucher-merchant-checkout-spec.md`;
- direct-order portions of `packages/react-app/docs/spend-earn-redesign-spec.md`.

Add a superseded notice to those documents during implementation; do not delete
historical design records.

---

## 8. Data and event cleanup

### 8.1 Do not drop `merchant_transactions` before extracting its dependencies

`merchant_transactions` is the legacy/direct-order record. In-store voucher
scans already have the better boundary:
`voucher_redemptions.redemption_channel = 'merchant_scan'`. Verified shopping
Miles arrive from the Platform earning/ledger path and its committed-credit
event. Those paths must remain independent of direct orders.

The order table is nevertheless referenced by refunds, fulfilment, reward
jobs, referrals, settlement views and the current merchant-affinity query.
Therefore:

1. Stop all new `merchant_transactions` order writes at cutover.
2. Resolve every table/job that still references an existing order.
3. Move new shopping qualification, affinity and referral evidence to verified
   merchant earning or voucher-redemption sources.
4. Remove online-order joins from voucher settlement after every historical
   `redemption_channel = 'online_order'` liability is terminal.
5. Restrict the order graph to service/admin read access and archive it as one
   unit before considering table drops.

Do not repurpose `merchant_transactions` as the new in-store purchase table.
If a local normalized purchase record is later required, define it around the
Platform's verified merchant event identity and idempotency contract rather
than inheriting checkout, delivery and fulfilment columns.

### 8.2 Source-of-truth changes

- Shopping Miles come from verified merchant-scan/Platform earning events, not
  Akiba order completion.
- “Shop KES X more” uses eligible verified gross merchant spend.
- Merchant preference/affinity may use verified visits, earns and voucher
  redemptions. It must not depend on an online product catalog.
- `purchase_completed` events produced solely by Akiba orders stop at cutover.
- Merchant scan and voucher redemption events continue under their existing
  idempotency and canonical-identity rules.
- Existing order-linked referrals/rewards remain auditable but cannot create a
  new reward after their wind-down deadline unless already contractually due.

### 8.3 Historical data

Do not destructively delete financial or settlement history in this release.

- Resolve all confirmed payments, refunds, disputes and unsettled voucher
  compensations.
- Export a reconciliation manifest and row counts before runtime code removal.
- Restrict archived direct-order tables to service/admin access.
- Remove public/client write grants and scheduled order jobs.
- Drop data only in a separately approved retention migration.

---

## 9. Wind-down sequence

Direct commerce is removed in gates, not with a single route deletion.

### Gate 0 — inventory

Produce counts and identifiers for:

- pending M-Pesa requests/results;
- submitted crypto payments without terminal orders;
- non-terminal orders;
- open disputes/refunds/fulfilment jobs;
- pending order Miles jobs;
- reserved/redeemed vouchers attached to non-terminal orders;
- outstanding paid game tickets and pre-cutover game sessions.

The manifest is private operational evidence and must not be committed with
personal/payment data.

### Gate 1 — stop new liability

- Hide/remove cart, checkout and direct-buy calls to action.
- Disable M-Pesa initiation and all direct-order creation endpoints.
- Stop paid game-ticket sales and new legacy-economy game sessions.
- Keep callbacks, reconciliation workers and read-only history running.
- Return a stable `410 direct-commerce-retired` error from obsolete write APIs
  after internal callers have been migrated.

### Gate 2 — reconcile

- Settle, fulfil, refund or manually resolve every existing paid order.
- Release or void each pending order reward exactly once.
- Restore or compensate every reserved voucher exactly once.
- Refund outstanding paid skill-game tickets.
- Allow valid pre-cutover game sessions to settle or expire.

### Gate 3 — switch product surfaces

- Merchant pages become discovery/voucher-only.
- Voucher actions explain in-store use and presentation.
- Old shop URLs redirect to merchants.
- Old order history becomes read-only and then leaves navigation.
- Mastery economy launches globally at a Nairobi boundary after legacy starts
  are closed.

### Gate 4 — remove runtime code

- Delete carts, checkout, order creation, direct-payment initiation,
  fulfilment and order notification code.
- Delete obsolete direct-order tests and replace them with retirement/redirect
  contract tests.
- Remove unused environment variables, cron jobs and provider secrets only
  after callbacks/reconciliation no longer need them.
- Archive the merchant dashboard only after scanner/redeemer ownership moves.

### Gate 5 — later schema retirement

After an explicit retention review, archive or drop direct-commerce-only
columns/tables and rename overloaded transaction concepts. This is not required
to ship the user-facing cleanup.

---

## 10. Rollout and failure policy

### 10.1 Game economy

Use a server-controlled economy version and reward kill switch. Run the new
calculation in shadow mode against recent sessions before cutover and compare:

- legacy emissions versus mastery-v1 emissions;
- projected daily/monthly caps;
- tier distribution;
- duplicated owners/identity merges;
- delivery failure rate.

Do not run a prolonged A/B test in which players on the same leaderboard have
different reward economies. Cut over globally at a published Nairobi boundary.

If reward finalization is unhealthy, disable new Miles delivery while allowing
safe play/leaderboard recording. Never automatically fall back to `6/9/12`.

### 10.2 Direct commerce

The commerce kill switch prevents new liabilities. Callback and reconciliation
routes use separate controls so disabling checkout cannot strand confirmed
payments. Removal is complete only when Gate 2 reports zero unresolved
liabilities.

---

## 11. Analytics and economy monitoring

Game events:

- `skill_game_started` — game, attempt number, economy version, event ID;
- `skill_game_finished` — accepted, score, tier, previous tier;
- `skill_game_mastery_improved` — from tier, to tier, base delta, bonus delta;
- `skill_game_no_reward` — maintained, below threshold, monthly cap, rejected;
- `skill_game_monthly_cap_reached`;
- `skill_game_leaderboard_viewed`;
- `skill_game_prize_delivered` — campaign and reward type.

Do not send canonical IDs, wallet addresses or emails to product analytics.

Required dashboards:

- daily/monthly base Miles emitted by game and tier;
- game Miles as a percentage of verified shopping Miles;
- members approaching/reaching the 60-Mile cap;
- attempts per member and mastery progression;
- event budget reserved/paid/remaining;
- settlement/delivery failures and duplicate prevention;
- merchant voucher prize issuance and redemption;
- direct-commerce wind-down liabilities until zero.

Primary economy guardrail:

```text
p95 ordinary monthly game Miles < average active-shopper monthly Miles
```

Also report median and cohort distributions; the 60-Mile hard cap is not a
substitute for checking whether actual shopping earnings remain healthy.

---

## 12. Acceptance criteria

### Game economy

- Shared scoring maps to tiers without containing payable Miles.
- Moderate → Strong → Elite in one game/day credits exactly `1 + 1 + 1`.
- Repeated Elite rounds credit zero additional Miles and still rank.
- Five attempts are available per game/day.
- Both current games can credit at most 6 base Miles/day combined.
- One member can receive at most 60 ordinary game Miles per Nairobi month
  across linked identities and hosts.
- Concurrent finishes cannot double-credit a tier.
- Retries return the persisted delta and never enqueue a second delivery.
- Free entry is active before mastery-v1 rewards; no 5-Mile paid v1 round exists.
- Existing paid tickets and valid legacy sessions have an auditable outcome.
- Events cannot overspend per-user or global budgets.
- Leaderboards pay no default Miles and support inventory-backed merchant
  vouchers when a campaign is active.

### Direct-commerce cleanup

- No user-facing Akiba surface offers a cart, product checkout, delivery or new
  order creation.
- No direct-order/payment write endpoint accepts a new liability.
- `/shop*` resolves to merchant discovery, not a storefront.
- Merchant pages retain branches, contacts, core offerings and vouchers without
  purchasable product controls.
- Voucher acquisition, presentation and merchant redemption still work end to
  end.
- Pass scans still produce committed shopping Miles and the earned
  notification.
- Next Reward shopping progress uses verified merchant activity.
- Merchant-sponsored leaderboard vouchers can reference reward items without a
  storefront product.
- Historical confirmed payments/orders/refunds are reconciled and auditable.
- Merchant-scan earning and `voucher_redemptions` remain functional and do not
  depend on new `merchant_transactions` writes.
- Scanner/redemption ownership is moved before the old merchant dashboard is
  archived.

---

## 13. Required tests

### Game economy

- every score boundary and below-threshold boundary;
- each progression order, including regressions and Elite-first;
- two concurrent Moderate/Strong/Elite finishes;
- finish retry/idempotency and delivery retry;
- day/month boundary at `Africa/Nairobi`;
- monthly remaining allowance smaller than the tier delta;
- canonical merge and wallet-link duplication;
- legacy session cutoff and paid-ticket refund idempotency;
- campaign activation, exhaustion, expiry and kill switch;
- zero-Miles accepted rounds remain leaderboard eligible.

### Direct-commerce retirement

- old shop page redirects preserve merchant slug/query parameters;
- direct-order and M-Pesa-initiation APIs return the retirement contract;
- pending callback/reconciliation paths remain available during wind-down;
- merchant profile DTO contains no checkout price/stock/delivery fields;
- voucher issue/presentation/status/redeem paths survive namespace migration;
- merchant scan earning and earned notification end to end;
- direct-order/legacy rows cannot satisfy new verified-shopping requirements;
- no cart/order modules remain imported after Gate 4;
- environment and cron validation contains no retired direct-commerce runtime
  dependencies after reconciliation closes.

---

## 14. Delivery slices

1. **Economy foundation:** score bands, economy version, mastery/cap schema,
   shadow calculator and tests.
2. **Economy cutover:** free entry, ticket reconciliation, atomic delta reward,
   status/result UX and monitoring.
3. **Leaderboard/event policy:** no default Miles, sponsored reward items,
   campaign budgets and event UX.
4. **Commerce liability freeze:** inventory manifest, disable new payments and
   orders, remove public cart/checkout actions.
5. **Discovery/rewards cleanup:** merchant profiles, reward items, voucher
   namespace and in-store copy.
6. **Historical reconciliation:** orders, refunds, fulfilment, vouchers and
   pending rewards to zero unresolved liability.
7. **Runtime removal:** obsolete APIs/components/workers/env/tests and merchant
   dashboard extraction/archive.
8. **Later data retirement:** separately approved archive/drop migration.

Slices 1 and 4 can be developed in parallel, but the game cutover and commerce
cleanup must each satisfy their own safety gates before release.
