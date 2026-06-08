-- ═══════════════════════════════════════════════════════════════════════════
-- RAFFLE WEEK 1 — Q3: Retention & Loyalty
-- Rounds 171–177 | minipay_celo.AkibaRaffleV2
-- ═══════════════════════════════════════════════════════════════════════════

WITH

participations AS (
  SELECT roundId AS round_id, participant, tickets
  FROM minipay_celo.AkibaRaffleV2_evt_ParticipantJoined
  WHERE roundId BETWEEN 171 AND 177
),

wallet_rounds AS (
  SELECT participant, round_id
  FROM participations
  GROUP BY participant, round_id
),

wallet_summary AS (
  SELECT
    participant,
    COUNT(DISTINCT round_id)           AS rounds_played,
    SUM(tickets)                       AS total_tickets,
    -- Presence bitmask per round for easy inspection
    MAX(CASE WHEN round_id = 171 THEN 1 ELSE 0 END) AS played_171,
    MAX(CASE WHEN round_id = 172 THEN 1 ELSE 0 END) AS played_172,
    MAX(CASE WHEN round_id = 173 THEN 1 ELSE 0 END) AS played_173,
    MAX(CASE WHEN round_id = 174 THEN 1 ELSE 0 END) AS played_174,
    MAX(CASE WHEN round_id = 175 THEN 1 ELSE 0 END) AS played_175,
    MAX(CASE WHEN round_id = 176 THEN 1 ELSE 0 END) AS played_176,
    MAX(CASE WHEN round_id = 177 THEN 1 ELSE 0 END) AS played_177,
    CASE
      WHEN COUNT(DISTINCT round_id) = 7 THEN 'Perfect (7/7)'
      WHEN COUNT(DISTINCT round_id) >= 5 THEN 'Loyal (5-6/7)'
      WHEN COUNT(DISTINCT round_id) >= 3 THEN 'Returning (3-4/7)'
      WHEN COUNT(DISTINCT round_id) = 2  THEN 'Occasional (2/7)'
      ELSE 'One-time'
    END                                AS loyalty_tier
  FROM participations
  GROUP BY participant
),

-- Day-over-day retention between consecutive rounds
dod_retention AS (
  SELECT
    a.round_id                         AS from_round,
    a.round_id + 1                     AS to_round,
    COUNT(DISTINCT a.participant)      AS players_in_from_round,
    COUNT(DISTINCT b.participant)      AS retained_in_next_round,
    COUNT(DISTINCT a.participant)
      - COUNT(DISTINCT b.participant)  AS churned,
    ROUND(
      100.0 * COUNT(DISTINCT b.participant)
            / NULLIF(COUNT(DISTINCT a.participant), 0), 1
    )                                  AS retention_pct
  FROM wallet_rounds a
  LEFT JOIN wallet_rounds b
    ON b.participant = a.participant
   AND b.round_id   = a.round_id + 1
  WHERE a.round_id BETWEEN 171 AND 176
  GROUP BY a.round_id
),

-- New players entering each round
first_appearance AS (
  SELECT participant, MIN(round_id) AS debut_round
  FROM participations
  GROUP BY participant
),

new_per_round AS (
  SELECT debut_round AS round_id, COUNT(*) AS new_wallets
  FROM first_appearance
  GROUP BY debut_round
),

-- Loyalty tier distribution
loyalty_dist AS (
  SELECT
    loyalty_tier,
    COUNT(*)                           AS wallet_count,
    SUM(total_tickets)                 AS tickets_from_tier,
    ROUND(100.0 * COUNT(*) / SUM(COUNT(*)) OVER (), 1) AS pct_of_players,
    ROUND(100.0 * SUM(total_tickets) / SUM(SUM(total_tickets)) OVER (), 1) AS pct_of_tickets
  FROM wallet_summary
  GROUP BY loyalty_tier
)

-- ── Output A: Day-over-day retention ────────────────────────────────────────
SELECT
  'dod_retention'                      AS section,
  dr.from_round,
  dr.to_round,
  dr.players_in_from_round,
  nr.new_wallets                       AS new_in_to_round,
  dr.retained_in_next_round,
  dr.churned,
  dr.retention_pct
FROM dod_retention dr
LEFT JOIN new_per_round nr ON nr.round_id = dr.to_round
ORDER BY dr.from_round ASC
