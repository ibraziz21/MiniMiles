-- ═══════════════════════════════════════════════════════════════════════════
-- RAFFLE WEEK 1 — Q2: Week Aggregate + Wallet TVL
-- Rounds 171–177 | minipay_celo.AkibaRaffleV2
-- ═══════════════════════════════════════════════════════════════════════════

WITH

participations AS (
  SELECT roundId AS round_id, participant, tickets
  FROM minipay_celo.AkibaRaffleV2_evt_ParticipantJoined
  WHERE roundId BETWEEN 171 AND 177
),

wallet_summary AS (
  SELECT
    participant,
    COUNT(DISTINCT round_id)           AS rounds_played,
    SUM(tickets)                       AS total_tickets
  FROM participations
  GROUP BY participant
),

-- USDT balances
usdt_balances AS (
  SELECT address, GREATEST(SUM(delta), 0) AS usdt_balance
  FROM (
    SELECT
      CAST('0x' || SUBSTR(CAST(topic2 AS VARCHAR), 27, 40) AS VARCHAR) AS address,
      bytearray_to_uint256(bytearray_substring(data, 1, 32)) / 1e6    AS delta
    FROM celo.logs
    WHERE contract_address = 0x48065fbBE25f71C9282ddf5e1cD6D6A887483D5e
      AND topic0 = 0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef

    UNION ALL

    SELECT
      CAST('0x' || SUBSTR(CAST(topic1 AS VARCHAR), 27, 40) AS VARCHAR) AS address,
      -bytearray_to_uint256(bytearray_substring(data, 1, 32)) / 1e6   AS delta
    FROM celo.logs
    WHERE contract_address = 0x48065fbBE25f71C9282ddf5e1cD6D6A887483D5e
      AND topic0 = 0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef
  )
  GROUP BY address
),

-- cUSD balances
cusd_balances AS (
  SELECT address, GREATEST(SUM(delta), 0) AS cusd_balance
  FROM (
    SELECT
      CAST('0x' || SUBSTR(CAST(topic2 AS VARCHAR), 27, 40) AS VARCHAR) AS address,
      bytearray_to_uint256(bytearray_substring(data, 1, 32)) / 1e18   AS delta
    FROM celo.logs
    WHERE contract_address = 0x765DE816845861e75A25fCA122bb6898B8B1282a
      AND topic0 = 0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef

    UNION ALL

    SELECT
      CAST('0x' || SUBSTR(CAST(topic1 AS VARCHAR), 27, 40) AS VARCHAR) AS address,
      -bytearray_to_uint256(bytearray_substring(data, 1, 32)) / 1e18  AS delta
    FROM celo.logs
    WHERE contract_address = 0x765DE816845861e75A25fCA122bb6898B8B1282a
      AND topic0 = 0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef
  )
  GROUP BY address
),

wallet_activity AS (
  SELECT "from" AS address, MIN(block_time) AS first_tx, COUNT(*) AS tx_count
  FROM celo.transactions
  GROUP BY "from"
),

wallet_profile AS (
  SELECT
    ws.participant,
    ws.rounds_played,
    ws.total_tickets,
    GREATEST(COALESCE(u.usdt_balance, 0), 0)                          AS usdt_balance,
    GREATEST(COALESCE(c.cusd_balance, 0), 0)                          AS cusd_balance,
    GREATEST(COALESCE(u.usdt_balance, 0) + COALESCE(c.cusd_balance, 0), 0) AS total_stable_tvl,
    DATE_DIFF('day', wa.first_tx, CURRENT_DATE)                        AS wallet_age_days,
    COALESCE(wa.tx_count, 0)                                           AS lifetime_tx_count
  FROM wallet_summary ws
  LEFT JOIN usdt_balances  u  ON LOWER(u.address) = LOWER(CAST(ws.participant AS VARCHAR))
  LEFT JOIN cusd_balances  c  ON LOWER(c.address) = LOWER(CAST(ws.participant AS VARCHAR))
  LEFT JOIN wallet_activity wa ON wa.address = ws.participant
),

-- Ticket concentration: share held by top 10% of wallets
ticket_concentration AS (
  SELECT
    ROUND(
      100.0 * SUM(CASE WHEN rn <= CEIL(0.1 * total) THEN total_tickets ELSE 0 END)
            / NULLIF(SUM(total_tickets), 0), 1
    ) AS top10pct_ticket_share
  FROM (
    SELECT
      total_tickets,
      ROW_NUMBER() OVER (ORDER BY total_tickets DESC) AS rn,
      COUNT(*) OVER ()                                 AS total
    FROM wallet_profile
  )
),

totals AS (
  SELECT
    COUNT(DISTINCT participant)        AS total_unique_wallets,
    SUM(total_tickets)                 AS total_tickets_sold
  FROM participations
)

SELECT
  -- Participation
  t.total_unique_wallets,
  t.total_tickets_sold,
  ROUND(t.total_tickets_sold * 1.0 / NULLIF(t.total_unique_wallets, 0), 1) AS avg_tickets_per_wallet,

  -- TVL
  ROUND(AVG(wp.usdt_balance),        2) AS avg_usdt_per_wallet,
  ROUND(AVG(wp.cusd_balance),        2) AS avg_cusd_per_wallet,
  ROUND(AVG(wp.total_stable_tvl),    2) AS avg_total_stable_tvl,
  ROUND(MEDIAN(wp.total_stable_tvl), 2) AS median_total_stable_tvl,

  -- Wallet maturity
  ROUND(AVG(wp.wallet_age_days),     0) AS avg_wallet_age_days,
  ROUND(AVG(wp.lifetime_tx_count),   0) AS avg_lifetime_tx_count,

  -- Engagement depth
  ROUND(AVG(wp.rounds_played),       2) AS avg_rounds_played_per_wallet,
  tc.top10pct_ticket_share

FROM wallet_profile wp
CROSS JOIN totals t
CROSS JOIN ticket_concentration tc
GROUP BY t.total_unique_wallets, t.total_tickets_sold, tc.top10pct_ticket_share
