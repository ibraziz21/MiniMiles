# Funded voucher redemption schedules

Apply MiniMiles migration 112_funded_voucher_redemption_schedule.sql after 110
and the Platform funding migrations. Deploy the admin, Hub/mobile, and Platform
merchant dashboard changes together. The admin API validates restricted schedules
through the database before accepting them, so an environment missing migration
112 cannot silently advertise an unenforced restriction.

In a draft allocation, use **Redemption schedule → Restrict which days the voucher
can be used → Sat and Sun**. Leave **Eligibility to claim → Claimable only on
certain days of the week** unchecked to permit claims throughout the claim window.
Country/pass/new-customer eligibility remains separate and still applies.

Schedules are saved in allocation metadata under redemption_schedule, validated
on all database writes, then copied into each new funded voucher's rules_snapshot.
Once published or issued, the allocation schedule cannot change. Existing issued
vouchers retain their original snapshot; this migration does not retrospectively
restrict previously issued vouchers.

A BEFORE INSERT trigger on voucher_redemptions checks the issued snapshot against
clock_timestamp() in its configured timezone. It never trusts occurred_at or
redeemed_at supplied by a caller. On a disallowed day it raises
REDEMPTION_DAY_NOT_ALLOWED, rolling back the entire atomic redeem-and-award
transaction. Completed idempotent replays insert no new redemption, so they still
return their committed result even on a later disallowed day. This preserves
Platform's existing redemption RPC without copying/replacing its implementation.

Days use 0=Sunday through 6=Saturday. Null/absent schedule means any day while
valid. Malformed non-null schedules fail closed. New schedules default to
Africa/Nairobi; a Nairobi Saturday begins at 21:00 UTC Friday.

**Validity still matters.** A 48-hour voucher claimed Monday expires Wednesday,
so it cannot be used the following weekend. Choose a duration that reaches the
intended weekend (for example, the allocation's existing 7 days). This setting
does not extend voucher expiry or override the template's campaign end time.

Tests cover database validation, Nairobi midnight boundaries, independent claim
and redemption days, snapshot persistence, forged timestamps, immutable published
terms, unrestricted legacy vouchers, and merchant error responses. Migration 112
has been verified on disposable local Postgres; it has not been applied to the
shared/live database by this task.
