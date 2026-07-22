-- leaderboard_voucher_prizes.sql
-- Skill games: merchant voucher prizes replacing USDT payouts.
-- See docs/skill-games-voucher-prizes-spec.md
--
-- Adds:
--   1. issued_vouchers columns for won vouchers (win_meta, win_seen_at,
--      source_ref, acquisition_source, expires_at)
--   2. game_weekly_campaigns  — campaign config (merchant + tiers), data not code
--   3. leaderboard_prize_events — issuance audit trail
--   4. voucher_burn_events   — every burn, with required reason (pilot analytics)
--   5. issue_leaderboard_prize()  — idempotent settlement issuance
--   6. burn_voucher_for_miles()   — atomic burn: reason row + status + Miles mint job
--
-- Idempotent: safe to re-run.

create extension if not exists pgcrypto;

-- ── 1. issued_vouchers additions ──────────────────────────────────────────────

alter table issued_vouchers
  add column if not exists acquisition_source text,          -- 'leaderboard_win' (null = purchased)
  add column if not exists win_meta           jsonb,         -- {game_type, week, rank, score,
                                                             --  marketplace_miles, burn_pct, expiry_burn_pct}
  add column if not exists win_seen_at        timestamptz,   -- win reveal sheet shown
  add column if not exists source_ref         text,          -- 'memory_flip:2026-W30:2'
  add column if not exists expires_at         timestamptz;

create unique index if not exists uq_iv_source_ref
  on issued_vouchers (source_ref)
  where source_ref is not null;

-- Allow 'burned' + 'expired' statuses if a CHECK constraint exists.
do $$
begin
  if exists (
    select 1 from information_schema.constraint_column_usage
    where table_name = 'issued_vouchers' and constraint_name = 'issued_vouchers_status_check'
  ) then
    alter table issued_vouchers drop constraint issued_vouchers_status_check;
    alter table issued_vouchers add constraint issued_vouchers_status_check
      check (status in ('pending','issued','claiming','redeemed','void','burned','expired'));
  end if;
end $$;

-- ── 2. game_weekly_campaigns ──────────────────────────────────────────────────

create table if not exists game_weekly_campaigns (
  id           uuid primary key default gen_random_uuid(),
  merchant_id  uuid not null references partners(id),
  week_from    date not null,               -- inclusive (Monday)
  week_to      date not null,               -- exclusive (next Monday)
  active       boolean not null default true,
  game_types   text[] not null default '{rule_tap,memory_flip}',
  -- [{rank:1, template_id:'…', label:'25% off', discount_percent:25,
  --   spend_cap_kes:3000, marketplace_miles:750, burn_pct:0.80, expiry_burn_pct:0.50}, …]
  tiers        jsonb not null,
  created_at   timestamptz not null default now()
);

create index if not exists idx_gwc_active_week
  on game_weekly_campaigns (active, week_from, week_to);

-- ── 3. leaderboard_prize_events (issuance audit) ──────────────────────────────

create table if not exists leaderboard_prize_events (
  id           uuid primary key default gen_random_uuid(),
  voucher_id   uuid references issued_vouchers(id),
  campaign_id  uuid references game_weekly_campaigns(id),
  game_type    text not null,
  week         text not null,               -- ISO 'YYYY-Www'
  rank         int  not null,
  score        int,
  user_address text not null,
  created_at   timestamptz not null default now()
);

create index if not exists idx_lpe_week on leaderboard_prize_events (week, game_type);

-- ── 4. voucher_burn_events ────────────────────────────────────────────────────

create table if not exists voucher_burn_events (
  id                uuid primary key default gen_random_uuid(),
  voucher_id        uuid not null references issued_vouchers(id) unique,
  user_address      text not null,
  reason            text not null check (reason in
                      ('not_in_country','too_far','not_interested','prefer_miles','other','expired')),
  reason_text       text,
  miles_credited    int  not null,
  marketplace_miles int  not null,
  user_country      text,                   -- from profile at burn time
  user_city         text,
  game_type         text,
  week              text,
  rank              int,
  merchant_id       uuid,
  sheet_shown_at    timestamptz,            -- = win_seen_at (time-to-decision)
  created_at        timestamptz not null default now()
);

create index if not exists idx_vbe_reason  on voucher_burn_events (reason);
create index if not exists idx_vbe_country on voucher_burn_events (user_country);

-- ── 5. issue_leaderboard_prize() — idempotent settlement issuance ─────────────
-- Called by the week-close settlement job for each (game, rank) winner.
-- Re-running for the same source_ref returns the existing voucher.

create or replace function issue_leaderboard_prize(
  p_campaign_id  uuid,
  p_game_type    text,
  p_week         text,          -- 'YYYY-Www'
  p_rank         int,
  p_user_address text,
  p_score        int,
  p_code         text,          -- generated by caller (server route)
  p_qr_payload   text
)
returns table (voucher_id uuid, code text, already_issued boolean)
language plpgsql
security definer
as $$
declare
  v_campaign   game_weekly_campaigns%rowtype;
  v_tier       jsonb;
  v_source_ref text := p_game_type || ':' || p_week || ':' || p_rank::text;
  v_existing   issued_vouchers%rowtype;
  v_voucher_id uuid;
begin
  select * into v_campaign from game_weekly_campaigns where id = p_campaign_id;
  if not found or not v_campaign.active then
    raise exception 'CAMPAIGN_NOT_FOUND: %', p_campaign_id using errcode = 'P0001';
  end if;

  select t into v_tier
    from jsonb_array_elements(v_campaign.tiers) t
   where (t->>'rank')::int = p_rank;
  if v_tier is null then
    raise exception 'TIER_NOT_FOUND: rank % in campaign %', p_rank, p_campaign_id using errcode = 'P0001';
  end if;

  -- Idempotency: existing voucher for this (game, week, rank) wins.
  select * into v_existing from issued_vouchers where source_ref = v_source_ref;
  if found then
    return query select v_existing.id, v_existing.code, true;
    return;
  end if;

  insert into issued_vouchers (
    user_address, merchant_id, voucher_template_id,
    code, qr_payload, status,
    acquisition_source, source_ref, expires_at,
    win_meta, idempotency_key
  ) values (
    lower(p_user_address), v_campaign.merchant_id, (v_tier->>'template_id')::uuid,
    p_code, p_qr_payload, 'issued',
    'leaderboard_win', v_source_ref, now() + interval '30 days',
    jsonb_build_object(
      'game_type',         p_game_type,
      'week',              p_week,
      'rank',              p_rank,
      'score',             p_score,
      'label',             v_tier->>'label',
      'discount_percent',  (v_tier->>'discount_percent')::int,
      'spend_cap_kes',     (v_tier->>'spend_cap_kes')::int,
      'marketplace_miles', (v_tier->>'marketplace_miles')::int,
      'burn_pct',          coalesce((v_tier->>'burn_pct')::numeric, 0.80),
      'expiry_burn_pct',   coalesce((v_tier->>'expiry_burn_pct')::numeric, 0.50)
    ),
    'lb:' || v_source_ref
  )
  returning id into v_voucher_id;

  insert into leaderboard_prize_events
    (voucher_id, campaign_id, game_type, week, rank, score, user_address)
  values
    (v_voucher_id, p_campaign_id, p_game_type, p_week, p_rank, p_score, lower(p_user_address));

  return query select v_voucher_id, p_code, false;
end;
$$;

revoke all on function issue_leaderboard_prize(uuid,text,text,int,text,int,text,text) from public;
revoke all on function issue_leaderboard_prize(uuid,text,text,int,text,int,text,text) from anon;
revoke all on function issue_leaderboard_prize(uuid,text,text,int,text,int,text,text) from authenticated;
grant execute on function issue_leaderboard_prize(uuid,text,text,int,text,int,text,text) to service_role;

-- ── 6. burn_voucher_for_miles() — atomic burn ─────────────────────────────────
-- Single transaction: validate → burn-event row (required) → status='burned'
-- → enqueue Miles mint job. No Miles are ever credited without the reason row.
-- p_expired=true is used only by the expiry sweep (reason must be 'expired',
-- pays expiry_burn_pct instead of burn_pct).

create or replace function burn_voucher_for_miles(
  p_voucher_id   uuid,
  p_user_address text,          -- '' for expiry sweep (uses voucher owner)
  p_reason       text,
  p_reason_text  text default null,
  p_user_country text default null,
  p_user_city    text default null,
  p_expired      boolean default false
)
returns table (miles_credited int, marketplace_miles int)
language plpgsql
security definer
as $$
declare
  v_voucher issued_vouchers%rowtype;
  v_mkt     int;
  v_pct     numeric;
  v_miles   int;
begin
  select * into v_voucher from issued_vouchers where id = p_voucher_id for update;
  if not found then
    raise exception 'VOUCHER_NOT_FOUND' using errcode = 'P0001';
  end if;
  if v_voucher.acquisition_source is distinct from 'leaderboard_win' then
    raise exception 'NOT_BURNABLE: only won vouchers can be burned' using errcode = 'P0001';
  end if;
  if v_voucher.status <> 'issued' then
    raise exception 'INVALID_STATUS: %', v_voucher.status using errcode = 'P0001';
  end if;

  if p_expired then
    if p_reason <> 'expired' then
      raise exception 'REASON_MISMATCH' using errcode = 'P0001';
    end if;
    if v_voucher.expires_at is null or v_voucher.expires_at > now() then
      raise exception 'NOT_EXPIRED' using errcode = 'P0001';
    end if;
  else
    if lower(p_user_address) <> v_voucher.user_address then
      raise exception 'FORBIDDEN: not voucher owner' using errcode = 'P0001';
    end if;
    if p_reason = 'expired' then
      raise exception 'REASON_MISMATCH' using errcode = 'P0001';
    end if;
    if v_voucher.expires_at is not null and v_voucher.expires_at <= now() then
      raise exception 'VOUCHER_EXPIRED' using errcode = 'P0001';
    end if;
  end if;

  v_mkt := (v_voucher.win_meta->>'marketplace_miles')::int;
  v_pct := case when p_expired
                then coalesce((v_voucher.win_meta->>'expiry_burn_pct')::numeric, 0.50)
                else coalesce((v_voucher.win_meta->>'burn_pct')::numeric, 0.80)
           end;
  if v_mkt is null or v_mkt <= 0 then
    raise exception 'NO_BURN_VALUE: win_meta.marketplace_miles missing' using errcode = 'P0001';
  end if;
  v_miles := greatest(1, round(v_mkt * v_pct)::int);

  -- Reason row first — its UNIQUE(voucher_id) also guards double-burn.
  insert into voucher_burn_events (
    voucher_id, user_address, reason, reason_text,
    miles_credited, marketplace_miles,
    user_country, user_city,
    game_type, week, rank, merchant_id, sheet_shown_at
  ) values (
    v_voucher.id, v_voucher.user_address, p_reason, p_reason_text,
    v_miles, v_mkt,
    p_user_country, p_user_city,
    v_voucher.win_meta->>'game_type',
    v_voucher.win_meta->>'week',
    (v_voucher.win_meta->>'rank')::int,
    v_voucher.merchant_id, v_voucher.win_seen_at
  );

  update issued_vouchers
     set status = case when p_expired then 'expired' else 'burned' end
   where id = v_voucher.id;

  -- Miles credit via the existing mint queue (idempotent on voucher id).
  insert into minipoint_mint_jobs (idempotency_key, user_address, points, reason, payload)
  values (
    'voucher_burn:' || v_voucher.id::text,
    v_voucher.user_address,
    v_miles,
    case when p_expired then 'voucher_expiry_burn' else 'voucher_burn' end,
    jsonb_build_object('voucher_id', v_voucher.id, 'burn_reason', p_reason)
  )
  on conflict (idempotency_key) do nothing;

  return query select v_miles, v_mkt;
end;
$$;

revoke all on function burn_voucher_for_miles(uuid,text,text,text,text,text,boolean) from public;
revoke all on function burn_voucher_for_miles(uuid,text,text,text,text,text,boolean) from anon;
revoke all on function burn_voucher_for_miles(uuid,text,text,text,text,text,boolean) from authenticated;
grant execute on function burn_voucher_for_miles(uuid,text,text,text,text,text,boolean) to service_role;
