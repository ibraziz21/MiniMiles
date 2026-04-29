-- AkibaMiles contracts: weekly transaction totals
-- Chain: Celo
-- DuneSQL
--
-- Dashboard chart suggestion:
--   Bar chart with week on X-axis, weekly_txs on Y-axis, contract_name as series.

WITH contracts(contract_name, contract_address) AS (
  VALUES
    ('AkibaMiles V2', 0xab93400000751fc17918940c202a66066885d628),
    ('Raffle V6',     0xd75dfa972c6136f1c594fec1945302f885e1ab29),
    ('Dice',          0xf77e7395aa5c89bcc8d6e23f67a9c7914ab9702a)
)
SELECT
  CAST(date_trunc('week', tx.block_time) AS date) AS week,
  c.contract_name,
  c.contract_address,
  COUNT(*) AS weekly_txs,
  COUNT(DISTINCT tx."from") AS weekly_unique_senders,
  SUM(CASE WHEN tx.success THEN 1 ELSE 0 END) AS successful_txs,
  SUM(CASE WHEN NOT tx.success THEN 1 ELSE 0 END) AS failed_txs
FROM celo.transactions tx
INNER JOIN contracts c
  ON tx."to" = c.contract_address
WHERE tx.block_time >= current_date - INTERVAL '180' day
GROUP BY 1, 2, 3
ORDER BY week DESC, weekly_txs DESC;
