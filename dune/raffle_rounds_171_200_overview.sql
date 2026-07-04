-- RAFFLE CAMPAIGN OVERVIEW — Rounds 171–200 (30 rounds)
-- Output: one row per round with round-level stats + retention + campaign totals

WITH

participations AS (
  SELECT roundId AS round_id, participant, tickets
  FROM minipay_celo.AkibaRaffleV2_evt_ParticipantJoined
  WHERE roundId BETWEEN 171 AND 200
),

first_appearance AS (
  SELECT participant, MIN(round_id) AS debut_round
  FROM participations
  GROUP BY participant
),

wallet_rounds AS (
  SELECT DISTINCT participant, round_id FROM participations
),

-- ── Per-round player / ticket stats ─────────────────────────────────────────
round_stats AS (
  SELECT
    p.round_id,
    COUNT(DISTINCT p.participant)                                                     AS players,
    COUNT(DISTINCT CASE WHEN fa.debut_round = p.round_id THEN p.participant END)     AS new_wallets,
    SUM(p.tickets)                                                                    AS total_tickets,
    ROUND(SUM(p.tickets) * 1.0 / NULLIF(COUNT(DISTINCT p.participant), 0), 1)        AS tickets_per_player
  FROM participations p
  JOIN first_appearance fa ON fa.participant = p.participant
  GROUP BY p.round_id
),

-- ── Day-over-day retention (generalised — one CTE for all 29 pairs) ──────────
-- For round R: % of round R-1 players who returned for round R
retention AS (
  SELECT
    a.round_id + 1                                                                    AS round_id,
    ROUND(
      100.0 * COUNT(DISTINCT b.participant)
             / NULLIF(COUNT(DISTINCT a.participant), 0), 1
    )                                                                                 AS retention_from_prev_pct
  FROM wallet_rounds a
  LEFT JOIN wallet_rounds b
    ON b.participant = a.participant AND b.round_id = a.round_id + 1
  WHERE a.round_id BETWEEN 171 AND 199
  GROUP BY a.round_id + 1
),

-- ── USDT balances ─────────────────────────────────────────────────────────────
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

-- ── cUSD balances ─────────────────────────────────────────────────────────────
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

-- ── Per-wallet TVL ────────────────────────────────────────────────────────────
wallet_tvl AS (
  SELECT
    p.participant,
    GREATEST(COALESCE(u.usdt_balance, 0), 0)                                         AS usdt_balance,
    GREATEST(COALESCE(c.cusd_balance, 0), 0)                                         AS cusd_balance,
    GREATEST(COALESCE(u.usdt_balance, 0) + COALESCE(c.cusd_balance, 0), 0)           AS total_tvl
  FROM (SELECT DISTINCT participant FROM participations) p
  LEFT JOIN usdt_balances u ON LOWER(u.address) = LOWER(CAST(p.participant AS VARCHAR))
  LEFT JOIN cusd_balances c ON LOWER(c.address) = LOWER(CAST(p.participant AS VARCHAR))
),

-- ── Campaign TVL summary (single row — CROSS JOIN safe) ───────────────────────
tvl_summary AS (
  SELECT
    COUNT(DISTINCT participant)          AS total_unique_wallets,
    ROUND(AVG(usdt_balance), 2)          AS avg_usdt_per_wallet,
    ROUND(AVG(cusd_balance), 2)          AS avg_cusd_per_wallet,
    ROUND(AVG(total_tvl), 2)             AS avg_total_tvl_per_wallet
  FROM wallet_tvl
),

-- ── Loyalty tier distribution (single row — CROSS JOIN safe) ─────────────────
loyalty_counts AS (
  SELECT
    COUNT(DISTINCT CASE WHEN rounds_played = 30                    THEN participant END) AS played_all_30,
    COUNT(DISTINCT CASE WHEN rounds_played BETWEEN 20 AND 29       THEN participant END) AS played_20_29,
    COUNT(DISTINCT CASE WHEN rounds_played BETWEEN 10 AND 19       THEN participant END) AS played_10_19,
    COUNT(DISTINCT CASE WHEN rounds_played BETWEEN 5  AND 9        THEN participant END) AS played_5_9,
    COUNT(DISTINCT CASE WHEN rounds_played BETWEEN 2  AND 4        THEN participant END) AS played_2_4,
    COUNT(DISTINCT CASE WHEN rounds_played = 1                     THEN participant END) AS played_1_only
  FROM (
    SELECT participant, COUNT(DISTINCT round_id) AS rounds_played
    FROM participations
    GROUP BY participant
  )
)

-- ── Final output ──────────────────────────────────────────────────────────────
SELECT
  -- Round identity
  rs.round_id,
  CASE
    WHEN rs.round_id BETWEEN 171 AND 177 THEN 'Week 1'
    WHEN rs.round_id BETWEEN 178 AND 184 THEN 'Week 2'
    WHEN rs.round_id BETWEEN 185 AND 194 THEN 'Week 3'
    ELSE 'Week 4'
  END                                                                                  AS week,

  -- Round-level metrics
  rs.players,
  rs.new_wallets,
  ROUND(100.0 * rs.new_wallets / NULLIF(rs.players, 0), 1)                            AS pct_new,
  rs.total_tickets,
  rs.tickets_per_player,
  r.retention_from_prev_pct,

  -- Campaign-level totals (same value on all 30 rows)
  ts.total_unique_wallets,
  ts.avg_usdt_per_wallet,
  ts.avg_cusd_per_wallet,
  ts.avg_total_tvl_per_wallet,

  -- Loyalty tiers (same value on all 30 rows)
  lc.played_all_30,
  lc.played_20_29,
  lc.played_10_19,
  lc.played_5_9,
  lc.played_2_4,
  lc.played_1_only

FROM round_stats rs
LEFT JOIN retention r        ON r.round_id = rs.round_id
CROSS JOIN tvl_summary ts
CROSS JOIN loyalty_counts lc
ORDER BY rs.round_id
