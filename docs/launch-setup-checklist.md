# Launch setup checklist

Manual steps left over from the November 2026 app work. Code for each item
is done and tested; these are dashboard, console and deploy steps only.
Tick them off as they're done.

## 1. Firebase Analytics (app)

- [x] Firebase console → Project settings → Integrations → turn on **Google Analytics** (already on).
- [ ] Google Analytics → Admin → Data retention: 14 months; Google signals: off.
- [x] Add the **iOS app** in Firebase with bundle ID `com.akibamiles.akiba`.
- [x] Download its `GoogleService-Info.plist` into `packages/akiba-app/` (checked: bundle ID and
      project `akiba-7bd7a` match). Commit it — EAS cloud builds only see committed files.
- [ ] New native build (EAS, or local Android on JDK 17). An over-the-air update is not enough.
- [ ] App Store privacy: "Analytics — product interaction, not linked to identity, not used for tracking".
      Google Play Data safety: matching entry.
- [ ] Privacy policy: mention Firebase Analytics.
- [ ] After the build: check events arrive in Firebase → Realtime.

## 2. Push notifications

- [ ] hub-page on Vercel:
  - `NATIVE_PUSH_ENABLED=true`
  - `HUB_MILES_EARNED_NOTIFICATIONS_ENABLED=true`
  - `HUB_MILES_EARNED_NOTIFICATIONS_ROLLOUT_PERCENT=100`
  - `HUB_MILES_EARNED_NOTIFICATIONS_MERCHANT_ALLOWLIST` empty
- [ ] EAS credentials (`npx eas-cli credentials` in `packages/akiba-app`):
      Android FCM V1 service account key, iOS push key.
- [ ] Once the FCM key is uploaded to EAS, move `akiba-7bd7a-firebase-adminsdk-*.json`
      out of the repo folder (or revoke it and make a new one).
- [ ] Verify: `curl -H "Authorization: Bearer $CRON_SECRET" https://pass.akibamiles.com/api/internal/push-health`
      and Settings → "Send a test notification" on a phone.

## 3. Database migrations (MiniMiles `supabase/migrations`)

Apply in order, then deploy hub-page, then Akiba-Platform:

Check first with `supabase/ops/verify_migrations_101_127.sql` (read-only; also checks Akiba-Platform 172).
All applied to production on 2026-11-11 and verified (every check true).

- [x] `121_edit_saved_verified_visits.sql` (private note on recommendations — the web and app edit forms send it)
- [x] `123_contribution_request_push.sql`
- [x] `124_native_push_receipts.sql`
- [x] `125_saved_place_offers_and_voucher_expiry_push.sql`
- [x] `126_welcome_offer_enrolment.sql` (needs Akiba-Platform 154/155 already applied)
- [ ] `127_push_delivery_tokens_and_scan_locks.sql` (audit fixes; apply before deploying hub-page — the new code writes `push_token` and test deliveries)

## 4. Welcome offer (BDR-008)

- [ ] Create the allocation with `create_voucher_funding_allocation_atomic`:
      percent_off 25, `maximum_discount_kes` 250, `minimum_spend_kes` 1000,
      `voucher_validity_seconds` 604800, `quantity_cap` 1000,
      `p_distribution_modes => ARRAY['auto_award']`, every ready merchant in its set.
- [ ] Approve and activate it as usual.
- [ ] `INSERT INTO welcome_offer_campaigns (key, allocation_id, enrolment_cap, enrolment_starts_at, state)
      VALUES ('welcome-2026', '<allocation id>', 1000, now(), 'enrolling');`
- [ ] Deploy Akiba-Platform (branch `merchant-mobile`): its public funded-offer listing now
      hides `auto_award`-only allocations (code done, not yet committed).

## 5. Deploy order (Akiba-Platform `merchant-mobile` + MiniMiles hub-page)

1. [ ] Apply MiniMiles migration **127** and Akiba-Platform migration **172**
       (`172_till_purchase_proofs_and_visit_evidence.sql`). Run
       `supabase/ops/verify_migrations_101_127.sql` before deploying.
2. [ ] Set the same random `TILL_ATTESTATION_SECRET` on the API and merchant dashboard.
3. [ ] Deploy the merchant dashboard and API, then hub-page. Either Platform service
       can deploy first. The old API accepts the dashboard's additional header,
       and the new API awards Miles from an unsigned merchant till request with
       a neutral source label. Till proof starts when both deployments are live
       and the signing secret matches.
4. [ ] Verify a signed till award and a merchant voucher redemption. Check that
       Miles and the verified-visit prompt reach the recorded recipient.

- [ ] Check `CRON_SECRET` is set on the api Vercel project (the webhook and reward
      jobs now run on Vercel Cron with it, and the expiry job is newly scheduled).
- [ ] After deploy, in Vercel → Crons, confirm webhook-worker, reward-worker and
      voucher-funding-expiry-worker return 200, not 401/405.
- [ ] Tell staff: only `super_admin`, `admin` and `finance` can now create or
      reverse Miles; `ops`, `support` and `viewer` are read-only for those.

## 6. Supabase custom domain (paused)

Decided: custom domain `auth.akibamiles.com`; keep merchants signed in by pinning
the dashboards' sign-in cookie name. Not started — pick up when ready.

## Done

- [x] Supabase "Secure password change" turned on.
