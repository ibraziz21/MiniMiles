-- Akiba core contracts: aggregate daily txs and 7-day rolling average
-- Chain: Celo
-- DuneSQL
--
-- This combines AkibaMiles V2 + Raffle V6 + Dice into one top-line metric.

WITH contracts(contract_name, contract_address) AS (
  VALUES
    ('AkibaMiles V2', 0xab93400000751fc17918940c202a66066885d628),
    ('Raffle V6',     0xd75dfa972c6136f1c594fec1945302f885e1ab29),
    ('Dice',          0xf77e7395aa5c89bcc8d6e23f67a9c7914ab9702a)
),
days AS (
  SELECT day
  FROM UNNEST(
    sequence(
      CAST(current_date - INTERVAL '120' day AS date),
      current_date,
      INTERVAL '1' day
    )
  ) AS t(day)
),
daily AS (
  SELECT
    CAST(date_trunc('day', tx.block_time) AS date) AS day,
    COUNT(*) AS daily_txs,
    COUNT(DISTINCT tx."from") AS unique_senders,
    SUM(CASE WHEN tx.success THEN 1 ELSE 0 END) AS successful_txs,
    SUM(CASE WHEN NOT tx.success THEN 1 ELSE 0 END) AS failed_txs
  FROM celo.transactions tx
  INNER JOIN contracts c
    ON tx."to" = c.contract_address
  WHERE tx.block_time >= current_date - INTERVAL '120' day
  GROUP BY 1
),
filled AS (
  SELECT
    d.day,
    COALESCE(daily.daily_txs, 0) AS daily_txs,
    COALESCE(daily.unique_senders, 0) AS unique_senders,
    COALESCE(daily.successful_txs, 0) AS successful_txs,
    COALESCE(daily.failed_txs, 0) AS failed_txs
  FROM days d
  LEFT JOIN daily
    ON daily.day = d.day
)
SELECT
  day,
  daily_txs,
  unique_senders,
  successful_txs,
  failed_txs,
  SUM(daily_txs) OVER (
    ORDER BY day
    ROWS BETWEEN 6 PRECEDING AND CURRENT ROW
  ) AS trailing_7d_txs,
  AVG(daily_txs) OVER (
    ORDER BY day
    ROWS BETWEEN 6 PRECEDING AND CURRENT ROW
  ) AS rolling_7d_avg_txs,
  AVG(unique_senders) OVER (
    ORDER BY day
    ROWS BETWEEN 6 PRECEDING AND CURRENT ROW
  ) AS rolling_7d_avg_unique_senders
FROM filled
ORDER BY day DESC;
