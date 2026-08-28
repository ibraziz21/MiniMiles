# Akiba Pass Navigation, Rewards and Earned-Miles Notifications V1

**Package:** `packages/hub-page`  
**Supporting systems:** Akiba Platform and the existing Hub Web Push pipeline  
**Status:** Ready for review  
**Related specs:** `home-redesign-spec.md`, `next-reward-progress-v1-spec.md`,
`web-push-notifications-spec.md`

---

## 0. Decision summary

V1 makes two focused changes that reinforce Akiba Pass as a shopping-value
product:

1. Simplify the primary navigation around the shopping journey:

   ```text
   Explore · Merchants · Rewards · Earn · Me
   ```

   Games, quests and referrals remain available, but move under one `Earn`
   destination. `Shop & Earn` is the first and most prominent option there.

2. Notify a member when a merchant purchase has successfully credited Miles:

   ```text
   You earned 120 Miles 🎉
   From your purchase at Merchant X. Only 80 more to unlock 10% off.
   ```

   The notification is transactional, uses the existing in-app notification
   outbox and Web Push delivery pipeline, and is created only after the credit
   is authoritative.

These changes improve product hierarchy and reinforce the earn-to-redeem loop.
They do not introduce another rewards economy or a second notification system.

## 1. Product principles

1. Shopping is the primary repeat earning behavior. Games, quests and
   referrals help a member accelerate progress.
2. Navigation labels describe outcomes. `Rewards` is clearer than `Vouchers`
   as a primary label; the underlying voucher remains the V1 reward unit.
3. A scan is not the success event. A committed Miles credit is the success
   event.
4. In-app notifications remain the source of truth. Push is best-effort and
   never controls reward state.
5. Marketing permission is separate. A Miles-credit notification reports a
   completed transaction and is not a promotion.
6. Lock-screen copy may show Miles, merchant name and reward progress, but must
   not show purchase amount, products bought, receipt contents, phone number,
   email address or wallet address.

## 2. Goals and non-goals

### Goals

- Reduce primary navigation choices without removing existing features.
- Make shopping and spending Miles the visible centre of Akiba Pass.
- Give games, quests and referrals a coherent home.
- Confirm immediately that earning through a merchant worked.
- Connect each confirmed earning event to the member's next attainable reward.
- Reuse existing routes, reward selection and push infrastructure wherever
  possible.

### Non-goals

- A redesign of merchant discovery or voucher acquisition.
- User-selected reward goals; V1 continues to use the automatic Next Reward
  target.
- Promotional merchant notifications, reward-expiry reminders or re-engagement
  campaigns.
- Notifications for every game, quest or referral earning event. Existing
  referral templates remain governed separately.
- A complete notification inbox redesign.
- A new native mobile notification stack.

## 3. Information architecture

### 3.1 Primary destinations

| Label | V1 destination | Purpose |
|---|---|---|
| Explore | `/` | Need-led discovery, recommendations and member progress |
| Merchants | `/merchants` | Browse and choose where to shop |
| Rewards | `/vouchers` | See rewards that can be unlocked with Miles |
| Earn | `/earn` | Shop & Earn, quests, games and referrals |
| Me | `/me` | Balance, Next Reward progress, activity and settings |

The Pass remains a visually distinct, one-tap action:

- desktop: the existing `Pass` pill;
- mobile: the existing floating Pass button.

The desktop account control continues to link to `/me`. It may make the `Me`
text item redundant on wider screens, but `/me` is still one of the five
conceptual primary destinations and remains a mobile bottom-nav item.

### 3.2 Desktop navigation

Desktop order:

```text
Explore | Merchants | Rewards | Earn | [Pass] | [Account]
```

`Games`, `Quests` and `Referrals` are removed as independent desktop nav
items. They remain directly addressable and appear inside `/earn`.

### 3.3 Mobile navigation

Mobile bottom-nav order:

```text
Explore | Merchants | Rewards | Earn | Me
```

The Pass floating action button remains above the bar and must not obscure the
`Earn` or `Me` tap targets, including with the iOS safe area.

### 3.4 Active-state mapping

| Current route | Active primary item |
|---|---|
| `/` | Explore |
| `/merchants`, `/merchants/*`, `/shop`, `/shop/*` | Merchants |
| `/vouchers`, `/vouchers/*`, `/my-vouchers` | Rewards |
| `/earn`, `/quests`, `/quests/*`, `/games`, `/games/*`, `/referrals` | Earn |
| `/me`, `/me/*` | Me |
| `/pass` | Pass only; no primary item is also marked active |

Active-state matching must use this explicit route-family map rather than
relying only on `pathname.startsWith(href)`.

## 4. Rewards destination

### 4.1 V1 route decision

The primary label changes from `Vouchers` to `Rewards`, but the V1 navigation
target remains `/vouchers`. This avoids unnecessary route and API churn while
the reward inventory is still voucher-based.

Update the page's user-facing heading and metadata from `Vouchers` to
`Rewards`. Supporting copy can say:

> Use your Miles for discounts and offers from Akiba merchants.

Voucher-specific language remains appropriate inside an individual reward
detail and acquisition flow.

### 4.2 Existing `/rewards` route

The current `/rewards` page advertises cross-chain campaigns and does not
represent the new consumer meaning of `Rewards`. V1 must not leave two
conflicting reward destinations.

Decision:

- replace `/rewards` with a permanent application redirect to `/vouchers`;
- remove its cross-chain campaign UI from the Akiba Pass primary experience;
- preserve any future partner-campaign work outside this route until it can be
  expressed as merchant value in the unified rewards inventory.

Update internal links to use `/vouchers` as the canonical V1 URL. The redirect
preserves old bookmarks and shared links.

## 5. Earn hub

### 5.1 Route

Add authenticated route `/earn`. If the visitor is signed out, redirect to:

```text
/login?next=/earn
```

Existing `/quests`, `/games` and `/referrals` routes remain unchanged. No
feature is removed and old deep links continue to work.

### 5.2 Page hierarchy

Page title:

> Earn Miles

Supporting copy:

> Earn more value when you shop, then use activities to get to your next
> reward faster.

Cards appear in this order:

1. **Shop & Earn** — primary, full-width card; links to `/merchants`.
2. **Quests** — links to `/quests`.
3. **Games** — links to `/games`.
4. **Refer & Earn** — links to `/referrals`.

The Shop & Earn card must have the strongest visual weight and explain the
repeat behavior. Suggested copy:

> Show your Akiba Pass when you shop with participating merchants and earn
> Miles from eligible purchases.

Secondary cards may show truthful summaries from data already available, such
as active quest count, remaining game plays or pending referral Miles. A
summary failure must degrade to static copy; it must never block the page.

Rollout-disabled games or quests remain visible only when their existing
rollout contract says the member is eligible. Do not expose a card that leads
to a dead or permanently unavailable state. Shop & Earn is always shown.

### 5.3 Navigation behavior

- Selecting `Earn` always opens `/earn`; it does not open a hover-only menu.
- Desktop may optionally show a click-triggered menu as an enhancement, but
  the label itself must remain a valid link and keyboard target.
- The mobile experience uses the Earn hub, not a nested bottom-nav menu.
- Browser back behavior remains normal.

## 6. Earned-Miles notification

### 6.1 Eligibility

Create one earned-Miles notification when all of the following are true:

- the recipient resolves to one authenticated Hub user;
- a merchant purchase or merchant Pass scan has produced an authoritative,
  committed credit;
- the total credited amount is a positive integer;
- the source event has not already produced a notification;
- the event is a shopping earning event, not a game, quest, referral, manual
  grant, correction, reversal or Miles spend.

Do not notify on:

- QR decode or Pass resolution;
- scan submission;
- a pending or retrying award;
- `rewardIssued = false`;
- zero-Miles transactions;
- duplicate delivery of the same award event;
- a reversal or administrative correction.

One merchant transaction that produces base Miles plus a campaign bonus must
produce one notification containing the total credited amount, not one push
per ledger row.

### 6.2 Authoritative event contract

The award-writing system owns the success fact. After the Miles credit commits,
it emits one durable `miles_credited` event with:

```ts
type MilesCreditedEvent = {
  eventId: string;             // stable, globally unique idempotency key
  hubUserId: string;           // returned by Pass resolution when available
  canonicalId?: string;        // reconciliation aid, not the primary Hub owner
  merchantId: string;
  merchantName: string;
  milesAwarded: number;        // total for this merchant transaction
  source: "merchant_scan" | "merchant_purchase";
  occurredAt: string;          // ISO-8601 credit timestamp
  purchaseEventId?: string;
};
```

For Hub orders, `releaseRewardJob()` already receives the authoritative
`rewardIssued` and `milesAwarded` response and can call the shared producer
directly after successful completion.

For in-store Pass scans, the Platform/merchant award service must emit the
same event only after its ledger transaction commits. Resolving a Pass through
`/api/me/pass/resolve` is insufficient proof and must not enqueue anything.

If the upstream system cannot yet deliver this event, add an authenticated,
idempotent Hub endpoint:

```text
POST /api/internal/miles-credited
Authorization: Bearer <rotatable service key>
```

The endpoint validates the contract, rate-limits callers, rejects unknown
sources, and invokes the same producer used by Hub orders. A network failure
must be retryable by the upstream outbox. Do not ask the merchant browser to
make this callback as a best-effort second request.

### 6.3 In-app outbox record

Insert one row into the existing `notification_outbox`:

```ts
{
  user_ref: hubUserId,
  hub_user_id: hubUserId,
  template: "miles_earned",
  category: "earnings",
  deep_link: "/me#next-reward",
  dedupe_key: `notif:miles-earned:${eventId}`,
  metadata: {
    eventId,
    amountMiles,
    merchantId,
    merchantName,
    nextReward: {
      templateId,
      benefitLabel,
      merchantName,
      gapMiles,
      affordable
    } | null
  }
}
```

The insert is idempotent through `dedupe_key`. The record is created even if
the user has no active push subscription or has disabled earnings push.

Metadata is server-authored and bounded:

- `merchantName`: trim, maximum 60 characters;
- `amountMiles`: positive integer within the configured per-event award cap;
- `benefitLabel`: generated by the existing voucher formatter, maximum 80
  characters;
- no receipt, basket or customer identity data.

### 6.4 Next Reward enrichment

After the credit commits, call `getNextRewardSummary()` using the credited Hub
user. Store a notification-time snapshot; do not recompute historical copy
when the notification is later rendered.

Enrichment failure must not prevent the earned-Miles notification. Use the
generic template when balance or reward inventory is unavailable.

If the target changed because the newly credited balance can now afford a
reward, use the newly selected/affordable target returned after the credit.

### 6.5 Copy states

#### Progress remains

```text
Title: You earned 120 Miles 🎉
Body: From Merchant X. Only 80 more to unlock 10% off.
Link: /me#next-reward
```

#### Reward is now affordable

```text
Title: Reward unlocked 🎉
Body: Your 120 Miles from Merchant X unlocked 10% off at Merchant Z.
Link: /vouchers/{templateId}
```

#### No usable progress context

```text
Title: You earned 120 Miles 🎉
Body: Your purchase at Merchant X added Miles to your balance.
Link: /me/activity
```

Copy rules:

- use localized integer formatting;
- do not show purchase amount or purchased items;
- do not claim a reward is unlocked unless the post-credit summary says it is
  affordable and the voucher is still available;
- do not use `money saved` in this notification until Akiba has authoritative
  redemption savings data.

### 6.6 Preference semantics

Add an `earnings` transactional preference instead of reusing the current
`rewards` preference:

| Preference | Default | Covers |
|---|---:|---|
| `earnings_enabled` | `true` | Confirmed shopping Miles credits |
| `rewards_enabled` | existing `false` | Referral and other optional reward updates |
| `marketing_enabled` | existing `false` | New merchants, features and promotions |

This means a member who explicitly enables Akiba notifications receives
transaction confirmations, including earned Miles, unless they switch that
category off. Existing users' `rewards_enabled` choice is not silently
changed.

Update the settings labels to:

- Orders & refunds
- Vouchers
- Miles earned from shopping
- Referral rewards
- New features & merchants

The `/api/me/push` response and preferences PATCH route must expose the new
`earnings` boolean. The dispatcher checks `earnings_enabled` when
`category = 'earnings'`.

### 6.7 Permission timing

Never request OS notification permission automatically after a scan or on
page load.

- If the device is already subscribed and earnings notifications are enabled,
  send the push normally.
- If the app is open but the device is not subscribed, show the in-app earning
  confirmation first. It may offer a secondary `Notify me next time` action.
- Only that explicit tap may invoke the browser permission flow.
- On iOS, show Add to Home Screen guidance until the app is installed.
- A denial is respected; do not repeatedly prompt.

The current generic early announcement prompt should not be the primary
permission moment for transactional notifications. Retain notification
settings at `/me/notifications` and prefer the contextual post-earning prompt
for members who have now seen the benefit.

## 7. Schema and pipeline changes

Add one additive migration after the current latest migration:

1. Add `earnings_enabled boolean not null default true` to
   `hub_notification_preferences`.
2. Extend `notification_outbox.category` to accept `earnings`.
3. Extend `enqueue_web_push_job()` so category `earnings` and template
   `miles_earned` enqueue a normal `web_push_jobs` row.
4. Do not backfill old ledger credits into notification rows.
5. Update API response types, preference patch validation, dispatcher
   preference loading and template allowlist.

The existing delivery behavior remains unchanged:

```text
committed Miles credit
  -> notification_outbox (canonical in-app event)
  -> web_push_jobs
  -> dispatcher
  -> active device subscriptions
  -> service worker
  -> OS notification
```

Push delivery failure never rolls back, duplicates or reverses Miles.

## 8. In-app notification feed

Add `miles_earned` to the notification template map.

Feed row:

```text
[Miles icon] 120 Miles earned
             Merchant X · 28 Aug, 14:32
             View progress
```

The row deep-links to the stored destination. Unknown or malformed metadata
must degrade to `Miles earned` without rendering raw JSON or template keys.

## 9. Analytics and operations

### Client events

- `primary_nav_tap` — `{ destination, surface: "desktop" | "mobile" }`
- `earn_hub_item_tap` — `{ item: "shop" | "quests" | "games" | "referrals" }`
- `earnings_push_prompt_shown`
- `earnings_push_prompt_accepted`
- `earnings_push_prompt_dismissed`
- `miles_earned_notification_opened` — `{ destination }`

### Server metrics

- committed shopping credit events;
- outbox rows created and deduplicated;
- recipient-resolution failures;
- Next Reward enrichment success/fallback rate;
- push jobs accepted, suppressed, retried and dead;
- notification opens;
- time from credit commit to provider acceptance, p50/p95;
- reward-detail visits and voucher acquisitions following a notification.

The production `track()` implementation must forward these events to the
configured analytics provider before analytics acceptance criteria can pass.

Never place customer email, phone, wallet, raw push endpoint or purchase data
in analytics properties.

## 10. Rollout

### Navigation

Ship the navigation and label change to everyone in one release. Information
architecture should not differ by cohort because shared links, support copy
and active states would become inconsistent.

### Earned-Miles notifications

Use a server-side enqueue flag, for example:

```text
HUB_MILES_EARNED_NOTIFICATIONS_ENABLED
```

Rollout sequence:

1. Deploy schema, template and event producer with enqueue disabled.
2. Verify authoritative merchant-scan events and idempotency in staging.
3. Enable for internal accounts and physical Android/iOS devices.
4. Enable for one or two pilot merchants.
5. Expand after seven days with no duplicate notifications, recipient leaks or
   material delivery delay.
6. Remove the temporary cohort restriction; retain the emergency enqueue flag.

Disabling the flag stops new earned-Miles push jobs but does not alter Miles,
subscriptions, existing in-app events or other push categories.

## 11. Testing

### Navigation and routes

- desktop and mobile render the specified labels and order;
- Pass remains one tap away on both surfaces;
- route families produce the correct single active item;
- `/earn` requires authentication and preserves the return URL;
- `/earn` always shows Shop & Earn first;
- rollout-ineligible games/quests do not lead to dead destinations;
- `/rewards` redirects to `/vouchers`;
- old direct links to `/games`, `/quests` and `/referrals` still work;
- keyboard focus, visible focus, touch target and screen-reader labels pass.

### Producer and data

- confirmed positive merchant credit creates one outbox row;
- scan/Pass resolution alone creates none;
- pending, zero, `rewardIssued = false`, reversal and unknown source create
  none;
- retrying the same `eventId` creates no duplicate;
- base-plus-bonus produces one total notification;
- ambiguous/unresolved recipient produces no push and emits an operational
  alert;
- Next Reward failure produces the generic earned template;
- newly affordable reward produces the unlock template and voucher deep link;
- no historical ledger rows are backfilled.

### Preferences and delivery

- a newly subscribed member has earnings enabled and marketing disabled;
- earnings can be disabled without disabling orders or vouchers;
- existing referral/marketing preferences remain unchanged by migration;
- no active subscription still leaves a visible in-app event;
- multi-device fan-out and expired subscription handling reuse existing
  behavior;
- notification tap opens the correct protected route after authentication;
- lock-screen payload contains no purchase amount or identity data.

### Physical acceptance

- scan and award at a pilot merchant, receive one Android notification while
  Akiba is closed;
- repeat on an installed iOS 16.4+ PWA;
- verify displayed Miles equal the committed credit;
- verify progress matches the post-credit Next Reward state;
- replay the upstream event and confirm no second notification;
- simulate Platform and push-provider outages and confirm eventual retry
  without duplicate Miles or push.

## 12. Definition of done

- Primary navigation is `Explore`, `Merchants`, `Rewards`, `Earn`, `Me`, with
  Pass remaining a distinct action.
- Games, quests and referrals are accessible from `/earn` and no longer occupy
  primary-nav slots.
- Rewards points to the merchant voucher inventory and `/rewards` no longer
  exposes a conflicting cross-chain experience.
- A successful shopping credit creates one durable in-app `miles_earned`
  notification.
- A subscribed member with earnings enabled receives a safe lock-screen push.
- No notification is created from a scan alone or before the award commits.
- The notification uses post-credit Next Reward progress when trustworthy and
  falls back safely when it is unavailable.
- Preferences, idempotency, retries, multi-device behavior and privacy tests
  pass.
- End-to-end merchant scan acceptance passes on physical Android and iOS.

## 13. Recommended implementation order

1. Replace primary nav items and add explicit route-family active states.
2. Add `/earn` and update Rewards labels.
3. Redirect the existing `/rewards` route to `/vouchers`.
4. Add the earnings preference/category migration and API/dispatcher support.
5. Add the `miles_earned` renderer and in-app feed row.
6. Add the shared idempotent earned-Miles notification producer.
7. Wire Hub order rewards after confirmed release.
8. Wire the authoritative Platform merchant-scan event/outbox.
9. Add contextual post-earning permission UX.
10. Add automated tests, analytics and staged physical-device rollout.
