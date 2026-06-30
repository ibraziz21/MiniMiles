-- RAFFLE WEEK 3 — General Stats | Rounds 185–194

WITH

participations AS (
  SELECT roundId AS round_id, participant, tickets
  FROM minipay_celo.AkibaRaffleV2_evt_ParticipantJoined
  WHERE roundId BETWEEN 185 AND 194
),

wallet_rounds AS (
  SELECT DISTINCT participant, round_id FROM participations
),

first_appearance AS (
  SELECT participant, MIN(round_id) AS debut_round
  FROM participations
  GROUP BY participant
),

r185_186 AS (
  SELECT ROUND(100.0 * COUNT(DISTINCT b.participant) / NULLIF(COUNT(DISTINCT a.participant), 0), 1) AS pct
  FROM wallet_rounds a LEFT JOIN wallet_rounds b ON b.participant = a.participant AND b.round_id = 186
  WHERE a.round_id = 185
),
r186_187 AS (
  SELECT ROUND(100.0 * COUNT(DISTINCT b.participant) / NULLIF(COUNT(DISTINCT a.participant), 0), 1) AS pct
  FROM wallet_rounds a LEFT JOIN wallet_rounds b ON b.participant = a.participant AND b.round_id = 187
  WHERE a.round_id = 186
),
r187_188 AS (
  SELECT ROUND(100.0 * COUNT(DISTINCT b.participant) / NULLIF(COUNT(DISTINCT a.participant), 0), 1) AS pct
  FROM wallet_rounds a LEFT JOIN wallet_rounds b ON b.participant = a.participant AND b.round_id = 188
  WHERE a.round_id = 187
),
r188_189 AS (
  SELECT ROUND(100.0 * COUNT(DISTINCT b.participant) / NULLIF(COUNT(DISTINCT a.participant), 0), 1) AS pct
  FROM wallet_rounds a LEFT JOIN wallet_rounds b ON b.participant = a.participant AND b.round_id = 189
  WHERE a.round_id = 188
),
r189_190 AS (
  SELECT ROUND(100.0 * COUNT(DISTINCT b.participant) / NULLIF(COUNT(DISTINCT a.participant), 0), 1) AS pct
  FROM wallet_rounds a LEFT JOIN wallet_rounds b ON b.participant = a.participant AND b.round_id = 190
  WHERE a.round_id = 189
),
r190_191 AS (
  SELECT ROUND(100.0 * COUNT(DISTINCT b.participant) / NULLIF(COUNT(DISTINCT a.participant), 0), 1) AS pct
  FROM wallet_rounds a LEFT JOIN wallet_rounds b ON b.participant = a.participant AND b.round_id = 191
  WHERE a.round_id = 190
),
r191_192 AS (
  SELECT ROUND(100.0 * COUNT(DISTINCT b.participant) / NULLIF(COUNT(DISTINCT a.participant), 0), 1) AS pct
  FROM wallet_rounds a LEFT JOIN wallet_rounds b ON b.participant = a.participant AND b.round_id = 192
  WHERE a.round_id = 191
),
r192_193 AS (
  SELECT ROUND(100.0 * COUNT(DISTINCT b.participant) / NULLIF(COUNT(DISTINCT a.participant), 0), 1) AS pct
  FROM wallet_rounds a LEFT JOIN wallet_rounds b ON b.participant = a.participant AND b.round_id = 193
  WHERE a.round_id = 192
),
r193_194 AS (
  SELECT ROUND(100.0 * COUNT(DISTINCT b.participant) / NULLIF(COUNT(DISTINCT a.participant), 0), 1) AS pct
  FROM wallet_rounds a LEFT JOIN wallet_rounds b ON b.participant = a.participant AND b.round_id = 194
  WHERE a.round_id = 193
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
  COUNT(DISTINCT CASE WHEN p.round_id = 185 THEN p.participant END)        AS round_185_players,
  COUNT(DISTINCT CASE WHEN p.round_id = 186 THEN p.participant END)        AS round_186_players,
  COUNT(DISTINCT CASE WHEN p.round_id = 187 THEN p.participant END)        AS round_187_players,
  COUNT(DISTINCT CASE WHEN p.round_id = 188 THEN p.participant END)        AS round_188_players,
  COUNT(DISTINCT CASE WHEN p.round_id = 189 THEN p.participant END)        AS round_189_players,
  COUNT(DISTINCT CASE WHEN p.round_id = 190 THEN p.participant END)        AS round_190_players,
  COUNT(DISTINCT CASE WHEN p.round_id = 191 THEN p.participant END)        AS round_191_players,
  COUNT(DISTINCT CASE WHEN p.round_id = 192 THEN p.participant END)        AS round_192_players,
  COUNT(DISTINCT CASE WHEN p.round_id = 193 THEN p.participant END)        AS round_193_players,
  COUNT(DISTINCT CASE WHEN p.round_id = 194 THEN p.participant END)        AS round_194_players,
  COUNT(DISTINCT p.participant)                                             AS total_unique_wallets,

  -- New entrants per round
  COUNT(DISTINCT CASE WHEN wp.debut_round = 185 THEN wp.participant END)   AS new_in_185,
  COUNT(DISTINCT CASE WHEN wp.debut_round = 186 THEN wp.participant END)   AS new_in_186,
  COUNT(DISTINCT CASE WHEN wp.debut_round = 187 THEN wp.participant END)   AS new_in_187,
  COUNT(DISTINCT CASE WHEN wp.debut_round = 188 THEN wp.participant END)   AS new_in_188,
  COUNT(DISTINCT CASE WHEN wp.debut_round = 189 THEN wp.participant END)   AS new_in_189,
  COUNT(DISTINCT CASE WHEN wp.debut_round = 190 THEN wp.participant END)   AS new_in_190,
  COUNT(DISTINCT CASE WHEN wp.debut_round = 191 THEN wp.participant END)   AS new_in_191,
  COUNT(DISTINCT CASE WHEN wp.debut_round = 192 THEN wp.participant END)   AS new_in_192,
  COUNT(DISTINCT CASE WHEN wp.debut_round = 193 THEN wp.participant END)   AS new_in_193,
  COUNT(DISTINCT CASE WHEN wp.debut_round = 194 THEN wp.participant END)   AS new_in_194,

  -- Loyalty tiers (out of 10 rounds this week)
  COUNT(DISTINCT CASE WHEN wp.rounds_played = 10 THEN wp.participant END)  AS played_all_10,
  COUNT(DISTINCT CASE WHEN wp.rounds_played BETWEEN 8 AND 9  THEN wp.participant END) AS played_8_or_9,
  COUNT(DISTINCT CASE WHEN wp.rounds_played BETWEEN 5 AND 7  THEN wp.participant END) AS played_5_to_7,
  COUNT(DISTINCT CASE WHEN wp.rounds_played BETWEEN 3 AND 4  THEN wp.participant END) AS played_3_or_4,
  COUNT(DISTINCT CASE WHEN wp.rounds_played = 2 THEN wp.participant END)   AS played_2,
  COUNT(DISTINCT CASE WHEN wp.rounds_played = 1 THEN wp.participant END)   AS played_1_only,

  -- Day-over-day retention
  (SELECT pct FROM r185_186)                                                AS retention_185_186_pct,
  (SELECT pct FROM r186_187)                                                AS retention_186_187_pct,
  (SELECT pct FROM r187_188)                                                AS retention_187_188_pct,
  (SELECT pct FROM r188_189)                                                AS retention_188_189_pct,
  (SELECT pct FROM r189_190)                                                AS retention_189_190_pct,
  (SELECT pct FROM r190_191)                                                AS retention_190_191_pct,
  (SELECT pct FROM r191_192)                                                AS retention_191_192_pct,
  (SELECT pct FROM r192_193)                                                AS retention_192_193_pct,
  (SELECT pct FROM r193_194)                                                AS retention_193_194_pct,

  -- Tickets per round
  SUM(CASE WHEN p.round_id = 185 THEN p.tickets ELSE 0 END)               AS tickets_185,
  SUM(CASE WHEN p.round_id = 186 THEN p.tickets ELSE 0 END)               AS tickets_186,
  SUM(CASE WHEN p.round_id = 187 THEN p.tickets ELSE 0 END)               AS tickets_187,
  SUM(CASE WHEN p.round_id = 188 THEN p.tickets ELSE 0 END)               AS tickets_188,
  SUM(CASE WHEN p.round_id = 189 THEN p.tickets ELSE 0 END)               AS tickets_189,
  SUM(CASE WHEN p.round_id = 190 THEN p.tickets ELSE 0 END)               AS tickets_190,
  SUM(CASE WHEN p.round_id = 191 THEN p.tickets ELSE 0 END)               AS tickets_191,
  SUM(CASE WHEN p.round_id = 192 THEN p.tickets ELSE 0 END)               AS tickets_192,
  SUM(CASE WHEN p.round_id = 193 THEN p.tickets ELSE 0 END)               AS tickets_193,
  SUM(CASE WHEN p.round_id = 194 THEN p.tickets ELSE 0 END)               AS tickets_194,

  -- TVL
  ROUND(AVG(wp.usdt_balance), 2)                                           AS avg_usdt_per_wallet,
  ROUND(AVG(wp.cusd_balance), 2)                                           AS avg_cusd_per_wallet,
  ROUND(AVG(wp.total_tvl),    2)                                           AS avg_total_tvl_per_wallet

FROM participations p
JOIN wallet_profile wp ON wp.participant = p.participant
