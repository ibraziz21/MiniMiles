# Verified Discovery — Operations Runbook

**Status:** Draft — review before relying on it during a real incident
**Date:** 2026-10-02
**Owners:** Hub / Discovery (ops) — *placeholder: name the actual on-call
owner here if this differs*
**Related:** `verified-discovery-market-readiness-hardening-spec.md` §8
("Observability and operational readiness"); migrations 090–092

> This runbook assumes no paging/alerting integration exists for this
> feature (none does, as of this writing — there is no Slack/PagerDuty hook
> anywhere in this codebase). Detection is manual: an operator checks the
> **Discovery Health** page in admin-dashboard
> (`/verified-discovery-health`). If that changes — an alert gets wired up —
> update this runbook's §1 rather than leaving it describing a check nobody
> actually does.

---

## 0. What this covers

The verified-discovery hardening work (migrations 090–092): canonical
eligibility enforcement, atomic moderation + audit, the photo-processing
queue, the shadow-mode projection/snapshot queue, emergency suppression, and
the public-proof kill switches. It does not cover the original Stage 0/1/2
contribution-flow operational concerns (those predate this hardening pass).

## 1. How to tell something's wrong

Open admin-dashboard → **Discovery Health**
(`/verified-discovery-health`). It reports, refreshed on every page load:

| Section | What a warning means |
|---|---|
| Photo processing | Jobs stuck in `processing` past their 10-minute lease, or accumulating `failed` |
| Moderation queue | A photo stuck `pending` a long time, or — more serious — an approved/rejected photo with **no domain audit event** (should be structurally impossible; see §2.2) |
| Projection queue (shadow) | Snapshot refresh jobs stuck or lagging past 15 minutes. This queue does not affect what members see (shadow mode) — it's a leading indicator, not a live incident |
| Snapshots (shadow) | How stale the shadow snapshots are |

The equivalent machine-readable endpoint is
`GET /api/internal/verified-discovery-health` on the hub-page deployment
(`x-webhook-secret: $INTERNAL_WEBHOOK_SECRET`) — same data, same thresholds,
useful if you want to script a check instead of looking at the page.

The page **cannot** show the public-proof kill-switch state (§3) — those env
vars live on the hub-page deployment, not admin-dashboard's. Check hub-page's
deployed environment directly if you need to confirm a switch's current
value.

## 2. Response playbook

### 2.1 Photo processing backlog or stuck jobs

1. Confirm via Discovery Health or:
   ```
   GET /api/internal/verified-discovery-health
   ```
2. Trigger the worker manually (it also runs on a 1-minute Vercel cron, so a
   backlog usually means the cron itself is failing — check Vercel's cron
   logs first):
   ```
   curl -X POST -H "x-webhook-secret: $INTERNAL_WEBHOOK_SECRET" \
     https://<hub-page-host>/api/internal/process-photo-jobs
   ```
3. A job stuck in `processing` past its lease is automatically reclaimed by
   `claim_photo_processing_jobs` (089) on the next worker run — no manual
   unstick needed. After 5 reclaims it terminally fails and the photo moves
   to `rejected` with reason `processing_failed` (it never silently
   disappears from moderation).

### 2.2 A moderated photo has no domain audit event

This should not be possible — `perform_visit_photo_transition` (090) writes
the state change and the audit row in one transaction. If Discovery Health
shows `missingAuditCount > 0`:

1. Do not assume it's safe. Find the affected photo id:
   ```sql
   select mvp.id, mvp.moderation_status, mvp.partner_id
   from merchant_visit_photos mvp
   where mvp.moderation_status in ('approved','rejected')
     and not exists (
       select 1 from discovery_moderation_audit_events a where a.photo_id = mvp.id
     );
   ```
2. If it's `approved`, treat it as unverified moderation and suppress it
   immediately (§2.4) pending investigation.
3. Investigate how it was moderated outside `perform_visit_photo_transition`
   — a direct `UPDATE`, a different/older code path, or manual SQL. Fix the
   access path, not just this one row.

### 2.3 An ineligible photo or visit appears in a public response

The canonical eligibility projection (`eligible_public_merchant_visits` /
`eligible_public_merchant_visit_photos`, 090) is the single predicate both
the merchant page and the Discovery spotlight read through — this should be
structurally impossible for anything moderated/submitted through normal
paths. If it happens anyway:

1. **Verify first, don't guess**:
   ```
   GET /api/internal/verified-discovery-eligibility?photoId=<id>
   GET /api/internal/verified-discovery-eligibility?contributionId=<id>
   ```
2. If a photo shows `photoPublic: true` and it should not be, suppress it
   immediately (§2.4) — this is independent of whatever bug caused the
   wrong result and stops the bleeding while you investigate.
3. If the problem is broader than one photo (e.g. a bug in the eligibility
   function itself), use the kill switches (§3) to hide the whole surface
   while you fix and redeploy.

### 2.4 Emergency photo suppression

Admin-dashboard → Discovery Photos → **Live** section → **Suppress now** on
the affected photo. This sets `suppressed_at`, which every public read
checks — there is no cache to wait out, no separate revocation step. The
spec's five-minute budget for this (§7.1) should be met by the time it takes
an operator to click the button.

Equivalent API call (`discovery.write` admin session required):
```
POST /api/admin/discovery-photos/:id/suppress
{ "suppressed": true, "reasonCode": "<reason, optional, ≤64 chars>" }
```
To reverse: same endpoint with `"suppressed": false`.

### 2.5 Projection queue lag (shadow mode — not a public-facing incident)

Since nothing public reads the snapshot yet, a lagging projection queue is a
data-freshness issue for the shadow comparison, not a member-facing one.
Trigger the worker or force a specific rebuild:
```
curl -X POST -H "x-webhook-secret: $INTERNAL_WEBHOOK_SECRET" \
  https://<hub-page-host>/api/internal/process-discovery-projection-jobs

curl -X POST -H "x-webhook-secret: $INTERNAL_WEBHOOK_SECRET" \
  -H "Content-Type: application/json" -d '{"partnerId":"<uuid>"}' \
  https://<hub-page-host>/api/internal/verified-discovery-rebuild
```
Omit `partnerId` to rebuild the entire pilot cohort.

### 2.6 Checking whether V2 (the shadow snapshot) still agrees with V1

```
GET /api/internal/verified-discovery-shadow-report
```
Reports every mismatch between the live spotlight computation and the SQL
snapshot, with a `direction` field — `v2_shows_more` is the one to treat as
urgent (the spec's explicit concern: the snapshot must never be willing to
expose something the live canonical path would not). `healthy: true` here is
necessary but not sufficient for the cutover gate in §12 Phase B of the
hardening spec, which additionally requires seven *consecutive* healthy
days — a single good report is not that.

## 3. Feature kill switches

Three independent env vars on the **hub-page** deployment, each defaulting
to enabled (`lib/akiba/verifiedDiscoveryPublicProofFlags.ts`). Set any to
`false`/`off`/`0`/`no` to hide that surface without a deploy, without
touching merchant search, merchant profiles, Miles or vouchers:

| Variable | Hides |
|---|---|
| `HUB_DISCOVERY_SPOTLIGHT_ENABLED` | The home "Places people loved" spotlight |
| `HUB_DISCOVERY_VERIFIED_VISITS_PUBLIC_ENABLED` | Merchant-page "Verified visits" cards |
| `HUB_DISCOVERY_CUSTOMER_PHOTOS_PUBLIC_ENABLED` | Public customer-photo galleries (merchant page + spotlight) |

These are **global** (all merchants), not per-merchant — there is currently
no way to kill a single merchant's proof surface without a deploy, because
`partner_settings`/`partners`/`merchant_discovery_settings` are
Akiba-Platform-owned tables this repo does not write to. A single-photo
emergency action is §2.4; a single-merchant kill would need Akiba-Platform
coordination.

Revert by unsetting the var (or setting it to a truthy value) and
redeploying/restarting — no migration involved.

## 4. Rollback decision

- **Never** re-enable the pre-hardening approved-photo-only merchant-page
  query or the latest-500-contribution spotlight ranking (hardening spec
  §10.3 is explicit: this is a one-way safety hardening, not something to
  roll back).
- If a §3 kill switch is flipped off, that is the rollback — contribution
  capture and private moderation keep working normally underneath it.
- Database changes (090–092) are additive (new columns, functions, tables);
  there is no migration-level rollback path and none is needed — the
  canonical eligibility projection being wrong would be a bug to fix
  forward, not a schema to revert.

## 5. Customer-support message (DRAFT — needs support/comms sign-off)

> We've temporarily paused [verified visits / customer photos / the
> community highlights] for this merchant/across Akiba while we look into
> an issue. Your Miles and vouchers are unaffected.

Do not treat the wording above as approved copy — it is a starting point for
whoever owns customer-facing messaging to edit and sign off on, not
something to paste into a real incident.
