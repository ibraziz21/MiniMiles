-- 077_voucher_claim_intents.sql
-- Auditable member confirmation before acquiring any voucher. The activity
-- counters are snapshots so product can measure whether the added friction
-- improves redemption without reconstructing historical state later.

CREATE TABLE IF NOT EXISTS public.voucher_claim_intents (
  id                            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  hub_user_id                   uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  voucher_id                    uuid        NOT NULL REFERENCES public.issued_vouchers(id) ON DELETE CASCADE,
  flow                          text        NOT NULL CHECK (flow IN ('miles_purchase', 'funded_claim')),
  voucher_template_id           uuid        REFERENCES public.spend_voucher_templates(id),
  funding_allocation_id         uuid,
  use_plan                      text        CHECK (use_plan IN ('nearby', 'planned_visit', 'upcoming_trip', 'other')),
  expired_unused_count_snapshot integer     NOT NULL DEFAULT 0 CHECK (expired_unused_count_snapshot >= 0),
  active_unused_count_snapshot  integer     NOT NULL DEFAULT 0 CHECK (active_unused_count_snapshot >= 0),
  redeemed_count_snapshot       integer     NOT NULL DEFAULT 0 CHECK (redeemed_count_snapshot >= 0),
  disclosure_version            text        NOT NULL,
  confirmed_at                  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT voucher_claim_intents_voucher_unique UNIQUE (voucher_id)
);

CREATE INDEX IF NOT EXISTS idx_voucher_claim_intents_user_confirmed
  ON public.voucher_claim_intents(hub_user_id, confirmed_at DESC);

CREATE INDEX IF NOT EXISTS idx_voucher_claim_intents_allocation
  ON public.voucher_claim_intents(funding_allocation_id)
  WHERE funding_allocation_id IS NOT NULL;

ALTER TABLE public.voucher_claim_intents ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.voucher_claim_intents FROM anon, authenticated;
GRANT ALL ON public.voucher_claim_intents TO service_role;

COMMENT ON TABLE public.voucher_claim_intents IS
  'Server-recorded voucher use-intent confirmations and claim-history friction snapshots.';
