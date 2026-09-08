# AkibaMiles Supabase Cleanup & CPU Report

**Project:** `minimiles` (`qmhmwkjmwcvlipotvkly.supabase.co`) — one shared database used by both **Akiba-Platform** (`packages/api`, `packages/dashboard-merchant`, plus `dashboard-partner`/`widget`) and **MiniMiles** (`packages/react-app`, `hub-page`, `skill-games`, `admin-dashboard`, `backend`, `merchant-dashboard`, and others).
**Date:** 2026-09-03
**Scope:** Diagnosis + recommendations only. Nothing was changed in the live database or either repo — every statement below is proposed SQL for your team to review and run.

---

## 0. Headline finding

Supabase's own dashboard confirms the project is CPU-bound right now ("Your project is currently facing high CPU usage, and its performance is affected"). Pulling `pg_stat_statements` (Query Performance, sorted by total time) shows this is **not spread evenly** — it's dominated by one missing index:

> **One table, `minipoint_mint_jobs`, accounts for ~77% of all database query time**, because it has zero index on `user_address` — the column every hot query filters on first. It was created in an SQL file that sits **outside** your tracked Supabase migrations entirely (see §6).

That's the single highest-leverage fix available. Everything else in this report (RLS policies, unused indexes, cron density, dead schema) is real and worth doing, but secondary to this.

---

## 1. Root cause #1: missing index on `minipoint_mint_jobs` (~77% of total DB time)

Table defined in `MiniMiles/packages/react-app/sql/minipoint_mint_queue.sql`. Its only index:

```sql
create index if not exists minipoint_mint_jobs_status_available_idx
  on public.minipoint_mint_jobs (status, available_at, created_at);
```

That index serves the background worker (claims jobs by status). It does **nothing** for user-facing lookups, because none of them lead with `status`. Here's what `pg_stat_statements` actually shows, sorted by total time consumed since the last stats reset:

| % of total DB time | Total time | Calls | Mean | Filters used |
|---|---|---|---|---|
| **53.3%** | 15h 37m | 106,346 | 529ms | `user_address = $1 AND status = ANY($2) AND payload @> $3 AND created_at >= $4` |
| 13.7% | 4h 1m | 548M+ | — | *(PostgREST per-request `set_config` overhead — not fixable by indexing, see note below)* |
| 7.8% | 2h 17m | 45,729 | — | `user_address = $1 AND created_at >= $2 ORDER BY created_at DESC` |
| 6.0% | 1h 45m | 1,435 | — | `status = $1 AND payload->>$2 = $3 ORDER BY updated_at DESC` |
| 5.1% | 1h 30m | 1,758 | — | `(reason LIKE $1 OR reason LIKE $2) AND user_address = $3 AND status = $4 ORDER BY created_at DESC` |
| 4.9% | 1h 27m | 1,196 | — | same shape as above, different columns selected |

Add up the `minipoint_mint_jobs`-filtered rows (excluding the `set_config` line, which is generic PostgREST session setup, not a table query) and you get **~77% of all query time on this one table**, almost entirely because every one of these does a sequential scan filtered by an unindexed `user_address`. Cache hit rate on the top query is 99.98% — this isn't disk I/O, it's raw CPU spent scanning rows in memory on every call.

### Proposed fix

```sql
-- Covers the #1 (53.3%) and #4/#5 (5.1% + 4.9%) query shapes
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_minipoint_mint_jobs_user_status_created
  ON public.minipoint_mint_jobs (user_address, status, created_at DESC);

-- Covers the #2 (7.8%) shape (no status filter)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_minipoint_mint_jobs_user_created
  ON public.minipoint_mint_jobs (user_address, created_at DESC);
```

`CONCURRENTLY` avoids locking the table during creation — important since this table is under constant write load from the mint worker.

The 6.0% query (`status = $1 AND payload->>$2 = $3`) is worth a closer look before indexing: the JSON key being extracted (`$2`) is itself a bind parameter, which is unusual — check whether the application always passes the same key (e.g. `'orderId'` or similar) for this call site. If so, a partial/expression index on that specific key would help; if the key genuinely varies per call, no single index will cover it well and it's better left alone.

After applying, use the Advisor's **"Reset report"** (or wait for the stats window to roll over) and re-check Query Performance — you should see total DB time drop sharply.

---

## 2. Root cause #2: RLS policies re-evaluating `auth.*()` per row (systemic, 88 warnings)

Supabase's Performance Advisor flags **88 warnings**, all of the same type — **"Auth RLS Initialization Plan"**: RLS policies that call `auth.uid()` / `current_setting()` directly instead of wrapping them in a subquery. Postgres re-evaluates the un-wrapped form **once per row scanned**, instead of once per query. This is Supabase's most common and most impactful lint, and it's hitting a large share of your schema, including your single busiest table:

Confirmed affected tables (partial list — 88 total, likely most/all RLS-protected tables in the schema): `skill_game_sessions`, `skill_game_settle_jobs`, `partners`, `campaigns`, `catalog_items`, `catalog_redemptions`, `vouchers`, `audit_log`, `campaign_completions`, `partner_contacts`, `partner_users`, `campaign_targets`, `campaign_budget_rules`, `campaign_reward_rules`, `offers`.

### Proposed fix (mechanical, low-risk, apply per policy)

For every policy using `auth.uid()`, `auth.role()`, `auth.jwt()`, or `current_setting()` directly in its `USING`/`WITH CHECK` clause, wrap the call in a scalar subquery:

```sql
-- Before
create policy "own only" on public.catalog_redemptions
  using (user_id = auth.uid());

-- After
create policy "own only" on public.catalog_redemptions
  using (user_id = (select auth.uid()));
```

This changes nothing about who can see what — it only changes *how many times* Postgres evaluates the auth check. Because there are 88 of these, the fastest path is:
1. Open the Performance Advisor → Warnings tab in the Supabase dashboard.
2. Each row has a **"Resolve" / "Ask Assistant"** action that can generate the exact `ALTER POLICY` for that table.
3. Alternatively, script it: pull all policy definitions from `pg_policies` where `qual` or `with_check` contains `auth.` without `(select`, and generate the rewritten `CREATE OR REPLACE POLICY` statements programmatically — with 88 to fix, this is worth 30 minutes of scripting rather than doing them by hand.

---

## 3. Unused indexes (write-amplification + storage, 504 info-level suggestions)

The Advisor's Info tab has **504 suggestions**, dominated by "Unused Index" (an index that has never been scanned) and some "unindexed foreign key" entries. Every unused index still costs a write on every `INSERT`/`UPDATE` to that table, plus storage and vacuum overhead — it's not idle, it's a tax. Confirmed examples seen in a partial scan (504 is too many to enumerate by hand — see the "next step" below):

`cos_calendar_entries` (×2), `cos_creative_briefs`, `cos_telegram_pending_edits`, `skill_game_sessions` (×2 — your busiest table is *also* carrying dead indexes), `payout_invoices` (×3), `spend_voucher_templates`, `poll_questions`, `poll_responses` (×2), `poll_response_answers` (×2), `partner_leads` (×2), `raffle_meta`.

Notably, several `cos_*` tables (Content OS — not one of the "key products" you named) are already showing up as unused-index carriers, which suggests that package's schema footprint is worth a look too, even if it's an internal tool.

**Next step:** export the full list from Database → Advisors → Performance Advisor → Info tab → **Export** (CSV) — that gives you all 504 rows with index names and sizes in one file, which is more reliable than reading them off the paginated UI. Before dropping any index, confirm it's genuinely unused rather than just low-traffic (a monthly admin report page, for instance, will look "unused" between runs). The standard safe pattern:

```sql
-- Check size + confirm zero scans before dropping
SELECT schemaname, relname, indexrelname, idx_scan, pg_size_pretty(pg_relation_size(indexrelid))
FROM pg_stat_user_indexes
WHERE idx_scan = 0
ORDER BY pg_relation_size(indexrelid) DESC;

-- Then, per confirmed-dead index:
DROP INDEX CONCURRENTLY IF EXISTS <index_name>;
```

---

## 4. Cron job density (baseline load, independent of the above)

There's no `pg_cron` — scheduling is done via **Vercel Cron** hitting API routes in both repos, all against the same database:

| Path | Schedule | Repo |
|---|---|---|
| `/api/crackpot/payout/process` | every minute | MiniMiles / react-app |
| `/api/crackpot/cycle/expire` | every minute | MiniMiles / react-app |
| `/api/internal/process-push-jobs` | every minute | MiniMiles / hub-page |
| `/api/internal/process-sponsored-game-jobs` | */5 min | MiniMiles / react-app |
| `/api/internal/process-reward-jobs` | */5 min | MiniMiles / hub-page |
| `/api/internal/process-internal-event-jobs` | */5 min | MiniMiles / hub-page |
| `/api/internal/process-referral-reward-jobs` | */5 min | MiniMiles / hub-page |
| `/api/internal/stale-orders` | */30 min | MiniMiles / merchant-dashboard |
| `/api/admin/settle-skill-game-leaderboard` | Sun 21:10 UTC | MiniMiles / react-app |
| `/api/admin/reconciliation/digest` | daily 08:00 UTC | MiniMiles / admin-dashboard |
| `/api/internal/webhook-worker` | every minute | Akiba-Platform / api |
| `/api/internal/miles-notification-worker` | every minute | Akiba-Platform / api |

**12 scheduled jobs, 6 of them at 1-minute or 5-minute cadence**, all hitting one Postgres instance around the clock. None of these are individually wrong, but combined they set a real CPU floor regardless of how clean the schema is. Worth asking, per job: does it need to run this often, or could 1-minute jobs move to every 2-5 minutes without hurting the product (e.g. Crackpot payout/expire, webhook-worker, miles-notification-worker, push-jobs)?

---

## 5. Dead / superseded schema — safe to drop

Both repos' full migration histories (Akiba-Platform: 102 migrations, MiniMiles: 71 migrations) were reconstructed and cross-referenced against actual usage across **all** packages in both repos (not just the ones you named — a table can look dead if you only check the "key" packages). Below are the items confirmed to have **zero callers anywhere**, in either repo, including internal RPC-to-RPC calls.

### Akiba-Platform

| Object | Type | Migration | Status | Action |
|---|---|---|---|---|
| `user_miles_balance` | view | 003 | Dead | Drop |
| `deduct_campaign_budget` | function | 002 | Dead | Drop |
| `award_campaign_reward` | function | 033 | Dead/superseded by `award_quest_reward` | Drop |
| `award_purchase_reward` (v1) | function | 046 | Superseded by `award_purchase_reward_v2` | Drop |
| `get_merchant_customers` / `get_merchant_customer_detail` (v1) | functions | 057 | Superseded by `_v2` versions | Drop |
| `reward_rule_evaluations` | table | 031 | Superseded by `quest_reward_rule_evaluations` | Drop (archive rows first if any) |
| `reward_evaluation_requests` | table | 028 | Superseded by `quest_reward_evaluation_requests` | Drop (archive rows first if any) |
| `subscription_billing_adjustments` | table | 082 | Dead — bypassed by `create_subscription_upgrade_adjustment` | Drop |
| `create_voucher_program` / `update_voucher_program` | function | 003 | Superseded by `*_with_settlement` | Drop |

**Needs a human decision, not a blind drop:**
- `issue_merchant_loyalty_award` — redefined 4× with production-grade grants, but no caller found in either repo. Could be a real gap (dead code) or a caller outside these two repos (an Edge Function, a third app). Confirm in Supabase logs before touching.
- `generate_subscription_renewal_invoice`, `advance_subscription_grace_state` — look like unshipped billing automation (no cron or app code ever calls them). This reads as a **product gap** (subscriptions never auto-renew or auto-advance through grace period), not dead code to delete.
- `partner_dashboard_keys` — marked deprecated in migration 021, but still touched by one route. Confirm that route is itself dead before dropping the table.
- Two Vercel crons every minute (`webhook-worker`, `miles-notification-worker`) plus `idempotency_keys` growing unbounded with no cleanup job (migration 018's cleanup query is commented out, never enabled) — recommend adding a scheduled purge for rows older than your idempotency window.

### MiniMiles

| Object | Type | Migration | Status | Action |
|---|---|---|---|---|
| `skill_game_leaderboard_settlements` | table | 068 | Dead — confirmed by reading the actual cron route, which calls a different, newer function | Drop after archiving historical rows |
| `skill_game_leaderboard_prize_deliveries` | table | 068 | Dead, same reason | Drop after archiving |
| `complete_skill_game_leaderboard_settlement` | function | 068 | Dead | Drop |
| `issue_skill_game_leaderboard_prize_delivery` / `reserve_skill_game_leaderboard_delivery` | function | 068 | Superseded by untracked `issue_leaderboard_prize()` (see §6) | Drop |
| `record_burn_outcome` | function | 002 | Dead | Drop |
| `replay_internal_event_jobs` | function | 052 | Dead (no caller, possibly an intended ops tool never wired up) | Drop or wire up |
| `void_unfunded_hub_voucher_backlog` | function | 046 | Dead | Drop |
| `upsert_program_settlement_terms` | function | 005 | Dead | Drop |
| `add_settlement_adjustment` | function | 005 | Only exercised by a test file, never called by a route | Drop or wire in if the capability is still wanted |
| `reserve_with_program_atomic_hub` | function | 003 | Superseded by untracked `reserve_voucher_atomic()` | Drop |
| `create_or_get_hub_pass` | function | 008 | Superseded by `create_or_get_hub_pass_with_referral` | Drop |

**Confirmed still active (do not touch)** — several items looked dead on first pass but turned out to be called from the *other* repo, since both share this database: `auto_complete_stale_deliveries` (called only from Akiba-Platform's dashboard-merchant), `set_platform_voucher_price_atomic`, `confirm_subscription_payment`, `reject_subscription_payment`, the `v_admin_subscription_payment_*` views, `merchant_settlement_batches`/`items`/`events` and the whole settlement-batch admin flow. This is exactly why the cross-repo check mattered — a repo-local usage grep alone would have marked several genuinely-active objects as dead.

---

## 6. Structural issue: a second, untracked schema surface

`MiniMiles/packages/react-app/sql/` contains **~40 additional `.sql` files** that are not part of `supabase/migrations/` and were never run through your migration tooling — yet they define some of the **most heavily used tables in the entire database**, including the one responsible for 77% of current CPU load:

| File(s) | Defines | Status |
|---|---|---|
| `minipoint_mint_queue.sql` | `minipoint_mint_jobs`, `minipoint_mint_queue_locks` | **Active — this is §1's table** |
| `skill_games.sql` | `skill_game_sessions` (46 references — busiest table in the repo) | Active, and *not* the same table as migration 063's walletless-session tables — needs reconciliation |
| `claw_game_tables.sql`, `claw_batch_manifests.sql`, `claw_sessions.sql` | A third game ("Claw") entirely absent from tracked migrations | Active |
| `leaderboard_voucher_prizes.sql` | `issue_leaderboard_prize()` — the function that actually superseded migration 068 (§5) | Active |
| `reserve_voucher_atomic.sql` | The function that superseded migration 001/047's `reserve_voucher_atomic_hub` | Active |
| `vault.sql`, `verified_insights.sql` (polls) | Entire features (DeFi vault, in-app polls) absent from migrations | Active |
| `minipoint_burn_queue.sql` | Redeclares the same burn-queue objects as migration 046, with `IF NOT EXISTS` | Duplicate authorship — harmless today, but whichever file runs first "wins" the column definitions; a maintenance hazard |

**Recommendation:** before any further schema cleanup, fold this directory into your tracked migration history (or at minimum add a README documenting it as a second, intentional source of truth). Right now, anyone auditing "what's in the database" by reading `supabase/migrations/` alone — including future cleanup passes — will miss a large fraction of live, high-traffic schema.

---

## 7. Worth a product conversation: two parallel systems live at once

The Query Performance report surfaced live traffic against `users`, `daily_engagements`, and `referral_codes` — tables keyed on a plain `user_address` text column. These coexist with the newer `hub_user_wallets` / `hub_referrals` / `hub_referral_codes` system (migration 053+) keyed on `hub_user_id`. Both are receiving real traffic today. This looks like an older, pre-"Hub" identity/referral system that was never fully retired when the newer one shipped. It's not something to delete — the older tables are clearly still serving live requests — but it's a strong candidate for a deliberate consolidation project, since running two parallel identity systems against the same database is itself a source of ongoing overhead and confusion.

---

## 8. Priority order

1. **Add the two indexes in §1.** Lowest risk, highest impact, reversible in seconds (`DROP INDEX` if somehow wrong), directly targets the ~77% figure.
2. **Fix the 88 RLS policies in §2.** Mechanical, no behavior change, meaningfully reduces per-row overhead on your highest-traffic tables.
3. **Export and review the 504 unused-index list in §3**, drop what's confirmed safe.
4. **Review cron cadence in §4** — cheap to test, easy to revert.
5. **Drop the confirmed-dead objects in §5** — do this after 1-3, once you're not mid-diagnosis, and take a `pg_dump --schema-only` snapshot first as a rollback point.
6. **Fold `packages/react-app/sql/` into tracked migrations (§6)** — not urgent, but do it before the *next* cleanup pass, or this same archaeology has to be redone from scratch.
7. **§7 (dual identity systems)** is a roadmap conversation, not a cleanup task.

Nothing above has been executed — all of it is ready for your team to run as a reviewed migration.
