#!/usr/bin/env bash
# Wrapper for account-deletion-lost-response-retry.yaml (AKIBA-MOB-002 §15.3).
#
# Maestro can only assert what is on screen. The property under test —
# "a retry returns the original request and does not create a second one" —
# is server state, so this script sets the scenario up and checks the
# database side around the flow.
#
# Requires, against a NON-PRODUCTION environment:
#   AKIBA_API_BASE_URL          e.g. https://staging.example
#   AKIBA_E2E_DELETE_EMAIL      a freshly seeded, disposable account
#   AKIBA_E2E_ACCESS_TOKEN      that account's Supabase access token
#   AKIBA_E2E_OTP               a code from the non-production OTP harness
#   AKIBA_E2E_POLICY_VERSION    from GET /api/v1/config → legal.deletionPolicyVersion
set -euo pipefail

: "${AKIBA_API_BASE_URL:?set AKIBA_API_BASE_URL}"
: "${AKIBA_E2E_DELETE_EMAIL:?set AKIBA_E2E_DELETE_EMAIL}"
: "${AKIBA_E2E_ACCESS_TOKEN:?set AKIBA_E2E_ACCESS_TOKEN}"
: "${AKIBA_E2E_OTP:?set AKIBA_E2E_OTP}"
: "${AKIBA_E2E_POLICY_VERSION:?set AKIBA_E2E_POLICY_VERSION}"

case "$AKIBA_API_BASE_URL" in
  *app.akibamiles.com*|*production*)
    echo "refusing to run against what looks like production: $AKIBA_API_BASE_URL" >&2
    exit 1
    ;;
esac

auth=(-H "Authorization: Bearer ${AKIBA_E2E_ACCESS_TOKEN}" -H "Content-Type: application/json")

echo "1/4 issuing a deletion challenge"
challenge=$(curl -sS -X POST "${AKIBA_API_BASE_URL}/api/v1/me/account-deletion/challenge" \
  "${auth[@]}" -d '{}')
challenge_id=$(printf '%s' "$challenge" | python3 -c 'import json,sys; print(json.load(sys.stdin)["data"]["challengeId"])')

echo "2/4 submitting the request whose response we pretend was lost"
first=$(curl -sS -X POST "${AKIBA_API_BASE_URL}/api/v1/me/account-deletion-request" \
  "${auth[@]}" \
  -d "{\"challengeId\":\"${challenge_id}\",\"otp\":\"${AKIBA_E2E_OTP}\",\"acknowledgement\":true,\"policyVersion\":\"${AKIBA_E2E_POLICY_VERSION}\"}")
reference=$(printf '%s' "$first" | python3 -c 'import json,sys; print(json.load(sys.stdin)["data"]["requestId"])')
echo "    original reference: ${reference}"

echo "3/4 driving the UI retry"
AKIBA_E2E_EXPECTED_REFERENCE="$reference" maestro test \
  -e AKIBA_E2E_EXPECTED_REFERENCE="$reference" \
  .maestro/flows/account-deletion-lost-response-retry.yaml

echo "4/4 confirming the retry returned the same request and created no second one"
retry=$(curl -sS -X POST "${AKIBA_API_BASE_URL}/api/v1/me/account-deletion-request" \
  "${auth[@]}" \
  -d "{\"challengeId\":\"${challenge_id}\",\"otp\":\"000000\",\"acknowledgement\":true,\"policyVersion\":\"${AKIBA_E2E_POLICY_VERSION}\"}")
python3 - "$retry" "$reference" <<'PY'
import json, sys
body = json.loads(sys.argv[1])["data"]
expected = sys.argv[2]
assert body["requestId"] == expected, f'expected {expected}, got {body["requestId"]}'
assert body["alreadyRequested"] is True, "a retry must report alreadyRequested"
print("    ok: same requestId, alreadyRequested=true, no second request")
PY
