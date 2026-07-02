-- Farkle live schema hotfix.
--
-- Some live databases have public.game_credit_ledger.reference_id as uuid from
-- an older schema. Farkle ledger rows use this column as a generic reference
-- identifier, and the matchmaking RPC writes p_match_id::text. Normalize the
-- column to text so entry debits, refunds, purchase recovery, and future
-- non-match references all share the same shape.

do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'game_credit_ledger'
      and column_name = 'reference_id'
      and data_type <> 'text'
  ) then
    alter table public.game_credit_ledger
      alter column reference_id type text using reference_id::text;
  end if;
end;
$$;
