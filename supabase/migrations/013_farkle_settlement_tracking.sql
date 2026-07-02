-- Farkle settlement tracking.
--
-- Adds settled_at to game_matches so the reconcile sweeps (both Railway and
-- Vercel cron) can skip rows that are already confirmed on-chain without making
-- an RPC call per row. The backend sets settled_at after a successful
-- settleFarkleOnChain() or when isFarkleMatchSettledOnChain() returns true.
--
-- Partial index speeds up the reconcile query pattern:
--   WHERE status = 'completed' AND settled_at IS NULL

alter table if exists public.game_matches
  add column if not exists settled_at timestamptz;

create index if not exists game_matches_unsettled_idx
  on public.game_matches (completed_at)
  where status = 'completed' and settled_at is null;
