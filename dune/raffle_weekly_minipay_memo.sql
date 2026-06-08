-- ═══════════════════════════════════════════════════════════════════════════
-- WEEKLY RAFFLE ANALYTICS — MiniPay Memo
-- Contract  : 0xD75dfa972C6136f1c594Fec1945302f885E1ab29
-- Namespace : minipay_celo.AkibaRaffleV2
-- Rounds    : 171 – 177  (week 1)
-- Tokens    : USDT 0x48065fbBE25f71C9282ddf5e1cD6D6A887483D5e (6 dec)
--             cUSD 0x765DE816845861e75A25fCA122bb6898B8B1282a (18 dec)
-- ═══════════════════════════════════════════════════════════════════════════

WITH rounds AS (
  SELECT r AS round_id FROM UNNEST(SEQUENCE(171, 177)) t(r)
),

-- ── 1. All participation events ──────────────────────────────────────────────
participations AS (
  SELECT
    roundId                                         AS round_id,
    participant,
    tickets,
    evt_block_time
  FROM minipay_celo.AkibaRaffleV2_evt_ParticipantJoined
  WHERE roundId BETWEEN 171 AND 177
),

-- ── 2. Round metadata from RoundCreated ──────────────────────────────────────
round_meta AS (
  SELECT
    roundId                                         AS round_id,
    maxTickets,
    ticketCostPoints / 1e18                         AS ticket_cost_miles,
    rewardPool / 1e6                                AS reward_pool_usdt,
    roundType,
    startTime,
    endTime
  FROM minipay_celo.AkibaRaffleV2_evt_RoundCreated
  WHERE roundId BETWEEN 171 AND 177
),

-- ── 3. Winners ───────────────────────────────────────────────────────────────
single_winners AS (
  SELECT roundId AS round_id, winner, reward / 1e6 AS reward_usdt
  FROM minipay_celo.AkibaRaffleV2_evt_WinnerSelected
  WHERE roundId BETWEEN 171 AND 177
),

multi_winners AS (
  SELECT
    roundId AS round_id,
    w       AS winner,
    a / 1e6 AS reward_usdt
  FROM minipay_celo.AkibaRaffleV2_evt_MultiWinnersSelected
  CROSS JOIN UNNEST(winners, amounts) AS t(w, a)
  WHERE roundId BETWEEN 171 AND 177
),

all_winners AS (
  SELECT * FROM single_winners
  UNION ALL
  SELECT * FROM multi_winners
),

-- ── 4. Retention matrix (which wallets appeared in which rounds) ─────────────
wallet_rounds AS (
  SELECT participant, round_id
  FROM participations
  GROUP BY participant, round_id
),

wallet_summary AS (
  SELECT
    participant,
    COUNT(DISTINCT round_id)                        AS rounds_played,
    MIN(round_id)                                   AS first_round,
    MAX(round_id)                                   AS last_round,
    SUM(tickets)                                    AS total_tickets,
    -- Loyalty tier
    CASE
      WHEN COUNT(DISTINCT round_id) = 7 THEN 'Perfect (7/7)'
      WHEN COUNT(DISTINCT round_id) >= 5 THEN 'Loyal (5-6/7)'
      WHEN COUNT(DISTINCT round_id) >= 3 THEN 'Returning (3-4/7)'
      WHEN COUNT(DISTINCT round_id) = 2  THEN 'Occasional (2/7)'
      ELSE 'One-time'
    END                                             AS loyalty_tier
  FROM participations
  GROUP BY participant
),

-- ── 5. USDT balances (all-time snapshot) ─────────────────────────────────────
usdt_xfers AS (
  SELECT
    bytearray_to_uint256(bytearray_substring(data, 1, 32)) / 1e6 AS amount,
    CAST('0x' || SUBSTR(CAST(topic2 AS VARCHAR), 27, 40) AS VARCHAR) AS to_addr,
    CAST('0x' || SUBSTR(CAST(topic1 AS VARCHAR), 27, 40) AS VARCHAR) AS from_addr
  FROM celo.logs
  WHERE contract_address = 0x48065fbBE25f71C9282ddf5e1cD6D6A887483D5e
    AND topic0 = 0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef
),
usdt_balances AS (
  SELECT address, GREATEST(SUM(delta), 0) AS usdt_balance
  FROM (
    SELECT to_addr   AS address,  amount AS delta FROM usdt_xfers
    UNION ALL
    SELECT from_addr AS address, -amount AS delta FROM usdt_xfers
  )
  GROUP BY address
),

-- ── 6. cUSD balances ─────────────────────────────────────────────────────────
cusd_xfers AS (
  SELECT
    bytearray_to_uint256(bytearray_substring(data, 1, 32)) / 1e18 AS amount,
    CAST('0x' || SUBSTR(CAST(topic2 AS VARCHAR), 27, 40) AS VARCHAR) AS to_addr,
    CAST('0x' || SUBSTR(CAST(topic1 AS VARCHAR), 27, 40) AS VARCHAR) AS from_addr
  FROM celo.logs
  WHERE contract_address = 0x765DE816845861e75A25fCA122bb6898B8B1282a
    AND topic0 = 0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef
),
cusd_balances AS (
  SELECT address, GREATEST(SUM(delta), 0) AS cusd_balance
  FROM (
    SELECT to_addr   AS address,  amount AS delta FROM cusd_xfers
    UNION ALL
    SELECT from_addr AS address, -amount AS delta FROM cusd_xfers
  )
  GROUP BY address
),

-- ── 7. Wallet age + tx count ─────────────────────────────────────────────────
wallet_activity AS (
  SELECT
    "from"                                          AS address,
    MIN(block_time)                                 AS first_tx,
    COUNT(*)                                        AS tx_count
  FROM celo.transactions
  GROUP BY "from"
),

-- ── 8. Per-wallet enriched profile ───────────────────────────────────────────
wallet_profile AS (
  SELECT
    ws.participant,
    ws.rounds_played,
    ws.first_round,
    ws.last_round,
    ws.total_tickets,
    ws.loyalty_tier,
    GREATEST(COALESCE(u.usdt_balance,  0), 0)       AS usdt_balance,
    GREATEST(COALESCE(c.cusd_balance,  0), 0)       AS cusd_balance,
    GREATEST(COALESCE(u.usdt_balance, 0) + COALESCE(c.cusd_balance, 0), 0) AS total_stable_tvl,
    DATE_DIFF('day', wa.first_tx, CURRENT_DATE)     AS wallet_age_days,
    COALESCE(wa.tx_count, 0)                        AS lifetime_tx_count
  FROM wallet_summary ws
  LEFT JOIN usdt_balances  u  ON LOWER(u.address)   = LOWER(CAST(ws.participant AS VARCHAR))
  LEFT JOIN cusd_balances  c  ON LOWER(c.address)   = LOWER(CAST(ws.participant AS VARCHAR))
  LEFT JOIN wallet_activity wa ON wa.address = ws.participant
),

-- ── SECTION A: Per-round summary ─────────────────────────────────────────────
round_summary AS (
  SELECT
    p.round_id,
    rm.startTime,
    rm.endTime,
    rm.maxTickets,
    rm.ticket_cost_miles,
    rm.reward_pool_usdt,
    COUNT(DISTINCT p.participant)                   AS participants,
    SUM(p.tickets)                                  AS tickets_sold,
    rm.maxTickets - SUM(p.tickets)                  AS tickets_remaining,
    ROUND(100.0 * SUM(p.tickets) / NULLIF(rm.maxTickets, 0), 1) AS sellthrough_pct,
    ROUND(SUM(p.tickets) * rm.ticket_cost_miles, 4) AS total_miles_burned,
    COUNT(DISTINCT aw.winner)                       AS winner_count,
    ROUND(SUM(aw.reward_usdt), 4)                   AS total_paid_out_usdt
  FROM participations p
  LEFT JOIN round_meta rm ON rm.round_id = p.round_id
  LEFT JOIN all_winners aw ON aw.round_id = p.round_id
  GROUP BY p.round_id, rm.startTime, rm.endTime, rm.maxTickets,
           rm.ticket_cost_miles, rm.reward_pool_usdt
),

-- ── SECTION B: Week-level aggregate ──────────────────────────────────────────
week_agg AS (
  SELECT
    COUNT(DISTINCT participant)                     AS total_unique_wallets,
    SUM(tickets)                                    AS total_tickets_sold,
    COUNT(*)                                        AS total_participation_events
  FROM participations
),

-- New vs returning by round (first appearance = new)
first_appearance AS (
  SELECT participant, MIN(round_id) AS debut_round
  FROM participations
  GROUP BY participant
),

new_vs_returning AS (
  SELECT
    p.round_id,
    COUNT(DISTINCT CASE WHEN fa.debut_round = p.round_id THEN p.participant END) AS new_wallets,
    COUNT(DISTINCT CASE WHEN fa.debut_round < p.round_id  THEN p.participant END) AS returning_wallets
  FROM participations p
  JOIN first_appearance fa ON fa.participant = p.participant
  GROUP BY p.round_id
),

-- Day-over-day retention (round N → round N+1)
dod_retention AS (
  SELECT
    a.round_id                                      AS from_round,
    a.round_id + 1                                  AS to_round,
    COUNT(DISTINCT a.participant)                   AS players_in_from,
    COUNT(DISTINCT b.participant)                   AS retained,
    ROUND(
      100.0 * COUNT(DISTINCT b.participant)
            / NULLIF(COUNT(DISTINCT a.participant), 0), 1
    )                                               AS retention_pct
  FROM wallet_rounds a
  LEFT JOIN wallet_rounds b
    ON b.participant = a.participant
   AND b.round_id   = a.round_id + 1
  WHERE a.round_id BETWEEN 171 AND 176   -- 176→177 is the last pair
  GROUP BY a.round_id
),

-- Loyalty tier distribution
loyalty_dist AS (
  SELECT
    loyalty_tier,
    COUNT(*)                                        AS wallet_count,
    ROUND(100.0 * COUNT(*) / SUM(COUNT(*)) OVER (), 1) AS pct_of_players
  FROM wallet_profile
  GROUP BY loyalty_tier
),

-- Ticket concentration (top 10% buyers)
ticket_concentration AS (
  SELECT
    ROUND(
      100.0 * SUM(CASE WHEN rn <= CEIL(0.1 * total) THEN total_tickets ELSE 0 END)
            / NULLIF(SUM(total_tickets), 0), 1
    ) AS top10pct_wallet_ticket_share
  FROM (
    SELECT
      participant,
      total_tickets,
      ROW_NUMBER() OVER (ORDER BY total_tickets DESC) AS rn,
      COUNT(*) OVER ()                                 AS total
    FROM wallet_summary
  )
),

-- Winner TVL profile
winner_tvl AS (
  SELECT
    aw.round_id,
    aw.winner,
    aw.reward_usdt,
    GREATEST(COALESCE(u.usdt_balance, 0), 0)        AS winner_usdt_balance,
    GREATEST(COALESCE(c.cusd_balance, 0), 0)        AS winner_cusd_balance
  FROM all_winners aw
  LEFT JOIN usdt_balances u ON LOWER(u.address) = LOWER(CAST(aw.winner AS VARCHAR))
  LEFT JOIN cusd_balances c ON LOWER(c.address) = LOWER(CAST(aw.winner AS VARCHAR))
)

-- ════════════════════════════════════════════════════════════════════════════
-- OUTPUT 1 of 5: Per-round performance
-- ════════════════════════════════════════════════════════════════════════════
SELECT
  'round_performance'                               AS report_section,
  rs.round_id,
  rs.participants,
  nr.new_wallets,
  nr.returning_wallets,
  rs.tickets_sold,
  rs.maxTickets                                     AS max_tickets,
  rs.sellthrough_pct,
  rs.total_miles_burned,
  rs.reward_pool_usdt,
  rs.total_paid_out_usdt,
  rs.winner_count,
  dr.retention_pct                                  AS retention_into_next_round_pct
FROM round_summary rs
LEFT JOIN new_vs_returning nr ON nr.round_id = rs.round_id
LEFT JOIN dod_retention    dr ON dr.from_round = rs.round_id
ORDER BY rs.round_id ASC

-- ════════════════════════════════════════════════════════════════════════════
-- OUTPUT 2 of 5: Week aggregate + TVL averages
-- (run as separate Dune query — paste from here down)
-- ════════════════════════════════════════════════════════════════════════════
/*
SELECT
  wa.total_unique_wallets,
  wa.total_tickets_sold,
  wa.total_participation_events,
  ROUND(wa.total_tickets_sold * 1.0 / NULLIF(wa.total_unique_wallets, 0), 1) AS avg_tickets_per_wallet,
  ROUND(AVG(wp.usdt_balance),       2)              AS avg_usdt_per_wallet,
  ROUND(AVG(wp.cusd_balance),       2)              AS avg_cusd_per_wallet,
  ROUND(AVG(wp.total_stable_tvl),   2)              AS avg_total_stable_tvl,
  ROUND(AVG(wp.wallet_age_days),    0)              AS avg_wallet_age_days,
  ROUND(AVG(wp.lifetime_tx_count),  0)              AS avg_lifetime_txs,
  tc.top10pct_wallet_ticket_share
FROM week_agg wa
CROSS JOIN wallet_profile wp
CROSS JOIN ticket_concentration tc
GROUP BY wa.total_unique_wallets, wa.total_tickets_sold,
         wa.total_participation_events, tc.top10pct_wallet_ticket_share
*/

-- ════════════════════════════════════════════════════════════════════════════
-- OUTPUT 3 of 5: Retention day-over-day
-- ════════════════════════════════════════════════════════════════════════════
/*
SELECT
  from_round,
  to_round,
  players_in_from,
  retained,
  retention_pct
FROM dod_retention
ORDER BY from_round
*/

-- ════════════════════════════════════════════════════════════════════════════
-- OUTPUT 4 of 5: Loyalty tier distribution
-- ════════════════════════════════════════════════════════════════════════════
/*
SELECT loyalty_tier, wallet_count, pct_of_players
FROM loyalty_dist
ORDER BY wallet_count DESC
*/

-- ════════════════════════════════════════════════════════════════════════════
-- OUTPUT 5 of 5: Winner profiles
-- ════════════════════════════════════════════════════════════════════════════
/*
SELECT
  round_id,
  winner,
  reward_usdt,
  winner_usdt_balance,
  winner_cusd_balance,
  ROUND(winner_usdt_balance + winner_cusd_balance, 2) AS winner_total_stable_tvl
FROM winner_tvl
ORDER BY round_id, reward_usdt DESC
*/
