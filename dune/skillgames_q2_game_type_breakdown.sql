-- ═══════════════════════════════════════════════════════════════════════════
-- QUERY 2: Game Type Breakdown — Rule Tap (0) vs Memory Flip (1)
-- Contract : 0xD2f1b9E3a3EE38C63c152cb1d8Dc7b4dD8871454 (AkibaSkillGamesV2)
-- Namespace : akiba_celo
-- ═══════════════════════════════════════════════════════════════════════════

WITH

game_label AS (
  SELECT 0 AS gameType, 'Rule Tap'    AS game_name
  UNION ALL
  SELECT 1,             'Memory Flip'
),

starts AS (
  SELECT
    DATE_TRUNC('day', evt_block_time)  AS day,
    sessionId,
    player,
    gameType,
    entryCost / 1e18                   AS entry_cost_miles
  FROM akiba_celo.AkibaSkillGamesV2_evt_GameStarted
),

settles AS (
  SELECT
    DATE_TRUNC('day', evt_block_time)  AS day,
    sessionId,
    player,
    gameType,
    score,
    rewardMiles  / 1e18                AS reward_miles,
    rewardStable / 1e6                 AS reward_stable_usd
  FROM akiba_celo.AkibaSkillGamesV2_evt_GameSettled
),

credits_consumed AS (
  SELECT
    DATE_TRUNC('day', evt_block_time)  AS day,
    player,
    gameType,
    COUNT(*)                           AS credit_plays
  FROM akiba_celo.AkibaSkillGamesV2_evt_CreditConsumed
  GROUP BY 1, 2, 3
),

-- Per game type, per day
by_game_starts AS (
  SELECT
    day,
    gameType,
    COUNT(*)                           AS sessions_started,
    COUNT(DISTINCT player)             AS unique_players,
    ROUND(SUM(entry_cost_miles), 4)    AS miles_burned
  FROM starts
  GROUP BY day, gameType
),

by_game_settles AS (
  SELECT
    day,
    gameType,
    COUNT(*)                           AS sessions_settled,
    ROUND(AVG(score), 2)               AS avg_score,
    ROUND(MAX(score), 2)               AS max_score,
    ROUND(MIN(score), 2)               AS min_score,

    -- Score distribution buckets
    COUNT(CASE WHEN score < 1000  THEN 1 END)  AS score_0_999,
    COUNT(CASE WHEN score >= 1000
               AND score < 5000  THEN 1 END)   AS score_1k_4999,
    COUNT(CASE WHEN score >= 5000
               AND score < 10000 THEN 1 END)   AS score_5k_9999,
    COUNT(CASE WHEN score >= 10000 THEN 1 END) AS score_10k_plus,

    ROUND(SUM(reward_miles), 4)        AS total_miles_rewarded,
    ROUND(SUM(reward_stable_usd), 4)   AS total_stable_rewarded,
    ROUND(AVG(reward_miles), 4)        AS avg_miles_per_session,
    ROUND(AVG(reward_stable_usd), 4)   AS avg_stable_per_session
  FROM settles
  GROUP BY day, gameType
),

by_game_credits AS (
  SELECT
    day,
    gameType,
    SUM(credit_plays)                  AS credit_plays
  FROM credits_consumed
  GROUP BY day, gameType
),

all_combos AS (
  SELECT day, gameType FROM by_game_starts
  UNION
  SELECT day, gameType FROM by_game_settles
  UNION
  SELECT day, gameType FROM by_game_credits
)

SELECT
  a.day,
  gl.game_name,

  -- Plays
  COALESCE(s.sessions_started,     0)  AS sessions_started,
  COALESCE(se.sessions_settled,    0)  AS sessions_settled,
  ROUND(
    100.0 * COALESCE(se.sessions_settled, 0)
          / NULLIF(s.sessions_started, 0), 1
  )                                    AS settlement_rate_pct,
  COALESCE(s.unique_players,       0)  AS unique_players,

  -- Credits consumed via credit path
  COALESCE(cc.credit_plays,        0)  AS credit_plays,

  -- Economics
  COALESCE(s.miles_burned,         0)  AS miles_burned_inline,
  COALESCE(se.total_miles_rewarded, 0) AS miles_rewarded,
  COALESCE(se.total_stable_rewarded, 0) AS stable_rewarded_usd,
  COALESCE(se.avg_miles_per_session, 0) AS avg_miles_per_session,
  COALESCE(se.avg_stable_per_session, 0) AS avg_stable_per_session,

  -- Scores
  COALESCE(se.avg_score,           0)  AS avg_score,
  COALESCE(se.max_score,           0)  AS max_score,
  COALESCE(se.min_score,           0)  AS min_score,
  COALESCE(se.score_0_999,         0)  AS score_bucket_0_999,
  COALESCE(se.score_1k_4999,       0)  AS score_bucket_1k_4999,
  COALESCE(se.score_5k_9999,       0)  AS score_bucket_5k_9999,
  COALESCE(se.score_10k_plus,      0)  AS score_bucket_10k_plus

FROM all_combos a
LEFT JOIN game_label      gl ON gl.gameType = a.gameType
LEFT JOIN by_game_starts  s  ON s.day = a.day  AND s.gameType = a.gameType
LEFT JOIN by_game_settles se ON se.day = a.day AND se.gameType = a.gameType
LEFT JOIN by_game_credits cc ON cc.day = a.day AND cc.gameType = a.gameType
ORDER BY a.day DESC, a.gameType ASC
