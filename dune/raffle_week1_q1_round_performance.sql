-- RAFFLE WEEK 1 — General Stats | Rounds 171–177

WITH

participations AS (
  SELECT roundId AS round_id, participant, tickets
  FROM minipay_celo.AkibaRaffleV2_evt_ParticipantJoined
  WHERE roundId BETWEEN 171 AND 177
),

wallet_rounds AS (
  SELECT DISTINCT participant, round_id FROM participations
),

first_appearance AS (
  SELECT participant, MIN(round_id) AS debut_round
  FROM participations
  GROUP BY participant
),

-- Scalar retention CTEs for each consecutive pair
r171_172 AS (
  SELECT ROUND(100.0 * COUNT(DISTINCT b.participant) / NULLIF(COUNT(DISTINCT a.participant), 0), 1) AS pct
  FROM wallet_rounds a LEFT JOIN wallet_rounds b ON b.participant = a.participant AND b.round_id = 172
  WHERE a.round_id = 171
),
r172_173 AS (
  SELECT ROUND(100.0 * COUNT(DISTINCT b.participant) / NULLIF(COUNT(DISTINCT a.participant), 0), 1) AS pct
  FROM wallet_rounds a LEFT JOIN wallet_rounds b ON b.participant = a.participant AND b.round_id = 173
  WHERE a.round_id = 172
),
r173_174 AS (
  SELECT ROUND(100.0 * COUNT(DISTINCT b.participant) / NULLIF(COUNT(DISTINCT a.participant), 0), 1) AS pct
  FROM wallet_rounds a LEFT JOIN wallet_rounds b ON b.participant = a.participant AND b.round_id = 174
  WHERE a.round_id = 173
),
r174_175 AS (
  SELECT ROUND(100.0 * COUNT(DISTINCT b.participant) / NULLIF(COUNT(DISTINCT a.participant), 0), 1) AS pct
  FROM wallet_rounds a LEFT JOIN wallet_rounds b ON b.participant = a.participant AND b.round_id = 175
  WHERE a.round_id = 174
),
r175_176 AS (
  SELECT ROUND(100.0 * COUNT(DISTINCT b.participant) / NULLIF(COUNT(DISTINCT a.participant), 0), 1) AS pct
  FROM wallet_rounds a LEFT JOIN wallet_rounds b ON b.participant = a.participant AND b.round_id = 176
  WHERE a.round_id = 175
),
r176_177 AS (
  SELECT ROUND(100.0 * COUNT(DISTINCT b.participant) / NULLIF(COUNT(DISTINCT a.participant), 0), 1) AS pct
  FROM wallet_rounds a LEFT JOIN wallet_rounds b ON b.participant = a.participant AND b.round_id = 177
  WHERE a.round_id = 176
),

usdt_balances AS (
  SELECT address, GREATEST(SUM(delta), 0) AS usdt_balance
  FROM (
    SELECT CAST('0x' || SUBSTR(CAST(topic2 AS VARCHAR), 27, 40) AS VARCHAR) AS address,
           bytearray_to_uint256(bytearray_substring(data, 1, 32)) / 1e6    AS delta
    FROM celo.logs
    WHERE contract_address = 0x48065fbBE25f71C9282ddf5e1cD6D6A887483D5e
      AND topic0 = 0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef
    UNION ALL
    SELECT CAST('0x' || SUBSTR(CAST(topic1 AS VARCHAR), 27, 40) AS VARCHAR) AS address,
           -bytearray_to_uint256(bytearray_substring(data, 1, 32)) / 1e6   AS delta
    FROM celo.logs
    WHERE contract_address = 0x48065fbBE25f71C9282ddf5e1cD6D6A887483D5e
      AND topic0 = 0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef
  )
  GROUP BY address
),

cusd_balances AS (
  SELECT address, GREATEST(SUM(delta), 0) AS cusd_balance
  FROM (
    SELECT CAST('0x' || SUBSTR(CAST(topic2 AS VARCHAR), 27, 40) AS VARCHAR) AS address,
           bytearray_to_uint256(bytearray_substring(data, 1, 32)) / 1e18   AS delta
    FROM celo.logs
    WHERE contract_address = 0x765DE816845861e75A25fCA122bb6898B8B1282a
      AND topic0 = 0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef
    UNION ALL
    SELECT CAST('0x' || SUBSTR(CAST(topic1 AS VARCHAR), 27, 40) AS VARCHAR) AS address,
           -bytearray_to_uint256(bytearray_substring(data, 1, 32)) / 1e18  AS delta
    FROM celo.logs
    WHERE contract_address = 0x765DE816845861e75A25fCA122bb6898B8B1282a
      AND topic0 = 0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef
  )
  GROUP BY address
),

wallet_profile AS (
  SELECT
    p.participant,
    COUNT(DISTINCT p.round_id)                                              AS rounds_played,
    SUM(p.tickets)                                                          AS total_tickets,
    fa.debut_round,
    GREATEST(COALESCE(u.usdt_balance, 0), 0)                               AS usdt_balance,
    GREATEST(COALESCE(c.cusd_balance, 0), 0)                               AS cusd_balance,
    GREATEST(COALESCE(u.usdt_balance, 0) + COALESCE(c.cusd_balance, 0), 0) AS total_tvl
  FROM participations p
  JOIN first_appearance fa ON fa.participant = p.participant
  LEFT JOIN usdt_balances u ON LOWER(u.address) = LOWER(CAST(p.participant AS VARCHAR))
  LEFT JOIN cusd_balances c ON LOWER(c.address) = LOWER(CAST(p.participant AS VARCHAR))
  GROUP BY p.participant, fa.debut_round, u.usdt_balance, c.cusd_balance
)

SELECT
  -- Per-round players
  COUNT(DISTINCT CASE WHEN p.round_id = 171 THEN p.participant END)        AS round_171_players,
  COUNT(DISTINCT CASE WHEN p.round_id = 172 THEN p.participant END)        AS round_172_players,
  COUNT(DISTINCT CASE WHEN p.round_id = 173 THEN p.participant END)        AS round_173_players,
  COUNT(DISTINCT CASE WHEN p.round_id = 174 THEN p.participant END)        AS round_174_players,
  COUNT(DISTINCT CASE WHEN p.round_id = 175 THEN p.participant END)        AS round_175_players,
  COUNT(DISTINCT CASE WHEN p.round_id = 176 THEN p.participant END)        AS round_176_players,
  COUNT(DISTINCT CASE WHEN p.round_id = 177 THEN p.participant END)        AS round_177_players,
  COUNT(DISTINCT p.participant)                                             AS total_unique_wallets,

  -- New entrants per round
  COUNT(DISTINCT CASE WHEN wp.debut_round = 171 THEN wp.participant END)   AS new_in_171,
  COUNT(DISTINCT CASE WHEN wp.debut_round = 172 THEN wp.participant END)   AS new_in_172,
  COUNT(DISTINCT CASE WHEN wp.debut_round = 173 THEN wp.participant END)   AS new_in_173,
  COUNT(DISTINCT CASE WHEN wp.debut_round = 174 THEN wp.participant END)   AS new_in_174,
  COUNT(DISTINCT CASE WHEN wp.debut_round = 175 THEN wp.participant END)   AS new_in_175,
  COUNT(DISTINCT CASE WHEN wp.debut_round = 176 THEN wp.participant END)   AS new_in_176,
  COUNT(DISTINCT CASE WHEN wp.debut_round = 177 THEN wp.participant END)   AS new_in_177,

  -- Loyalty tiers
  COUNT(DISTINCT CASE WHEN wp.rounds_played = 7 THEN wp.participant END)   AS played_all_7,
  COUNT(DISTINCT CASE WHEN wp.rounds_played BETWEEN 5 AND 6 THEN wp.participant END) AS played_5_or_6,
  COUNT(DISTINCT CASE WHEN wp.rounds_played BETWEEN 3 AND 4 THEN wp.participant END) AS played_3_or_4,
  COUNT(DISTINCT CASE WHEN wp.rounds_played = 2 THEN wp.participant END)   AS played_2,
  COUNT(DISTINCT CASE WHEN wp.rounds_played = 1 THEN wp.participant END)   AS played_1_only,

  -- Day-over-day retention
  (SELECT pct FROM r171_172)                                                AS retention_171_172_pct,
  (SELECT pct FROM r172_173)                                                AS retention_172_173_pct,
  (SELECT pct FROM r173_174)                                                AS retention_173_174_pct,
  (SELECT pct FROM r174_175)                                                AS retention_174_175_pct,
  (SELECT pct FROM r175_176)                                                AS retention_175_176_pct,
  (SELECT pct FROM r176_177)                                                AS retention_176_177_pct,

  -- Tickets per round
  SUM(CASE WHEN p.round_id = 171 THEN p.tickets ELSE 0 END)               AS tickets_171,
  SUM(CASE WHEN p.round_id = 172 THEN p.tickets ELSE 0 END)               AS tickets_172,
  SUM(CASE WHEN p.round_id = 173 THEN p.tickets ELSE 0 END)               AS tickets_173,
  SUM(CASE WHEN p.round_id = 174 THEN p.tickets ELSE 0 END)               AS tickets_174,
  SUM(CASE WHEN p.round_id = 175 THEN p.tickets ELSE 0 END)               AS tickets_175,
  SUM(CASE WHEN p.round_id = 176 THEN p.tickets ELSE 0 END)               AS tickets_176,
  SUM(CASE WHEN p.round_id = 177 THEN p.tickets ELSE 0 END)               AS tickets_177,

  -- TVL
  ROUND(AVG(wp.usdt_balance), 2)                                           AS avg_usdt_per_wallet,
  ROUND(AVG(wp.cusd_balance), 2)                                           AS avg_cusd_per_wallet,
  ROUND(AVG(wp.total_tvl),    2)                                           AS avg_total_tvl_per_wallet

FROM participations p
JOIN wallet_profile wp ON wp.participant = p.participant
