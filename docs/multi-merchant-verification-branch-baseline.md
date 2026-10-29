# Verification branch — restored baseline

Date: 2026-10-28
Status: Schema baseline restored and checked. Feature acceptance remains pending.

## Source and destination

- Source: main project `qmhmwkjmwcvlipotvkly`, PostgreSQL 15.8.
- Destination: verification branch `urjamfbtlzycetvuvwpg`, PostgreSQL 15.19.
- Source connections used read-only transactions or schema-only `pg_dump`.
  No source database changes were made.
- No customer rows, authentication users, storage objects, Vault secrets, or
  migration-history rows were copied.

## Restored

- All 283 public application tables and 430 public functions.
- Public schema types, views, indexes, constraints, triggers, policies and grants
  contained in the schema-only export.
- The custom `auth.users` trigger `trg_auth_user_canonical_identity`.
- Three application policies on `storage.objects`.
- Missing `citext` and `pgjwt` extensions in their source schemas.

The restore was atomic. Two initial attempts rolled back completely: one hit
Supabase-managed default privileges, and one needed the public search path for
the separately exported identity trigger. The successful attempt retained the
branch's Supabase-managed `supabase_admin` defaults and restored application
objects under `postgres`.

The comparison detected branch default grants adding privileges on 85 tables.
Those grants were reconciled to the exported source grants before the final
comparison passed.

## Verification evidence

The final read-only comparison completed at `2026-10-28T20:34:42Z`:

| Check | Result |
|---|---|
| Public table count | Source 283; branch 283 |
| Catalog entries compared | Source 7,034; branch 7,034 |
| Unexpected differences | 0 |
| Nonempty branch application tables | 0 |
| Customer rows copied | 0 |

Compared entries cover table columns/defaults, application function definition
hashes and permissions, table permissions/ownership/RLS, constraints, indexes,
views, enums, public triggers and the custom managed-table trigger, and policies
in public/auth/storage. This is not a full comparison of Supabase-managed
schemas, settings, extension implementations, sequence state, or external
services.

The one intentional application catalog difference is
`public.web_push_jobs.trg_web_push_jobs_dispatch`: enabled on main, disabled on
the verification branch. Test inserts must not dispatch notifications. No
scheduled jobs or notification configuration were copied.

Detailed exports and comparison results are in the Git-ignored `.verification/`
directory. Schema exports are private local artifacts; do not attach their raw
function bodies to release evidence or commit them without review.

## What this closes and what remains

This replaces the empty branch with the running database's actual application
schema, including objects omitted from the local migration replay. It does not
prove historical migration apply order, and
`MIGRATION_ORDER_VERIFIED_AGAINST_PRODUCTION` remains false.

The new multi-merchant helpers, atomic authoring wrappers and readiness helper
were absent from the source schema. Pending feature migrations have not been
applied to the branch yet. Next, check their prerequisites against this baseline,
apply the reviewed feature migrations only to the branch, seed synthetic data
and execute the functional and browser checks in the
[staging runbook](multi-merchant-staging-verification-runbook.md).

Storage buckets, lookup/configuration rows, rates, users, merchant subscriptions
and test funds must be seeded explicitly where needed; schema cloning does not
populate them. App preview configuration must target the verification branch.
Publication and production promotion remain blocked pending acceptance results.

## Feature migrations applied to the branch

At `2026-10-28T20:38:33Z`, the following migrations were applied to verification
branch `urjamfbtlzycetvuvwpg` in one transaction, with matching entries in
`supabase_migrations.schema_migrations`:

| Branch history version | Source migration |
|---|---|
| `20261028203825` | Platform `154_multi_merchant_funded_vouchers.sql` |
| `20261028203826` | MiniMiles `113_multi_merchant_funded_claims.sql` |
| `20261028203827` | Platform `155_atomic_allocation_authoring.sql` |
| `20261028203828` | Platform `156_allocation_publication_readiness.sql` |

Checks confirmed both live inspect/redeem definitions use the shared merchant
gate, the transition function contains the readiness gate, and both merchant
and redemption-schedule snapshot triggers are enabled. Direct helper calls
accepted a secondary snapshot merchant, rejected an outside merchant, and kept
a legacy voucher primary-only.

These are migration and targeted runtime checks, not end-to-end acceptance.
No synthetic records have been seeded yet. Main was not modified. The unrelated
Platform 153 merchant-terms migration was not applied as part of this batch.

The exact source checksums and branch version mapping are in
`.verification/feature-migrations-result.json`. The timestamp versions above
identify this branch's deployment of the existing numeric repository files;
they do not establish historical production apply order. Reconcile this mapping
with the eventual production deployment workflow to avoid applying the same SQL
twice under different migration IDs. Do not bulk-push both repositories' entire
migration directories or promote the schema-copy baseline as a new production
migration.

## Synthetic fixture seeded

Completed at `2026-10-28T20:45:59Z` on the verification branch only.

- Merchants: Verification Merchant A, B and C, all active with active test
  subscriptions and published directory entries. All three pass allocation
  readiness checks. Payout destinations are unset, as an advisory state; no
  real payments or payout destinations were configured.
- Active fund: `270850b0-f873-4adc-99c8-a7fde4316b9e`, synthetic KES 2,000
  authorization. This is test accounting, not a transfer of money.
- Active allocation: `37e30c21-23a6-4132-9090-089b27800f93`. One shared offer,
  10% off capped at KES 200, KES 300 minimum spend, seven-day issued-voucher
  validity, and quantity cap 10 so it remains active after three grants.
- Members: `mm-member-1@example.test`, `mm-member-2@example.test`, and
  `mm-member-3@example.test`. Each has a confirmed Auth account, Kenya profile,
  canonical identity, username and Pass. Password sign-in passed for all three.
- Each member received one issued voucher through the real `internal_grant`
  claim path. Each voucher snapshot names A, B and C. Three reservations total
  KES 600; none of the vouchers has been redeemed.
- Two synthetic support Auth accounts with internal ops/finance identities
  were created to attribute fund and allocation lifecycle transitions to
  different operators. Program and allocation activation used their actual
  lifecycle RPCs; this does not claim that the admin UI was exercised.
- A synthetic KES Miles rate was seeded at 1 Mile per KES 100 to support later
  checkout tests. No outbound emails were sent by account creation.

The idempotent seed manifest, including generated login passwords, is local and
Git-ignored at `.verification/synthetic-fixture-private.json`. Its sanitized
result is `.verification/synthetic-fixture-result.json`. Reuse the manifest for
future fixture work rather than creating duplicate funds or accounts.

The member and merchant app configurations have not been switched to this
branch. Browser verification and till staff-account provisioning remain to be
done before testing through the UI. End-to-end checkout acceptance and production
promotion remain outstanding.
