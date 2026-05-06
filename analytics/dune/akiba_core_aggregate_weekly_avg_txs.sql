-- Akiba core contracts: aggregate weekly average transactions
-- Chain: Celo
-- DuneSQL
--
-- Focus contracts:
--   AkibaMiles V2, Raffle V6, Dice
--
-- Dashboard chart suggestion:
--   Main KPI: current_week_avg_daily_txs
--   Line chart: week vs avg_daily_txs

WITH contracts(contract_name, contract_address) AS (
  VALUES
    ('AkibaMiles V2', 0xab93400000751fc17918940c202a66066885d628),
    ('Raffle V6',     0xd75dfa972c6136f1c594fec1945302f885e1ab29),
    ('Dice',          0xf77e7395aa5c89bcc8d6e23f67a9c7914ab9702a)
),
daily AS (
  SELECT
    CAST(date_trunc('day', tx.block_time) AS date) AS day,
    COUNT(*) AS daily_txs,
    COUNT(DISTINCT tx."from") AS daily_unique_senders
  FROM celo.transactions tx
  INNER JOIN contracts c
    ON tx."to" = c.contract_address
  WHERE tx.block_time >= current_date - INTERVAL '180' day
  GROUP BY 1
),
days AS (
  SELECT day
  FROM UNNEST(
    sequence(
      CAST(current_date - INTERVAL '180' day AS date),
      current_date,
      INTERVAL '1' day
    )
  ) AS t(day)
),
filled_daily AS (
  SELECT
    d.day,
    CAST(date_trunc('week', d.day) AS date) AS week,
    COALESCE(daily.daily_txs, 0) AS daily_txs,
    COALESCE(daily.daily_unique_senders, 0) AS daily_unique_senders
  FROM days d
  LEFT JOIN daily
    ON daily.day = d.day
),
weekly AS (
  SELECT
    week,
    SUM(daily_txs) AS weekly_txs,
    AVG(daily_txs) AS avg_daily_txs,
    AVG(daily_unique_senders) AS avg_daily_unique_senders,
    COUNT(*) AS days_in_sample
  FROM filled_daily
  GROUP BY 1
)
SELECT
  week,
  weekly_txs,
  avg_daily_txs,
  avg_daily_unique_senders,
  AVG(avg_daily_txs) OVER (
    ORDER BY week
    ROWS BETWEEN 3 PRECEDING AND CURRENT ROW
  ) AS rolling_4w_avg_daily_txs,
  AVG(weekly_txs) OVER (
    ORDER BY week
    ROWS BETWEEN 3 PRECEDING AND CURRENT ROW
  ) AS rolling_4w_avg_weekly_txs,
  days_in_sample
FROM weekly
ORDER BY week DESC;
