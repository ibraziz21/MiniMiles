# Content report moderation

Open **Merchants → Content Reports** (or **More → Content Reports** on mobile).
The queue requires `discovery.read`; resolving reports requires `discovery.write`
and a named authenticated admin. Open-access development sessions are read-only.

## Deployment

1. Apply migration 104 if not already applied, then
   `supabase/migrations/107_resolve_verified_visit_reports.sql`.
   Migration 107 does not depend on migration 105's shared-identity changes.
   Its RPC requires the existing suppression function from migration 092.
2. Deploy admin-dashboard and the native/Hub reporting slice together. Verify
   the Supabase service-role key remains server-only and authenticated pages,
   report mutations and signed image previews are never cached by the PWA.
3. Assign a named moderation owner and backup before enabling community content.
   Check pending count and oldest report each working day; urgent safety/privacy
   reports need prompt escalation through the team's support process.
   This workflow does not introduce email alerts or background polling.

## Review a report

- Pending reports appear oldest first, 25 per page. Status and page are in the
  URL; Actioned and Dismissed show the recorded moderator, time and decision.
- Inspect the visit's merchant, public favourite order/experience labels and
  photos. Full photos open in a separate tab using a five-minute signed URL.
  Non-public visits may no longer have a public text projection; do not treat
  its absence as evidence that the report was false.
- **Hide reported photo only** suppresses that photo and leaves the rest of the
  visit unchanged. This is available only when the reported photo still exists
  on that visit.
- **Hide entire visit and its photos** suppresses the contribution and every
  linked photo. Existing eligibility checks exclude them; projection refreshes
  are queued. Previously issued signed photo URLs may last up to five minutes.
- **Dismiss report** requires no-violation, insufficient-evidence or
  already-handled reasoning and leaves content unchanged.
- Confirm the action. Content changes, existing photo audit entries, refresh
  jobs and report resolution commit in one database transaction. The report's
  decision records actor, timestamp, bounded reason and correlation ID.
- Other reports about the same visit remain pending for explicit review.
  Already-resolved reports cannot be overwritten by a concurrent moderator.
  If a network response is lost, refresh before retrying. If suppression fails,
  no content changes or resolution are committed.

## Release acceptance

Use a disposable member and test content in staging:

1. Report a visible visit/photo from native. Confirm it appears in this queue.
2. Verify a read-only admin can inspect but cannot resolve, and a cross-origin
   mutation is rejected.
3. Hide the reported photo; confirm its public API eligibility disappears while
   other visit content remains. Repeat with whole-visit suppression.
4. Dismiss a separate report; confirm content stays visible and history records
   the actor/reason/time. Resolve simultaneously in two sessions; only one wins.
5. Verify signed-link expiry, projection refresh processing, keyboard/mobile
   controls, errors, empty queues, filters and pagination against the deployment.

Local automated coverage uses synthetic browser data and an isolated PostgreSQL
database, not production member records. Live deployment acceptance above still
needs completion. This slice does not implement user blocking or certify the
entire community experience against Play's UGC policy.
