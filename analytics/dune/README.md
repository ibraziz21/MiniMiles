# AkibaMiles Dune Dashboard

These DuneSQL queries track Celo transactions sent directly to the core Akiba contracts: AkibaMiles V2, raffle, and dice.

Primary contracts included:

| Contract | Address |
| --- | --- |
| AkibaMiles V2 | `0xab93400000751fc17918940c202a66066885d628` |
| Raffle V6 | `0xd75dfa972c6136f1c594fec1945302f885e1ab29` |
| Dice | `0xf77e7395aa5c89bcc8d6e23f67a9c7914ab9702a` |

## Queries

1. `akiba_contracts_7d_rolling_txs.sql`
   - Daily transactions per contract.
   - Successful and failed tx counts.
   - Unique senders.
   - Trailing 7-day tx count.
   - 7-day rolling average txs.

2. `akiba_contracts_7d_kpis.sql`
   - Latest KPI table for today.
   - Best for a dashboard summary panel.

3. `akiba_contracts_weekly_txs.sql`
   - Weekly tx totals and unique senders.
   - Best for a weekly bar chart.

4. `akiba_core_aggregate_7d_rolling_txs.sql`
   - Top-line aggregate daily txs across AkibaMiles V2 + Raffle V6 + Dice.
   - Best for the main 7-day rolling average chart.

5. `akiba_core_aggregate_weekly_avg_txs.sql`
   - Top-line aggregate weekly totals and average daily txs by week.
   - Best for the main weekly activity panel.

## Dashboard Setup In Dune

Create a dashboard named:

```text
AkibaMiles Contract Activity
```

Recommended panels:

1. **Core 7D Rolling Average TXs**
   - Query: `akiba_core_aggregate_7d_rolling_txs.sql`
   - Visualization: line chart
   - X-axis: `day`
   - Y-axis: `rolling_7d_avg_txs`

2. **Core Weekly Average TXs**
   - Query: `akiba_core_aggregate_weekly_avg_txs.sql`
   - Visualization: bar or line chart
   - X-axis: `week`
   - Y-axis: `avg_daily_txs`
   - Secondary metric: `weekly_txs`

3. **Contract-Level 7D Rolling Average TXs**
   - Query: `akiba_contracts_7d_rolling_txs.sql`
   - Visualization: line chart
   - X-axis: `day`
   - Y-axis: `rolling_7d_avg_txs`
   - Series: `contract_name`

4. **Contract-Level Daily Transactions**
   - Query: `akiba_contracts_7d_rolling_txs.sql`
   - Visualization: stacked bar chart
   - X-axis: `day`
   - Y-axis: `daily_txs`
   - Series: `contract_name`

5. **Latest 7D KPIs**
   - Query: `akiba_contracts_7d_kpis.sql`
   - Visualization: table
   - Columns: `contract_name`, `txs_today`, `trailing_7d_txs`, `rolling_7d_avg_txs`, `rolling_7d_avg_unique_senders`

6. **Contract-Level Weekly TXs**
   - Query: `akiba_contracts_weekly_txs.sql`
   - Visualization: bar chart
   - X-axis: `week`
   - Y-axis: `weekly_txs`
   - Series: `contract_name`

## Notes

- These queries use `celo.transactions`, Dune's raw Celo transaction table.
- They count direct transactions where `tx.to` is one of the tracked contracts.
- If you want internal contract calls as well, add a separate `celo.traces` query. Direct user/product activity is usually cleaner from `celo.transactions`.
- If contract addresses change, update the `contracts` CTE at the top of each SQL file.
