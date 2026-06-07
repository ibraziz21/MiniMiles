-- ═══════════════════════════════════════════════════════════════════════════
-- QUERY 3: Credits & Sponsored Starts
-- Contract : 0xD2f1b9E3a3EE38C63c152cb1d8Dc7b4dD8871454 (AkibaSkillGamesV2)
-- Namespace : akiba_celo
-- Covers   : credits purchased, bundle sizes inferred from count,
--            miles burned buying credits, sponsored vs self-starts,
--            credit consumption by game type, repeat-player rate
-- ═══════════════════════════════════════════════════════════════════════════

WITH

-- ── Credit purchases ─────────────────────────────────────────────────────────
purchases AS (
  SELECT
    DATE_TRUNC('day', evt_block_time)       AS day,
    player,
    gameType,
    count                                   AS credits_bought,
    totalCost / 1e18                        AS miles_burned,
    -- Infer bundle tier
    CASE
      WHEN count >= 20 THEN '20-credit bundle'
      WHEN count >= 10 THEN '10-credit bundle'
      WHEN count >= 5  THEN '5-credit bundle'
      ELSE 'small (<5)'
    END                                     AS bundle_tier
  FROM akiba_celo.AkibaSkillGamesV2_evt_CreditsPurchased
),

-- ── Credit consumed events ───────────────────────────────────────────────────
consumed AS (
  SELECT
    DATE_TRUNC('day', evt_block_time)       AS day,
    player,
    gameType,
    COUNT(*)                                AS credits_consumed
  FROM akiba_celo.AkibaSkillGamesV2_evt_CreditConsumed
  GROUP BY 1, 2, 3
),

-- ── All starts + sponsored flag ──────────────────────────────────────────────
starts AS (
  SELECT
    DATE_TRUNC('day', evt_block_time)       AS day,
    sessionId,
    player,
    gameType
  FROM akiba_celo.AkibaSkillGamesV2_evt_GameStarted
),

sponsored AS (
  SELECT DISTINCT sessionId, player, gameType,
    DATE_TRUNC('day', evt_block_time)       AS day
  FROM akiba_celo.AkibaSkillGamesV2_evt_SponsoredStartUsed
),

-- ── Repeat player rate ───────────────────────────────────────────────────────
-- A repeat player has played on more than one distinct day
player_days AS (
  SELECT player, COUNT(DISTINCT day) AS days_played
  FROM starts
  GROUP BY player
),

repeat_flags AS (
  SELECT
    player,
    days_played,
    CASE WHEN days_played > 1 THEN 'repeat' ELSE 'one-time' END AS player_type
  FROM player_days
),

-- ── Plays per wallet ─────────────────────────────────────────────────────────
plays_per_wallet AS (
  SELECT
    player,
    COUNT(*)                                AS total_plays,
    COUNT(DISTINCT gameType)                AS game_types_played
  FROM starts
  GROUP BY player
),

-- ── Daily credit summary ─────────────────────────────────────────────────────
daily_purchases AS (
  SELECT
    day,
    COUNT(DISTINCT player)                  AS unique_buyers,
    SUM(credits_bought)                     AS total_credits_bought,
    ROUND(SUM(miles_burned), 4)             AS total_miles_burned,
    COUNT(CASE WHEN bundle_tier = '20-credit bundle' THEN 1 END) AS bundle_20_purchases,
    COUNT(CASE WHEN bundle_tier = '10-credit bundle' THEN 1 END) AS bundle_10_purchases,
    COUNT(CASE WHEN bundle_tier = '5-credit bundle'  THEN 1 END) AS bundle_5_purchases,
    COUNT(CASE WHEN bundle_tier = 'small (<5)'       THEN 1 END) AS bundle_small_purchases
  FROM purchases
  GROUP BY day
),

daily_consumed AS (
  SELECT
    day,
    SUM(credits_consumed)                   AS total_credits_consumed,
    SUM(CASE WHEN gameType = 0 THEN credits_consumed ELSE 0 END) AS rule_tap_credits_consumed,
    SUM(CASE WHEN gameType = 1 THEN credits_consumed ELSE 0 END) AS memory_flip_credits_consumed
  FROM consumed
  GROUP BY day
),

daily_sponsored AS (
  SELECT
    day,
    COUNT(*)                                AS sponsored_starts,
    COUNT(DISTINCT player)                  AS sponsored_unique_players
  FROM sponsored
  GROUP BY day
),

daily_starts AS (
  SELECT
    day,
    COUNT(*)                                AS total_starts
  FROM starts
  GROUP BY day
),

all_days AS (
  SELECT day FROM daily_purchases
  UNION SELECT day FROM daily_consumed
  UNION SELECT day FROM daily_sponsored
  UNION SELECT day FROM daily_starts
)

-- ── Output A: Daily credit & sponsored summary ───────────────────────────────
SELECT
  d.day,

  -- Starts breakdown
  COALESCE(ds.total_starts,                0)   AS total_starts,
  COALESCE(sp.sponsored_starts,            0)   AS sponsored_starts,
  COALESCE(ds.total_starts, 0) - COALESCE(sp.sponsored_starts, 0) AS self_starts,
  ROUND(
    100.0 * COALESCE(sp.sponsored_starts, 0)
          / NULLIF(ds.total_starts, 0), 1
  )                                             AS sponsored_pct,

  -- Credits purchased
  COALESCE(dp.unique_buyers,               0)   AS unique_credit_buyers,
  COALESCE(dp.total_credits_bought,        0)   AS credits_bought,
  COALESCE(dp.total_miles_burned,          0)   AS miles_burned_on_credits,
  COALESCE(dp.bundle_20_purchases,         0)   AS bundle_20_count,
  COALESCE(dp.bundle_10_purchases,         0)   AS bundle_10_count,
  COALESCE(dp.bundle_5_purchases,          0)   AS bundle_5_count,
  COALESCE(dp.bundle_small_purchases,      0)   AS bundle_small_count,

  -- Credits consumed (credit-path plays)
  COALESCE(dc.total_credits_consumed,      0)   AS credits_consumed,
  COALESCE(dc.rule_tap_credits_consumed,   0)   AS rule_tap_credit_plays,
  COALESCE(dc.memory_flip_credits_consumed,0)   AS memory_flip_credit_plays

FROM all_days d
LEFT JOIN daily_starts    ds ON ds.day = d.day
LEFT JOIN daily_purchases dp ON dp.day = d.day
LEFT JOIN daily_consumed  dc ON dc.day = d.day
LEFT JOIN daily_sponsored sp ON sp.day = d.day
ORDER BY d.day DESC
