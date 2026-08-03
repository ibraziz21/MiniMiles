# Hub Quest Event Delivery — Cutover Runbook

**Status:** Draft — execute after Slices A–D are deployed
**Date:** 2026-08-03
**Owners:** Hub, Backend, Akiba Platform (ops)
**Related:** `hub-quest-event-delivery-spec.md` (see §11 "Backlog recovery" and
§16 "Non-goals" for the decisions this runbook does not revisit)

This is the operator sequence for Slice E — turning `packages/backend`'s
`HubQuestEventWorker` into the production publisher for Hub's
`internal_event_jobs` outbox, and retiring the Vercel cron path. Nothing here
is automated; each step names the system to act in and the check that proves
it's safe to continue. **Do not skip a step or reorder them** — the sequence
exists specifically to avoid the double-delivery and stuck-lease failure
modes the lease migration was built to prevent.

## 0. Preconditions

Before starting step 1, confirm all of these are true. If any is false, stop
— do not proceed into backlog recovery.

- [ ] Migration `052_hub_quest_event_worker_leases.sql` is applied to the
      production Supabase project (adds `claimed_at`/`claimed_by`/
      `lease_expires_at`/`failed_at`/`last_error_code` to
      `internal_event_jobs`; replaces `claim_internal_event_jobs` and
      `complete_internal_event_job`; adds `replay_internal_event_jobs`).
- [ ] `packages/backend` is deployed with `HUB_QUEST_EVENT_WORKER_ENABLED=false`
      (the code is live, the worker is not running yet).
- [ ] `packages/hub-page`'s `process-internal-event-jobs` route is deployed
      with the updated lease-aware RPC calls (it already ships as part of
      the same change as the migration — confirm the deployed commit
      includes it, since an old build calling the retired 3-arg
      `complete_internal_event_job(uuid, boolean, text)` signature will
      error on every completion).
- [ ] **Slice A is done**: all five quests are seeded on Akiba Platform, the
      five `AKIBA_QUEST_ID_*` env vars on `packages/hub-page` point at them,
      and the readiness check in spec §7.2 passes with the production
      `AKIBA_API_KEY`. Do not proceed on the strength of a staging
      credential — the spec's own baseline finding was a 404
      `QUEST_NOT_FOUND` against the configured production credential.
- [ ] You have confirmed with Akiba Platform whether `POST
      /api/v1/events/track` persists an event/idempotency record before
      returning 2xx (spec §17 open decision #2). If unconfirmed, do not
      enable the worker — a non-durable Platform accept plus a Hub-side
      "released" status would silently lose events on a Platform-side crash.

## 1. Record the pre-recovery baseline

Run this in the production Supabase SQL editor and save the output
somewhere durable (a ticket, a doc) — it's what step 7's reconciliation
compares against.

```sql
select event_type, status, count(*) 
from internal_event_jobs
where event_type in (
  'pass_activated', 'deal_viewed', 'sponsored_game_played',
  'profile_country_set', 'voucher_redeemed'
)
group by event_type, status
order by event_type, status;
```

Cross-check against `GET /api/internal/quests-health` on `packages/hub-page`
(`x-webhook-secret: $INTERNAL_WEBHOOK_SECRET`) — `byQuest` in that response
should match this query.

## 2. Synthetic staging event (spec §11 step 5)

Before touching production data, prove the worker end-to-end in staging:

1. In a staging Supabase project with migration 052 applied, insert one row
   directly:
   ```sql
   insert into internal_event_jobs (event_type, idempotency_key, identities, metadata)
   values ('pass_activated', 'runbook-smoke-test:' || gen_random_uuid(), '[]'::jsonb, '{}'::jsonb);
   ```
2. Run the staging backend with `HUB_QUEST_EVENT_WORKER_ENABLED=true`,
   `AKIBA_API_URL`/`AKIBA_API_KEY` pointed at Platform's staging environment,
   `HUB_QUEST_EVENT_BATCH_SIZE=1`.
3. Confirm the row reaches `status = 'released'` and that a matching event
   exists on Platform staging (or a matching rejection you understand, e.g.
   `QUEST_NOT_FOUND` if staging quests aren't seeded — do not treat that as
   a pass).
4. Confirm `GET /health` on the staging backend reports
   `hubQuestEvents.healthy: true` and `hubQuestEvents.pending: 0`.

Do not proceed to step 3 until this passes.

## 3. Enable the worker in production at batch size 1

On the production `packages/backend` deployment, set:

```text
HUB_QUEST_EVENT_WORKER_ENABLED=true
HUB_QUEST_EVENT_BATCH_SIZE=1
BACKEND_ROLE=all   # or "worker" — must not be "api"
```

Redeploy/restart so the process picks up the new env. The Vercel
`process-internal-event-jobs` cron (`packages/hub-page/vercel.json`, every 5
minutes) **stays enabled** through this whole runbook — both callers now
share the lease-aware RPCs from migration 052, so a claim by one cannot
strand or double-send a row the other is also polling. There is no need to
disable it before step 8.

## 4. Confirm the first real release (spec §11 step 7–8)

Within a few minutes of step 3:

```sql
select id, event_type, status, attempts, claimed_by, released_at, last_error_code
from internal_event_jobs
where status = 'released' and released_at > now() - interval '10 minutes'
order by released_at desc
limit 5;
```

- [ ] At least one row shows `status = 'released'` with `claimed_by`
      matching the backend worker's ID format (`<pid>-<uuid8>`, visible in
      its logs as `[hubQuestEventWorker] Starting (worker=...)`).
- [ ] The matching completion/reward exists on Akiba Platform for that
      event's identity (check via Platform's own admin/API, not by trusting
      the Hub-side `released` status alone).
- [ ] Exactly one completion was created — not zero, not two. If Platform
      shows two, stop: idempotency isn't behaving as spec'd and this must be
      fixed on the Platform side before continuing (spec §7.3, §15
      acceptance criteria).

If this fails: set `HUB_QUEST_EVENT_WORKER_ENABLED=false` on the backend
again. The Vercel cron is still running and will keep draining the outbox
while you investigate — production is not stuck.

## 5. Ramp batch size

Only after step 4 passes cleanly:

1. `HUB_QUEST_EVENT_BATCH_SIZE=5` — observe one full poll cycle (see
   `GET /health`'s `hubQuestEvents.lastDrainAt`/`lastSuccessAt` advancing,
   `failed: 0`).
2. `HUB_QUEST_EVENT_BATCH_SIZE=25` (the spec default) — same check.

At each step, re-run the query in step 1 and confirm `failed` counts aren't
climbing and `processing` isn't accumulating (a growing `processing` count
with `pending` shrinking means leases are being taken but not completed —
check backend logs for `complete_internal_event_job RPC failed` or `Lost
lease` warnings).

## 6. Drain the backlog

With batch size at 25, the pre-existing 39-job backlog (34 `pass_activated`,
4 `voucher_redeemed`, 1 `profile_country_set` per the spec's 2026-08-03
baseline) should clear over a small number of one-minute poll cycles. Watch:

```sql
select event_type, status, count(*) 
from internal_event_jobs
where event_type in (
  'pass_activated', 'deal_viewed', 'sponsored_game_played',
  'profile_country_set', 'voucher_redeemed'
)
group by event_type, status
order by event_type, status;
```

until `pending` and `processing` are 0 for all five event types (excluding
any genuinely new activity that arrived during the rollout).

If any rows land in `failed`: do **not** manually flip them back to
`pending`. Investigate the `last_error_code`/`last_error` first (a
`malformed_event`/`no_matching_quest`/`endpoint_mismatch` failure will just
fail again). Once the root cause is fixed, replay explicitly by ID:

```sql
select replay_internal_event_jobs(
  array['<job-id-1>', '<job-id-2>']::uuid[],
  'root cause fixed — <describe>',
  '<your name/handle>'
);
```

This is intentionally not scriptable as "replay all" (spec §5.3) — every
replay must name specific job IDs and a reason, recorded in
`internal_event_job_replays`.

## 7. Reconcile

Compare against the step-1 baseline:

```text
released jobs (this rollout)
  = accepted Platform events by idempotency key
  = expected verified completions, except documented ineligible events
```

Any mismatch must be understood and written down (e.g. "N pre-outbox rows
were backfilled by migration 049 and correspond to users who no longer have
a valid email identity") before calling this step done.

## 8. Retire the Vercel cron path

Only after step 7 reconciles cleanly:

1. Remove the `process-internal-event-jobs` entry from
   `packages/hub-page/vercel.json`'s `crons` array (leave
   `process-reward-jobs` and `process-push-jobs` untouched — they're
   unrelated systems).
2. Leave the route itself (`POST /api/internal/process-internal-event-jobs`,
   authenticated via `x-webhook-secret`) in place as the manual recovery
   path spec §10 describes — it now shares the same lease-aware RPCs as the
   backend worker, so it's safe to trigger by hand if the backend worker
   ever needs a manual nudge.

## 9. Observe, then clean up

Per spec §11 step 10 / Slice E exit criteria: watch for **at least 24
hours** — `GET /health`'s `hubQuestEvents` block staying `healthy: true`,
`failed: 0`, `oldestPendingSeconds` staying low, no lease-related warnings in
backend logs — before considering this done.

After that observation window, per spec §17 open decision #5, decide with
the team whether to remove the Vercel recovery route immediately or keep it
for one more release cycle. Don't leave two independently-evolving
publisher implementations around indefinitely (spec §10's explicit warning)
— whichever you choose, put a date on it.
