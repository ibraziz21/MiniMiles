-- leaderboard_voucher_prizes_channel_bridge.sql
-- Bridges the pilot's hand-seeded game_weekly_campaigns config to real
-- merchant self-service allocations (Akiba-Platform/packages/dashboard-merchant
-- writes voucher_program_channel_allocations with
-- channel = 'weekly_leaderboard_challenge' — MiniMiles migration
-- 045_weekly_leaderboard_channel.sql). Until now nothing read those
-- allocations; settlement only ever issued from the hand-authored `tiers`
-- jsonb on game_weekly_campaigns (sql/leaderboard_voucher_prizes.sql,
-- sql/seed_pilot_dev.sql).
--
-- Kept as an ungoverned sql/*.sql file (not a numbered supabase/migrations/
-- entry) because it alters tables created by that same ungoverned file —
-- same reasoning migration 045's header gives for not taking a hard FK on
-- sponsored_game_campaigns: apply-order across these two file categories
-- isn't guaranteed.
--
-- Adds one nullable column: game_weekly_campaigns.program_id. When set, the
-- campaign's merchant + voucher come from a real voucher_programs row
-- instead of the hand-authored merchant_id/tiers columns — one sponsor per
-- week, same voucher to all 3 ranks (matches the merchant self-service
-- model: one template, one channel cap, no per-rank tiering). Existing
-- hand-seeded rows (program_id IS NULL) are untouched and keep working via
-- the original tiers-jsonb path.
--
-- merchant_id was NOT NULL because every prior row was hand-authored with
-- one; a program_id-backed row derives its merchant live from the program
-- instead, so merchant_id is relaxed to nullable rather than requiring the
-- admin-assignment route to redundantly resolve and pass it.
--
-- Idempotent: safe to re-run.

-- issue_voucher_from_program() (003_voucher_programs_phase2.sql) is broken
-- against this DB's actual issued_vouchers schema, for every channel it
-- serves (claw, raffle, giveaway, merchant_grant, akiba_grant) — not just
-- weekly_leaderboard_challenge. Its INSERT never satisfies three NOT NULL
-- columns this table currently has:
--
--   qr_payload    NOT NULL, no default. Only meaningful for the legacy
--                 physical-QR redemption flow the RPC predates/ignores.
--                 Relaxed to nullable rather than threading a fake
--                 placeholder through every programmatic issuance path.
--
--   burn_tx_hash  NOT NULL, no default, not set by any trigger either
--                 (checked: the only BEFORE INSERT trigger on this table,
--                 fn_iv_source_ref_required, validates source_ref only).
--                 A freshly issued, unburned voucher has no burn tx yet —
--                 same as redeem_tx_id/refund_tx_hash, which are correctly
--                 nullable. This NOT NULL is simply wrong; relaxed here.
--
--   expires_at    NOT NULL, but its source — spend_voucher_templates.expires_at
--                 — is nullable (a merchant can legitimately offer a
--                 no-expiry voucher). Relaxed to nullable to match the
--                 template layer's own optionality, rather than forcing a
--                 synthetic expiry onto every issuance (would silently
--                 change existing product behavior for every other caller
--                 of this RPC).
alter table issued_vouchers
  alter column qr_payload drop not null;

alter table issued_vouchers
  alter column burn_tx_hash drop not null;

alter table issued_vouchers
  alter column expires_at drop not null;

-- chk_iv_acquisition_source is the actual reason weekly_leaderboard_challenge
-- has never been able to issue a voucher through any code path, pilot
-- included: migration 045_weekly_leaderboard_channel.sql widened the channel
-- enum on voucher_program_channel_allocations, but never widened this
-- separate CHECK constraint on issued_vouchers.acquisition_source — the
-- column issue_voucher_from_program() actually writes the channel into.
-- Confirmed live allow-list before this fix: miles_purchase, claw, raffle,
-- giveaway, akiba_grant, merchant_grant — neither weekly_leaderboard_challenge
-- nor the pilot's own legacy 'leaderboard_win' string was ever permitted.
-- This really belongs in 045's rollout; recorded here because this branch's
-- supabase/migrations/ has diverged from main's (stops at 029, missing
-- 030–045 including 045 itself) even though the live DB already has 045's
-- other changes applied — that divergence is a separate thing worth
-- reconciling, not something this file attempts to fix.
alter table issued_vouchers
  drop constraint if exists chk_iv_acquisition_source;

alter table issued_vouchers
  add constraint chk_iv_acquisition_source
  check (acquisition_source = ANY (ARRAY[
    'miles_purchase', 'claw', 'raffle', 'giveaway', 'akiba_grant', 'merchant_grant',
    'weekly_leaderboard_challenge', 'leaderboard_win'
  ]));

alter table game_weekly_campaigns
  alter column merchant_id drop not null;

alter table game_weekly_campaigns
  add column if not exists program_id uuid references voucher_programs(id);

do $$
begin
  if not exists (
    select 1 from information_schema.table_constraints
    where table_name = 'game_weekly_campaigns' and constraint_name = 'chk_gwc_merchant_or_program'
  ) then
    alter table game_weekly_campaigns
      add constraint chk_gwc_merchant_or_program
      check (merchant_id is not null or program_id is not null);
  end if;
end;
$$;

-- ── issue_leaderboard_prize() — program_id branch added ───────────────────────
-- program_id IS NOT NULL → issue via the existing, already-hardened
-- issue_voucher_from_program() RPC (atomic cap/state checks, its own
-- source_ref idempotency) against the real allocation, then backfill
-- win_meta so the existing reveal/burn/banner UI (which reads win_meta, not
-- rules_snapshot) keeps working unchanged. acquisition_source becomes
-- 'weekly_leaderboard_challenge' (set by issue_voucher_from_program's
-- p_channel) instead of the legacy 'leaderboard_win' string — every
-- consumer of that string must now accept both (see
-- lib/games/prizeAcquisitionSources.ts).
--
-- program_id IS NULL → original hand-authored tiers-jsonb path, unchanged.

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
  v_campaign    game_weekly_campaigns%rowtype;
  v_tier        jsonb;
  v_source_ref  text := p_game_type || ':' || p_week || ':' || p_rank::text;
  v_existing    issued_vouchers%rowtype;
  v_voucher_id  uuid;
  v_out_code    text;
  v_template    record;
begin
  select * into v_campaign from game_weekly_campaigns where id = p_campaign_id;
  if not found or not v_campaign.active then
    raise exception 'CAMPAIGN_NOT_FOUND: %', p_campaign_id using errcode = 'P0001';
  end if;

  -- Idempotency: existing voucher for this (game, week, rank) wins, either path.
  select * into v_existing from issued_vouchers where source_ref = v_source_ref;
  if found then
    return query select v_existing.id, v_existing.code, true;
    return;
  end if;

  if v_campaign.program_id is not null then
    select ivfp.voucher_id, ivfp.code into v_voucher_id, v_out_code
      from issue_voucher_from_program(
        v_campaign.program_id,
        'weekly_leaderboard_challenge',
        v_source_ref,
        lower(p_user_address),
        null,
        p_code,
        jsonb_build_object('game_type', p_game_type, 'week', p_week, 'rank', p_rank, 'score', p_score),
        'weekly_leaderboard_settlement'
      ) as ivfp;

    select svt.title, svt.discount_percent, svt.miles_cost
      into v_template
      from voucher_programs vp
      join spend_voucher_templates svt on svt.id = vp.template_id
     where vp.id = v_campaign.program_id;

    update issued_vouchers
       set win_meta = jsonb_build_object(
             'game_type',         p_game_type,
             'week',              p_week,
             'rank',              p_rank,
             'score',             p_score,
             'label',             coalesce(v_template.discount_percent::text || '% off', v_template.title),
             'discount_percent',  v_template.discount_percent,
             'spend_cap_kes',     null,
             'marketplace_miles', v_template.miles_cost,
             'burn_pct',          0.80,
             'expiry_burn_pct',   0.50
           )
     where id = v_voucher_id;

    insert into leaderboard_prize_events
      (voucher_id, campaign_id, game_type, week, rank, score, user_address)
    values
      (v_voucher_id, p_campaign_id, p_game_type, p_week, p_rank, p_score, lower(p_user_address));

    return query select v_voucher_id, v_out_code, false;
    return;
  end if;

  select t into v_tier
    from jsonb_array_elements(v_campaign.tiers) t
   where (t->>'rank')::int = p_rank;
  if v_tier is null then
    raise exception 'TIER_NOT_FOUND: rank % in campaign %', p_rank, p_campaign_id using errcode = 'P0001';
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

-- ── burn_voucher_for_miles() — accept both acquisition_source values ─────────
-- Same body as sql/leaderboard_voucher_prizes.sql, only the NOT_BURNABLE
-- guard changed: a program-backed win now carries acquisition_source =
-- 'weekly_leaderboard_challenge', not the legacy 'leaderboard_win'.

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
  if v_voucher.acquisition_source not in ('leaderboard_win', 'weekly_leaderboard_challenge') then
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
