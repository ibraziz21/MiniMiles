-- ═══════════════════════════════════════════════════════════════════════════
-- RAFFLE WEEK 1 — Q4: Loyalty Tier Distribution
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
    SUM(tickets)                       AS total_tickets,
    CASE
      WHEN COUNT(DISTINCT round_id) = 7 THEN 'Perfect (7/7)'
      WHEN COUNT(DISTINCT round_id) >= 5 THEN 'Loyal (5-6/7)'
      WHEN COUNT(DISTINCT round_id) >= 3 THEN 'Returning (3-4/7)'
      WHEN COUNT(DISTINCT round_id) = 2  THEN 'Occasional (2/7)'
      ELSE 'One-time'
    END                                AS loyalty_tier,
    CASE
      WHEN COUNT(DISTINCT round_id) = 7 THEN 1
      WHEN COUNT(DISTINCT round_id) >= 5 THEN 2
      WHEN COUNT(DISTINCT round_id) >= 3 THEN 3
      WHEN COUNT(DISTINCT round_id) = 2  THEN 4
      ELSE 5
    END                                AS tier_order
  FROM participations
  GROUP BY participant
)

SELECT
  loyalty_tier,
  COUNT(*)                             AS wallet_count,
  SUM(total_tickets)                   AS tickets_from_tier,
  ROUND(AVG(total_tickets), 1)         AS avg_tickets_per_wallet,
  ROUND(AVG(rounds_played), 1)         AS avg_rounds_played,
  ROUND(100.0 * COUNT(*) / SUM(COUNT(*)) OVER (), 1)             AS pct_of_players,
  ROUND(100.0 * SUM(total_tickets) / SUM(SUM(total_tickets)) OVER (), 1) AS pct_of_tickets
FROM wallet_summary
GROUP BY loyalty_tier, tier_order
ORDER BY tier_order ASC
