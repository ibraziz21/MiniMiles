# Merchant discovery quest rollout

The rollout health path uses first-party database records only. Merchant quest
proof, claim, retry, completion, and terminal failure transitions do not depend
on PostHog.

## Deployment order

1. Apply `sql/merchant_discovery_quests.sql`.
2. Apply `sql/merchant_quest_action_proofs.sql`.
3. Apply `sql/merchant_quest_reward_delivery.sql`.
4. Apply `sql/merchant_quest_rollout_observability.sql`.
5. Apply root migration `supabase/migrations/054_canonical_partner_quest_completion.sql`.
6. Deploy the React application, Hub, and mint worker from the same release.

Migration 054 must precede the application deploy: React reserves canonical
completion before queueing, and Hub uses its atomic off-chain ledger RPC.

The event table is service-role-only. Do not add public read policies.

## Release controls

The section fails closed unless the server has:

```sh
MERCHANT_QUESTS_ENABLED=true
MERCHANT_QUESTS_ROLLOUT_PERCENT=0
MERCHANT_QUESTS_ALLOWLIST=0xPilotWallet1,0xPilotWallet2
```

The master switch controls every merchant quest surface. Allowlisted wallets
are always included while the switch is on. Other wallets are assigned to a
stable percentage cohort based on their normalized wallet address.

Keep the percentage at `0` for internal testing, then increase it without
changing the allowlist. Set it to `100` for full release. Setting the master
switch to `false` immediately hides the section and rejects new merchant quest
proof, eligibility, and claim requests. Existing queued rewards still finish in
the mint worker.

## Readiness check

Set `ADMIN_QUEUE_SECRET`, then call:

```sh
curl -H "Authorization: Bearer $ADMIN_QUEUE_SECRET" \
  "https://<app-host>/api/admin/merchant-quests/health?hours=24"
```

The endpoint returns aggregate counts only; it does not return wallet addresses.
It reports unhealthy when:

- no active sponsored-game campaign is configured;
- any merchant quest reward job in the selected window has failed; or
- a merchant quest reward job has remained in `processing` for over 10 minutes.

Use `hours=1` through `hours=168` to change the observation window.

## Rollout gates

Before enabling the section for all users:

- the health endpoint is `healthy: true`;
- each of the five fixed quest IDs exists in `partner_quests`;
- the sponsored leaderboard has an active campaign with at least one game type;
- one test wallet completes each action and reaches `completed`;
- a forced failed reward can be retried and reaches `reward_completed`;
- the mint worker is deployed continuously, not only the one-shot drain script.

During rollout, check the endpoint after each cohort increase. Pause expansion
if failures or stuck jobs appear. Lifecycle audit writes are deliberately
best-effort, so an observability outage cannot turn a valid proof or confirmed
mint into a failed user flow.
