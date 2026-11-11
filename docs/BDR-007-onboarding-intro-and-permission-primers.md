# BDR-007 — Onboarding: pre-sign-in intro and permission primers

**Status:** Accepted · 10 November 2026
**Scope:** `packages/akiba-app` onboarding (AKIBA-MOB-001 §2–§4)

## Context

The native app's first run was: email → code → Welcome (three icon rows) →
Profile → Pass (three icon rows, no QR) → tabs. A new user was asked for an
email before seeing what Akiba is. The notification permission was raised
by `PushRegistrar` the moment the tabs mounted, with no explanation, and
location was only ever asked from "Near me" on the Merchants tab.

AKIBA-MOB-001 made two of those choices deliberately:

1. **No permissions during onboarding** — location only when "Near me" is
   tapped; notifications only after the member has seen what the app is for.
2. **No Pass QR in onboarding** — the Pass step was explanatory only, leaving
   the QR to the Pass tab (AKIBA-MOB-003).

## Decision

New flow, designed in Google Stitch (export: `001onboard.zip`):

1. **Intro slides before sign-in**, once per device: *Find places worth
   going to* → *Get something back* → *One Pass, every place*. Visuals are
   fragments of the app's own UI, not illustrations.
2. Email → code (restyled; six code boxes over one real input so OS autofill
   still works).
3. Setup, four steps with resume: **profile** (username + city tiles) →
   **location primer** → **notifications primer** → **Pass ready** (live QR).
4. A **welcome voucher** variant of Pass ready (25% off, 7 days) behind the
   `welcomeVoucher` config flag, default off until the voucher is issued.

### Why reverse §1

The spec's concern was the cold, unexplained prompt that gets permanently
denied. A primer screen addresses that directly: each permission is asked
only after a screen explaining its benefit, and both have "Not now".
"Not now" on notifications is remembered per member so the registrar does
not immediately re-raise the system prompt; members who onboarded on web
never see the step and are still asked once by the registrar. Location is
still asked again from "Near me" if skipped, and denial still falls back to
filtering by city.

### Why reverse §2

The Pass is the thing a new member will actually use. Showing their real
code at the end of setup makes the payoff concrete. It uses the same
endpoints and short-lived presentation token as the Pass tab, so there is no
second QR implementation to keep in sync.

### Rejected

- **Keep the intro after sign-in** (the old Welcome step): simpler, but asks
  for an email before explaining the app.
- **Illustrated intro slides**: AI-generated sets came out inconsistent
  across slides and commissioning a set costs time; UI fragments also preview
  the real product.
- **Dark onboarding theme** (from one reference): the rest of the app is
  light, so the hand-off felt like two products.
- **Interests step** ("What are you into?"): left out until Explore can use
  the answers.

## Revisit if

- Notification or location opt-in falls after release compared with the old
  registrar prompt (`push_permission_granted` / `_denied` events).
- The welcome voucher ships: set `welcomeVoucher` in `/api/v1/config`, and
  decide which places accept it before the ticket copy says anything more
  than "25% off · Expires in 7 days".
