# Claw Batch Runbook

Use these commands from `packages/hardhat`.

## Dry Run

Generates a manifest and Merkle root without opening anything on-chain:

```bash
npm run claw:batch:dry
```

Optional inventory overrides:

```bash
CLAW_BATCH_LOSES=800 \
CLAW_BATCH_COMMONS=150 \
CLAW_BATCH_RARES=40 \
CLAW_BATCH_EPICS=10 \
CLAW_BATCH_LEGENDARYS=0 \
npm run claw:batch:dry
```

## Open Live Batch

Uploads the manifest to Supabase first, then calls `openBatch`, then updates
the Supabase row with the open transaction hash:

```bash
npm run claw:batch:open
```

Required env:

```bash
PRIVATE_KEY=...
SUPABASE_URL=...
SUPABASE_SERVICE_KEY=...
NEXT_PUBLIC_BATCH_RNG_ADDRESS=...
```

Optional env:

```bash
CLAW_BATCH_ID=202604160002
CLAW_BATCH_LOSES=800
CLAW_BATCH_COMMONS=150
CLAW_BATCH_RARES=40
CLAW_BATCH_EPICS=10
CLAW_BATCH_LEGENDARYS=0
CLAW_BATCH_SHUFFLE_SEED=manual-test-seed
```

If `CLAW_BATCH_ID` is omitted, the opener uses a UTC timestamp batch id in
`YYYYMMDDHHMMSS` format.

Do not use `CLAW_BATCH_SKIP_SUPABASE=1` for production. It opens a batch without
the settlement manifest being available to the backend.

## Upload Existing Manifest

Use this only when a manifest already exists and needs to be copied to Supabase:

```bash
CLAW_BATCH_ID=202604160001 \
CLAW_BATCH_MANIFEST_FILE=scripts/output/claw-batch-202604160001.manifest.json \
CLAW_BATCH_MERKLE_ROOT=0x... \
npm run claw:batch:upload
```

## Cron Requirement

The settlement cron must call the app with:

```bash
Authorization: Bearer $ADMIN_QUEUE_SECRET
```
