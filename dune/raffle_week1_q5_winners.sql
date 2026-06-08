-- ═══════════════════════════════════════════════════════════════════════════
-- RAFFLE WEEK 1 — Q5: Winner Profiles
-- Rounds 171–177 | minipay_celo.AkibaRaffleV2
-- ═══════════════════════════════════════════════════════════════════════════

WITH

all_winners AS (
  SELECT roundId AS round_id, winner, reward / 1e6 AS reward_usdt
  FROM minipay_celo.AkibaRaffleV2_evt_WinnerSelected
  WHERE roundId BETWEEN 171 AND 177
),

-- How many tickets did the winner hold in their winning round?
participations AS (
  SELECT roundId AS round_id, participant, tickets
  FROM minipay_celo.AkibaRaffleV2_evt_ParticipantJoined
  WHERE roundId BETWEEN 171 AND 177
),

round_totals AS (
  SELECT round_id, SUM(tickets) AS total_tickets
  FROM participations
  GROUP BY round_id
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

-- How many total rounds did the winner participate in across the week?
winner_activity AS (
  SELECT
    participant,
    COUNT(DISTINCT round_id)           AS rounds_entered,
    SUM(tickets)                       AS lifetime_tickets_week
  FROM participations
  GROUP BY participant
)

SELECT
  aw.round_id,
  aw.winner,
  aw.reward_usdt,

  -- Winner's ticket share in their round
  p.tickets                            AS winner_tickets,
  rt.total_tickets                     AS round_total_tickets,
  ROUND(100.0 * p.tickets / NULLIF(rt.total_tickets, 0), 2) AS winner_ticket_share_pct,

  -- Week activity
  wa.rounds_entered                    AS winner_rounds_entered_week,
  wa.lifetime_tickets_week             AS winner_total_tickets_week,

  -- Wallet TVL
  ROUND(GREATEST(COALESCE(u.usdt_balance, 0), 0), 2)   AS winner_usdt_balance,
  ROUND(GREATEST(COALESCE(c.cusd_balance, 0), 0), 2)   AS winner_cusd_balance,
  ROUND(
    GREATEST(COALESCE(u.usdt_balance, 0), 0)
    + GREATEST(COALESCE(c.cusd_balance, 0), 0), 2
  )                                    AS winner_total_stable_tvl

FROM all_winners aw
LEFT JOIN participations p  ON p.round_id = aw.round_id AND p.participant = aw.winner
LEFT JOIN round_totals   rt ON rt.round_id = aw.round_id
LEFT JOIN winner_activity wa ON wa.participant = aw.winner
LEFT JOIN usdt_balances  u  ON LOWER(u.address) = LOWER(CAST(aw.winner AS VARCHAR))
LEFT JOIN cusd_balances  c  ON LOWER(c.address) = LOWER(CAST(aw.winner AS VARCHAR))
ORDER BY aw.round_id ASC, aw.reward_usdt DESC
