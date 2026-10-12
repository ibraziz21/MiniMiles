# Maestro E2E harness

AKIBA-MOB-002 §15.3. First device-driving tests for Akiba Pass: they cover
the MOB-001 launch/onboarding flow that shipped unverified by E2E, plus the
MOB-002 account-control flow.

## Running

```bash
# once, per machine
curl -fsSL https://get.maestro.mobile.dev | bash

# against a running simulator/emulator with a development or preview build
# installed (NOT Expo Go — the app needs its own native modules)
maestro test .maestro/flows/first-run-onboarding.yaml
maestro test .maestro/flows            # whole suite
```

## Environment

Every flow reads its inputs from the environment so nothing about a test
account is committed:

```bash
export AKIBA_E2E_EMAIL=...        # a disposable, seeded account
export AKIBA_E2E_OTP=...          # from the non-production OTP harness
export AKIBA_E2E_DELETE_EMAIL=... # separate account — deletion is one-way
```

**These flows must never run against production.** The build under test has
to point at a non-production `EXPO_PUBLIC_API_BASE_URL` and a non-production
Supabase project. `account-deletion-submit.yaml` destroys its account, and
`account-deletion-lost-response-retry.yaml` relies on the request API being
idempotent — neither is reversible.

## What still needs a human

- A non-production OTP harness (a fixed test code, or a mailbox API the flow
  can read). Supabase email OTP cannot be read by Maestro on its own, so the
  flows that need a code take `AKIBA_E2E_OTP` from the environment.
- Asserting backend state. §15.3 requires `account-deletion-submit` to assert
  the receipt actually exists server-side; Maestro only sees the screen.
  `scripts/lost-response-retry.sh` is the pattern — it sets up the scenario
  over the API, runs the flow, and then verifies server-side that the retry
  returned the original request and created no second one. An equivalent
  wrapper for `account-deletion-submit.yaml` still needs writing.
- The physical-device matrix (§15.5) is a manual checklist, not a flow.
