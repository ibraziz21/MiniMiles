-- Phase 3: weekly merchant-quest reward delivery.
--
-- Weekly completion is now written only by the mint worker after a successful
-- on-chain mint. These optional audit columns preserve the delivered amount
-- and transaction without breaking legacy rows that were created earlier.

alter table partner_quest_weekly_claims
  add column if not exists points_awarded integer,
  add column if not exists tx_hash text;

-- Claims created by the former queue path could exist even when minting later
-- failed. Remove only those premature rows; completed jobs remain authoritative.
delete from partner_quest_weekly_claims as claim
using minipoint_mint_jobs as job
where job.idempotency_key =
    'partner-weekly:' ||
    claim.partner_quest_id::text ||
    ':' ||
    lower(claim.user_address) ||
    ':' ||
    claim.iso_week
  and job.status in ('pending', 'processing', 'failed');

-- Pending legacy weekly jobs used the once-ever partner_engagement payload.
-- Upgrade them in place so a retried job records week-scoped completion.
update minipoint_mint_jobs
set payload =
  jsonb_set(
    jsonb_set(
      payload,
      '{kind}',
      to_jsonb('partner_weekly_engagement'::text),
      true
    ),
    '{isoWeek}',
    to_jsonb(substring(idempotency_key from '([0-9]{4}-W[0-9]{2})$')),
    true
  )
where idempotency_key like 'partner-weekly:%'
  and status in ('pending', 'processing', 'failed')
  and payload->>'kind' = 'partner_engagement'
  and idempotency_key ~ '[0-9]{4}-W[0-9]{2}$';

-- Merchant quest state is now read only through the authenticated status API.
drop policy if exists "partner_quest_weekly_claims_public_read"
  on partner_quest_weekly_claims;
