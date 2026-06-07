-- ═══════════════════════════════════════════════════════════════════════════
-- QUERY 4: Settlement Health
-- Contract : 0xD2f1b9E3a3EE38C63c152cb1d8Dc7b4dD8871454 (AkibaSkillGamesV2)
-- Namespace : akiba_celo
-- Covers   : avg time to settle, pending/abandoned sessions,
--            sessions past 30-min window, verifier activity
-- ═══════════════════════════════════════════════════════════════════════════

WITH

SETTLEMENT_WINDOW_SECONDS AS (SELECT 1800 AS val),   -- 30 minutes

starts AS (
  SELECT
    sessionId,
    player,
    gameType,
    evt_block_time                          AS started_at,
    evt_tx_from                             AS start_tx_sender
  FROM akiba_celo.AkibaSkillGamesV2_evt_GameStarted
),

settles AS (
  SELECT
    sessionId,
    player,
    score,
    rewardMiles  / 1e18                     AS reward_miles,
    rewardStable / 1e6                      AS reward_stable_usd,
    evt_block_time                          AS settled_at,
    evt_tx_from                             AS settle_tx_sender
  FROM akiba_celo.AkibaSkillGamesV2_evt_GameSettled
),

-- Join to compute per-session settlement time
session_health AS (
  SELECT
    s.sessionId,
    s.player,
    s.gameType,
    s.started_at,
    se.settled_at,
    se.score,
    se.reward_miles,
    se.reward_stable_usd,
    se.settle_tx_sender,
    s.start_tx_sender,

    CASE WHEN se.sessionId IS NOT NULL THEN 'settled' ELSE 'pending' END AS status,

    -- Time to settle in seconds
    DATE_DIFF('second', s.started_at, se.settled_at)                    AS seconds_to_settle,

    -- Flag sessions past the 30-min contract window
    CASE
      WHEN se.sessionId IS NULL
       AND DATE_DIFF('second', s.started_at, NOW()) > 1800
      THEN TRUE ELSE FALSE
    END                                                                 AS abandoned,

    CASE
      WHEN se.sessionId IS NOT NULL
       AND DATE_DIFF('second', s.started_at, se.settled_at) > 1800
      THEN TRUE ELSE FALSE
    END                                                                 AS settled_past_window

  FROM starts s
  LEFT JOIN settles se ON se.sessionId = s.sessionId
),

-- Daily settlement health
daily_health AS (
  SELECT
    DATE_TRUNC('day', started_at)                                       AS day,
    COUNT(*)                                                            AS total_sessions,
    COUNT(CASE WHEN status = 'settled'  THEN 1 END)                     AS settled,
    COUNT(CASE WHEN status = 'pending'  THEN 1 END)                     AS pending,
    COUNT(CASE WHEN abandoned           THEN 1 END)                     AS abandoned,
    COUNT(CASE WHEN settled_past_window THEN 1 END)                     AS settled_past_30min_window,

    -- Settlement timing
    ROUND(AVG(CASE WHEN status = 'settled'
              THEN seconds_to_settle END) / 60.0, 2)                    AS avg_minutes_to_settle,
    ROUND(MIN(CASE WHEN status = 'settled'
              THEN seconds_to_settle END) / 60.0, 2)                    AS min_minutes_to_settle,
    ROUND(MAX(CASE WHEN status = 'settled'
              THEN seconds_to_settle END) / 60.0, 2)                    AS max_minutes_to_settle,

    -- Time buckets for settled sessions
    COUNT(CASE WHEN status = 'settled'
               AND seconds_to_settle <= 60   THEN 1 END)                AS settled_under_1min,
    COUNT(CASE WHEN status = 'settled'
               AND seconds_to_settle BETWEEN 61  AND 300  THEN 1 END)   AS settled_1_5min,
    COUNT(CASE WHEN status = 'settled'
               AND seconds_to_settle BETWEEN 301 AND 1800 THEN 1 END)   AS settled_5_30min,
    COUNT(CASE WHEN status = 'settled'
               AND seconds_to_settle > 1800  THEN 1 END)                AS settled_over_30min,

    -- Verifier vs player settlement
    COUNT(CASE WHEN status = 'settled'
               AND settle_tx_sender != player THEN 1 END)               AS verifier_settled,
    COUNT(CASE WHEN status = 'settled'
               AND settle_tx_sender  = player THEN 1 END)               AS player_self_settled

  FROM session_health
  GROUP BY DATE_TRUNC('day', started_at)
)

SELECT
  day,
  total_sessions,
  settled,
  pending,
  abandoned,

  -- Rates
  ROUND(100.0 * settled     / NULLIF(total_sessions, 0), 1)            AS settlement_rate_pct,
  ROUND(100.0 * abandoned   / NULLIF(total_sessions, 0), 1)            AS abandonment_rate_pct,
  settled_past_30min_window,

  -- Timing
  avg_minutes_to_settle,
  min_minutes_to_settle,
  max_minutes_to_settle,

  -- Settlement time buckets
  settled_under_1min,
  settled_1_5min,
  settled_5_30min,
  settled_over_30min,

  -- Verifier health
  verifier_settled,
  player_self_settled,
  ROUND(100.0 * verifier_settled / NULLIF(settled, 0), 1)              AS verifier_settled_pct

FROM daily_health
ORDER BY day DESC
