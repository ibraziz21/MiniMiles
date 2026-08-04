# Akiba Pass referral system

**Package:** `packages/hub-page`  
**Status:** Proposed  
**Priority:** Growth launch  
**Owners:** Product, Hub, Akiba Platform, Risk/Ops  
**Companion specs:** `merchant-shopping-quests-spec.md`,
`order-lifecycle-completion-spec.md`, `production-readiness-security-spec.md`

## 0. Product decision

Launch an automatic, two-milestone referral program for Akiba Pass:

| Milestone | Referrer reward | Required proof |
|---|---:|---|
| Friend joins | 50 AkibaMiles | The referred person verifies their email and creates their first Akiba Pass. |
| Friend becomes active | 100 AkibaMiles | The referred person completes a qualifying paid purchase or a merchant-confirmed eligible voucher redemption. |

The referrer can earn **150 AkibaMiles per qualified friend**. The referred
member receives the normal Akiba Pass onboarding rewards; this referral
program does not add a separate friend bonus in V1.

Rewards are automatic. Neither party submits screenshots or presses a claim
button.

The launch promise is:

> Invite a friend to Akiba Pass. Earn 50 Miles when they join, then another
> 100 Miles when they make their first qualifying purchase or use an eligible
> voucher.

The system optimizes for activated, economically useful members rather than
raw account creation. A Pass signup is sufficient for the first 50 Miles but
never for the second 100 Miles.

## 1. Goals and non-goals

### Goals

- Give every eligible Hub member a simple personal invite link.
- Make the 50/100 progress understandable before and after sharing.
- Attribute a new member to exactly one referrer.
- Pay both milestones automatically and at most once.
- Keep rewards available to email-first members; a wallet is not required.
- Prevent self-referrals, disposable-account farming, referral rings and
  cheap-voucher loops.
- Reuse the Hub's canonical account, stable Pass, durable job and Platform
  Miles-ledger architecture.
- Give operations a complete review, override and audit surface.
- Make reward values, limits, holds, budgets and qualification rules
  versioned configuration rather than code constants.

### Non-goals for V1

- Multi-level or affiliate commissions.
- Tiered ambassador levels, referral streaks or leaderboards.
- Rewards for clicks, link shares, app installs or wallet links.
- Referral-code bidding, custom vanity codes or public referral profiles.
- Cash payouts, on-chain minting or a selectable payout wallet.
- Retroactive attribution of members who already owned an Akiba Pass.
- Client-submitted purchase or voucher proof.
- Machine-learning fraud scoring. V1 uses explicit, auditable rules.

## 2. Locked launch policy

### 2.1 Program defaults

| Setting | Launch value |
|---|---:|
| Signup reward | 50 Miles |
| Activation reward | 100 Miles |
| Total per qualified friend | 150 Miles |
| Attribution window | 30 days from accepted referral click |
| Time to complete activation | 30 days from Pass creation |
| Signup-reward hold | 24 hours |
| Activation-reward hold | 7 days |
| Minimum qualifying paid purchase | KES 200 or currency-equivalent |
| Rewarded referrals per referrer | 10 per rolling 30 days |
| Signup rewards per referrer | 3 per rolling 24 hours |
| Code-click rate limit | 60 per IP hash per hour |
| Code rotation | Support/admin only in V1 |

All values live on an immutable program-policy version. Publishing changed
values creates a new version; it never rewrites a referral already bound to an
earlier version.

The KES 200 minimum is a launch default, not a hard-coded assumption. Product
and Finance may change it before rollout by publishing the first active policy.

### 2.2 Eligible referrer

A member may share a link at any time, but a reward can release only while the
referrer:

- owns an active Akiba Pass;
- is not suspended, deleted, blacklisted or `rewards_disabled`;
- is within the program's daily and rolling-30-day limits;
- is not the referred member;
- has either owned the Pass for at least seven days or previously completed a
  server-verified purchase or eligible voucher redemption.

The final rule prevents newly created accounts from immediately forming a
reward-farming chain while allowing a genuine new shopper to refer friends as
soon as they become active.

If a person follows an otherwise valid link from an ineligible referrer, the
join flow still works. The UI must not promise a reward, and no reward budget
is reserved. A later change in referrer eligibility does not turn that old
signup into a paid referral.

### 2.3 Eligible referred member

A referred member must:

- not have had an Akiba Pass before attribution was accepted;
- complete email OTP verification;
- create their first Pass inside the 30-day attribution window;
- have no earlier bound referral;
- not resolve to the referrer's user ID, verified wallet, verified phone, or
  another hard-blocked identity;
- pass the launch risk rules.

An existing authentication record with no prior Pass can qualify if it has no
prior completed commercial activity and the referral was accepted before its
first Pass creation. Merely visiting an invite link after a Pass already
exists never qualifies.

### 2.4 Qualifying activation

The second 100 Miles requires one of the following events owned by the
referred Hub account:

1. **Paid Hub purchase**
   - payment is server-confirmed;
   - the order reaches the canonical `completed` state;
   - gross customer spend is at least the policy's currency threshold;
   - it is not a test, complimentary, admin-created or fully promotional
     order; and
   - it is not cancelled, disputed, refunded or charged back before release.

2. **Verified in-store purchase**
   - a participating merchant verifies the purchase through an authenticated
     Akiba merchant flow;
   - the scan/award resolves to the referred member's Pass;
   - verified gross spend meets the policy threshold; and
   - the merchant and transaction are eligible for referral qualification.

3. **Eligible voucher redemption**
   - the voucher reaches `redeemed`, not merely `claiming` or `issued`;
   - redemption is confirmed by an authenticated merchant or by a completed
     paid Hub order;
   - ownership resolves to the referred Hub account;
   - the voucher program has `referral_qualifying = true`; and
   - the voucher is not free, test, admin-granted, self-funded by referral
     bonuses, or on the policy exclusion list.

Voucher programs are **ineligible by default**. Product/Ops explicitly enables
programs whose redemption represents meaningful customer activity. This
prevents a new member from using onboarding Miles on a very cheap voucher to
unlock the 100-Mile reward.

Only the earliest eligible event qualifies the referral. A purchase and
voucher used in the same order produce one activation reward, never two.

## 3. User journeys

### 3.1 Referrer shares an invite

1. An authenticated member opens `/referrals` or the home referral card.
2. Hub loads or creates their stable, random referral code.
3. The page shows the current offer, remaining monthly capacity and exact
   conditions.
4. The member shares through WhatsApp, the device share sheet, or Copy Link.
5. The canonical link is `https://hub.akibamiles.com/r/<code>`.

Suggested share text:

> Join me on Akiba Pass to earn Miles when you shop and use rewards. Get your
> Pass here: <link>

The shared message must not tell the friend that they personally receive 150
Miles.

### 3.2 Friend follows the link and joins

1. `/r/<code>` validates the active code and program before rendering or
   redirecting.
2. The server creates an anonymous referral-click record and sets a signed,
   opaque, `HttpOnly` attribution cookie.
3. The route redirects to `/join?src=referral`, removing the public code from
   the browser URL to reduce leakage through referrers and analytics.
4. The friend verifies email OTP.
5. First Pass creation atomically binds the referral, snapshots its program
   policy, reserves the maximum 150-Mile liability and creates the pending
   signup reward.
6. The friend sees their Pass normally. The join flow never waits on Platform
   reward delivery.

The first valid invite accepted in a browser wins for the attribution window.
A later invite link does not silently overwrite it. Before OTP verification,
the join screen may offer “Use a different invite code”; this explicit action
invalidates the earlier anonymous click and records an audit event.

### 3.3 Referrer receives 50 Miles

1. The referral appears immediately as `Joined — 50 Miles pending`.
2. During the 24-hour hold, deterministic risk rules run and may place the
   referral into manual review.
3. When the hold expires, a leased worker claims the eligible reward job.
4. Akiba Platform credits 50 off-chain Miles to the referrer's canonical
   account using the job idempotency key.
5. Hub records the Platform ledger reference and displays `50 Miles earned`.
6. A notification tells the referrer that their friend joined.

The referrer sees a privacy-safe label such as the friend's chosen first name
when available, otherwise `A friend`. Raw email, phone and wallet identifiers
are never shown.

### 3.4 Friend activates the referral

1. A qualifying purchase or voucher redemption produces a durable first-party
   domain event.
2. An atomic qualification function locks the referral, stores the proof
   reference and creates the 100-Mile reward once.
3. The referrer sees `Friend became active — 100 Miles pending`.
4. Cancellation, refund and fraud signals can void the reward during its
   seven-day hold.
5. After the hold, the worker credits 100 Miles through Platform.
6. The referral displays `Complete — 150 Miles earned`.

### 3.5 Expiry, rejection and reversal

- If no first Pass is created in 30 days, the anonymous attribution expires.
- If no qualifying activation occurs within 30 days after Pass creation, the
  referral remains a valid 50-Mile signup but the 100-Mile milestone expires.
- Hard-blocked referrals show `Not eligible` without exposing fraud logic.
- A reward held for review shows `Under review`; support copy gives a normal
  review window without promising approval.
- A qualifying order refunded before release voids the pending 100 Miles.
- Confirmed fraud or a post-release chargeback creates an idempotent reversal
  ledger entry. Never delete or mutate the original credit.
- If available balance is insufficient for reversal, the ledger may become
  negative according to Platform policy and the account is marked for review;
  Hub does not silently take an unrelated voucher.

## 4. State model

### 4.1 Referral state

```text
clicked
  -> attributed
  -> pass_activated
  -> qualified
  -> complete

Any non-terminal state may become:
  expired | rejected | manual_review

manual_review may become:
  pass_activated | qualified | complete | rejected
```

`complete` means both applicable reward jobs released. Referral state is a
read model; reward-job state remains authoritative for payment.

### 4.2 Reward state

```text
pending_hold
  -> eligible
  -> processing
  -> released

pending_hold | eligible -> manual_review -> eligible | voided
processing -> eligible (retry with backoff)
released -> reversed
```

Required invariants:

- exactly one `signup` reward and one `activation` reward per referral;
- a reward cannot be both `released` and `voided`;
- only a released reward can be reversed;
- a referral cannot qualify from an event that predates Pass creation;
- changing or replaying client requests cannot change a proof reference;
- all state transitions append an immutable audit event.

## 5. Data model

Add a forward Supabase migration using the next available migration number.
Names below are normative unless they conflict with production schema.

### 5.1 Program policy

```text
referral_program_versions
  id                              uuid primary key
  version                         integer unique
  status                          draft | active | paused | ended
  signup_reward_miles             integer
  activation_reward_miles         integer
  attribution_window_days         integer
  activation_window_days          integer
  signup_hold_hours               integer
  activation_hold_hours           integer
  min_purchase_kes                integer
  daily_signup_cap                integer
  rolling_30_day_referral_cap     integer
  total_budget_miles              bigint
  reserved_budget_miles           bigint
  released_budget_miles           bigint
  starts_at                       timestamptz
  ends_at                         timestamptz null
  rules                           jsonb
  created_by                      uuid null
  created_at                      timestamptz
  published_at                    timestamptz null
```

Constraints:

- reward amounts and windows are positive;
- reserved/released values never exceed total budget;
- at most one version is `active` at a time;
- an active or ended version is immutable except for emergency `paused`
  status;
- activation reward rules are snapshotted onto the referral.

At Pass activation, reserve the full 150-Mile maximum. If no budget remains,
do not create a reward-eligible referral. If the activation milestone expires
or is rejected, release its 100-Mile reservation. Released credits move from
reserved to released atomically.

### 5.2 Referral codes

```text
referral_codes
  id              uuid primary key
  hub_user_id     uuid references auth.users(id)
  code            text unique
  status          active | rotated | disabled
  created_at      timestamptz
  disabled_at     timestamptz null
  disabled_reason text null
```

Code requirements:

- one active code per user;
- eight random characters from an unambiguous uppercase Base32 alphabet;
- at least 40 bits of entropy;
- no embedded user ID, timestamp, email or sequential value;
- case-insensitive lookup after normalization;
- codes are public identifiers, not authentication secrets.

### 5.3 Anonymous referral clicks

```text
referral_clicks
  id                    uuid primary key
  referral_code_id      uuid references referral_codes(id)
  program_version_id    uuid references referral_program_versions(id)
  token_hash            text unique
  ip_hash                text null
  device_hash            text null
  user_agent_family      text null
  landing_path           text
  status                 accepted | replaced | bound | expired | blocked
  accepted_at            timestamptz
  expires_at             timestamptz
  bound_at               timestamptz null
  created_at              timestamptz
```

The browser cookie contains a signed opaque token; the database stores only
its hash. Store no raw IP address. Hash network signals using a purpose-specific
HMAC secret and rotate/expire them under the retention rules in section 10.

### 5.4 Bound referrals

```text
referrals
  id                         uuid primary key
  program_version_id         uuid references referral_program_versions(id)
  referral_code_id           uuid references referral_codes(id)
  referral_click_id          uuid references referral_clicks(id)
  referrer_user_id           uuid references auth.users(id)
  referred_user_id           uuid references auth.users(id) unique
  referred_pass_id           uuid references hub_user_passes(id) unique
  status                     attributed | pass_activated | qualified |
                             complete | expired | rejected | manual_review
  signup_reward_miles        integer
  activation_reward_miles    integer
  min_purchase_kes           integer
  activation_expires_at      timestamptz
  qualification_type         hub_purchase | merchant_purchase |
                             voucher_redemption null
  qualification_reference    text null
  qualified_at               timestamptz null
  risk_score                  integer
  risk_decision               allow | review | block
  risk_reason_codes           text[]
  rejection_reason_code       text null
  created_at                  timestamptz
  updated_at                  timestamptz
```

Uniqueness on `referred_user_id` and `referred_pass_id` makes one lifetime
referral binding enforceable at the database layer.

### 5.5 Reward jobs

```text
referral_reward_jobs
  id                    uuid primary key
  referral_id           uuid references referrals(id)
  milestone             signup | activation
  recipient_user_id     uuid references auth.users(id)
  amount_miles          integer
  idempotency_key       text unique
  status                pending_hold | eligible | processing |
                        released | manual_review | voided | reversed
  eligible_at           timestamptz
  lease_owner           text null
  lease_expires_at      timestamptz null
  attempts              integer
  next_retry_at         timestamptz null
  last_error_code       text null
  last_error_detail     text null
  platform_reference    text null
  released_at           timestamptz null
  voided_at             timestamptz null
  reversed_at           timestamptz null
  created_at            timestamptz
  updated_at            timestamptz

  unique(referral_id, milestone)
```

Idempotency format:

```text
hub-referral:<program-version>:<referral-id>:<milestone>:referrer
```

### 5.6 Audit and risk evidence

```text
referral_events
  id              bigint generated always as identity primary key
  referral_id     uuid null references referrals(id)
  referral_click_id uuid null references referral_clicks(id)
  actor_type      system | user | worker | admin
  actor_id        text null
  event_type      text
  from_state      text null
  to_state        text null
  reason_code     text null
  metadata        jsonb
  created_at      timestamptz

hub_user_risk_flags
  id              uuid primary key
  hub_user_id     uuid references auth.users(id)
  flag_type       suspicious_activity | blacklisted |
                  rewards_disabled | manual_review
  reason_code     text
  notes           text null
  is_active       boolean
  flagged_by      uuid null
  resolved_by     uuid null
  resolved_at     timestamptz null
  created_at      timestamptz
  updated_at      timestamptz
```

Admin notes are never returned through member APIs. Risk decisions store
stable reason codes; sensitive internal detection details remain admin-only.

### 5.7 Security

- Enable RLS on every referral table.
- Revoke direct writes from `anon` and `authenticated`.
- Service role and narrowly scoped security-definer RPCs perform mutations.
- Member reads use an API/BFF that selects a privacy-safe projection.
- Never accept `referrer_user_id`, reward amount, reward state, qualification
  reference or risk decision from a browser.
- Lock rows with `FOR UPDATE` in binding, qualification, budget and reward
  transition functions.

## 6. Atomic database operations

### 6.1 `accept_referral_click`

Inputs: normalized code, hashed opaque token, privacy-safe request signals.

The function:

1. locks the active program and code;
2. verifies dates, program status and aggregate budget availability;
3. applies code-click rate limits;
4. inserts an accepted click with policy/version reference;
5. returns only expiry and cookie material required by the route.

No reward budget is reserved at click time.

### 6.2 `create_or_get_hub_pass_with_referral`

Create a new canonical RPC rather than adding an ambiguous Postgres overload to
`create_or_get_hub_pass`.

Inputs include authenticated user ID, verified email, signup source and the
server-resolved referral token hash. In one transaction it:

1. returns the existing Pass with `is_new = false` without binding anything;
2. creates the first Pass when absent;
3. enqueues the existing `pass_activated` internal event;
4. loads and locks the accepted, unexpired referral click;
5. verifies referrer/referred eligibility and hard-block rules;
6. atomically reserves 150 Miles against the click's program version;
7. inserts one bound referral with a policy snapshot;
8. inserts the 50-Mile `signup` reward job with a 24-hour `eligible_at`;
9. marks the click bound; and
10. appends referral audit events.

Pass creation must still succeed if referral binding is invalid, paused or out
of budget. The RPC returns a safe referral outcome such as `bound`,
`not_eligible`, `program_paused` or `none`; it never returns fraud internals.

Every Pass-creation request path must pass server-resolved referral context to
this canonical operation. This includes `/join`, `/pass`, `/welcome`, `/me`,
the member-home feed and `GET /api/me/pass`. A referral must not disappear
because the member navigated away from the join reveal screen.

### 6.3 `qualify_referral_activation`

Inputs: referred Hub user ID, qualification type, authoritative proof ID,
verified amount/currency and occurrence time. It:

1. locks the member's referral;
2. verifies status, deadline and policy rules;
3. checks proof ownership and eligibility from first-party tables;
4. rejects events predating Pass creation;
5. writes the immutable qualification type/reference;
6. inserts the 100-Mile job with its hold; and
7. appends an audit event.

The function is idempotent by `(qualification_type,
qualification_reference)` and `unique(referral_id, milestone)`. Concurrent
purchase and voucher events can create only one activation reward.

### 6.4 Reward worker primitives

Provide lease-based functions matching the hardened internal-event worker:

- `claim_referral_reward_jobs(limit, worker_id, lease_seconds)`;
- `complete_referral_reward_job(job_id, worker_id, outcome, reference)`;
- `release_expired_referral_reward_leases()`;
- `void_referral_activation_for_reversal(proof_type, proof_id, reason)`; and
- `expire_referrals(batch_size)`.

Use `FOR UPDATE SKIP LOCKED`, exponential backoff with jitter, a maximum retry
policy and explicit terminal/manual-review handling. A crashed worker must not
strand a job in `processing`.

## 7. Platform reward contract

Referral rewards credit the Platform canonical off-chain `miles_ledger`.
Wallet linking is not required and no direct on-chain mint occurs.

The Hub worker needs one service-to-service operation with this semantic
contract:

```json
{
  "idempotencyKey": "hub-referral:1:<referral-id>:signup:referrer",
  "recipient": {
    "hubUserId": "<referrer-user-id>",
    "identities": [
      { "type": "email", "value": "verified@example.com" },
      { "type": "wallet", "value": "0x..." }
    ]
  },
  "amountMiles": 50,
  "reason": "referral_signup",
  "sourceApp": "hub",
  "metadata": {
    "programVersion": 1,
    "referralId": "<uuid>",
    "milestone": "signup"
  }
}
```

Successful response:

```json
{
  "ok": true,
  "duplicate": false,
  "ledgerReference": "<stable-reference>",
  "amountMiles": 50
}
```

Requirements:

- the idempotency key is unique in Platform;
- replay returns the original successful result without a second credit;
- Platform resolves all supplied identities to one canonical participant;
- conflicting canonical identities fail closed for manual review;
- response amount must exactly match the job amount;
- the ledger entry stores reason, source and referral metadata;
- a separate idempotent reversal operation creates a debit entry referencing
  the original credit.

If Platform's existing internal-event engine is used as the adapter, launch is
still blocked until it provides the same acknowledgement: canonical recipient,
exact credited amount, durable ledger reference and replay-safe result. A
fire-and-forget quest webhook is not sufficient for referral payouts.

## 8. Hub routes and server contracts

### `GET /r/[code]`

Public referral landing endpoint. Normalizes and validates the code, records
an accepted click, sets the attribution cookie and redirects to the join flow.
Invalid, disabled, expired or capped links render a friendly generic page with
a normal `Get Akiba Pass` action and no reward promise.

### `GET /api/referrals/me`

Authenticated, `private, no-store`.

```ts
type ReferralDashboard = {
  program: {
    status: "active" | "paused" | "ended";
    signupMiles: number;
    activationMiles: number;
    activationWindowDays: number;
    remainingRewardedReferrals: number;
    termsVersion: string;
  };
  invite: {
    code: string;
    url: string;
    canEarn: boolean;
    ineligibleReason?: "account_not_active" | "limit_reached" | "program_paused";
  };
  summary: {
    friendsJoined: number;
    friendsActivated: number;
    milesPending: number;
    milesEarned: number;
  };
  referrals: Array<{
    id: string;
    friendLabel: string;
    state: "joined_pending" | "joined" | "activation_pending" |
      "complete" | "under_review" | "expired" | "not_eligible";
    earnedMiles: number;
    pendingMiles: number;
    nextStep: string | null;
    joinedAt: string;
  }>;
};
```

Never return a friend's email, phone, wallet, risk score, reason codes or proof
reference.

### `POST /api/referrals/share-event`

Optional authenticated analytics endpoint for `copy`, `native_share` and
`whatsapp`. It records intent only and has no reward effect. Rate-limit it and
accept an enumerated channel, not arbitrary metadata.

### Existing join and Pass routes

- Referral code/token is resolved only on the server.
- `/api/auth/join-complete` does not accept a referrer ID or reward amount.
- Clear the attribution cookie after successful bind, explicit replacement,
  expiry, logout/account switch, or discovery that a Pass already exists.
- Generic login remains generic; referral reward copy appears only when an
  accepted attribution exists.

### Internal worker route

Add `POST /api/internal/process-referral-reward-jobs`, protected by a dedicated
cron/worker secret and disabled by default outside configured environments.
Production should prefer the long-running backend worker pattern already used
for internal Hub events; a cron route can remain a recovery drain.

Return non-2xx on configuration or batch-claim failure. Return aggregate counts
only, never identities.

## 9. Product and interface specification

### 9.1 Home card

Place a referral card in the authenticated member home rewards/tool section,
not above primary merchant discovery.

```text
Invite friends. Earn 150 Miles.
Get 50 when a friend joins Akiba Pass and 100 more after their first
qualifying purchase or eligible voucher use.

[ Invite friends ]
```

After activity, replace generic copy with progress:

```text
Your referrals
2 friends joined · 1 activated · 200 Miles earned
[ View referrals ]
```

### 9.2 `/referrals`

The page contains:

1. **Offer header** — 50 + 100 visual breakdown, not only “up to 150”.
2. **Share actions** — WhatsApp primary in Kenya, device Share and Copy Link.
3. **Eligibility/cap note** — show remaining rewarded referrals this period.
4. **Progress summary** — joined, activated, pending and earned.
5. **Friend progress list** — privacy-safe label, two-step progress and dates.
6. **How it works** — three short steps.
7. **Terms link** — qualifying activity, holds, limits and abuse policy.

Required state copy:

| Internal state | Member copy |
|---|---|
| Signup hold | Friend joined · 50 Miles pending |
| Signup released | Friend joined · 50 Miles earned |
| Waiting for activation | 100 Miles left when they shop or use an eligible voucher |
| Activation hold | Friend became active · 100 Miles pending |
| Complete | Referral complete · 150 Miles earned |
| Manual review | Reward under review |
| Activation expired | Activation window ended · 50 Miles earned |
| Rejected | This referral was not eligible |
| Program paused | Referrals are temporarily paused |

Do not tell a referrer which exact fraud signal failed. Do not expose a
friend's purchase value, merchant, voucher or shopping history.

### 9.3 Referred-member experience

- The join page may say `You were invited to Akiba Pass`.
- It must clearly distinguish the referrer's reward from the friend's normal
  onboarding rewards.
- Do not reveal the referrer's email or account data. A display name is shown
  only if the referrer explicitly allows it in a future preference; V1 can use
  generic wording.
- Referral status never blocks Pass access, shopping or redemption.

### 9.4 Accessibility and resilience

- Reward progress cannot rely on color alone.
- All share actions have accessible names and keyboard focus states.
- Copy Link provides a live-region confirmation.
- Render a usable page when Web Share or WhatsApp deep links are unavailable.
- Server failures preserve the invite link and show retryable, non-destructive
  states.
- Never optimistically display Miles as earned before Platform confirms the
  ledger credit.

## 10. Abuse prevention and privacy

### 10.1 Hard blocks

Reject or void a referral when any is true:

- referrer and referred user IDs match;
- the referred member already had a Pass;
- the referred member is already bound to a referral;
- a verified wallet or verified phone is shared by both accounts;
- code, program or account was disabled before binding;
- attribution or activation deadline passed;
- authoritative proof is test, cancelled, refunded, disputed or ineligible;
- a duplicate proof/reference was used;
- reward cap or program budget was unavailable when the Pass was created;
- either account has an active blacklist or rewards-disabled flag.

### 10.2 Review signals

The following raise risk score or manual review; they do not independently
prove fraud:

- many signups sharing an IP/device hash;
- disposable or high-velocity email domains;
- rapid code-click, signup and activation velocity;
- multiple accounts using the same merchant, device or funding source in a
  tight interval;
- reciprocal/circular referral graph patterns;
- a newly created referrer with no verified activity;
- repeated failed OTP or account-switch behavior;
- post-release refunds or merchant disputes;
- unusual concentration against one voucher program.

Use transparent thresholds stored in program/risk configuration. A rule change
must not silently rewrite historical decisions.

### 10.3 V1 risk actions

```text
score 0-29   -> allow
score 30-59  -> extend hold / manual review
score 60+    -> block pending Ops review
```

Scores are a routing mechanism, not the only evidence used by an admin.
Decision reason codes and rule version are stored for auditability.

### 10.4 Privacy and retention

- Do not use canvas, audio or invasive browser fingerprinting.
- Use a random first-party device cookie and server-side HMAC only.
- Never store raw IP addresses in referral tables or analytics properties.
- Retain click-level IP/device hashes for 90 days, then delete or irreversibly
  aggregate them.
- Retain financial reward/audit records according to Akiba's ledger and legal
  retention policy.
- Exclude emails, phone numbers and wallet addresses from product analytics.
- Update Privacy Policy and Referral Terms before public rollout.
- Support account deletion by removing/anonymizing non-ledger PII while
  retaining legally required reward audit references.

## 11. Admin and operations

Add a Referral section to the admin dashboard.

### 11.1 Program management

Admins with the appropriate role can:

- draft and publish a new immutable program version;
- set reward amounts, holds, windows, caps, purchase threshold and budget;
- enable specific voucher programs for qualification;
- pause new attribution immediately;
- end a program at a future time; and
- see reserved, released and remaining Miles liability.

Published financial settings cannot be edited in place. Emergency pause does
not cancel already earned/released rewards.

### 11.2 Referral review queue

The queue supports:

- referral ID, safe user identifiers and timestamps;
- milestone and amount;
- risk score and internal reason codes;
- linked proof type/reference;
- account/referral graph summary;
- Platform delivery status and retry history;
- approve, reject, void, reverse or requeue actions;
- required reason and internal note; and
- full admin audit log.

Admin approval changes job eligibility; it never writes directly to
`miles_ledger`. Manual grants still pass through the same idempotent reward
worker.

### 11.3 Support lookup

Support can search by referral ID, Hub user ID, referral code, masked email or
Platform ledger reference. Read-only support roles cannot reveal raw risk
signals or mutate rewards.

### 11.4 Kill switches

Provide independent controls for:

- accepting new referral clicks;
- binding new referrals;
- qualifying activation events; and
- releasing reward jobs.

Turning off reward release preserves eligible jobs for later processing; it
must not mark them successful or discard them.

## 12. Notifications

Send notifications from durable outbox jobs after committed state changes:

- `A friend joined with your invite. 50 Miles are pending.`
- `You earned 50 Miles for a referral.`
- `Your friend became active. 100 Miles are pending.`
- `You earned another 100 Miles. Referral complete!`
- `A referral reward needs more time for review.`

Do not identify the friend's merchant, purchase or voucher. Email/push failure
never rolls back a reward. Notification idempotency keys use referral ID,
milestone and notification type.

## 13. Analytics and reporting

### 13.1 Client events

```text
referral_card_view
referral_card_tap
referral_page_view
referral_share_tap { channel }
referral_link_copy
referral_terms_view
referral_join_attributed
```

Client events measure UX only and can never drive referral state or rewards.

### 13.2 Server events

```text
referral_click_accepted
referral_click_blocked { reason_code }
referral_bound
referral_signup_reward_held
referral_signup_reward_released
referral_qualified { qualification_type }
referral_activation_reward_held
referral_activation_reward_released
referral_manual_reviewed { outcome }
referral_expired
referral_reward_voided
referral_reward_reversed
```

Use referral/program IDs, not raw identities.

### 13.3 Funnel and business metrics

- eligible referrers who view and share;
- accepted invite clicks per sharer;
- click-to-OTP and click-to-Pass conversion;
- Pass-to-activation conversion within 7, 14 and 30 days;
- time from click to Pass and Pass to activation;
- Miles reserved, pending, released, voided and reversed;
- effective cost per referred Pass and per activated member;
- purchase revenue/gross value from referred members;
- 30/60/90-day retention versus organic cohorts;
- cap, budget exhaustion and program-pause rates;
- fraud block, review and false-positive/appeal rates;
- worker latency, retry and Platform failure rates.

Referral signup count is not the primary success metric. The primary outcome is
cost per activated referred member with healthy retained value.

## 14. Observability and service levels

### 14.1 Targets

| Operation | Target |
|---|---|
| Referral redirect p95 | < 300 ms excluding network |
| Dashboard API p95 | < 500 ms excluding bounded Platform lookup |
| Pass binding | Same transaction as Pass creation |
| Qualification recorded | < 1 minute after authoritative event |
| Eligible reward release | 95% within 5 minutes of hold expiry |
| Reward release | 99.9% at-most-once credits |
| Stuck processing lease | Recovered within 2 lease windows |

### 14.2 Metrics and alerts

Alert on:

- no reward worker heartbeat for two intervals;
- eligible backlog age over 15 minutes;
- any job processing beyond its lease;
- Platform credential or authorization failures;
- retry/terminal failure rate above threshold;
- database uniqueness or budget invariant violations;
- daily reward release above configured guardrail;
- spike in shared device/IP clusters or reversals;
- program remaining budget below 20%, 10% and 5%; and
- discrepancy between referral released totals and Platform ledger totals.

Logs include correlation ID, referral/job ID, program version, milestone,
outcome and safe reason code. Never log full email, phone, wallet, cookie token
or raw IP.

### 14.3 Reconciliation

Run a daily reconciliation that compares:

- released `referral_reward_jobs` against Platform ledger references;
- unique idempotency keys and exact amounts;
- reserved/released program-budget counters against job totals;
- reversed jobs against reversal ledger entries; and
- completed referrals against their two reward jobs.

Discrepancies create an Ops incident and never auto-issue a second credit
without checking Platform by idempotency key.

## 15. Security requirements

- Generate codes and cookie tokens with a cryptographically secure RNG.
- Sign cookies with a purpose-specific secret of at least 32 random bytes.
- Set cookies `Secure`, `HttpOnly`, `SameSite=Lax`, scoped to the minimum path
  compatible with join and Pass creation, with a 30-day maximum age.
- Validate production host before accepting referral attribution.
- Strip referral codes from redirected URLs and analytics payloads.
- Apply durable rate limits to redirect, join completion, dashboard and worker
  endpoints.
- Use constant-shape invalid-code responses to reduce code enumeration value.
- Require CSRF-safe same-origin mutations for authenticated endpoints.
- Use purpose-specific worker/cron credentials, not the Supabase service key.
- Bound every Platform network call with timeout and retry classification.
- Treat Platform 4xx credential/canonical-identity conflicts as operator
  failures, not infinite retries.
- Add dependency and secret-rotation instructions to the deployment runbook.

## 16. Rollout

### Phase 0 — contracts and migration

- Approve Referral Terms, privacy retention and budget.
- Confirm Platform idempotent credit and reversal contracts.
- Add tables, RPCs, RLS, worker leases, risk flags and reconciliation views.
- Seed a draft policy with zero public budget.
- Add admin roles and immutable program publishing.

### Phase 1 — internal testing

- Enable for staff allowlist only.
- Use a small test policy and non-production/test-ledger rewards.
- Exercise signup, purchase, voucher, refund, review and Platform outage paths.
- Reconcile every reward manually during the pilot.

### Phase 2 — controlled production pilot

- Publish a limited real budget.
- Allow 5–10% of eligible referrers through a deterministic user-ID bucket.
- Keep signup and activation caps conservative.
- Review daily activation value, fraud clusters, reversals and support cases.

### Phase 3 — general availability

- Increase rollout only after seven clean days of reconciliation.
- Enable the home card for all eligible members.
- Keep kill switches and budget enforcement active.
- Reassess the 50/100 split only through a new policy version.

Rollback pauses new clicks/bindings and reward release independently. Already
released Miles remain ledger history. Eligible jobs remain durable until Ops
chooses to resume, approve, void or reverse them.

## 17. Test plan

### 17.1 Unit tests

- code normalization, entropy and ambiguous-character exclusion;
- signed token creation, expiry and tamper rejection;
- eligibility, cap, budget and time-window rules;
- purchase currency/threshold normalization;
- voucher allowlist/exclusion rules;
- risk-score thresholds and reason-code output;
- privacy-safe friend labels and API serialization;
- reward/job state transitions and retry classification.

### 17.2 Database integration tests

- concurrent first Pass calls create one Pass, referral and signup job;
- existing Pass never binds after clicking a referral link;
- one referred user cannot bind to two referrers;
- self/shared-identity referral is blocked;
- full 150 budget reservation is atomic under concurrency;
- budget cannot oversubscribe;
- two simultaneous qualification proofs create one activation job;
- ineligible/cheap/test voucher cannot qualify;
- cancelled/refunded order cannot qualify or releases/voids correctly;
- expired holds and activation windows transition correctly;
- worker lease recovery and `SKIP LOCKED` ownership work;
- duplicate completion/reversal is idempotent;
- every transition appends one audit record;
- RLS prevents cross-user reads and direct mutations.

### 17.3 API and security tests

- invalid/disabled/capped code gives no internal detail;
- referrer ID and reward amount cannot be injected from client input;
- cookie is secure, HttpOnly, scoped, expiring and tamper-proof;
- code is absent from post-redirect URL and analytics;
- unauthenticated dashboard/worker access is rejected;
- dashboard never returns friend PII or risk fields;
- rate limits persist across instances;
- Platform timeout returns a retryable job, not a false success;
- logout/account switch clears anonymous attribution safely.

### 17.4 End-to-end journeys

1. **Happy purchase:** share → new Pass → 50 pending/released → completed KES
   200+ order → 100 pending/released → 150 total.
2. **Happy voucher:** share → new Pass → eligible merchant-confirmed voucher
   redemption → complete.
3. **Claim is not redemption:** friend acquires a voucher but does not use it;
   no 100-Mile job exists.
4. **Existing member:** existing Pass opens invite; joins normally but produces
   no referral.
5. **Self-referral:** member opens their own link in another session; blocked.
6. **Double attribution:** two links precede signup; first accepted referral
   remains unless friend explicitly replaces it before OTP.
7. **Concurrent qualification:** purchase and voucher arrive together; only one
   100-Mile credit.
8. **Refund during hold:** qualification is voided; no 100 Miles released.
9. **Chargeback after release:** reversal debit is created once and audited.
10. **Platform outage:** Hub remains usable; job retries and later releases
    once.
11. **Cap reached:** link still permits ordinary Pass signup but gives no
    reward promise or job.
12. **Budget exhausted:** new attribution is safely paused; existing reserved
    referrals can finish.
13. **Manual review:** admin approval requeues the same job and idempotency key.
14. **Account switch:** one browser cannot bind attribution to the wrong
    already-existing Pass.

## 18. Launch acceptance criteria

- Every eligible member has one stable, shareable referral URL.
- The UI accurately explains the 50/100 milestones and normal friend reward.
- A new Pass binds to at most one eligible referrer before Pass creation.
- The 50-Mile job is created atomically with first Pass creation and releases
  only after its hold/risk gate.
- The 100-Mile job requires an authoritative eligible purchase or redeemed
  voucher and cannot be produced by a claim, click or client payload.
- Each milestone credits Platform at most once under retries, concurrency and
  worker crashes.
- Email-only referrers receive spendable off-chain Miles.
- Limits, budget, holds and eligibility are enforced server-side from the
  referral's immutable policy version.
- Refunds/fraud can void pending jobs and reverse released jobs without
  deleting ledger history.
- Referrers cannot see a friend's email, phone, wallet, merchant, purchase or
  risk decision.
- Admins can pause, review, approve, reject, requeue and reconcile with a full
  audit trail.
- All unit, migration, concurrency, API, security and E2E tests pass.
- Seven pilot days reconcile exactly between Hub jobs and Platform ledger.
- Finance and Risk approve the launch budget, KES threshold, holds and caps.

## 19. Build order

1. Confirm Platform credit/reversal and canonical-recipient contracts.
2. Add program, code, click, referral, reward-job, risk and audit migrations.
3. Implement atomic click, Pass-binding, qualification and worker RPCs.
4. Add the Platform referral reward adapter and reconciliation lookup.
5. Extend Pass creation paths to preserve server-side referral context.
6. Connect completed Hub/merchant purchases and eligible voucher redemptions
   to the qualification RPC.
7. Implement the leased reward worker, reversal path and notifications.
8. Add admin program controls, review queue, audit and kill switches.
9. Build `/r/[code]`, `/referrals`, home card and dashboard API.
10. Add analytics, metrics, alerts, reconciliation and retention jobs.
11. Complete automated tests and internal pilot.
12. Publish Referral Terms and start controlled production rollout.

