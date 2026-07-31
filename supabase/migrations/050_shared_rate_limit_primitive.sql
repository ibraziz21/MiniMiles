-- Shared durable rate-limit primitive (production-readiness-security-spec.md
-- §3.5 / §9.2 / Phase 0). Generalizes the fixed-bucket approach already used
-- by web_push_subscription_rate_limit (047_web_push_notifications.sql) into
-- one table/function reusable by any endpoint: wallet-link challenges,
-- M-Pesa initiation, pass regeneration, quest proof/claim, claw, raffle,
-- grant, etc. Bucket-based (not sliding window) — cheap, index-friendly, and
-- good enough for abuse throttling at the limits this spec calls for.

CREATE TABLE IF NOT EXISTS rate_limit_buckets (
  scope        text NOT NULL,        -- caller-defined key, e.g. 'wallet_challenge:user:<uuid>' or 'mpesa_initiate:ip:<addr>'
  bucket_start timestamptz NOT NULL, -- start of the fixed window this count belongs to
  count        integer NOT NULL DEFAULT 0,
  PRIMARY KEY (scope, bucket_start)
);

CREATE INDEX IF NOT EXISTS rate_limit_buckets_bucket_start_idx
  ON rate_limit_buckets (bucket_start);

-- Checks and increments one counter for `p_scope` in the current window of
-- length `p_window_seconds`, returning true iff the count after this call is
-- still within `p_limit`. Windows are aligned to epoch time, not to first
-- use, so concurrent callers agree on bucket boundaries without coordination.
CREATE OR REPLACE FUNCTION check_rate_limit(
  p_scope          text,
  p_limit          integer,
  p_window_seconds integer
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_bucket timestamptz;
  v_count  integer;
BEGIN
  IF p_window_seconds <= 0 THEN
    RAISE EXCEPTION 'p_window_seconds must be positive';
  END IF;

  v_bucket := to_timestamp(floor(extract(epoch FROM now()) / p_window_seconds) * p_window_seconds);

  -- Opportunistic cleanup of old buckets; bounded so this never runs away.
  DELETE FROM rate_limit_buckets
  WHERE scope = p_scope AND bucket_start < now() - make_interval(secs => p_window_seconds * 2);

  INSERT INTO rate_limit_buckets (scope, bucket_start, count)
  VALUES (p_scope, v_bucket, 1)
  ON CONFLICT (scope, bucket_start) DO UPDATE SET count = rate_limit_buckets.count + 1
  RETURNING count INTO v_count;

  RETURN v_count <= p_limit;
END
$$;

REVOKE ALL ON FUNCTION check_rate_limit(text, integer, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION check_rate_limit(text, integer, integer) TO service_role;

ALTER TABLE rate_limit_buckets ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON rate_limit_buckets FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON rate_limit_buckets TO service_role;
