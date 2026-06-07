-- ═══════════════════════════════════════════════════════════════════════════
-- QUERY 5: Wallet Profiles & Whale Analysis
-- Contract : 0xD2f1b9E3a3EE38C63c152cb1d8Dc7b4dD8871454 (AkibaSkillGamesV2)
-- Namespace : akiba_celo
-- Token addresses:
--   AkibaMiles V2 : 0xab93400000751fc17918940C202A66066885d628 (18 decimals)
--   USDT (Tether) : 0x48065fbBE25f71C9282ddf5e1cD6D6A887483D5e (6 decimals)
--   cUSD          : 0x765DE816845861e75A25fCA122bb6898B8B1282a (18 decimals)
-- Covers:
--   - Balance at first play date
--   - Balance at latest snapshot (all-time)
--   - Plays per wallet, total rewards, repeat-player rate
--   - Whale leaderboard by plays and rewards
-- ═══════════════════════════════════════════════════════════════════════════

WITH

-- ── Player activity ──────────────────────────────────────────────────────────
starts AS (
  SELECT
    sessionId,
    player,
    gameType,
    evt_block_time                                      AS started_at
  FROM akiba_celo.AkibaSkillGamesV2_evt_GameStarted
),

settles AS (
  SELECT
    sessionId,
    player,
    rewardMiles  / 1e18                                 AS reward_miles,
    rewardStable / 1e6                                  AS reward_stable_usd,
    score
  FROM akiba_celo.AkibaSkillGamesV2_evt_GameSettled
),

-- Per-player lifetime stats
player_stats AS (
  SELECT
    s.player,
    COUNT(*)                                            AS total_plays,
    COUNT(DISTINCT DATE_TRUNC('day', s.started_at))     AS days_played,
    COUNT(DISTINCT s.gameType)                          AS game_types_played,
    MIN(s.started_at)                                   AS first_play_at,
    MAX(s.started_at)                                   AS last_play_at,
    COUNT(se.sessionId)                                 AS settled_sessions,
    ROUND(SUM(COALESCE(se.reward_miles, 0)), 4)         AS total_miles_earned,
    ROUND(SUM(COALESCE(se.reward_stable_usd, 0)), 4)    AS total_stable_earned_usd,
    ROUND(AVG(COALESCE(se.score, 0)), 2)                AS avg_score,
    ROUND(MAX(COALESCE(se.score, 0)), 2)                AS best_score,
    CASE WHEN COUNT(DISTINCT DATE_TRUNC('day', s.started_at)) > 1
         THEN 'repeat' ELSE 'one-time' END              AS player_type
  FROM starts s
  LEFT JOIN settles se ON se.sessionId = s.sessionId
  GROUP BY s.player
),

all_players AS (SELECT DISTINCT player FROM starts),

-- ── ERC20 transfer helper (generic) ─────────────────────────────────────────
-- USDT transfers (6 decimals)
usdt_xfers AS (
  SELECT
    bytearray_to_uint256(bytearray_substring(data, 1, 32)) / 1e6  AS amount,
    CAST('0x' || SUBSTR(CAST(topic2 AS VARCHAR), 27, 40) AS VARCHAR) AS to_addr,
    CAST('0x' || SUBSTR(CAST(topic1 AS VARCHAR), 27, 40) AS VARCHAR) AS from_addr,
    block_time
  FROM celo.logs
  WHERE contract_address = 0x48065fbBE25f71C9282ddf5e1cD6D6A887483D5e
    AND topic0 = 0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef
),

-- cUSD transfers (18 decimals)
cusd_xfers AS (
  SELECT
    bytearray_to_uint256(bytearray_substring(data, 1, 32)) / 1e18 AS amount,
    CAST('0x' || SUBSTR(CAST(topic2 AS VARCHAR), 27, 40) AS VARCHAR) AS to_addr,
    CAST('0x' || SUBSTR(CAST(topic1 AS VARCHAR), 27, 40) AS VARCHAR) AS from_addr,
    block_time
  FROM celo.logs
  WHERE contract_address = 0x765DE816845861e75A25fCA122bb6898B8B1282a
    AND topic0 = 0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef
),

-- AkibaMiles V2 transfers (18 decimals)
miles_xfers AS (
  SELECT
    bytearray_to_uint256(bytearray_substring(data, 1, 32)) / 1e18 AS amount,
    CAST('0x' || SUBSTR(CAST(topic2 AS VARCHAR), 27, 40) AS VARCHAR) AS to_addr,
    CAST('0x' || SUBSTR(CAST(topic1 AS VARCHAR), 27, 40) AS VARCHAR) AS from_addr,
    block_time
  FROM celo.logs
  WHERE contract_address = 0xab93400000751fc17918940C202A66066885d628
    AND topic0 = 0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef
),

-- ── All-time (latest snapshot) balances ──────────────────────────────────────
usdt_balance_latest AS (
  SELECT address, SUM(delta) AS usdt_balance
  FROM (
    SELECT to_addr   AS address,  amount AS delta FROM usdt_xfers
    UNION ALL
    SELECT from_addr AS address, -amount AS delta FROM usdt_xfers
  )
  GROUP BY address
),

cusd_balance_latest AS (
  SELECT address, SUM(delta) AS cusd_balance
  FROM (
    SELECT to_addr   AS address,  amount AS delta FROM cusd_xfers
    UNION ALL
    SELECT from_addr AS address, -amount AS delta FROM cusd_xfers
  )
  GROUP BY address
),

miles_balance_latest AS (
  SELECT address, SUM(delta) AS miles_balance
  FROM (
    SELECT to_addr   AS address,  amount AS delta FROM miles_xfers
    UNION ALL
    SELECT from_addr AS address, -amount AS delta FROM miles_xfers
  )
  GROUP BY address
),

-- ── Balance at first play date ────────────────────────────────────────────────
usdt_balance_at_first_play AS (
  SELECT address, SUM(delta) AS usdt_balance_at_first_play
  FROM (
    SELECT x.to_addr   AS address,  x.amount AS delta, x.block_time
    FROM usdt_xfers x
    UNION ALL
    SELECT x.from_addr AS address, -x.amount AS delta, x.block_time
    FROM usdt_xfers x
  ) t
  JOIN player_stats ps ON LOWER(t.address) = LOWER(CAST(ps.player AS VARCHAR))
  WHERE t.block_time <= ps.first_play_at
  GROUP BY address
),

cusd_balance_at_first_play AS (
  SELECT address, SUM(delta) AS cusd_balance_at_first_play
  FROM (
    SELECT x.to_addr   AS address,  x.amount AS delta, x.block_time
    FROM cusd_xfers x
    UNION ALL
    SELECT x.from_addr AS address, -x.amount AS delta, x.block_time
    FROM cusd_xfers x
  ) t
  JOIN player_stats ps ON LOWER(t.address) = LOWER(CAST(ps.player AS VARCHAR))
  WHERE t.block_time <= ps.first_play_at
  GROUP BY address
),

miles_balance_at_first_play AS (
  SELECT address, SUM(delta) AS miles_balance_at_first_play
  FROM (
    SELECT x.to_addr   AS address,  x.amount AS delta, x.block_time
    FROM miles_xfers x
    UNION ALL
    SELECT x.from_addr AS address, -x.amount AS delta, x.block_time
    FROM miles_xfers x
  ) t
  JOIN player_stats ps ON LOWER(t.address) = LOWER(CAST(ps.player AS VARCHAR))
  WHERE t.block_time <= ps.first_play_at
  GROUP BY address
)

-- ── Final output: per-player profile ────────────────────────────────────────
SELECT
  ps.player,
  ps.player_type,
  ps.total_plays,
  ps.days_played,
  ps.game_types_played,
  ps.first_play_at,
  ps.last_play_at,
  ps.settled_sessions,
  ROUND(100.0 * ps.settled_sessions / NULLIF(ps.total_plays, 0), 1) AS personal_settlement_rate_pct,
  ps.avg_score,
  ps.best_score,

  -- Lifetime rewards
  ps.total_miles_earned,
  ps.total_stable_earned_usd,

  -- Latest balances (current snapshot)
  ROUND(GREATEST(COALESCE(ul.usdt_balance,  0), 0), 4)   AS usdt_balance_now,
  ROUND(GREATEST(COALESCE(cl.cusd_balance,  0), 0), 4)   AS cusd_balance_now,
  ROUND(GREATEST(COALESCE(ml.miles_balance, 0), 0), 4)   AS miles_balance_now,
  ROUND(
    GREATEST(COALESCE(ul.usdt_balance, 0), 0)
    + GREATEST(COALESCE(cl.cusd_balance, 0), 0), 4
  )                                                       AS total_stablecoin_now,

  -- Balances at first play date
  ROUND(GREATEST(COALESCE(uf.usdt_balance_at_first_play,  0), 0), 4) AS usdt_at_first_play,
  ROUND(GREATEST(COALESCE(cf.cusd_balance_at_first_play,  0), 0), 4) AS cusd_at_first_play,
  ROUND(GREATEST(COALESCE(mf.miles_balance_at_first_play, 0), 0), 4) AS miles_at_first_play,
  ROUND(
    GREATEST(COALESCE(uf.usdt_balance_at_first_play, 0), 0)
    + GREATEST(COALESCE(cf.cusd_balance_at_first_play, 0), 0), 4
  )                                                       AS total_stablecoin_at_first_play

FROM player_stats ps
LEFT JOIN usdt_balance_latest         ul ON LOWER(ul.address) = LOWER(CAST(ps.player AS VARCHAR))
LEFT JOIN cusd_balance_latest         cl ON LOWER(cl.address) = LOWER(CAST(ps.player AS VARCHAR))
LEFT JOIN miles_balance_latest        ml ON LOWER(ml.address) = LOWER(CAST(ps.player AS VARCHAR))
LEFT JOIN usdt_balance_at_first_play  uf ON LOWER(uf.address) = LOWER(CAST(ps.player AS VARCHAR))
LEFT JOIN cusd_balance_at_first_play  cf ON LOWER(cf.address) = LOWER(CAST(ps.player AS VARCHAR))
LEFT JOIN miles_balance_at_first_play mf ON LOWER(mf.address) = LOWER(CAST(ps.player AS VARCHAR))

ORDER BY ps.total_plays DESC
