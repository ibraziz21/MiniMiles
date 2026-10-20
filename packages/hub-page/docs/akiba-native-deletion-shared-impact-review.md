# Native deletion: shared-account impact review

**Historical review:** the user has since explicitly selected entire shared
Akiba member-account deletion. [BDR-004](../../../docs/BDR-004-admin-shared-account-deletion.md)
records the approved scope and verified admin workflow. The earlier native-only
recommendation below no longer describes the intended deletion effect.

Reviewed 2026-10-19 after the user selected **native-app data only; review shared-account effects first**. Source inspected in MiniMiles and `/Users/ibraziz21/Desktop/Work/Akiba-Platform/packages/api` plus Platform migrations. No Platform source was edited and no production data was modified.

## Finding

The current account model does not provide an independent native membership lifecycle. Native email OTP authenticates the shared Supabase user; Hub and Platform connect that user to a shared canonical and Miles ledger. Removing a native profile is therefore different from deleting the shared identity or forfeiting its global Miles.

The narrowed scope must not silently hard-delete or soft-delete shared Auth, remove canonical/wallet links, delete shared usernames, or mutate the global ledger. Those operations have been excluded from the executable registry. The canonical SQL step explicitly refuses mutation, the original ledger immutability trigger remains intact, and admission is blocked independently of rollout flags while scope review is pending.

## Concrete dependencies

| Surface | Source evidence | Effect of a whole-account delete | Native-only disposition |
|---|---|---|---|
| Sign-in | `akiba-app/src/auth/supabase.ts`; Hub `lib/auth/requestActor.ts` | Removing/soft-deleting Auth invalidates the identity used by other consumers | Preserve shared Auth; establish native membership state before activation |
| Canonical/identity links | Platform `003_rewards.sql`; Hub `054_canonical_partner_quest_completion.sql`, `099_hub_auth_purchase_identity_bridge.sql` | Removing email/wallet/canonical mappings can sever reward lookup across services | Preserve mappings; read-only dependency preflight |
| Global Miles | Platform `003_rewards.sql`, `079_referral_rewards.sql`; Hub `lib/akiba/activity.ts` | Deleting ledger rows changes shared balances; reversal/refund FKs also depend on them | Preserve ledger and ordinary immutability; do not promise forfeiture of global Miles as a native-only effect |
| Shared username | Hub `095_voucher_username_identity_foundation.sql`; `leaderboard_profiles` and `leaderboard_username_changes` | Removes a shared identity projection used outside the native screen | Preserve; separate inventory row for review |
| Merchant purchase/refund evidence | Platform `046_purchase_rewards.sql`, `082_merchant_checkout_hardening.sql` | Source identity and raw metadata are tied to merchant transactions, reward outcomes and billing adjustments | Do not erase obligations or apply the native 180-day rule without a shared-policy decision |
| Vouchers and funding | Platform `115_voucher_funding_foundation.sql`, `119_voucher_funding_payables.sql`, `132_loyalty_qualified_vouchers_foundation.sql` | Claims, funding reservations, payables and acquisition rows can block or be affected by removing an issued voucher | Complete a combined-schema review before enabling native voucher cleanup; current preflight refuses unhandled canonical histories |
| Referrals | Hub `053_referral_system.sql`; Platform `079_referral_rewards.sql` | Hub referral detachment alone does not remove Platform credit/reversal evidence | Hub cleanup is staged; shared histories remain blocked, with the other member's completed entitlement preserved |
| Hub companion-web data | Hub profile, verified visits, saves, web/native push tables | Native and companion-web features use the same member rows and some of the same queues | Confirm the product boundary: these cannot be assumed to have native-only provenance merely because the native app displays them |

The app does not initiate money payments. A merchant recording a purchase for a Miles award is nevertheless a real shared backend record; its presence does not turn the native app into a payment app.

## Required native lifecycle design

Before activation, define native membership independently of shared Auth, with at least active/deletion-pending/deleted states and a durable native-generation identifier. Native actor resolution and bootstrap must respect that state. Rejoining must start a new native membership without accidentally restoring deleted profile/content through shared projections.

Decide which Hub companion-web data belongs to that same membership, and which data belongs to other Akiba products. Table/source ownership, not the screen that displayed it, must define cleanup. Device installations and native delivery registrations are clearly native; profile, content and general notification queues need the explicit Hub/web boundary.

The notice must then distinguish native access/data removal from shared-account effects. In particular, promising that Miles cannot be restored conflicts with preserving the shared ledger if the same Auth identity can sign in again and read that balance. The staged notice must not be published until this behavior/copy is reconciled.

This is an architectural dependency, not another request to approve the already accepted 90-day/180-day/24-month working periods. Keep the staged cleanup, expiry and evidence tests, but do not apply migration 103 to production or enable submission/processing until native lifecycle isolation and source ownership have been implemented and verified.
