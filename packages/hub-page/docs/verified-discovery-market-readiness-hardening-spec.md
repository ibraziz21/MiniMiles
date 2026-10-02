# Verified Discovery Market-Readiness Hardening Specification

- **Primary package:** `packages/hub-page`
- **Supporting packages:** `packages/admin-dashboard`, `supabase`
- **Status:** Proposed implementation contract
- **Date:** 2026-10-02
- **Related specifications:**
  - `verified-discovery-acquisition-v1-spec.md`
  - `merchant-discovery-media-and-intelligence-spec.md`
  - `merchant-directory-in-store-discovery-spec.md`

---

## 0. Executive decision

The verified-visit contribution, customer-photo, merchant-page and Discovery
spotlight features are functionally complete enough for a controlled pilot.
They are not yet ready for unrestricted market rollout.

Market readiness requires five changes:

1. make current earning eligibility a mandatory public-photo predicate;
2. replace the latest-500 application scan with a complete, durable public
   projection;
3. make photo upload completion deterministic and independent from foreground
   image processing;
4. make moderation decisions and their audit records atomic; and
5. add database-level lifecycle tests, production telemetry and staged rollout
   gates.

This document is a hardening addendum. It does not change the product decision
that one approved customer photo is enough to appear in `Verified visits`.
It distinguishes that individual-photo rule from aggregate claims such as
`What people loved`, which still require the privacy and confidence thresholds
in the parent specification.

### 0.1 Release recommendation

- **Controlled pilot:** allowed after all P0 gates in §3 pass.
- **Broad market rollout:** allowed only after all P0 and P1 gates pass and the
  shadow projection has remained healthy for seven consecutive days.
- **Feature kill switch:** must hide the affected public proof surface without
  disabling merchant search, merchant profiles, Miles or vouchers.

---

## 1. Market-ready definition

The feature is market ready when it is:

- **correct:** no withdrawn, reversed, disputed, suppressed or otherwise
  ineligible contribution can produce public proof;
- **private:** public payloads contain only approved derivatives and explicitly
  allowed anonymous fields;
- **complete:** ranking and counts operate over the full eligible corpus, not a
  recent arbitrary scan window;
- **durable:** uploads, processing, moderation, projection and audit transitions
  survive retries, crashes and concurrent requests;
- **observable:** Operations can detect queue lag, projection drift, processing
  failures and takedown failures before customers report them;
- **performant:** discovery proof does not block the primary home or merchant
  experience and meets the parent specification's mobile budgets; and
- **reversible:** independent flags can disable contribution entry, public
  customer photos, merchant-page verified visits and the Discovery spotlight.

Passing lint, type checking and component tests alone is not sufficient. The
release gate includes real PostgreSQL migration/RPC tests and lifecycle tests
that cover approval, reversal, reinstatement and withdrawal.

---

## 2. Scope and non-goals

### 2.1 In scope

- Public eligibility for verified recommendations and customer photos.
- Merchant-page `Verified visits` projection.
- Home/Discovery verified-photo spotlight and ranking.
- Customer-photo upload, processing, retry and abandonment handling.
- Admin customer-photo moderation and immutable audit evidence.
- Public snapshot generation and freshness.
- Security, privacy, performance, accessibility and operational release gates.
- Backfill and migration of existing pilot contributions and approved photos.

### 2.2 Non-goals

- Merchant-authored media creation or editing.
- Public free-text reviews, ratings, customer identities or profiles.
- Automated face recognition or biometric processing.
- Merchant moderation of customer photos.
- A paid ranking product.
- Phase B external social-post ingestion.
- Redesigning the already-approved merchant profile tab interaction.

---

## 3. Release gates and priority

| Priority | Gate | Required outcome |
|---|---|---|
| P0 | Active evidence enforcement | Reversed, disputed, withdrawn or suppressed evidence cannot return a public visit or photo |
| P0 | Safe aggregate claims | Discovery labels, items and count displays obey public thresholds and never imply a multi-person trend from one response |
| P0 | Atomic moderation audit | Every successful moderation transition has an immutable same-transaction audit event |
| P0 | Database lifecycle tests | Migrations 081 onward apply cleanly and eligibility/RPC transitions pass against PostgreSQL |
| P0 | Upload completion safety | A member cannot leave the flow while a browser upload is unfinished without an explicit warning or cancellation outcome |
| P1 | Full-corpus projection | Ranking and counts do not use an application-side 500-row cap |
| P1 | Durable projection worker | Public snapshots retry after failure and expose measurable lag |
| P1 | Deterministic photo worker | Completing photo A never synchronously claims unrelated photo B |
| P1 | Production telemetry | Queue, moderation, projection, publication and takedown health are observable and alerted |
| P1 | Shadow and canary rollout | New and old results are compared before public cutover |
| P2 | Maintainability cleanup | Large client components and duplicated projection logic are split behind tested domain interfaces |

P0 failures block every public rollout. P1 failures block broad rollout but may
be accepted temporarily for a named, size-limited pilot with an expiry date.

---

## 4. Non-negotiable invariants

### 4.1 Public verified recommendation

A recommendation card is public only when all conditions are true at read or
snapshot-generation time:

1. the merchant is active and directory-published;
2. the merchant has public structured proof enabled;
3. the contribution is not withdrawn;
4. the request state is `submitted`;
5. the linked earning event is `active`;
6. the contribution is an explicit positive recommendation; and
7. no merchant, contribution or content suppression is active.

### 4.2 Public verified customer photo

A customer photo is public only when all recommendation eligibility conditions
that establish provenance remain true, and:

1. customer photos are enabled for the merchant;
2. `moderation_status = 'approved'`;
3. both safe derivative keys exist;
4. the photo itself is not withdrawn, reported for emergency review or
   suppressed; and
5. only derived objects are signed or returned.

Moderation approval and earning eligibility are independent facts. Approval
means the image passed policy review. It does not keep the image public after
its verified-visit evidence becomes ineligible.

Reinstating an earning event may make the photo eligible again without a new
moderation decision, provided the photo remains approved and unsuppressed.

### 4.3 Public aggregate claims

One approved active photo may appear immediately. That rule does not unlock
aggregate claims.

- Individual visit cards may show that visit's template-owned public labels.
- Discovery-level `What people loved` labels require at least five unique
  eligible contributors and at least 20% of eligible tag respondents in the
  active window.
- A Discovery `recommended item` claim requires the customer-favourite
  threshold from the parent spec, currently five unique eligible contributors
  in 90 days.
- Counts below the public exact-count threshold are banded rather than exact.
  For example, one to four contributions render `New from verified visits`,
  not `1 verified visit`.
- Same-member, same-merchant, same-day activity contributes at most once to
  ranking and public aggregate thresholds.

### 4.4 Fail-closed behavior

- An eligibility lookup failure returns no verified proof; it never falls back
  to an approved-photo-only query.
- A signing failure omits the image and records telemetry.
- A stale snapshot may omit newly eligible proof, but it may never publish
  currently ineligible proof.
- The home spotlight failing must not remove search, filters, generic merchant
  discovery or navigation.

---

## 5. Target architecture

### 5.1 Canonical eligibility projection

Add one private database projection, implemented as a view or stable SQL
function, for active public customer photos. A suggested name is:

```text
eligible_public_merchant_visit_photos
```

It joins:

```text
merchant_visit_photos
  → merchant_discovery_contributions
  → discovery_contribution_requests
  → verified_earning_events
  → merchant_discovery_settings
  → partner_settings / partners
```

It returns only:

```text
photo_id
contribution_id
partner_id
thumbnail_key
display_key
approved_at
qualified_item_id null
```

The predicates in §4 live inside this projection. Hub code must not recreate
the predicate in separate merchant-page and Discovery queries.

The projection:

- has RLS enabled or is exposed only through a `SECURITY DEFINER` function;
- revokes access from `PUBLIC`, `anon` and `authenticated`;
- grants only the minimal service role used by Hub;
- has a fixed `search_path`;
- never returns `hub_user_id`, source keys, moderation reasons, raw labels,
  event identifiers, amounts or timestamps other than safe ordering metadata;
- is covered by PostgreSQL tests for every eligibility state.

Public URLs remain short-lived server-signed URLs generated from the returned
derivative keys. Database object keys never cross the public API boundary.

### 5.2 Durable merchant discovery snapshots

Add or complete the parent spec's public snapshot read model. The recommended
V1 table is:

```text
merchant_discovery_public_snapshots
  partner_id                         uuid primary key
  ranking_version                    integer not null
  active_positive_unique_count       integer not null
  public_count_band                  text null
  qualified_experience_labels        jsonb not null
  qualified_recommended_items        jsonb not null
  cover_photo_id                     uuid null
  rank_score                         numeric not null
  source_window_start                timestamptz not null
  source_window_end                  timestamptz not null
  generated_at                       timestamptz not null
  source_watermark                   text null
  suppression_reason                 text null
```

Exact internal counts may be stored for ranking but are not automatically
public fields. Public responses expose only approved bands and qualified
labels.

Snapshot refresh operates over the complete eligible corpus. No application
query may impose a fixed contribution scan cap before grouping merchants.

### 5.3 Ranking V1

The first market-ready ranking stays intentionally explainable:

1. require a published active merchant and at least one currently eligible
   approved customer photo;
2. count unique active positive contributors in the configured 90-day window,
   applying the same-member/day deduplication rule;
3. order descending by that count;
4. break ties by most recent eligible approved photo;
5. break any remaining tie by stable `partner_id` ordering.

Engagement, vouchers, merchant media volume and payment do not influence this
ranking version. Any later confidence or recency model requires a version bump,
offline evaluation and updated explanation copy.

The response field should be named `verifiedRecommendationBand` rather than
`verifiedVisitCount` unless it truthfully represents all verified visits.

### 5.4 Projection jobs

Add a durable per-merchant projection queue:

```text
merchant_discovery_projection_jobs
  id
  partner_id
  status              // pending | processing | done | failed
  attempts
  reason
  next_retry_at
  locked_at
  created_at
  updated_at
```

Enqueue or coalesce a partner refresh after:

- contribution submit or withdrawal;
- earning-event reversal, dispute or reinstatement;
- photo approval, rejection, withdrawal or suppression;
- discovery participation-setting changes;
- merchant publish, suspend or deactivate transitions; and
- canonical item qualification, merge or suppression.

Workers claim jobs with `FOR UPDATE SKIP LOCKED`, use bounded batches and
reclaim stale processing leases. Repeated events for one partner coalesce into
one pending refresh. A cron or scheduled worker is the durable path; a
best-effort immediate refresh may reduce latency but is never the only path.

Before serving a snapshot photo, the public read contract revalidates the photo
against the canonical eligibility projection. This is the safety barrier that
prevents stale snapshots from publishing reversed or withdrawn evidence.

### 5.5 Photo processing jobs

The browser completion endpoint must:

1. authenticate the member and verify contribution/photo ownership;
2. verify the uploaded object exists at the server-derived private key;
3. atomically move the photo from `uploading` to `processing` and enqueue its
   exact processing job;
4. return `202 Accepted` with the photo id and a stable processing state; and
5. perform no arbitrary queue claim inside the foreground request.

The worker owns decoding, dimension checks, metadata stripping, re-encoding,
derivative upload and transition to `pending` moderation. Duplicate completion
requests are idempotent and return the current state. A worker crash leaves a
reclaimable lease, not a permanently stranded photo.

The deployment must run the worker in every environment where uploads are
enabled. Local development may expose an explicit developer worker command;
production behavior must not depend on a browser request doing worker work.

### 5.6 Atomic moderation and audit

Extend the moderation transition RPC so the following happen in one database
transaction:

1. lock and validate the photo's current state;
2. validate the action and an allowlisted rejection reason;
3. apply the state transition;
4. insert an immutable domain audit event containing actor, action, target,
   safe before/after state, reason code and request correlation id; and
5. enqueue the merchant projection refresh.

The API returns success only if all five operations commit. A best-effort copy
to the general `admin_audit_logs` table may remain for unified search, but the
domain audit event is the authoritative record and cannot be updated or
deleted through application roles.

Admin moderation requests additionally require:

- `discovery.write` authorization;
- same-origin validation in addition to strict cookies;
- UUID validation;
- an enum rejection reason with a 64-character maximum;
- generic client errors with detailed server-only logs; and
- rate limiting appropriate to an authenticated admin workflow.

---

## 6. Member experience contract

### 6.1 Upload states

The photo step uses explicit per-file states:

```text
selected → requesting_upload → uploading → queued → submitted_for_review
                                      ↘ failed
```

- `Done` is disabled while any file is `requesting_upload` or `uploading`.
- The member may cancel an unfinished file; cancellation withdraws any created
  server row on a best-effort basis and the stale-upload reaper remains the
  durable fallback.
- Once the server has returned `202` and the job is durable, the member may
  leave. The UI says `Submitted for review`; it does not wait for moderation.
- A processing failure shows a retry/remove path without affecting the already
  saved structured contribution.
- Client-side file type and size checks provide fast feedback, but server and
  storage enforcement remain authoritative.
- Selecting the same file again after a failure works.

### 6.2 Dismissal and navigation

- `Not now` navigates away only after a successful dismissal response.
- A network or server failure leaves the member on the page with Retry and
  Cancel controls.
- Double-taps and request retries are idempotent.
- Navigation during a browser upload requires either cancellation confirmation
  or completion of that upload.

### 6.3 Accessibility

- Upload status changes are announced through a polite live region.
- Errors identify the affected photo and recovery action.
- Controls retain a minimum 44×44 CSS-pixel target.
- The complete flow works at 320px, 200% zoom and by keyboard/screen reader.
- Focus moves to the first error on failed submission and returns predictably
  after dialogs.

---

## 7. Security and privacy hardening

### 7.1 Storage and media

- Source and derivative buckets remain private.
- Signed upload intents bind user, contribution, generated object prefix,
  allowed content type, maximum 10 MB size and a maximum five-minute lifetime.
- The worker validates decoded content and magic bytes rather than trusting the
  client MIME type or extension.
- Decoding has explicit input byte, pixel, dimension, memory and wall-time
  limits.
- Derivatives are re-encoded without metadata and originals are never served.
- Public customer-photo signed URLs have a maximum 15-minute lifetime and
  private/no-store response caching unless the storage layer supports immediate
  revocation.
- Emergency suppression quarantines or removes public derivatives so retained
  signed URLs stop working within five minutes.
- No user-controlled value can choose a bucket or object key.

### 7.2 Authorization

- Member reads and mutations remain scoped by authenticated `hub_user_id` at
  the mutation statement, not only a preceding lookup.
- Internal earning and worker routes use rotated secrets or service assertions
  and timing-safe comparison.
- Public clients never receive raw contribution, earning-event or moderation
  rows.
- Every security-definer function fixes its search path and revokes execution
  from anonymous/authenticated roles.

### 7.3 Privacy-safe telemetry

Telemetry may contain merchant id, photo/job id, state, error class, duration
and correlation id. It must not contain:

- image bytes or signed URLs;
- private object keys;
- member email, wallet or public identity;
- raw item labels or negative feedback; or
- moderation notes beyond an allowlisted reason code.

### 7.4 Automated dependency and static checks

The release pipeline runs secret scanning, dependency vulnerability scanning
and static analysis. A critical or high-severity finding blocks release unless
Security records a time-bounded exception and compensating control.

---

## 8. Observability and operational readiness

### 8.1 Required metrics

At minimum, emit:

- contribution create/submit/withdraw/dismiss counts and error rates;
- upload intent, upload completion, abandonment and client cancellation rates;
- photo processing queue depth, oldest age, attempt count and terminal failure;
- processing duration, rejection category and derivative generation failures;
- moderation queue depth, oldest age, approve/reject rate and audit failures;
- projection queue depth, oldest age, refresh duration and failed partners;
- current snapshot lag and shadow-result mismatch rate;
- public proof query duration, signing failures and fail-closed omissions;
- reversal/withdrawal-to-public-removal duration; and
- spotlight impressions and merchant exposure concentration.

### 8.2 Alerts

Page or notify the owning team when:

- an ineligible photo is detected in a public response;
- any moderation transition lacks its domain audit event;
- a projection or photo job is stuck in `processing` beyond its lease;
- projection lag exceeds 15 minutes for 15 consecutive minutes;
- withdrawal/reversal removal exceeds 60 minutes;
- emergency suppression exceeds five minutes;
- terminal processing failures exceed 2% over 30 minutes; or
- spotlight/public proof error rate exceeds 2% over 15 minutes.

### 8.3 Operational tools

Operations needs documented, authorized commands or admin actions to:

- inspect and retry a photo-processing job;
- inspect and retry a merchant projection;
- suppress a photo or merchant proof surface immediately;
- verify whether a contribution/photo is currently public-eligible;
- compare source state with the current snapshot; and
- rebuild one merchant or the full pilot cohort without exposing private data.

Every action writes an immutable audit event. Runbooks identify the owning team,
alert channel, rollback decision and customer-support message.

---

## 9. Performance and scale contract

- Home and merchant pages never fetch raw contribution sets to count them in
  application memory.
- The spotlight uses one bounded snapshot query plus one batched photo-signing
  operation; it performs no per-card database queries.
- Snapshot and eligibility predicates have indexes verified with production-
  shaped `EXPLAIN (ANALYZE, BUFFERS)` plans.
- A load fixture with at least 100,000 contributions, 10,000 photos and 1,000
  merchants produces the same top results as an uncapped reference query.
- At the expected launch dataset, the server-side spotlight data query has p95
  below 250 ms excluding image transfer.
- Optional proof sections have independent timeouts and failure boundaries.
- Existing p75 mobile targets remain LCP under 2.5 s, INP under 200 ms and CLS
  under 0.1.

---

## 10. Migration and backfill

### 10.1 Forward migration

Create one new numbered migration after the current verified-discovery
migrations. It must:

1. add the canonical eligible-photo projection;
2. add public snapshot and projection-job tables;
3. add indexes, RLS, grants and immutable audit storage;
4. replace/extend transition RPCs without breaking current callers;
5. enqueue a backfill job for every currently published pilot merchant; and
6. be safe to run once against the current production schema.

Do not edit already-applied migrations 081–089 to deliver this change.

### 10.2 Backfill

- Build snapshots from current source-of-truth rows, not from current public
  responses.
- Exclude withdrawn contributions, ineligible requests and reversed/disputed
  events during the initial query.
- Record generation time, ranking version and source watermark.
- Produce a reconciliation report containing counts only: eligible merchants,
  eligible photos, excluded photos by reason and failed merchants.
- Do not log member identities or raw response data.

### 10.3 Rollback

The safety predicate is a one-way hardening change and is not rolled back.
If the new snapshot path fails:

- disable the Discovery spotlight;
- hide verified public proof or fall back to the canonical fail-closed
  eligibility query for a bounded pilot; and
- keep contribution capture and private moderation operational if healthy.

Rollback must never re-enable the approved-photo-only public query or the
latest-500 ranking path.

---

## 11. Test plan

### 11.1 PostgreSQL migration and RPC tests

Run against disposable PostgreSQL with Supabase roles represented:

- migrations 081 through the hardening migration apply in order;
- the hardening migration applies to a fixture representing the current live
  schema and preserves existing rows;
- rerunnable objects are idempotent where intended;
- anonymous and authenticated roles cannot read source tables or execute
  privileged functions;
- service role access is limited to documented objects;
- contribution submission remains atomic and idempotent under concurrency;
- photo completion creates exactly one job under duplicate requests;
- concurrent workers cannot claim the same job;
- stale jobs are reclaimed without resurrecting withdrawn photos;
- a moderation transition and domain audit event commit or roll back together;
- projection enqueueing coalesces repeated merchant changes; and
- snapshot ranking over more than 500 contributions matches the reference
  aggregate exactly.

### 11.2 Eligibility lifecycle matrix

Every public merchant and Discovery query must pass this matrix:

| Scenario | Visit public | Photo public |
|---|---:|---:|
| Submitted positive + active earning + approved photo | Yes | Yes |
| Photo pending/rejected/withdrawn | Yes | No |
| Contribution withdrawn | No | No |
| Earning reversed | No | No |
| Earning disputed | No | No |
| Reinstated, contribution retained, photo still approved | Yes | Yes |
| Merchant proof disabled | No | No |
| Customer photos disabled only | Visit per setting | No |
| Merchant suspended/unpublished | No | No |
| Emergency photo suppression | Visit may remain | No |
| Stale snapshot referencing now-ineligible photo | No | No |

### 11.3 API security tests

- unauthenticated requests receive `401`;
- cross-origin member and admin mutations receive `403`;
- member A cannot read, mutate, complete or delete member B's contribution or
  photo;
- object keys and contribution/user identity cannot be overridden by input;
- unsupported type, forged MIME, corrupt image, excessive dimensions and
  oversized files fail safely;
- rate limits and retry responses are deterministic;
- internal endpoints reject missing, old and malformed credentials; and
- public responses contain no identity, source key, earning id, raw label,
  negative response or moderation reason.

### 11.4 Client and accessibility tests

- `Done` is disabled during browser upload and enabled once every file is
  durable or removed;
- upload error, retry, same-file reselection and cancellation work;
- dismissal failure does not silently navigate away;
- keyboard and screen-reader users can complete the flow and gallery;
- modal focus is trapped and restored;
- 320, 375 and 430 px layouts have no horizontal overflow; and
- reduced motion, 200% zoom and slow-network states remain usable.

### 11.5 End-to-end tests

1. ingest a verified earning event;
2. create and submit a contribution;
3. upload and process a photo;
4. approve it as an authorized admin;
5. observe it on the merchant page and eligible Discovery spotlight;
6. reverse the earning and observe removal from both surfaces;
7. reinstate the earning and observe republishing after projection refresh;
8. withdraw the contribution and confirm permanent public removal; and
9. verify an immutable audit trail for every privileged transition.

---

## 12. Rollout plan

### Phase A — safety patch

- Deploy the canonical eligibility projection.
- Switch merchant-page customer photos to it.
- Enforce aggregate thresholds/bands in the existing spotlight.
- Add the atomic moderation audit transition.
- Add lifecycle database tests.
- Keep public spotlight behind its current kill switch.

### Phase B — durable projection in shadow mode

- Deploy snapshot tables, job queue, worker and backfill.
- Compute V2 without serving it.
- Compare eligibility, ranking, labels, items and cover photo with a complete
  reference query.
- Investigate every case where V2 would expose more content than the canonical
  eligibility result.
- Require seven consecutive healthy days with zero unsafe mismatches.

### Phase C — canary

- Serve V2 to internal/test accounts, then 10% of public traffic.
- Increase to 50% only if error, latency, queue-lag, removal-SLA and exposure-
  concentration guardrails remain healthy for 48 hours.
- Increase to 100% after a second explicit Engineering and Operations review.

### Phase D — broad launch

- Remove the old latest-500 code path.
- Retain flags, reconciliation and repair tooling.
- Review ranking concentration, moderation capacity, report rate and mobile
  performance weekly for the first month.

---

## 13. Implementation sequence

1. **Data safety:** canonical eligibility projection and reversal/withdrawal
   lifecycle tests.
2. **Public reads:** merchant page and existing spotlight consume the canonical
   projection and threshold-safe fields.
3. **Moderation:** atomic domain audit and stricter admin mutation validation.
4. **Upload reliability:** decouple completion from processing; update member
   upload states and navigation guards.
5. **Scale:** snapshot schema, projection queue, worker, backfill and shadow
   comparison.
6. **Operations:** dashboards, alerts, repair actions and runbooks.
7. **Release:** canary, performance validation and removal of legacy paths.

The first four steps form the P0 safety release. Scale and operational steps
must complete before broad market rollout.

---

## 14. Definition of done

The feature may be called market ready only when:

- every P0 and P1 gate in §3 is complete;
- the lifecycle matrix passes against PostgreSQL and public API tests;
- no approved photo survives publicly after its earning event becomes
  reversed or disputed;
- ranking remains correct with more than 500 contributions;
- aggregate labels, items and counts obey thresholds and banding;
- browser completion never processes an unrelated queued photo;
- unfinished uploads cannot be silently abandoned through the success action;
- every successful moderation action has an immutable atomic audit record;
- public responses and logs pass the privacy field audit;
- shadow comparison records zero unsafe mismatches for seven days;
- canary traffic meets latency, error, freshness, takedown and Core Web Vitals
  targets;
- Operations has tested the retry, suppression, reconciliation and kill-switch
  runbooks; and
- the new Discover test, route tests and database migration tests are committed
  and required in CI.

At that point the feature is suitable for broad consumer release on the Hub
side. Merchant intelligence and merchant-authored media may continue on their
own rollout schedule, provided missing merchant-side contracts fail closed and
do not weaken verified-customer proof.
