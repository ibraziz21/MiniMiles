# App failures investigated November 9, 2026

Read-only production investigation covered November 8 in Africa/Nairobi
(`2026-11-07T21:00:00Z` inclusive to `2026-11-08T21:00:00Z` exclusive).

| Credit source | Credits | Miles |
| --- | ---: | ---: |
| Merchant voucher checkout | 9 | 121 |
| Scan award | 5 | 75 |
| Total | 14 | 196 |

All 14 purchase events were rewarded, with positive net miles and no reversals.
All nine corresponding voucher redemptions used `merchant_scan` and had a Hub
member attached. Their purchase metadata lacked `channel`, so the previous
reconciliation filter excluded them from both notification and visit recovery.

The five scan credits had verified earning events and earned-miles notifications.
Their push jobs completed, with six accepted native deliveries. Expo returned five
successful downstream receipts when those six tickets were queried; one receipt
was unavailable. These records do not establish whether a banner was displayed
on each phone. The existing foreground handler already requests banners and sound.

Merchant contribution settings were enabled, but the application contribution
rollout defaulted off independently. Existing cooldown and fatigue rules can also
suppress new contribution requests; these rules were preserved.

The Offers screen hid the bell whenever `remindersEnabled` was false. Production
included an always-available offer with this flag false. Opening-relative reminders
are not available for it, but a member can still schedule a timed reminder.

## Local changes

- Recover earned-miles notifications for committed positive rewards regardless of
  channel, preserving Hub order notification keys to avoid duplicate confirmations.
- Resolve missing voucher-checkout channels using a redemption matched on voucher,
  merchant and Hub member. Online or absent redemption evidence cannot unlock a visit.
- Use the same redemption recovery for on-demand contribution eligibility.
- Promote existing unknown-channel earning evidence when in-store proof arrives.
- Default contribution availability to on/100%; retain explicit rollout overrides.
- Always show the offer bell. Offers without opening reminders use a local reminder
  in 30 minutes, one hour or one day, including permission/error handling.

## Validation and release status

Focused backend suite: 45 tests passed. Local offer reminder suite: 3 tests passed.
App lint and TypeScript checks passed; backend changed-file lint and TypeScript
checks passed. Physical device display has not been verified.

Changes have not been deployed. Production data was not modified and missed
notifications were not replayed during this investigation. After deployment, the
existing five-minute reconciliation worker can recover eligible recent rewards;
explicit deployment rollout overrides still take precedence over defaults.
