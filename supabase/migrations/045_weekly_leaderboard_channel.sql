-- Weekly Leaderboard Challenge distribution channel
-- (merchant-ux-spec.md §4 Step 4, §14: "The Weekly Leaderboard Challenge
-- requires a runtime-backed channel identifier before it can issue
-- inventory.") This migration is that identifier: adds
-- 'weekly_leaderboard_challenge' to the channel enum merchants can select,
-- plus an optional link from a channel allocation to the campaign/week it
-- draws from.
--
-- The campaign concept already exists — sponsored_game_campaigns, added by
-- packages/react-app/sql/sponsored_games.sql for discovery-quests-spec.md
-- §3.4 (gating the sponsored_game_played webhook on an active campaign
-- window). Investigation confirmed both specs want the same "currently
-- active weekly campaign" concept, not two disconnected ones, so
-- campaign_id below is a soft reference to that table's id column.
--
-- No FK constraint: sponsored_game_campaigns lives in an ungoverned
-- packages/react-app/sql/*.sql file, not this numbered migration sequence,
-- so its presence/apply-order in any given environment isn't guaranteed the
-- way another numbered migration's would be. A hard FK here would make this
-- migration fail wherever that file hasn't been run yet.
--
-- What this migration deliberately does NOT add: any leaderboard
-- winner-selection or voucher-issuance-on-qualification logic. Per
-- merchant-ux-spec.md §2 non-goals and §10 ("challenge eligibility and
-- winner selection are controlled by the platform runtime"), this dashboard
-- only allocates inventory to the channel — resolving weekly winners and
-- issuing their vouchers is Platform/react-app-side work, tracked
-- separately.

ALTER TABLE voucher_program_channel_allocations
  DROP CONSTRAINT IF EXISTS voucher_program_channel_allocations_channel_check;

ALTER TABLE voucher_program_channel_allocations
  ADD CONSTRAINT voucher_program_channel_allocations_channel_check
  CHECK (channel IN (
    'miles_purchase','claw','raffle',
    'giveaway','akiba_grant','merchant_grant',
    'weekly_leaderboard_challenge'
  ));

ALTER TABLE voucher_program_channel_allocations
  ADD COLUMN IF NOT EXISTS campaign_id uuid;

COMMENT ON COLUMN voucher_program_channel_allocations.campaign_id IS
  'Soft reference to sponsored_game_campaigns.id (packages/react-app/sql/sponsored_games.sql) — no FK, see migration header. Only meaningful for channel = weekly_leaderboard_challenge; NULL otherwise.';

-- Redefine create_voucher_program with the widened channel list — full body
-- unchanged from 003_voucher_programs_phase2.sql except v_valid_channels,
-- same pattern 044_internal_event_outbox.sql used for advance_order_status.

CREATE OR REPLACE FUNCTION create_voucher_program(
  p_name              text,
  p_template_id       uuid,
  p_funding_type      text,
  p_sponsor           text,
  p_total_cap         integer,
  p_start_at          timestamptz,
  p_end_at            timestamptz,
  p_channels          jsonb,            -- [{channel, cap, active}]
  p_merchant_user_id  uuid,
  p_partner_id        uuid
)
RETURNS TABLE (ok boolean, program_id uuid, error_code text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_program_id     uuid;
  v_ch             record;
  v_cap_sum        bigint := 0;
  v_valid_channels text[] := ARRAY[
    'miles_purchase','claw','raffle','giveaway','merchant_grant','akiba_grant',
    'weekly_leaderboard_challenge'
  ];
  v_valid_funding  text[] := ARRAY['miles','akiba','sponsor','free'];
BEGIN
  IF trim(COALESCE(p_name,'')) = '' THEN
    RAISE EXCEPTION 'INVALID_NAME' USING ERRCODE = 'P0001';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM spend_voucher_templates WHERE id = p_template_id) THEN
    RAISE EXCEPTION 'TEMPLATE_NOT_FOUND' USING ERRCODE = 'P0001';
  END IF;
  IF NOT (p_funding_type = ANY(v_valid_funding)) THEN
    RAISE EXCEPTION 'INVALID_FUNDING_TYPE: %', p_funding_type USING ERRCODE = 'P0001';
  END IF;
  IF p_total_cap IS NOT NULL AND p_total_cap <= 0 THEN
    RAISE EXCEPTION 'INVALID_TOTAL_CAP: must be positive' USING ERRCODE = 'P0001';
  END IF;
  IF p_start_at IS NOT NULL AND p_end_at IS NOT NULL AND p_start_at >= p_end_at THEN
    RAISE EXCEPTION 'INVALID_SCHEDULE: start_at must be before end_at' USING ERRCODE = 'P0001';
  END IF;

  FOR v_ch IN SELECT * FROM jsonb_to_recordset(COALESCE(p_channels,'[]'::jsonb))
                AS t(channel text, cap integer, active boolean)
  LOOP
    IF NOT (v_ch.channel = ANY(v_valid_channels)) THEN
      RAISE EXCEPTION 'INVALID_CHANNEL: %', v_ch.channel USING ERRCODE = 'P0001';
    END IF;
    IF COALESCE(v_ch.active, true) AND (v_ch.cap IS NULL OR v_ch.cap <= 0) THEN
      RAISE EXCEPTION 'ACTIVE_CHANNEL_MUST_HAVE_POSITIVE_CAP: %', v_ch.channel
        USING ERRCODE = 'P0001';
    END IF;
    IF v_ch.cap IS NOT NULL THEN
      v_cap_sum := v_cap_sum + v_ch.cap;
    END IF;
  END LOOP;

  IF p_total_cap IS NOT NULL AND v_cap_sum > p_total_cap THEN
    RAISE EXCEPTION 'CHANNEL_CAP_SUM_EXCEEDS_TOTAL_CAP: sum=%, total=%',
      v_cap_sum, p_total_cap USING ERRCODE = 'P0001';
  END IF;

  INSERT INTO voucher_programs (
    name, template_id, funding_type, sponsor, total_cap, start_at, end_at, state
  ) VALUES (
    p_name, p_template_id, p_funding_type, p_sponsor, p_total_cap, p_start_at, p_end_at, 'draft'
  )
  RETURNING id INTO v_program_id;

  FOR v_ch IN SELECT * FROM jsonb_to_recordset(COALESCE(p_channels,'[]'::jsonb))
                AS t(channel text, cap integer, active boolean)
  LOOP
    INSERT INTO voucher_program_channel_allocations (program_id, channel, cap, active)
    VALUES (v_program_id, v_ch.channel, v_ch.cap, COALESCE(v_ch.active, true));
  END LOOP;

  INSERT INTO merchant_audit_log (merchant_user_id, partner_id, action, metadata)
  VALUES (
    p_merchant_user_id,
    p_partner_id,
    'program.created',
    jsonb_build_object(
      'program_id',  v_program_id,
      'name',        p_name,
      'template_id', p_template_id,
      'total_cap',   p_total_cap,
      'state',       'draft'
    )
  );

  RETURN QUERY SELECT true, v_program_id, ''::text;
END;
$$;

REVOKE ALL ON FUNCTION create_voucher_program(text,uuid,text,text,integer,timestamptz,timestamptz,jsonb,uuid,uuid) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION create_voucher_program(text,uuid,text,text,integer,timestamptz,timestamptz,jsonb,uuid,uuid) TO service_role;

NOTIFY pgrst, 'reload schema';
