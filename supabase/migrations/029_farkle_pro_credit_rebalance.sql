-- Farkle Pro Reward Duel credit rebalance.
--
-- Product change:
--   - Pro Duel entry drops from 10 credits to 5 credits.
--   - Winner reward credit drops from $1.85 to $0.85.
--
-- The matchmaking RPC reads entry_amount from game_modes, so this single mode
-- update controls balance checks, debits, ledger rows, no-show refunds, and
-- settlement reward-credit dispatch.

update public.game_modes
set entry_amount = 5,
    winner_reward_credit = 85,
    active = true
where mode_key = 'FARKLE_PRO_5000_USDT';
