-- Removes the Crackpot (mastermind jackpot) and Claw (claw-machine) game
-- features entirely. Both are fully decommissioned to eliminate Supabase
-- CPU load (claw_batch_manifests reads averaged 693ms/call across 5,265
-- calls against a 5-row table; Crackpot's polling routes and tables were
-- similarly high-traffic). This is a permanent, irreversible data deletion
-- of production tables — do not run without a fresh backup/snapshot, and
-- only after confirming no application traffic still writes to these
-- tables (all app-level code for both features has already been removed).
--
-- NOTE: public.touch_updated_at() is a SHARED trigger function also used by
-- farkle (010_farkle_pvp_runtime.sql), hub_miles_spend_intents
-- (046_hub_miles_spend_intents.sql), web_push_notifications
-- (047_web_push_notifications.sql), and skill_game_mastery_economy
-- (070_skill_game_mastery_economy.sql). It is NOT dropped here.
--
-- NOTE: issued_vouchers.acquisition_source keeps 'claw' as a permitted
-- historical enum value (chk_iv_acquisition_source, last defined in
-- 068_skill_game_dormant_prize_schema.sql) — existing claw-channel voucher
-- rows are not touched by this migration and the constraint is left as-is.
-- Only application code stops offering 'claw' as a new-entry channel.

-- ── Crackpot ──────────────────────────────────────────────────────────────
-- Drop order respects FKs: dependents before parents.
drop table if exists public.crackpot_guesses;
drop table if exists public.crackpot_payout_jobs;
drop table if exists public.crackpot_attempts;
drop table if exists public.crackpot_cycles;
drop table if exists public.crackpot_rotation_locks;
drop table if exists public.crackpot_orphaned_entries;

drop function if exists public.crackpot_claim_rotation_lock(text, text, integer);
drop function if exists public.crackpot_release_rotation_lock(text, text);

-- ── Claw ──────────────────────────────────────────────────────────────────
-- These tables were created via ad-hoc SQL files (not numbered migrations),
-- so this is their first appearance in the migrations/ directory.
drop table if exists public.claw_batch_manifests;
drop table if exists public.claw_batch_plays;
drop table if exists public.claw_settle_logs;
drop table if exists public.claw_sessions;
drop table if exists public.claw_voucher_redemptions;
