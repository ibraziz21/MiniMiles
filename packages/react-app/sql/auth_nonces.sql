-- auth_nonces.sql
-- Stores short-lived sign-in nonces for wallet authentication.
-- Replaces the in-memory Map in lib/auth.ts so nonces survive
-- multi-instance deployments (Vercel, etc.).
--
-- Run once. Safe to re-run (all statements are idempotent).

create table if not exists auth_nonces (
  address     text        not null primary key,  -- one pending nonce per address
  nonce       text        not null,
  expires_at  timestamptz not null,
  created_at  timestamptz not null default now()
);

-- Purge expired rows automatically via a periodic job or pg_cron.
-- For Supabase free tier, the DELETE in verifyNonce is sufficient cleanup
-- since old rows only accumulate for users who abandon sign-in flows.
create index if not exists idx_auth_nonces_expires_at on auth_nonces (expires_at);
