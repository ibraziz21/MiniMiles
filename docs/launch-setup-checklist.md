# Launch setup checklist

Manual steps left over from the November 2026 app work. Code for each item
is done and tested; these are dashboard, console and deploy steps only.
Tick them off as they're done.

## 1. Firebase Analytics (app)

- [ ] Firebase console → Project settings → Integrations → turn on **Google Analytics**.
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

- [ ] `123_contribution_request_push.sql`
- [ ] `124_native_push_receipts.sql`
- [ ] `125_saved_place_offers_and_voucher_expiry_push.sql`
- [ ] `126_welcome_offer_enrolment.sql` (needs Akiba-Platform 154/155 already applied)

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

## 5. Akiba-Platform fault fixes (branch `merchant-mobile`, not yet committed)

- [ ] Commit and deploy the api and dashboard-merchant changes.
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
