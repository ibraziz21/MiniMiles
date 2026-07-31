# Spec: Hub Page Production Readiness, Security, and Robustness

**Package:** `packages/hub-page`  
**Status:** Proposed  
**Priority:** Launch blocker  
**Companion specs:** `merchant-shopping-quests-spec.md`,
`paid-order-recovery-spec.md`, `order-lifecycle-completion-spec.md`,
`web-push-notifications-spec.md`

---

## 0. Release decision

The Hub must not be promoted to unrestricted production traffic until every
P0 and P1 item in this spec is implemented and the release gates in section 14
pass in staging.

The production invariant is:

> Every identity, payment, order, reward, and offline credential is owned by
> one authenticated Hub account through server-verifiable evidence. No
> browser-supplied identifier is ownership proof.

This spec converts the production-readiness audit into an implementation plan.
It covers:

- verified wallet linking and identity migration;
- authenticated, server-priced M-Pesa checkout;
- private PWA/offline behavior;
- canonical walletless order ownership;
- durable job recovery;
- claw reward state validation;
- merchant availability enforcement;
- bounded Platform calls;
- security headers and deployment configuration;
- monitoring, tests, rollout, and rollback.

The existing Akiba Platform partner-quest infrastructure remains in the
codebase but stays disabled in the launch UI, as decided in
`merchant-shopping-quests-spec.md`.

## 1. Severity and launch policy

| Priority | Meaning | Launch policy |
|---|---|---|
| P0 | Account or asset ownership can be forged | Must be fixed before any production traffic |
| P1 | Payment, PII, rewards, or durable processing can fail insecurely | Must be fixed before public launch |
| P2 | Defense-in-depth, operability, or degraded-mode gap | Must be fixed before unrestricted rollout unless explicitly accepted with an owner and deadline |

### Audit traceability

| ID | Priority | Finding | Primary workstream |
|---|---:|---|---|
| PR-01 | P0 | Wallets can be linked without ownership proof | Verified wallet linking |
| PR-02 | P1 | M-Pesa status is unauthenticated and exposes payment metadata | Checkout authorization |
| PR-03 | P1 | M-Pesa initiation trusts client amount and permits prompt abuse | Server-owned checkout intents |
| PR-04 | P1 | Service worker caches authenticated HTML across users | Private offline architecture |
| PR-05 | P1 | Claimed internal-event jobs can remain stuck forever | Durable job leases |
| PR-06 | P1 | Walletless paid orders disappear from order history | Canonical order ownership |
| PR-07 | P1 | Burned/refunded claw sessions can issue vouchers | Explicit reward-state validation |
| PR-08 | P2 | Known product IDs bypass merchant availability | Atomic orderability checks |
| PR-09 | P2 | Application security headers are absent | Browser security policy |
| PR-10 | P2 | Quest Platform calls can hang and fan out excessively | Bounded upstream adapter |
| PR-11 | P2 | Push worker claim failures return HTTP 200 | Worker observability |
| PR-12 | P2 | Production environment contract is untracked and not validated | Deployment contract |

## 2. Locked architecture decisions

1. `auth.users.id` is the canonical local owner for Hub-created records.
2. Email and verified wallets are aliases of that owner, not independent
   owners.
3. A wallet address is security-sensitive only after a signed challenge or an
   equally strong trusted handoff has been verified.
4. Existing unverified wallet links remain visible during migration but cannot
   authorize a claim, voucher, order, or identity merge.
5. Checkout amount, merchant, product, voucher, and fulfillment type are
   derived by the server from a persisted checkout intent.
6. M-Pesa callback evidence is authoritative only when it matches a
   server-created checkout request owned by the current Hub user.
7. Protected HTML is never stored in a shared service-worker page cache.
8. Hub-created orders always store `hub_user_id`, including walletless orders.
9. External jobs are at-least-once and lease-based. Every side effect is
   idempotent.
10. A merchant or product must still be orderable inside the same database
    transaction that creates the order.
11. Production configuration is validated at build/startup; required secrets
    never silently fall back to another credential.
12. User-facing degradation is safe and explicit. Infrastructure failures must
    remain visible to operators through non-2xx responses, metrics, and alerts.

## 3. Workstream A — verified wallet linking

### 3.1 Data model

Add the next available forward migration after the quest-catalog migration.
The names below are illustrative; do not reuse a migration number already
present on the target branch.

Extend `hub_user_wallets`:

```text
verification_status  text not null
  check in ('legacy_unverified', 'verified', 'revoked')
verification_method  text null
  check in ('eip191', 'eip712', 'trusted_handoff', 'admin')
verified_at           timestamptz null
revoked_at            timestamptz null
```

Add:

```text
wallet_link_challenges
  id                  uuid primary key
  hub_user_id         uuid references auth.users(id)
  ecosystem           text
  address             text
  nonce_hash          text unique
  statement_hash      text
  chain_id            bigint
  expires_at          timestamptz
  consumed_at         timestamptz null
  created_at          timestamptz
```

Security requirements:

- RLS enabled.
- No direct anon/authenticated writes.
- Service-role access only.
- Challenge lifetime at most five minutes.
- Only one live challenge per `(hub_user_id, ecosystem, address)`.
- Consumed and expired challenges cannot be reused.
- Address normalization happens before uniqueness checks.

### 3.2 API contract

Replace the direct linking behavior in `POST /api/me/wallets` with two steps.

#### `POST /api/me/wallets/challenge`

Authenticated request:

```json
{
  "ecosystem": "minipay",
  "address": "0x..."
}
```

Response:

```json
{
  "challengeId": "<uuid>",
  "message": "Akiba Hub wallet link\nDomain: hub.akibamiles.com\nHub user: <opaque-id>\nWallet: 0x...\nEcosystem: minipay\nNonce: ...\nIssued at: ...\nExpires at: ..."
}
```

The signed statement must bind:

- production domain and environment;
- authenticated Hub user ID or a one-way opaque binding;
- normalized wallet address;
- ecosystem and chain ID;
- random nonce;
- issued and expiry timestamps;
- purpose: `link_wallet`.

#### `POST /api/me/wallets/verify`

Authenticated request:

```json
{
  "challengeId": "<uuid>",
  "signature": "0x..."
}
```

The server:

1. Loads the unused challenge for the current Hub user.
2. Rejects expired, consumed, environment-mismatched, or malformed challenges.
3. Recovers the signer with `viem`.
4. Compares the recovered normalized address with the challenged address.
5. Calls one atomic `link_verified_wallet` RPC that consumes the challenge and
   creates or updates the wallet link.
6. Re-emits identity enrichment only after successful verification.

Use EIP-191 initially unless a wallet requires EIP-712. A trusted MiniPay
handoff is acceptable only if it is a signed, audience-bound, short-lived
assertion issued by a service the Hub explicitly trusts.

### 3.3 Legacy `users` bridge

The wallet link operation must not update the email or membership fields of an
existing wallet-keyed `users` row.

Rules:

- If no legacy row exists, insert a minimal row through a dedicated RPC.
- If a row exists and already agrees with the authenticated identity, leave it
  unchanged.
- If its email conflicts, record an `identity_merge_incident`; do not overwrite
  either identity automatically.
- Identity reconciliation must be an audited admin operation.

### 3.4 Migration of existing links

On deploy:

1. Mark every existing row `legacy_unverified`.
2. Keep it visible in the wallet UI with a “Verify wallet” action.
3. Exclude it from `buildIdentities`, voucher ownership, reward claims, claw
   claims, and payment ownership.
4. Permit an audited backfill to `verified` only where an existing trusted
   signed handoff record proves ownership.
5. Never infer verification from matching email alone.

### 3.5 Rate limiting and abuse controls

Use a shared durable rate limiter, not an in-memory per-instance map:

- challenge creation: 5/user/10 minutes and 20/IP/hour;
- verification: 10/user/10 minutes;
- temporary lock after repeated bad signatures;
- structured security event for conflicts and replay attempts;
- no wallet, email, signature, or nonce in application logs.

### 3.6 Acceptance criteria

- A syntactically valid address without a valid signature cannot be linked.
- A signature for another Hub user, domain, environment, purpose, or expired
  challenge is rejected.
- A challenge cannot be replayed concurrently.
- Linking never overwrites an existing legacy user’s email.
- Unverified legacy wallets cannot authorize any asset or reward operation.
- Verified email-only and wallet-enabled users retain one canonical quest and
  reward history.

## 4. Workstream B — server-owned M-Pesa checkout

This workstream implements the checkout-intent direction already defined in
`paid-order-recovery-spec.md`; it is not a second payment architecture.

### 4.1 Checkout intent

Create or finish `hub_checkout_intents` with:

```text
id                    uuid primary key
hub_user_id           uuid not null references auth.users(id)
state                 text
product_id            uuid
merchant_id           uuid
voucher_id            uuid null
recipient_name        text
recipient_phone       text
city                  text null
location_details      text null
currency              text
expected_amount_kes   integer
pricing_snapshot      jsonb
checkout_request_id   text unique null
idempotency_key       text
order_id              uuid null
expires_at            timestamptz
created_at            timestamptz
updated_at            timestamptz

unique (hub_user_id, idempotency_key)
```

Fulfillment PII remains service-role-only and has a documented retention
period.

### 4.2 Initiation contract

`POST /api/payments/mpesa/initiate` accepts only a checkout-intent ID and an
idempotency key. It no longer accepts authoritative `amount_usd` or
`merchant_name`.

The server:

1. Authenticates the user.
2. Loads an unexpired intent owned by that user.
3. Revalidates merchant, product, voucher, fulfillment fields, and price.
4. Loads a current server-owned USD/KES rate with a timestamp and rejects a
   stale or invalid rate.
5. Requires a finite positive integer KES amount within configured min/max
   bounds.
6. Validates a Kenyan MSISDN, including the `254` prefix and permitted mobile
   ranges.
7. Applies user, IP, phone, and intent cooldowns.
8. Initiates exactly one STK request per idempotency key.
9. Persists the provider checkout ID before returning success.

If Daraja accepted a request but persistence fails, create a reconciliation
incident. Do not invite the customer to pay again.

### 4.3 Status contract

`GET /api/payments/mpesa/status?id=<checkout-request-id>`:

- requires a valid Hub session;
- loads `mpesa_stk_requests` with both checkout ID and
  `hub_user_id = auth.uid()`;
- returns `404` for IDs not owned by the caller;
- returns only `pending | success | failed`, sanitized reason, and order or
  recovery state;
- does not return phone number or raw receipt metadata;
- sets `Cache-Control: private, no-store`;
- is rate-limited.

Provider reconciliation should run in a worker keyed from known pending
requests. The public polling route must never become a generic authenticated
Daraja query proxy.

### 4.4 Callback hardening

- Require the configured callback authentication mechanism.
- Require the checkout ID to exist in `mpesa_stk_requests`.
- Record callbacks idempotently.
- Never allow a later failure callback to overwrite a recorded success.
- Preserve raw provider data only for the minimum operational retention period.
- Alert on unknown checkout IDs, amount mismatches, or conflicting callbacks.

### 4.5 Acceptance criteria

- A client cannot change the STK amount, merchant, or product.
- Another user’s checkout ID returns `404` and no payment metadata.
- Repeated initiate calls with one idempotency key produce at most one STK
  request.
- Rate limits prevent repeated prompts to the same phone.
- Invalid, negative, non-finite, stale-rate, and excessive amounts never reach
  Daraja.
- Callback races cannot turn a successful payment into a failed payment.
- A confirmed payment always resolves to one order, active recovery, or
  tracked refund.

## 5. Workstream C — private PWA and offline pass

### 5.1 Service-worker caching

`public/sw.js` must:

- cache immutable `/_next/static`, fonts, and public icons only;
- never cache navigation responses for `/me`, `/quests`, `/my-vouchers`,
  `/rewards`, `/welcome`, order pages, or any authenticated route;
- never use `/me` as a generic offline fallback;
- respect an explicit denylist before any `cache.put`;
- delete the old `akiba-pages-v1` cache during activation;
- support a `CLEAR_PRIVATE_DATA` message from the application.

Protected routes set:

```text
Cache-Control: private, no-store, max-age=0
```

### 5.2 Offline pass

Offline Pass support must not depend on cached server-rendered HTML.

Use a static offline shell containing no account data. If offline presentation
is retained for launch:

- save only the stable, lower-trust Pass QR payload and a non-PII label;
- keep it in a versioned, user-scoped store;
- require explicit user opt-in on shared devices;
- clearly label it as an offline fallback;
- delete it on logout, pass regeneration, account switch, or revocation;
- never store email, balance, activity, vouchers, orders, or live tokens;
- merchant tooling continues treating the static Pass as lower trust than the
  short-lived live presentation token.

### 5.3 Logout

Before completing logout:

1. Remove push subscriptions as today.
2. Send `CLEAR_PRIVATE_DATA` to the active service worker.
3. Delete Hub-owned IndexedDB/local storage records.
4. Delete legacy page caches.
5. Sign out and navigate to the public home page.

Cleanup failure must not trap the user in an authenticated session, but it
must be logged as a sanitized security event.

### 5.4 Acceptance criteria

- No protected HTML response appears in Cache Storage.
- Offline navigation after logout cannot reveal the previous user’s email,
  balance, activity, wallet, orders, or voucher data.
- An account switch cannot display the previous account’s Pass.
- The service worker never serves `/me` as fallback for another URL.
- Static assets and the approved minimal offline Pass continue to work offline.

## 6. Workstream D — canonical order ownership

### 6.1 Schema and writes

Add `hub_user_id uuid references auth.users(id)` to
`merchant_transactions`, indexed for recent-order queries.

Every Hub order-creation RPC receives `p_hub_user_id` as the canonical order
owner regardless of:

- payment rail;
- voucher use;
- wallet availability;
- whether `user_address` contains a wallet, email, or legacy ID.

`user_address` remains a compatibility/payment-evidence field and is not the
primary authorization key for new orders.

### 6.2 Reads and authorization

All member order routes, pages, confirmation actions, disputes, recovery, and
refund views first require:

```text
merchant_transactions.hub_user_id = auth.uid()
```

Legacy fallback through a verified linked wallet is permitted only for rows
whose `hub_user_id` could not be safely backfilled. The fallback must not use a
`legacy_unverified` wallet.

### 6.3 Backfill

Backfill in decreasing confidence:

1. Existing voucher ownership through `issued_vouchers.hub_user_id`.
2. Exact stored auth UUID.
3. Unique normalized auth email.
4. Unique verified wallet link.
5. Otherwise leave null and create an ownership-reconciliation report.

Never choose among multiple candidate users. Ambiguous rows require audited
manual resolution.

### 6.4 Acceptance criteria

- A walletless M-Pesa customer sees the order immediately and after relogin on
  another device.
- A user cannot read, confirm, dispute, or recover another user’s order.
- New Hub orders cannot be inserted without `hub_user_id`.
- Existing unambiguous orders are backfilled; ambiguous rows are reported.

## 7. Workstream E — durable jobs and upstream calls

### 7.1 Internal-event leases

Extend `internal_event_jobs` with explicit leasing:

```text
claimed_at       timestamptz null
claimed_by       text null
lease_expires_at timestamptz null
failed_at        timestamptz null
```

`claim_internal_event_jobs` must atomically claim:

- eligible `pending` jobs; and
- `processing` jobs whose lease expired.

The claim increments `attempts`, sets the worker ID, and creates a lease longer
than one bounded Platform request but shorter than the cron recovery target.

Completion must only succeed for the active lease owner. After the configured
attempt limit, move the job to `failed`; do not retry forever.

Add:

- a failed-job admin/replay path;
- alerting on oldest pending age, expired leases, and failed count;
- a kill-the-worker integration test proving recovery.

### 7.2 Push worker failures

`processPushJobs` must distinguish:

- no eligible jobs: successful zero-work response;
- configuration error: non-2xx or explicit unhealthy response;
- database claim error: throw and return 5xx;
- per-job delivery error: complete/retry the claimed job and continue.

Every RPC response used to complete/retry a job must be checked. The cron
route returns `ok: true` only when the claim operation succeeded.

### 7.3 Bounded Platform adapter

Centralize Hub-to-Platform calls in one server-only adapter:

- request deadline with `AbortSignal.timeout`;
- bounded concurrency;
- sanitized error mapping;
- correlation/request ID;
- retry only idempotent reads and event sends;
- no retry for claim POST unless Platform accepts an idempotency key;
- circuit-breaker or short degraded-mode cache for repeated upstream failure.

Replace the per-quest/per-identity fan-out with a bulk status endpoint where
possible:

```text
POST /api/v1/hub/quest-status
  identities[]
  questIds[]
  period
```

Until the bulk endpoint exists, cap total upstream requests and return
`verifying` after the deadline. Claim remains unavailable when authoritative
ownership cannot be checked.

### 7.4 Acceptance criteria

- A worker killed after claim does not strand an event permanently.
- Duplicate execution produces one Platform completion/reward.
- Database claim failure causes the cron endpoint to return 5xx.
- A stalled Platform cannot hold a Hub page or API request beyond the defined
  deadline.
- A Platform outage preserves local quest progress and shows a degraded state.

## 8. Workstream F — reward and merchant integrity

### 8.1 Claw reward states

Replace `status >= Settled` with an explicit allowlist.

Launch rule:

```text
claimable on-chain status = Settled (2) only
rejected = None, Pending, Claimed, Burned, Refunded
```

If contract semantics require `Claimed` for Hub voucher issuance, document and
test that transition before changing the allowlist. Do not infer eligibility
from numeric ordering.

Retain the unique `source_ref`, and verify:

- configured chain and contract;
- verified wallet ownership;
- exact eligible state;
- allowed reward class;
- non-zero voucher ID;
- reward not previously consumed, burned, or refunded.

### 8.2 Atomic merchant orderability

Create a canonical database function used by:

- public merchant/product reads;
- checkout-intent creation;
- payment initiation;
- final order placement.

An orderable product requires:

- product active;
- partner published/approved;
- partner not hidden or suspended;
- `partner_settings.store_active = true`;
- configured merchant wallet for the chosen rail;
- current product price and fulfillment configuration.

The final order-placement transaction rechecks these conditions. If payment
was already confirmed and the merchant becomes unavailable, create a recovery
or refund incident instead of silently dropping the order or charging again.

### 8.3 Acceptance criteria

- Burned and refunded claw sessions never issue a voucher.
- One claw session/reward can issue at most one voucher under concurrency.
- A known product ID cannot order from a hidden, suspended, unpublished, or
  inactive store.
- Merchant status changing between quote and placement produces a tracked
  recovery/refund path.

## 9. Workstream G — browser and API security baseline

### 9.1 Headers

Add headers centrally in `next.config.mjs` or middleware:

```text
Content-Security-Policy
  default-src 'self'
  object-src 'none'
  base-uri 'self'
  frame-ancestors 'none'
  form-action 'self'
  script-src with Next-compatible nonces/hashes
  connect-src limited to required Supabase, Platform, and wallet endpoints
Strict-Transport-Security: max-age=31536000; includeSubDomains
X-Content-Type-Options: nosniff
Referrer-Policy: strict-origin-when-cross-origin
Permissions-Policy: camera=(), microphone=(), geolocation=(self), payment=(self)
```

Roll CSP out in report-only mode in staging first. Remove unexpected inline
scripts or add framework-supported nonces; do not ship a permanent
`unsafe-eval` production policy.

### 9.2 Input and response policy

- Use shared schemas for request bodies, query parameters, lengths, enums, and
  numeric ranges.
- Reject ambiguous payment inputs, including both crypto and M-Pesa evidence.
- Return generic 5xx messages; log sanitized internal error codes server-side.
- Add `private, no-store` to authenticated responses.
- Never return phone numbers, service errors, raw callbacks, wallet signatures,
  secret-derived tokens, or fulfillment details unless the endpoint contract
  explicitly requires them.
- Apply durable rate limits to payment, wallet-link, pass-regeneration, quest
  proof/claim, claw, raffle, grant, and other externally expensive endpoints.

### 9.3 Acceptance criteria

- Automated header tests pass on public and protected pages.
- CSP report-only produces no unexplained violations in the staging journey.
- Error responses do not expose Supabase, Daraja, RPC, or stack details.
- Oversized and malformed bodies return bounded 4xx responses.

## 10. Workstream H — production configuration

### 10.1 Tracked environment contract

Commit `packages/hub-page/.env.example`; do not use the ignored
`.env.local.example` filename.

Document every variable by feature and environment, including:

- Supabase public and service credentials;
- Akiba Platform URL, service keys, quest IDs, and partner webhook values;
- Hub Pass and internal worker secrets;
- directory revalidation secret;
- Celo RPC and contract addresses;
- M-Pesa environment, consumer credentials, shortcode, passkey, callback URL,
  callback secret, and exchange-rate source;
- web-push VAPID values;
- public Hub and React-app origins.

Placeholders only. Never commit real credentials or production identifiers
that should remain private.

### 10.2 Runtime validation

Add a server-only environment schema with:

- URL and origin validation;
- minimum secret entropy/length;
- address and UUID validation;
- explicit `MPESA_ENV = sandbox | production`;
- production callback host allowlist;
- no localhost upstreams in production;
- no secret fallback from `HUB_PASS_SECRET` to `SUPABASE_SERVICE_KEY`;
- feature-specific requirements.

Required production configuration fails deployment/startup. Optional features
must be explicitly disabled and hidden rather than failing silently at runtime.

### 10.3 Secret operations

- Separate sandbox, preview, and production credentials.
- Rotate shared service keys into purpose-specific credentials.
- Document rotation without downtime for Platform, callback, cron, pass, and
  VAPID keys.
- Redact secrets and PII from Vercel logs, traces, errors, and support exports.

### 10.4 Acceptance criteria

- A clean clone contains a complete, placeholder-only `.env.example`.
- CI rejects missing or malformed required variables.
- Production cannot start with sandbox M-Pesa or localhost Platform URLs.
- No credential silently substitutes for another credential.

## 11. Observability and operational readiness

### 11.1 Structured telemetry

Every request and job carries a correlation ID. Record sanitized structured
events for:

- wallet challenge created/verified/rejected/replayed;
- STK initiated, callback accepted, amount mismatch, status polled;
- checkout confirmed, order created, recovery opened, refund tracked;
- internal/reward/push job claimed, completed, retried, lease expired, failed;
- Platform deadline/circuit state;
- offline-cache cleanup failure;
- claw claim accepted/rejected by reason.

Do not log email, full wallet address, phone, signature, nonce, fulfillment
address, raw callback, auth token, or secret.

### 11.2 Metrics and alerts

Minimum production metrics:

```text
wallet_link_verification_failure_rate
mpesa_stk_initiate_rate_by_user_and_phone
mpesa_confirmed_without_order_count
payment_confirmed_to_order_created_seconds
order_recovery_age_seconds
internal_event_oldest_pending_seconds
internal_event_expired_lease_count
internal_event_failed_count
push_claim_error_count
platform_request_latency_and_timeout_rate
claw_rejected_terminal_state_count
```

Page an operator for:

- any confirmed payment without order/recovery/refund after five minutes;
- internal event oldest age above ten minutes;
- repeated worker claim failures;
- M-Pesa callback amount conflict;
- sustained Platform timeout rate;
- a production environment validation failure.

### 11.3 Runbooks

Ship runbooks for:

- paid order missing after M-Pesa success;
- wallet ownership conflict;
- stuck/failed internal event replay;
- Platform outage;
- callback credential rotation;
- service-worker rollback/cache eviction;
- reverting a forward-only migration safely.

## 12. Test strategy

### 12.1 Unit and route tests

Add tests for:

- wallet challenge binding, expiry, replay, wrong signer, wrong user, and
  conflicting legacy identity;
- M-Pesa status authentication and cross-user isolation;
- initiation amount derivation, phone validation, idempotency, and throttling;
- claw explicit status matrix;
- merchant availability matrix;
- Platform timeout and degraded quest states;
- push claim error returning 5xx;
- authenticated response cache headers;
- environment validation.

### 12.2 Database integration tests

Add concurrency and migration tests for:

- consuming one wallet challenge exactly once;
- uniqueness of verified wallet ownership;
- no legacy email overwrite;
- canonical `hub_user_id` order writes and backfill;
- two simultaneous order placements;
- internal-event lease expiry and reclaim;
- dead-letter transition;
- claw source-ref uniqueness;
- merchant suspension between quote and order placement;
- callback success/failure reordering.

### 12.3 Browser/E2E tests

Required staging journeys:

1. Email-only member completes and claims a Hub-native quest.
2. Member links MiniPay/Base through a real signed challenge.
3. Wrong-wallet and replay attempts fail.
4. Walletless M-Pesa purchase remains visible after refresh and second-device
   login.
5. Another user cannot poll the checkout status.
6. Shared-browser logout followed by offline navigation exposes no prior PII.
7. Offline static Pass works only under the approved minimal-data policy.
8. Suspended merchant checkout is rejected or enters paid recovery.
9. Worker is killed after claim and the event is reclaimed once.
10. Platform timeout degrades quest status inside the response deadline.

### 12.4 Continuous gates

CI must run:

```text
pnpm exec tsc --noEmit
pnpm lint
pnpm test
pnpm test:integration
pnpm build
production dependency audit
migration apply on an empty database
migration apply on an anonymized production-shape snapshot
```

No critical/high production dependency advisory may ship without a written,
time-bounded exception.

## 13. Implementation and rollout order

### Phase 0 — controls and feature gates

- Commit environment contract and validation.
- Add correlation IDs, metrics plumbing, and durable rate-limit primitive.
- Add feature flags for wallet linking, M-Pesa initiation, offline Pass,
  Hub-native quest claims, and claw voucher issuance.
- Disable affected flows if their required production configuration is absent.

**Gate:** staging deploy fails closed with intentionally missing configuration.

### Phase 1 — ownership boundary

- Ship wallet challenges, verification RPC, and legacy-unverified migration.
- Update every ownership helper to use verified wallets only.
- Remove the legacy `users.email` overwrite.
- Add identity-conflict admin/runbook support.

**Gate:** PR-01 acceptance suite passes before quest claims or wallet-owned
voucher flows are enabled.

### Phase 2 — payment and order ownership

- Finish checkout intents and server pricing.
- Authenticate and scope M-Pesa status.
- Add rate limits and idempotency.
- Add canonical `merchant_transactions.hub_user_id` and backfill.
- Wire paid recovery/refund invariant.

**Gate:** M-Pesa sandbox end-to-end, cross-user tests, reload recovery, and
walletless order-history tests pass.

### Phase 3 — private offline behavior

- Replace page-navigation caching with static-shell caching.
- Add minimal offline Pass storage or disable offline Pass until ready.
- Purge old caches and private data at logout/account switch.
- Add protected response cache headers.

**Gate:** shared-device/offline E2E test passes in all supported browsers.

### Phase 4 — integrity and durability

- Add internal-event leases and dead-lettering.
- Correct push-worker failure status.
- Add bounded Platform adapter/bulk status.
- Enforce claw status allowlist.
- Recheck merchant orderability atomically.

**Gate:** crash/reclaim, upstream timeout, terminal claw state, and merchant
status race tests pass.

### Phase 5 — browser hardening and canary

- Roll CSP from report-only to enforcing.
- Enable remaining security headers.
- Run credential rotation rehearsal and operational runbooks.
- Deploy to internal accounts, then a small production cohort.
- Observe payment, worker, error, and latency metrics before expansion.

**Gate:** section 14 is signed off.

## 14. Production launch checklist

### Mandatory code and data gates

- [ ] PR-01 through PR-07 are closed with automated regression tests.
- [ ] PR-08 through PR-12 are closed or have an explicit owner, deadline, and
      documented launch acceptance.
- [ ] Existing wallet links are classified; none silently become verified.
- [ ] Existing orders are backfilled or appear in the reconciliation report.
- [ ] All forward migrations pass empty and production-shape database tests.
- [ ] Rollback/disable flags exist for wallet linking, M-Pesa, offline Pass,
      quest claims, and claw issuance.

### Mandatory quality gates

- [ ] Typecheck, lint, unit, integration, build, and E2E suites pass.
- [ ] Production dependency audit has no unresolved critical/high findings.
- [ ] Header and private-cache tests pass.
- [ ] Load test covers payment status polling, quest status, and cron workers.
- [ ] No secrets or PII appear in logs or client bundles.

### Mandatory operational gates

- [ ] Production environment validation passes with purpose-specific secrets.
- [ ] M-Pesa production callback and reconciliation are verified with a
      controlled low-value transaction.
- [ ] Alerts and dashboards receive staging test signals.
- [ ] Paid-order, wallet-conflict, worker-replay, Platform-outage, and
      service-worker rollback runbooks are rehearsed.
- [ ] Database backup and point-in-time recovery are enabled and tested.
- [ ] Named on-call owner is available during canary and first public rollout.

## 15. Definition of done

The Hub is production-ready when:

1. An authenticated account cannot acquire another person’s wallet, payment,
   order, voucher, or reward through a supplied identifier.
2. A confirmed payment cannot disappear and cannot cause a second charge
   during recovery.
3. Email-only members can use quests, orders, vouchers, and balances without a
   wallet-specific data-loss path.
4. Logout and account switching leave no prior account HTML or PII available
   offline.
5. Worker crashes and upstream outages recover predictably without silent
   success.
6. Merchant and reward terminal states are enforced in database-backed,
   concurrency-safe operations.
7. Production configuration, security policy, telemetry, and runbooks are
   validated before traffic is expanded.

Passing the existing build and test suites is necessary but not sufficient;
the new security, concurrency, browser, and operational tests in this spec are
part of the release contract.
