-- AkibaMiles contracts: daily transactions and 7-day rolling average
-- Chain: Celo
-- DuneSQL
--
-- Dashboard chart suggestion:
--   X-axis: day
--   Series: contract_name
--   Y-axis 1: daily_txs
--   Y-axis 2: rolling_7d_avg_txs

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
    c.contract_name,
    c.contract_address,
    COUNT(*) AS daily_txs,
    COUNT(DISTINCT tx."from") AS unique_senders,
    SUM(CASE WHEN tx.success THEN 1 ELSE 0 END) AS successful_txs,
    SUM(CASE WHEN NOT tx.success THEN 1 ELSE 0 END) AS failed_txs
  FROM celo.transactions tx
  INNER JOIN contracts c
    ON tx."to" = c.contract_address
  WHERE tx.block_time >= current_date - INTERVAL '120' day
  GROUP BY 1, 2, 3
),
calendar AS (
  SELECT
    d.day,
    c.contract_name,
    c.contract_address
  FROM days d
  CROSS JOIN contracts c
),
filled AS (
  SELECT
    cal.day,
    cal.contract_name,
    cal.contract_address,
    COALESCE(d.daily_txs, 0) AS daily_txs,
    COALESCE(d.unique_senders, 0) AS unique_senders,
    COALESCE(d.successful_txs, 0) AS successful_txs,
    COALESCE(d.failed_txs, 0) AS failed_txs
  FROM calendar cal
  LEFT JOIN daily d
    ON d.day = cal.day
   AND d.contract_address = cal.contract_address
)
SELECT
  day,
  contract_name,
  contract_address,
  daily_txs,
  unique_senders,
  successful_txs,
  failed_txs,
  SUM(daily_txs) OVER (
    PARTITION BY contract_address
    ORDER BY day
    ROWS BETWEEN 6 PRECEDING AND CURRENT ROW
  ) AS trailing_7d_txs,
  AVG(daily_txs) OVER (
    PARTITION BY contract_address
    ORDER BY day
    ROWS BETWEEN 6 PRECEDING AND CURRENT ROW
  ) AS rolling_7d_avg_txs,
  AVG(unique_senders) OVER (
    PARTITION BY contract_address
    ORDER BY day
    ROWS BETWEEN 6 PRECEDING AND CURRENT ROW
  ) AS rolling_7d_avg_unique_senders
FROM filled
ORDER BY day DESC, contract_name;
