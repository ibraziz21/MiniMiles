-- 102_push_job_immediate_dispatch.sql
-- Nudges the push worker the moment a job is enqueued, so a notification
-- does not wait for the next minute boundary of the Vercel cron.
--
-- Why a nudge and not an inline send: every worker in this system is
-- claim-and-sweep (process-reward-jobs, process-photo-jobs,
-- process-push-jobs and seven others), and no producer anywhere invokes a
-- sender directly. That decoupling is deliberate — it is what makes retry,
-- backoff and terminal-state protection live in exactly one place. This
-- migration does not change it. The job is still enqueued the same way,
-- still claimed by claim_web_push_jobs with FOR UPDATE SKIP LOCKED, and
-- still completed by complete_web_push_job. All that changes is *when* the
-- existing sweep starts.
--
-- The cron stays. pg_net is fire-and-forget: it queues the request and a
-- background worker sends it, so a failed POST is invisible to this
-- transaction and is never retried. The every-minute cron therefore remains
-- the guarantee of delivery, and this is only a latency optimisation.
-- Measured: ~38s of pure queue wait before, ~1-3s after (Expo plus FCM).
--
-- One pg_net property worth relying on: the request is not started until the
-- transaction commits. A rolled-back enqueue therefore sends no POST, so the
-- worker is never woken for a job that does not exist.
--
-- Racing the cron is safe by construction. claim_web_push_jobs skips locked
-- rows, so two concurrent runs cannot claim the same job, and
-- complete_web_push_job refuses to overwrite a terminal outcome.

-- pg_net is standard on Supabase but absent from a vanilla PostgreSQL, and
-- this file has to apply in both (the integration suite runs against a
-- disposable local database). A hard CREATE EXTENSION would abort the whole
-- migration there.
DO $$
BEGIN
  CREATE EXTENSION IF NOT EXISTS pg_net;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE
    'pg_net is unavailable; the immediate-dispatch trigger will no-op and the cron remains the only sweep';
END
$$;

-- ── Dispatch trigger ──────────────────────────────────────────────────────
--
-- SECURITY DEFINER because it reads Vault, which is not readable by the
-- roles that insert notifications. search_path is pinned so a caller cannot
-- shadow `vault` or `net` with their own schema.
--
-- The single most important property of this function: **it must never
-- raise**. An exception here would abort the INSERT into web_push_jobs,
-- which would abort the INSERT into notification_outbox that triggered it,
-- which would fail the caller's whole request. A missing notification is
-- far worse than a slow one, so every failure path degrades to a WARNING
-- and lets the cron do its job.
CREATE OR REPLACE FUNCTION fn_dispatch_push_jobs()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, vault, net, extensions
AS $$
DECLARE
  v_url    text;
  v_secret text;
BEGIN
  BEGIN
    -- Both values live in Vault rather than in this file: the secret
    -- because it is one, and the URL beside it so that a restored dump or a
    -- branch database cannot silently POST at production.
    SELECT decrypted_secret INTO v_url
      FROM vault.decrypted_secrets WHERE name = 'push_worker_url';
    SELECT decrypted_secret INTO v_secret
      FROM vault.decrypted_secrets WHERE name = 'push_worker_secret';

    -- Unconfigured is a normal state, not an error: it is exactly what a
    -- local or preview database looks like, and the cron still covers it.
    IF v_url IS NULL OR v_secret IS NULL THEN
      RETURN NULL;
    END IF;

    PERFORM net.http_post(
      url     := v_url,
      body    := '{}'::jsonb,
      params  := '{}'::jsonb,
      headers := jsonb_build_object(
        'Content-Type',     'application/json',
        'x-webhook-secret', v_secret
      ),
      -- pg_net currently ignores this; passed for the day it does not.
      -- The worker returns immediately anyway — it only needs to be woken.
      timeout_milliseconds := 5000
    );
  EXCEPTION WHEN OTHERS THEN
    -- Covers pg_net absent, Vault absent, permission denied, and anything
    -- else. Never propagate.
    RAISE WARNING 'push job dispatch failed (cron will still deliver): %', SQLERRM;
  END;

  RETURN NULL;
END
$$;

REVOKE ALL ON FUNCTION fn_dispatch_push_jobs() FROM PUBLIC, anon, authenticated;

-- FOR EACH STATEMENT, not FOR EACH ROW. enqueue_web_push_job() inserts one
-- row per notification, so in normal operation these are identical — but a
-- bulk insert or a backfill would otherwise fire one HTTP request per row.
-- One nudge is all the worker needs; it claims up to 25 jobs per run.
DROP TRIGGER IF EXISTS trg_web_push_jobs_dispatch ON web_push_jobs;
CREATE TRIGGER trg_web_push_jobs_dispatch
  AFTER INSERT ON web_push_jobs
  FOR EACH STATEMENT EXECUTE FUNCTION fn_dispatch_push_jobs();

NOTIFY pgrst, 'reload schema';

-- ── Enabling this on a deployment ─────────────────────────────────────────
--
-- The trigger is inert until both Vault secrets exist. To turn it on, run
-- against the target database (values from that environment, not this file):
--
--   SELECT vault.create_secret(
--     'https://pass.akibamiles.com/api/internal/process-push-jobs',
--     'push_worker_url');
--   SELECT vault.create_secret(
--     '<INTERNAL_WEBHOOK_SECRET for that deployment>',
--     'push_worker_secret');
--
-- To turn it off again without a migration, delete either secret:
--
--   DELETE FROM vault.secrets WHERE name = 'push_worker_url';
--
-- Delivery continues on the cron, one minute slower. To remove it entirely:
--
--   DROP TRIGGER trg_web_push_jobs_dispatch ON web_push_jobs;
--
-- Verifying a POST actually went out. pg_net's documented accessor takes the
-- request id that http_post returned:
--
--   SELECT * FROM net.http_collect_response(<request_id>);
--
-- That id is not kept here (the trigger discards it — there is nothing to do
-- with a failure it cannot retry), so in practice read the backing table:
--
--   SELECT id, status_code, created
--     FROM net._http_response ORDER BY created DESC LIMIT 5;
--
-- A 200 means the worker was woken. Whether a notification was delivered is
-- a separate question, answered by native_push_deliveries.
