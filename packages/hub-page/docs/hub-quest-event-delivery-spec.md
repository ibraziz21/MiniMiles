# Hub Quest Event Delivery

**Status:** Draft for implementation  
**Date:** 2026-08-03  
**Owners:** Hub, Backend, Akiba Platform  
**Related:** `merchant-shopping-quests-spec.md`, `production-readiness-security-spec.md`

## 1. Decision

Move the publisher for Hub's `internal_event_jobs` outbox from a Vercel cron
route to the long-running service in `packages/backend`.

Keep responsibilities separated:

- Hub and merchant applications write first-party domain records and outbox
  rows in the shared Hub Supabase transaction.
- `packages/backend` reliably delivers those rows to Akiba Platform.
- Akiba Platform durably accepts events, verifies quests, creates completions
  and rewards, and owns reward claim semantics.
- Akiba Platform must not receive the Hub Supabase service-role credential or
  query Hub tables directly.

The Vercel route remains temporarily available as an authenticated manual
recovery path during migration, but Vercel cron stops being the production
owner after the backend worker is proven healthy.

## 2. Why this boundary

`internal_event_jobs` is a transactional outbox. Its publisher belongs on the
producer side of the system boundary because only the producer can atomically
commit the domain action and its intent to notify another service.

Putting the outbox reader inside Akiba Platform would require one of these
undesirable designs:

1. Platform receives Hub's service-role key and polls Hub's private database.
2. Platform and Hub share database internals and deployment assumptions.
3. Hub sends events synchronously without a durable local retry boundary.

Instead, Platform's public responsibility starts at its authenticated event
endpoint. Platform must persist an accepted event before returning a 2xx
response. Any verification or reward work after acceptance may use a
Platform-owned inbox or job queue.

## 3. Production baseline

Read-only checks on 2026-08-03 found:

| Signal | Observed state |
|---|---:|
| `internal_event_jobs` for launch quests | 39 |
| Pending | 39 |
| Processing, released, or failed | 0 |
| Maximum attempts | 0 |
| `pass_activated` pending | 34 |
| `voucher_redeemed` pending | 4 |
| `profile_country_set` pending | 1 |
| `deal_viewed` proof rows | 0 |
| Hub passes | 18 |
| Hub profile rows | 1 |

The five locally configured Platform quest IDs each returned
`404 QUEST_NOT_FOUND` with the configured Platform credential. Listing quests
with that credential returned zero visible quests.

These findings establish three independent blockers:

1. The current Vercel worker is not claiming jobs.
2. The Platform environment, API-key scope, or quest IDs do not match.
3. The Hub UI never produces a `deal_viewed` proof.

Moving the worker addresses only the first blocker. The deployment sequence in
this document deliberately repairs Platform configuration before releasing the
existing backlog.

## 4. Target architecture

```text
Member action
  |
  v
Hub or merchant transaction
  - writes authoritative domain record
  - inserts internal_event_jobs with an idempotency key
  |
  v
Hub Supabase outbox
  |
  v
packages/backend: HubQuestEventWorker
  - leases eligible rows
  - sends bounded, authenticated requests
  - releases, retries, or dead-letters each row
  |
  v
POST Akiba Platform /api/v1/events/track
  - persists event/idempotency record before 2xx
  - merges supplied identities
  - queues or runs verification
  |
  v
Platform completion and reward
  |
  v
Hub status BFF reads completion/reward state
  |
  v
Member claims Miles to the canonical off-chain ledger
```

### 4.1 Trust boundary

The backend publisher receives:

- `SUPABASE_URL`
- `SUPABASE_SERVICE_KEY`
- `AKIBA_API_URL`
- `AKIBA_API_KEY`

Akiba Platform receives only its normal Bearer-authenticated event request.
The request contains the event type, idempotency key, identities, occurrence
time, and non-sensitive metadata required for verification.

No Platform response, worker log, or health response may expose email, phone,
wallet address, Hub user ID, API keys, or arbitrary event metadata.

## 5. Outbox schema hardening

The current claim RPC changes `pending` to `processing`, but a worker crash can
leave the job in `processing` forever. Before enabling the backend worker, add
an additive migration with explicit leases:

```text
internal_event_jobs
  claimed_at       timestamptz null
  claimed_by       text null
  lease_expires_at timestamptz null
  failed_at        timestamptz null
  last_error_code  text null
```

### 5.1 Claim contract

Replace the claim signature with:

```text
claim_internal_event_jobs(
  p_limit integer,
  p_worker_id text,
  p_lease_seconds integer
) returns setof internal_event_jobs
```

The RPC atomically claims, in oldest-first order:

- `pending` rows whose `next_retry_at` is null or due; and
- `processing` rows whose lease has expired.

For each claimed row it must:

- set `status = 'processing'`;
- increment `attempts` exactly once;
- set `claimed_at = now()`;
- set `claimed_by = p_worker_id`;
- set `lease_expires_at = now() + p_lease_seconds`;
- clear a stale `last_error` only after successful release, not at claim time;
- return the claimed row.

Continue using `FOR UPDATE SKIP LOCKED` so multiple backend replicas can drain
the same queue safely.

### 5.2 Completion contract

Replace the completion signature with:

```text
complete_internal_event_job(
  p_job_id uuid,
  p_worker_id text,
  p_ok boolean,
  p_retryable boolean,
  p_error_code text,
  p_error_detail text
) returns boolean
```

The update succeeds only when `claimed_by = p_worker_id`, status is
`processing`, `lease_expires_at > now()`, and the lease has not been replaced
by another worker.

On success:

- set `status = 'released'`;
- set `released_at = now()`;
- clear claim and lease fields;
- clear error fields.

On retryable failure below the attempt limit:

- set `status = 'pending'`;
- set `next_retry_at` using exponential backoff plus jitter;
- store a sanitized error code and bounded detail;
- clear claim and lease fields.

On non-retryable failure, or after the attempt limit:

- set `status = 'failed'`;
- set `failed_at = now()`;
- store the sanitized failure;
- clear claim and lease fields.

Suggested defaults:

| Setting | Default |
|---|---:|
| Batch size | 25 |
| Poll schedule | every 60 seconds |
| Platform timeout | 10 seconds |
| Lease duration | 60 seconds |
| Maximum attempts | 10 |
| Maximum concurrent sends | 5 |
| Maximum stored error detail | 500 characters |

The lease must be longer than one bounded request plus completion-RPC time.

### 5.3 Replay contract

Add an operator-only RPC to replay failed rows by explicit ID or by a narrow,
auditable filter:

```text
replay_internal_event_jobs(
  p_job_ids uuid[],
  p_reason text,
  p_actor text
) returns integer
```

It resets selected `failed` rows to `pending`, clears `failed_at`, and records
the replay action in an operations audit table. It must not change the
idempotency key or identities.

Do not implement a public "replay all" endpoint.

## 6. Backend worker

Add `packages/backend/src/hubQuestEventWorker.ts` with two exported functions:

```ts
startHubQuestEventWorker(): Promise<void>
runHubQuestEventDrain(): Promise<DrainSummary>
```

`startHubQuestEventWorker` runs one drain at startup and schedules another
every minute. A process-local guard prevents overlapping drains in one
instance; database leases coordinate multiple instances.

### 6.1 Drain algorithm

For each drain:

1. Return without claiming when `HUB_QUEST_EVENT_WORKER_ENABLED` is not true.
2. Validate required configuration once.
3. Create a unique worker ID for this process instance.
4. Claim one batch through the leasing RPC.
5. Send claimed jobs with bounded concurrency.
6. Complete each job independently.
7. Continue processing other jobs after an individual delivery failure.
8. Return an aggregate summary without event identities or metadata.

The worker must not mark a job released merely because a fetch resolved. It
requires a successful Platform response satisfying the event contract.

### 6.2 Platform adapter

Move or share the existing server-only event adapter so backend uses the same
payload shape:

```json
{
  "eventType": "pass_activated",
  "identities": [{ "type": "email", "value": "..." }],
  "idempotencyKey": "pass:<hub-user-id>",
  "occurredAt": "2026-08-03T00:00:00.000Z",
  "metadata": {}
}
```

Required request headers:

```text
Authorization: Bearer <AKIBA_API_KEY>
Content-Type: application/json
Idempotency-Key: <job.idempotency_key>
X-Correlation-ID: <generated non-PII request ID>
```

Use `AbortSignal.timeout` or an equivalent bounded timeout.

Classify responses as follows:

| Result | Worker action |
|---|---|
| 2xx accepted or duplicate-idempotency success | release |
| 408, 425, 429, 5xx, timeout, network failure | retry |
| 400 malformed event | fail |
| 401 or 403 credential/scope failure | retry briefly, then fail and alert |
| 404 endpoint mismatch | fail and alert |
| 409 with a stable already-accepted idempotency code | release |
| 422 no matching live quest or invalid event contract | fail and alert |
| Unknown result | retry until maximum attempts |

Platform should return a stable error code. The worker stores the code and a
sanitized message, never a full response containing request data.

### 6.3 Configuration

Add to `packages/backend/.env.example`:

```text
HUB_QUEST_EVENT_WORKER_ENABLED=false
AKIBA_API_URL=
AKIBA_API_KEY=
HUB_QUEST_EVENT_BATCH_SIZE=25
HUB_QUEST_EVENT_POLL_SECONDS=60
HUB_QUEST_EVENT_LEASE_SECONDS=60
HUB_QUEST_EVENT_MAX_ATTEMPTS=10
HUB_QUEST_EVENT_CONCURRENCY=5
HUB_QUEST_EVENT_TIMEOUT_MS=10000
```

Production must fail the worker closed when it is enabled without the
required Supabase or Platform configuration. Other backend API routes may
continue running, but worker health must report unhealthy.

### 6.4 Process integration

Start the worker from `packages/backend/src/index.ts` only when background
workers are enabled. `BACKEND_ROLE=worker` and `BACKEND_ROLE=all` are eligible;
`BACKEND_ROLE=api` is not.

On shutdown, stop scheduling new drains. In-flight jobs may finish within a
short grace period. Any unfinished lease is recovered after expiry.

## 7. Akiba Platform readiness

Worker activation is blocked until Platform readiness is proven.

### 7.1 Quest catalog

Seed or identify exactly one launch quest for each key:

| Hub key | Event type | Frequency | Reward |
|---|---|---|---:|
| `pass_activated` | `pass_activated` | once/lifetime | 20 Miles |
| `deal_viewed` | `deal_viewed` | once/lifetime | 5 Miles |
| `sponsored_game_played` | `sponsored_game_played` | weekly/ISO week | 25 Miles |
| `profile_country_set` | `profile_country_set` | once/lifetime | 50 Miles |
| `voucher_redeemed` | `voucher_redeemed` | once/lifetime | 100 Miles |

The quests must be active in the same Platform environment addressed by
`AKIBA_API_URL` and visible to the credential used by Hub and backend.

Do not copy UUIDs between staging and production. Record environment-specific
IDs in deployment configuration.

### 7.2 Readiness check

Add an operator command or CI smoke check that, without participant identity,
validates:

- Platform is reachable and authenticated;
- all five configured IDs resolve;
- each quest has the expected event type, frequency, reward amount, and live
  status;
- the API credential is authorized to send events for their owning partner;
- the reward currency is the canonical off-chain Miles ledger currency.

The worker feature flag cannot be enabled while this check fails.

### 7.3 Durable acceptance

`POST /api/v1/events/track` must persist an inbound event or idempotency record
before responding with success. Repeating the same idempotency key must:

- return a successful idempotent result;
- merge richer identity information where the Platform contract supports it;
- never create a duplicate completion or reward.

If verification is asynchronous, Platform exposes an internal queue health
signal distinct from Hub's delivery queue health.

## 8. Deal-view proof completion

The existing `POST /api/quests/proof` route remains the only client-facing
producer for `deal_viewed`. It already validates the supplied voucher template
against live Hub inventory before calling `record_hub_deal_view`.

The missing client integration must be added.

### 8.1 User flow

1. `Start quest` navigates to `/vouchers?quest=deal_viewed`.
2. The voucher page displays available offers normally.
3. A genuine interaction with a specific available offer records proof.
4. The proof request posts `{ offerId: template.id }`.
5. A `202` response shows lightweight acknowledgement and retains normal
   navigation.
6. Returning to `/quests` refreshes status.

A route page view by itself is not proof. Valid interactions are:

- opening an offer detail;
- selecting the voucher's primary action; or
- following its merchant-offer action.

The first valid interaction should send the proof before navigation where
practical. Use `keepalive` only for this small, authenticated same-origin
request if navigation would otherwise cancel it.

Repeated interactions are safe because the database uniqueness constraint and
outbox idempotency key deduplicate them.

### 8.2 Client failure behavior

Proof failure must not block the member from viewing an offer. Preserve the
quest intent in the URL or session state and provide a retryable acknowledgement
when the user returns. The server remains authoritative; local storage is not
completion proof.

## 9. Quest status experience

The current `verifying` state hides configuration failures and never polls
while the page remains focused. Split operator reasons from member-facing
states.

### 9.1 Status behavior

While any quest is `verifying`, poll `GET /api/quests/status` with bounded
backoff, for example:

```text
immediate on focus -> 5s -> 10s -> 20s -> 30s, then every 30s
```

Stop polling when:

- no quest is verifying;
- the tab becomes hidden;
- the component unmounts; or
- a defined maximum continuous polling window is reached.

Continue refreshing immediately on window focus and after a successful claim.

### 9.2 Member-facing states

| Internal condition | Member copy |
|---|---|
| Local action not complete | Start quest |
| Outbox pending/processing | Verifying your activity… |
| Platform completion pending | Preparing your reward… |
| Temporary upstream failure | Verification is taking longer than usual. Retry status. |
| Misconfigured/missing quest | This quest is temporarily unavailable. |
| Reward active | Claim X Miles |
| Reward claimed | Claimed +X Miles |
| Terminal reward failure | Reward needs attention |

Do not expose raw error codes to members. Include sanitized reason codes in
the private status response for logging and support correlation.

### 9.3 Status lookup efficiency

The current implementation makes one completion request per quest per
identity and additional reward requests. Prefer a Platform bulk status
endpoint that accepts the five quest IDs and the member's identities in one
authenticated server-to-server request.

Until that exists, bound concurrency and apply a request timeout so one
Platform problem cannot hold the entire Hub render indefinitely.

## 10. Vercel worker retirement

During migration:

- keep `POST /api/internal/process-internal-event-jobs` as an authenticated,
  operator-only one-shot recovery endpoint;
- disable or remove its GET cron path after the backend worker has released
  test events successfully;
- remove the internal-event schedule from `packages/hub-page/vercel.json`;
- do not run Vercel and backend publishers concurrently until leases are
  deployed and both callers use the lease-aware RPC.

After the observation period, either remove the recovery route or have it call
an administrative backend endpoint. Do not keep two independent worker
implementations that can drift.

## 11. Backlog recovery

The 39 existing jobs are valid production intents and must not be deleted or
rewritten.

Recovery order:

1. Deploy Platform quest seeds/configuration.
2. Verify all five production quest IDs with the production API credential.
3. Deploy the outbox lease migration.
4. Deploy backend code with the worker flag disabled.
5. Run a synthetic, non-rewarding contract test or staging event.
6. Enable the worker with batch size `1` in production.
7. Confirm one job becomes `released` and one matching Platform event exists.
8. Confirm the expected completion/reward is created exactly once.
9. Raise batch size to `5`, observe, then to the normal `25`.
10. Confirm all eligible backlog rows release and Hub status becomes
    claimable or completed.
11. Disable the Vercel cron owner.

Before releasing the backlog, record aggregate counts by event type and
status. After release, reconcile:

```text
released jobs
  = accepted Platform events by idempotency key
  = expected verified completions, except documented ineligible events
```

Do not manually mark jobs released. A row is released only after Platform has
durably accepted its event.

## 12. Observability and operations

### 12.1 Metrics

At minimum report:

- `hub_quest_outbox_pending_count`
- `hub_quest_outbox_processing_count`
- `hub_quest_outbox_failed_count`
- `hub_quest_outbox_oldest_pending_seconds`
- `hub_quest_outbox_expired_lease_count`
- `hub_quest_outbox_claimed_total`
- `hub_quest_outbox_released_total`
- `hub_quest_outbox_retry_total` by sanitized error code
- `hub_quest_outbox_delivery_duration_ms`
- `platform_event_acceptance_total` by event type
- `platform_quest_completion_total` by quest key
- `platform_reward_created_total` and `platform_reward_claimed_total`

### 12.2 Alerts

Alert when:

- oldest pending age exceeds 5 minutes;
- any lease remains expired for more than one poll interval;
- any job reaches `failed`;
- 401, 403, or 404 responses occur from Platform;
- no successful releases occur while eligible pending jobs exist;
- Platform readiness detects a missing or changed launch quest.

### 12.3 Health response

The backend health surface returns only aggregate information:

```json
{
  "hubQuestEvents": {
    "enabled": true,
    "healthy": true,
    "lastDrainAt": "2026-08-03T00:00:00.000Z",
    "lastSuccessAt": "2026-08-03T00:00:00.000Z",
    "pending": 0,
    "processing": 0,
    "failed": 0,
    "oldestPendingSeconds": 0
  }
}
```

No health endpoint may return identities, metadata, idempotency keys, job IDs,
or upstream response bodies.

## 13. Testing

### 13.1 Database integration tests

- Concurrent workers never claim the same live lease.
- An expired lease is reclaimed.
- A live lease cannot be completed by another worker ID.
- Attempts increment exactly once per delivery attempt.
- Retry backoff makes a row temporarily ineligible.
- Maximum attempts move a row to `failed`.
- Replay preserves the original idempotency key and payload.
- Existing pending rows remain claimable after the additive migration.

### 13.2 Backend unit tests

- Disabled worker makes no database or Platform calls.
- Startup drain and scheduled drain use the same implementation.
- Process-local overlap guard works.
- Batch concurrency stays within the configured limit.
- 2xx releases a job.
- Network, timeout, 429, and 5xx retry a job.
- Malformed-event 400 fails a job.
- Credential and contract errors are sanitized and alerted.
- One failed delivery does not stop the remainder of the batch.
- Logs and summaries contain no PII or secrets.

### 13.3 Platform contract tests

- Each configured launch quest resolves in its target environment.
- Event acceptance is durable before 2xx.
- Duplicate idempotency keys create one completion and reward.
- Identity replay merges email and wallet identity without duplication.
- One-time and weekly scopes use the expected uniqueness.
- Email-only rewards can be claimed to the off-chain ledger.

### 13.4 Hub route and UI tests

- Deal proof rejects unknown, inactive, expired, sold-out, and hidden offers.
- A valid offer interaction records one proof and one outbox row.
- Repeated offer interactions remain idempotent.
- Returning from the offer refreshes quest state.
- Verifying quests poll and stop under the defined conditions.
- Platform configuration failures do not display an infinite spinner.
- Claim refreshes both quest status and available Miles.

### 13.5 Failure drills

- Kill the backend after claim and before Platform send; lease expiry recovers.
- Kill it after Platform acceptance and before local completion; duplicate send
  is accepted idempotently and the job releases.
- Disable Platform temporarily; jobs retry without user action.
- Rotate the Platform key; alerts fire on the old key and recovery succeeds
  after the new key is deployed.

## 14. Implementation slices

### Slice A — Platform readiness

- Seed or locate the five launch quests.
- Correct environment-specific IDs and API-key scope.
- Add the readiness command/check.
- Prove durable, idempotent event acceptance.

**Exit:** all five quest lookups succeed and their configuration matches this
spec.

### Slice B — lease-safe outbox

- Add lease and failure columns.
- Replace claim/complete RPCs.
- Add replay RPC and audit record.
- Add migration integration tests.

**Exit:** crash recovery and multi-worker ownership tests pass.

### Slice C — backend publisher

- Add worker and Platform adapter.
- Add configuration and health reporting.
- Wire worker startup by backend role.
- Deploy disabled.

**Exit:** staging events release through backend with no Vercel cron.

### Slice D — Hub proof and status UX

- Wire deal interactions to the proof route.
- Preserve quest intent through navigation.
- Add polling, manual retry, and distinct failure copy.
- Add route and component tests.

**Exit:** all five quest actions reach an accurate claimable/completed state.

### Slice E — production backlog and cutover

- Enable batch size 1.
- Reconcile the first delivery end to end.
- Gradually drain the backlog.
- Remove the Vercel cron schedule.
- Observe for at least 24 hours before deleting redundant worker code.

**Exit:** no stale pending or expired leases, no duplicate rewards, and the
backend is the sole production publisher.

## 15. Acceptance criteria

- A valid Hub quest action creates its domain record and outbox intent in one
  transaction.
- Backend delivers every eligible event at least once without relying on
  Vercel cron.
- Platform processes repeated delivery exactly once by idempotency key.
- Worker crashes and Platform downtime recover without member action.
- Platform never receives Hub database credentials.
- All five production quest IDs resolve and match the expected configuration.
- The existing production backlog is reconciled without duplicate rewards.
- A real voucher-offer interaction produces `deal_viewed` proof.
- Members do not see an indefinite spinner for terminal configuration errors.
- Email-only members can complete and claim every non-wallet quest.
- Operational health exposes queue age, retries, failures, and lease recovery
  without exposing PII.

## 16. Non-goals

- Moving Hub domain tables into Akiba Platform.
- Giving Platform direct read access to Hub Supabase.
- Replacing the off-chain Miles ledger with per-quest on-chain minting.
- Re-enabling generic paid partner quest inventory.
- Rebuilding every existing backend worker under one new queue framework.
- Making a voucher-list page impression sufficient proof of a deal view.

## 17. Open decisions before implementation

1. Confirm the production owner/partner under which the five Platform quests
   will be seeded.
2. Confirm whether `/api/v1/events/track` already persists an inbox row before
   returning success.
3. Confirm the backend production process has access to the same Supabase
   project that contains `internal_event_jobs`.
4. Choose the operations audit table used by failed-job replay.
5. Decide whether the temporary Vercel recovery route is removed immediately
   after cutover or retained for one release cycle.

None of these decisions changes the selected service boundary: Hub owns the
outbox, backend publishes it, and Akiba Platform owns verification and reward
processing after durable acceptance.
