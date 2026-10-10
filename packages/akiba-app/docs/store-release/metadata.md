# Akiba Pass — store listing metadata

AKIBA-MOB-002 §12. Draft copy for review. Nothing here may describe a
feature the production capability response hides (Gifts, Games, raffles,
push) or a screen that is not in the reviewed binary.

Every field needs a named owner and a sign-off date before submission.

## Identity

| Field | Value | Owner | Signed off |
|---|---|---|---|
| App name | Akiba Pass | Product | |
| Developer / operator | Akiba Ecosystems Ltd | Legal | |
| Bundle id / package | **BLOCKED** — §20 decision | Product | |
| Category | Shopping (primary) · Lifestyle (secondary) | Product | |
| First-rollout availability | Kenya only | Product | |
| Age rating / target audience | 18+, to match the Terms | Product / Legal | |

## Short description (Play, 80 chars)

> Earn rewards at local Kenyan shops. Show your Akiba Pass, collect Miles.

(72 characters.)

## Subtitle (App Store, 30 chars)

> Rewards where you shop

(21 characters.)

## Full description — draft

> Akiba Pass turns everyday spending at local merchants into rewards you can
> actually use.
>
> **Discover trusted places.** Browse shops, cafés and services that Akiba
> members actually visit, with verified visits from real customers.
>
> **Earn AkibaMiles.** Show your Akiba Pass when you pay at a participating
> merchant. The cashier scans it and your Miles land straight away — no
> balance to top up, no card to carry.
>
> **Use your rewards.** Turn Miles into vouchers and redeem them with
> participating merchants. Everything you own sits in the Rewards tab, ready
> to show when you pay.
>
> Signing in takes one email — we send a 6-digit code, and there is no
> password to remember. Akiba Pass is available in Kenya.

Claims to re-verify against the binary before submission: "verified visits",
"Miles land straight away", "available in Kenya".

## URLs

| Field | Value |
|---|---|
| Privacy policy | `https://<production-host>/privacy-policy` |
| Terms of use | `https://<production-host>/terms-of-use` |
| Account deletion | `https://<production-host>/account-deletion` |
| Support | `mailto:hello@akibamiles.com` |
| Marketing | **TBD** — Product |

The account-deletion URL is the one Google Play requires in the data-deletion
field, and is also usable as Apple's User Privacy Choices URL. The app reads
all three from `/api/v1/config`, so the production Hub environment must serve
the same values that are entered in the consoles.

## Review notes — draft

> **Signing in.** Akiba Pass uses email one-time codes; there is no password.
> Enter an email, receive a 6-digit code, enter it. A review account and its
> code-retrieval procedure are provided separately.
>
> **Location.** Location is requested only after tapping "Near me" on the
> Merchants tab, and only to show merchants within 25 km. Denying it leaves
> the app fully usable — you can filter by city instead.
>
> **Akiba Pass QR.** The Pass tab shows a QR code that a participating
> merchant scans at the till to credit AkibaMiles. There is nothing to scan
> during review; the code is informational on a test account.
>
> **AkibaMiles and vouchers.** Miles are a loyalty balance, not money. They
> cannot be withdrawn, transferred, or converted to cash. They can only be
> exchanged for vouchers redeemable with participating merchants. The app
> contains no in-app purchase and no cash-out path.
>
> **Account deletion.** Settings → Danger zone → Delete account. It needs an
> email code and an explicit acknowledgement, then submits a request
> processed within 14 days. The same flow is available without the app at
> `/account-deletion`.
>
> **Hidden features.** Gifts is disabled by server configuration in the
> production build and is not part of this release.

**BLOCKED:** the review account. Reviewers cannot receive a member's email
OTP, so this needs either a durable review account with a fixed code or a
documented retrieval procedure (§20, Engineering/Support).

## Screenshots

Required: small and large supported phone, both platforms. Suggested set,
all from the reviewed binary:

1. Explore — merchant discovery
2. Merchant detail — verified visits and offers
3. Pass — the QR screen
4. Rewards — vouchers owned
5. Onboarding — "Welcome to Akiba"

Must not show Gifts, Games, raffles, or any push prompt.
