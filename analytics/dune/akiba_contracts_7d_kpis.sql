-- AkibaMiles contracts: latest 7-day rolling transaction KPIs
-- Chain: Celo
-- DuneSQL
--
-- Dashboard chart suggestion:
--   Use this as a table or KPI panel showing the latest rolling metrics.

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
      CAST(current_date - INTERVAL '30' day AS date),
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
    COUNT(DISTINCT tx."from") AS unique_senders
  FROM celo.transactions tx
  INNER JOIN contracts c
    ON tx."to" = c.contract_address
  WHERE tx.block_time >= current_date - INTERVAL '30' day
  GROUP BY 1, 2, 3
),
filled AS (
  SELECT
    d.day,
    c.contract_name,
    c.contract_address,
    COALESCE(daily.daily_txs, 0) AS daily_txs,
    COALESCE(daily.unique_senders, 0) AS unique_senders
  FROM days d
  CROSS JOIN contracts c
  LEFT JOIN daily
    ON daily.day = d.day
   AND daily.contract_address = c.contract_address
),
rolled AS (
  SELECT
    day,
    contract_name,
    contract_address,
    daily_txs,
    unique_senders,
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
),
latest_by_contract AS (
  SELECT
    contract_name,
    contract_address,
    daily_txs AS txs_today,
    unique_senders AS unique_senders_today,
    trailing_7d_txs,
    rolling_7d_avg_txs,
    rolling_7d_avg_unique_senders
  FROM rolled
  WHERE day = current_date
),
aggregate_latest AS (
  SELECT
    'All Core Contracts' AS contract_name,
    CAST(NULL AS varbinary) AS contract_address,
    SUM(txs_today) AS txs_today,
    SUM(unique_senders_today) AS unique_senders_today,
    SUM(trailing_7d_txs) AS trailing_7d_txs,
    SUM(rolling_7d_avg_txs) AS rolling_7d_avg_txs,
    SUM(rolling_7d_avg_unique_senders) AS rolling_7d_avg_unique_senders
  FROM latest_by_contract
)
SELECT *
FROM aggregate_latest
UNION ALL
SELECT *
FROM latest_by_contract
ORDER BY trailing_7d_txs DESC;
