-- ═══════════════════════════════════════════════════════════════════════════
-- QUERY 1: Daily Overview
-- Contract : 0xD2f1b9E3a3EE38C63c152cb1d8Dc7b4dD8871454 (AkibaSkillGamesV2)
-- Namespace : akiba_celo
-- Covers   : sessions started/settled, unique players, DAU/WAU, economics
-- ═══════════════════════════════════════════════════════════════════════════

WITH

starts AS (
  SELECT
    DATE_TRUNC('day', evt_block_time)   AS day,
    sessionId,
    player,
    gameType,
    entryCost / 1e18                    AS entry_cost_miles,
    evt_tx_from                         AS tx_sender     -- verifier if sponsored
  FROM akiba_celo.AkibaSkillGamesV2_evt_GameStarted
),

settles AS (
  SELECT
    DATE_TRUNC('day', evt_block_time)   AS day,
    sessionId,
    player,
    gameType,
    score,
    rewardMiles  / 1e18                 AS reward_miles,
    rewardStable / 1e6                  AS reward_stable_usd,
    evt_block_time                      AS settled_at
  FROM akiba_celo.AkibaSkillGamesV2_evt_GameSettled
),

sponsored AS (
  SELECT DISTINCT sessionId
  FROM akiba_celo.AkibaSkillGamesV2_evt_SponsoredStartUsed
),

credits AS (
  SELECT
    DATE_TRUNC('day', evt_block_time)   AS day,
    player,
    count                               AS credits_bought,
    totalCost / 1e18                    AS miles_burned
  FROM akiba_celo.AkibaSkillGamesV2_evt_CreditsPurchased
),

-- WAU: assign each session to its ISO week
starts_with_week AS (
  SELECT
    player,
    DATE_TRUNC('week', day) AS week
  FROM starts
),

wau AS (
  SELECT week, COUNT(DISTINCT player) AS weekly_active_players
  FROM starts_with_week
  GROUP BY week
),

-- Daily aggregations
daily_starts AS (
  SELECT
    day,
    COUNT(*)                                                        AS sessions_started,
    COUNT(DISTINCT player)                                          AS dau,
    COUNT(DISTINCT CASE WHEN sp.sessionId IS NOT NULL
                        THEN s.sessionId END)                       AS sponsored_starts,
    COUNT(DISTINCT CASE WHEN sp.sessionId IS NULL
                        THEN s.sessionId END)                       AS self_starts,
    ROUND(SUM(entry_cost_miles), 4)                                 AS miles_burned_inline
  FROM starts s
  LEFT JOIN sponsored sp ON sp.sessionId = s.sessionId
  GROUP BY day
),

daily_settles AS (
  SELECT
    day,
    COUNT(*)                            AS sessions_settled,
    COUNT(DISTINCT player)              AS unique_winners,
    ROUND(AVG(score), 2)                AS avg_score,
    ROUND(MAX(score), 2)                AS highest_score,
    ROUND(SUM(reward_miles), 4)         AS total_miles_rewarded,
    ROUND(SUM(reward_stable_usd), 4)    AS total_stable_rewarded_usd,
    ROUND(AVG(reward_miles), 4)         AS avg_miles_per_session,
    ROUND(AVG(reward_stable_usd), 4)    AS avg_stable_per_session
  FROM settles
  GROUP BY day
),

daily_credits AS (
  SELECT
    day,
    COUNT(DISTINCT player)              AS unique_credit_buyers,
    SUM(credits_bought)                 AS credits_purchased,
    ROUND(SUM(miles_burned), 4)         AS miles_burned_credits
  FROM credits
  GROUP BY day
),

all_days AS (
  SELECT day FROM daily_starts
  UNION SELECT day FROM daily_settles
  UNION SELECT day FROM daily_credits
)

SELECT
  d.day,
  DATE_TRUNC('week', d.day)                                         AS week,

  -- ── Plays ──────────────────────────────────────────────────────────────────
  COALESCE(s.sessions_started,        0)                            AS sessions_started,
  COALESCE(se.sessions_settled,       0)                            AS sessions_settled,
  ROUND(
    100.0 * COALESCE(se.sessions_settled, 0)
          / NULLIF(s.sessions_started, 0), 1
  )                                                                 AS settlement_rate_pct,

  -- ── Players ────────────────────────────────────────────────────────────────
  COALESCE(s.dau,                     0)                            AS dau,
  w.weekly_active_players                                           AS wau,
  COALESCE(s.sponsored_starts,        0)                            AS sponsored_starts,
  COALESCE(s.self_starts,             0)                            AS self_starts,

  -- ── Credits ────────────────────────────────────────────────────────────────
  COALESCE(c.credits_purchased,       0)                            AS credits_purchased,
  COALESCE(c.unique_credit_buyers,    0)                            AS unique_credit_buyers,

  -- ── Economics ──────────────────────────────────────────────────────────────
  ROUND(
    COALESCE(s.miles_burned_inline, 0) + COALESCE(c.miles_burned_credits, 0), 4
  )                                                                 AS total_miles_burned,
  COALESCE(se.total_miles_rewarded,   0)                            AS total_miles_rewarded,
  ROUND(
    COALESCE(s.miles_burned_inline, 0) + COALESCE(c.miles_burned_credits, 0)
    - COALESCE(se.total_miles_rewarded, 0), 4
  )                                                                 AS net_miles_burn,
  COALESCE(se.total_stable_rewarded_usd, 0)                         AS total_stable_rewarded_usd,

  -- ── Scores ─────────────────────────────────────────────────────────────────
  COALESCE(se.avg_score,              0)                            AS avg_score,
  COALESCE(se.highest_score,          0)                            AS highest_score,
  COALESCE(se.avg_miles_per_session,  0)                            AS avg_miles_per_settled_session,
  COALESCE(se.avg_stable_per_session, 0)                            AS avg_stable_per_settled_session

FROM all_days d
LEFT JOIN daily_starts   s  ON s.day  = d.day
LEFT JOIN daily_settles  se ON se.day = d.day
LEFT JOIN daily_credits  c  ON c.day  = d.day
LEFT JOIN wau            w  ON w.week = DATE_TRUNC('week', d.day)
ORDER BY d.day DESC
