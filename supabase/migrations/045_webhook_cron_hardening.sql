-- Migration 045: webhook_events + cron_runs + cron_locks — Wave 2.
--
-- Purpose:
--   1. `webhook_events` — idempotency log for every inbound webhook
--      (Asaas, Clicksign, Inngest, future). A composite UNIQUE on
--      (source, idempotency_key) guarantees at-most-once processing per
--      delivery attempt.
--   2. `cron_runs` — append-only audit of every cron invocation with
--      duration, status, error and optional structured result.
--   3. `cron_locks` + `cron_try_lock()` / `cron_release_lock()` RPCs —
--      single-flight guard so two overlapping cron executions can never
--      race on the same job name. Uses a TTL lease (auto-steals after
--      expires_at) so a crashed runner cannot deadlock future runs.
--
-- Consumers:
--   lib/webhooks/dedup.ts   — claimWebhookEvent / completeWebhookEvent
--   lib/cron/guarded.ts     — runCronGuarded(jobName, handler, { ttlSeconds })
--
-- Access model:
--   All three tables and both RPCs are write-only for the app; only
--   `service_role` (admin client) inserts. RLS denies every other role.
--   SUPER_ADMIN / PLATFORM_ADMIN get SELECT for the audit UI.
--
-- Rollback:
--   DROP FUNCTION public.cron_release_lock(text, text);
--   DROP FUNCTION public.cron_try_lock(text, text, int);
--   DROP TABLE   public.cron_locks;
--   DROP TABLE   public.cron_runs;
--   DROP TABLE   public.webhook_events;
--
-- Idempotency:
--   All CREATE statements use IF NOT EXISTS / OR REPLACE. Safe to re-run.

-- ═══════════════════════════════════════════════════════════════════════════
-- 1. webhook_events — at-most-once webhook dedup log
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.webhook_events (
  id               bigserial   PRIMARY KEY,
  source           text        NOT NULL,      -- 'asaas' | 'clicksign' | 'inngest' | ...
  event_type       text,                       -- Source-specific event name
  idempotency_key  text        NOT NULL,       -- Deterministic composite (see lib/webhooks/dedup.ts)
  payload_hash     bytea,                      -- SHA-256 of the raw body for forensics
  received_at      timestamptz NOT NULL DEFAULT now(),
  processed_at     timestamptz,
  status           text        NOT NULL DEFAULT 'received'
                               CHECK (status IN ('received','processed','failed','duplicate')),
  http_status      int,                        -- Response status returned to caller
  attempts         int         NOT NULL DEFAULT 1,
  error            text,
  request_id       text,                       -- Correlates with logger.requestId (Wave 1)
  UNIQUE (source, idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_webhook_events_received_at
  ON public.webhook_events (received_at DESC);

CREATE INDEX IF NOT EXISTS idx_webhook_events_source_status
  ON public.webhook_events (source, status, received_at DESC);

COMMENT ON TABLE  public.webhook_events IS
  'Idempotency log for inbound webhooks. UNIQUE(source, idempotency_key) guarantees at-most-once processing. Wave 2.';
COMMENT ON COLUMN public.webhook_events.idempotency_key IS
  'Source-specific deterministic key. Asaas: <payment.id>:<event>. Clicksign: <document.key>:<event.name>:<event.occurred_at>.';

ALTER TABLE public.webhook_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "admins_read_webhook_events" ON public.webhook_events;
CREATE POLICY "admins_read_webhook_events"
  ON public.webhook_events FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.user_roles ur
      WHERE ur.user_id = auth.uid()
        AND ur.role IN ('SUPER_ADMIN', 'PLATFORM_ADMIN')
    )
  );

-- service_role bypasses RLS — no policy needed for writes.

-- ═══════════════════════════════════════════════════════════════════════════
-- 2. cron_runs — append-only cron execution log
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.cron_runs (
  id           bigserial   PRIMARY KEY,
  job_name     text        NOT NULL,
  started_at   timestamptz NOT NULL DEFAULT now(),
  finished_at  timestamptz,
  duration_ms  int,
  status       text        NOT NULL DEFAULT 'running'
                           CHECK (status IN ('running','success','failed','skipped_locked')),
  error        text,
  request_id   text,                       -- Correlates with logger.requestId
  locked_by    text,                       -- Matches cron_locks.locked_by for the acquiring run
  result       jsonb                        -- Optional summary payload (row counts, ...)
);

CREATE INDEX IF NOT EXISTS idx_cron_runs_job_started
  ON public.cron_runs (job_name, started_at DESC);

CREATE INDEX IF NOT EXISTS idx_cron_runs_status_started
  ON public.cron_runs (status, started_at DESC)
  WHERE status IN ('failed','running');

COMMENT ON TABLE public.cron_runs IS
  'Append-only audit of cron invocations. Status `skipped_locked` means another run was in-flight. Wave 2.';

ALTER TABLE public.cron_runs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "admins_read_cron_runs" ON public.cron_runs;
CREATE POLICY "admins_read_cron_runs"
  ON public.cron_runs FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.user_roles ur
      WHERE ur.user_id = auth.uid()
        AND ur.role IN ('SUPER_ADMIN', 'PLATFORM_ADMIN')
    )
  );

-- ═══════════════════════════════════════════════════════════════════════════
-- 3. cron_locks + acquire / release RPCs — single-flight guard
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.cron_locks (
  job_name    text        PRIMARY KEY,
  run_id      bigint      REFERENCES public.cron_runs(id) ON DELETE SET NULL,
  locked_by   text        NOT NULL,
  locked_at   timestamptz NOT NULL DEFAULT now(),
  expires_at  timestamptz NOT NULL
);

COMMENT ON TABLE public.cron_locks IS
  'Single-flight TTL lease per cron job. A lock with expires_at < now() is considered abandoned and can be stolen by the next caller. Wave 2.';

ALTER TABLE public.cron_locks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "admins_read_cron_locks" ON public.cron_locks;
CREATE POLICY "admins_read_cron_locks"
  ON public.cron_locks FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.user_roles ur
      WHERE ur.user_id = auth.uid()
        AND ur.role IN ('SUPER_ADMIN', 'PLATFORM_ADMIN')
    )
  );

-- Acquire a lock for `p_job_name`. Returns true iff this caller now holds
-- the lock. Stealing an expired lock counts as acquisition. The whole
-- upsert is serialised by a transaction-scoped advisory lock on
-- hashtext(job_name) to avoid two callers both stealing an expired row.
CREATE OR REPLACE FUNCTION public.cron_try_lock(
  p_job_name    text,
  p_locked_by   text,
  p_ttl_seconds int DEFAULT 900
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ok boolean := false;
BEGIN
  IF p_job_name IS NULL OR length(p_job_name) = 0 THEN
    RAISE EXCEPTION 'cron_try_lock: p_job_name must be non-empty';
  END IF;
  IF p_locked_by IS NULL OR length(p_locked_by) = 0 THEN
    RAISE EXCEPTION 'cron_try_lock: p_locked_by must be non-empty';
  END IF;
  IF p_ttl_seconds IS NULL OR p_ttl_seconds <= 0 THEN
    RAISE EXCEPTION 'cron_try_lock: p_ttl_seconds must be positive';
  END IF;

  -- Serialise concurrent callers for THIS job name. Released on tx end.
  PERFORM pg_advisory_xact_lock(hashtext('cron_lock:' || p_job_name));

  INSERT INTO public.cron_locks (job_name, locked_by, expires_at)
  VALUES (p_job_name, p_locked_by, now() + make_interval(secs => p_ttl_seconds))
  ON CONFLICT (job_name) DO UPDATE
    SET locked_by  = EXCLUDED.locked_by,
        locked_at  = now(),
        expires_at = EXCLUDED.expires_at
    WHERE cron_locks.expires_at < now()
  RETURNING (cron_locks.locked_by = p_locked_by) INTO v_ok;

  RETURN COALESCE(v_ok, false);
END;
$$;

COMMENT ON FUNCTION public.cron_try_lock(text, text, int) IS
  'Attempts to acquire a named single-flight lock with TTL lease. Returns true iff acquired. Steals locks whose expires_at has passed. Wave 2.';

-- Release a lock only if it is still held by `p_locked_by`. Safe to call
-- blindly at the end of a job even when the lock already expired — that
-- just returns false.
CREATE OR REPLACE FUNCTION public.cron_release_lock(
  p_job_name  text,
  p_locked_by text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_deleted int;
BEGIN
  DELETE FROM public.cron_locks
  WHERE job_name = p_job_name AND locked_by = p_locked_by;
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN v_deleted > 0;
END;
$$;

COMMENT ON FUNCTION public.cron_release_lock(text, text) IS
  'Releases a cron_locks row iff the current caller still holds it. Wave 2.';

-- Extend TTL of a held lock (heartbeat for long-running jobs).
CREATE OR REPLACE FUNCTION public.cron_extend_lock(
  p_job_name    text,
  p_locked_by   text,
  p_ttl_seconds int DEFAULT 900
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_updated int;
BEGIN
  UPDATE public.cron_locks
     SET expires_at = now() + make_interval(secs => p_ttl_seconds)
   WHERE job_name = p_job_name AND locked_by = p_locked_by;
  GET DIAGNOSTICS v_updated = ROW_COUNT;
  RETURN v_updated > 0;
END;
$$;

COMMENT ON FUNCTION public.cron_extend_lock(text, text, int) IS
  'Extends expires_at for a cron_locks row owned by this caller (heartbeat). Wave 2.';

-- ═══════════════════════════════════════════════════════════════════════════
-- 4. Revoke default privileges — service_role is the only writer
-- ═══════════════════════════════════════════════════════════════════════════

REVOKE ALL ON public.webhook_events FROM anon, authenticated;
REVOKE ALL ON public.cron_runs      FROM anon, authenticated;
REVOKE ALL ON public.cron_locks     FROM anon, authenticated;

GRANT SELECT ON public.webhook_events TO authenticated;
GRANT SELECT ON public.cron_runs      TO authenticated;
GRANT SELECT ON public.cron_locks     TO authenticated;

-- Make the helper functions callable ONLY by service_role; client-side
-- RPC calls are rejected.
REVOKE ALL ON FUNCTION public.cron_try_lock(text, text, int)     FROM public;
REVOKE ALL ON FUNCTION public.cron_release_lock(text, text)       FROM public;
REVOKE ALL ON FUNCTION public.cron_extend_lock(text, text, int)  FROM public;
GRANT  EXECUTE ON FUNCTION public.cron_try_lock(text, text, int)     TO service_role;
GRANT  EXECUTE ON FUNCTION public.cron_release_lock(text, text)       TO service_role;
GRANT  EXECUTE ON FUNCTION public.cron_extend_lock(text, text, int)  TO service_role;
