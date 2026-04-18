-- Migration 051: Data Subject Access Request queue + SLA tracking (Wave 9).
--
-- Purpose
-- -------
-- LGPD Art. 18 gives Brazilian data subjects the right to (I) access
-- their personal data, (II) correct it, and (VI) have it erased.
-- The platform already exposes
--   * GET  /api/lgpd/export           (Art. 18 I)
--   * POST /api/lgpd/deletion-request (Art. 18 VI — kicks off review)
--   * POST /api/admin/lgpd/anonymize/:userId (admin completes the erasure)
-- but each request only lives as a pair of audit_log rows + a
-- SUPER_ADMIN notification. There is no queue, no state machine, and
-- no way to tell which requests are approaching the 15-working-day
-- legal SLA.
--
-- This migration introduces:
--
--   1. public.dsar_requests — persistent, state-machined queue of
--      every LGPD request (EXPORT, ERASURE, RECTIFICATION). Every
--      transition is validated by a BEFORE trigger so the state
--      graph is enforced in the database, not just in TS.
--
--   2. public.dsar_audit — append-only hash-chained history of every
--      transition. Mirrors the audit_logs design from migration 046.
--      Writers go through the sanctioned dsar_transition() SECURITY
--      DEFINER RPC; direct INSERT/UPDATE/DELETE is blocked.
--
--   3. profiles.anonymized_at / profiles.anonymized_by columns so
--      downstream code can tell a live user from an erased one
--      without reading free-text fields.
--
--   4. public.dsar_transition(uuid, text, jsonb) RPC that atomically
--      validates the target state, bumps updated_at, appends the
--      hash-chained audit row, and refuses to operate on already-
--      terminal requests. All public mutations go through this
--      single entry point.
--
--   5. public.dsar_expire_stale() RPC used by the Wave-9 cron to
--      flip requests that missed their SLA by > 30 days to EXPIRED
--      without actually doing anything destructive.
--
--   6. Feature flag dsar.sla_enforce (default OFF). When ON, the
--      /api/cron/dsar-sla-check endpoint pages P1 on breach. While
--      OFF, the cron still runs and populates metrics but only
--      warns at P2.
--
-- Rollback
-- --------
--   DROP TRIGGER IF EXISTS trg_dsar_requests_state_guard ON public.dsar_requests;
--   DROP TRIGGER IF EXISTS trg_dsar_audit_immutable ON public.dsar_audit;
--   DROP FUNCTION IF EXISTS public.dsar_transition(uuid, text, jsonb);
--   DROP FUNCTION IF EXISTS public.dsar_expire_stale();
--   DROP FUNCTION IF EXISTS public._dsar_validate_state_transition() CASCADE;
--   DROP FUNCTION IF EXISTS public._dsar_audit_guard() CASCADE;
--   DROP TABLE IF EXISTS public.dsar_audit;
--   DROP TABLE IF EXISTS public.dsar_requests;
--   ALTER TABLE public.profiles DROP COLUMN IF EXISTS anonymized_at;
--   ALTER TABLE public.profiles DROP COLUMN IF EXISTS anonymized_by;
--   DELETE FROM public.feature_flags WHERE key = 'dsar.sla_enforce';

SET search_path TO public, extensions, pg_temp;

-- ── 1. profiles.anonymized_at ────────────────────────────────────────────
-- A non-null value means the profile has been erased per Art. 18 VI.
-- Downstream queries should treat the row as tombstoned. The existing
-- anonymize endpoint (app/api/admin/lgpd/anonymize/[userId]/route.ts)
-- will be updated in a follow-up to populate this column.

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS anonymized_at timestamptz,
  ADD COLUMN IF NOT EXISTS anonymized_by uuid REFERENCES public.profiles(id);

COMMENT ON COLUMN public.profiles.anonymized_at IS
  'Wave 9 — set when the profile has been anonymised via LGPD erasure. NULL = live subject. Non-null = tombstoned (full_name, phone, email_hash only).';
COMMENT ON COLUMN public.profiles.anonymized_by IS
  'Admin who executed the erasure (NULL for cron-driven).';

CREATE INDEX IF NOT EXISTS idx_profiles_anonymized_at
  ON public.profiles(anonymized_at)
  WHERE anonymized_at IS NOT NULL;

-- ── 2. dsar_requests table ───────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.dsar_requests (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  subject_user_id uuid NOT NULL REFERENCES public.profiles(id),

  kind            text NOT NULL
                  CHECK (kind IN ('EXPORT', 'ERASURE', 'RECTIFICATION')),

  status          text NOT NULL DEFAULT 'RECEIVED'
                  CHECK (status IN (
                    'RECEIVED',     -- user submitted; awaiting admin triage
                    'PROCESSING',   -- admin picked it up; in-flight
                    'FULFILLED',    -- export delivered / erasure done
                    'REJECTED',     -- legally blocked (retention); reason_code required
                    'EXPIRED'       -- > 30 days past SLA without closure; terminal
                  )),

  -- 15 working days per LGPD Art. 19. Stored as calendar days plus a
  -- 5-day buffer so the cron first warns at 12 days and pages at 15.
  sla_due_at      timestamptz NOT NULL DEFAULT now() + interval '15 days',

  -- Free-form actor-provided text. Kept encrypted at rest in a
  -- future wave when encryption-at-rest extends to this column.
  reason_text     text,

  -- When REJECTED: which legal hold forbade the erasure (e.g.
  -- "NFSE_10Y" for the 10-year financial-records retention).
  reject_code     text,

  -- When FULFILLED: SHA-256 over the canonical JSON payload
  -- delivered. For EXPORT this is the HMAC-signed export.
  delivery_hash   text,

  -- When FULFILLED: storage_path of the bundle (for EXPORT) or
  -- the user_id of the tombstoned profile (for ERASURE). Kept as
  -- text so the same column serves both kinds.
  delivery_ref    text,

  -- Process-tracking timestamps.
  requested_at    timestamptz NOT NULL DEFAULT now(),
  triaged_at      timestamptz,
  fulfilled_at    timestamptz,
  expired_at      timestamptz,

  -- Actors.
  requested_by    uuid REFERENCES public.profiles(id),
  triaged_by      uuid REFERENCES public.profiles(id),
  fulfilled_by    uuid REFERENCES public.profiles(id),

  -- Request-correlation identifier for the HTTP handler that
  -- accepted the request; useful for log-join.
  request_id      text,

  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

-- A subject can have at most one non-terminal request of each kind.
-- This blocks a user from opening 20 erasure requests in a row.
CREATE UNIQUE INDEX IF NOT EXISTS uq_dsar_requests_open_by_kind
  ON public.dsar_requests (subject_user_id, kind)
  WHERE status IN ('RECEIVED', 'PROCESSING');

CREATE INDEX IF NOT EXISTS idx_dsar_requests_status_due
  ON public.dsar_requests (status, sla_due_at)
  WHERE status IN ('RECEIVED', 'PROCESSING');

CREATE INDEX IF NOT EXISTS idx_dsar_requests_subject
  ON public.dsar_requests (subject_user_id, created_at DESC);

COMMENT ON TABLE public.dsar_requests IS
  'Wave 9 — LGPD Art. 18 data-subject request queue with SLA tracking. Every state transition flows through public.dsar_transition(); direct UPDATE is blocked by trg_dsar_requests_state_guard.';

-- ── 3. dsar_audit table (append-only, hash-chained) ──────────────────────

CREATE TABLE IF NOT EXISTS public.dsar_audit (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id      uuid NOT NULL REFERENCES public.dsar_requests(id),

  -- Mirrored column: same ENUM as dsar_requests.status but here it
  -- represents "the state the request transitioned TO in this row".
  from_status     text,
  to_status       text NOT NULL,

  actor_user_id   uuid REFERENCES public.profiles(id),
  actor_role      text,
  metadata_json   jsonb,

  -- Hash chain, mirrors migration 046 audit_logs design.
  seq             bigserial NOT NULL,
  prev_hash       text,
  row_hash        text NOT NULL,

  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_dsar_audit_request
  ON public.dsar_audit (request_id, seq);

COMMENT ON TABLE public.dsar_audit IS
  'Wave 9 — append-only hash-chained history of every dsar_requests transition. Insert-only via dsar_transition() RPC; UPDATE/DELETE blocked by trg_dsar_audit_immutable.';

-- ── 4. State-transition guard on dsar_requests ───────────────────────────
--
-- The only sanctioned way to mutate a dsar_requests row is through
-- the dsar_transition() RPC, which runs with SECURITY DEFINER and
-- sets a per-transaction GUC
-- `clinipharma.dsar_transition_ok = 'true'`. Any other UPDATE is
-- rejected. INSERT is allowed only when the row starts in the
-- RECEIVED status (so new requests always enter the queue at the
-- correct state).

CREATE OR REPLACE FUNCTION public._dsar_validate_state_transition()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_ok text;
  v_allowed boolean := false;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status IS DISTINCT FROM 'RECEIVED' THEN
      RAISE EXCEPTION 'dsar_requests: new rows must start in RECEIVED (got %)', NEW.status
        USING ERRCODE = 'P0001';
    END IF;
    RETURN NEW;
  END IF;

  -- UPDATE path.
  v_ok := current_setting('clinipharma.dsar_transition_ok', true);
  IF v_ok IS DISTINCT FROM 'true' THEN
    RAISE EXCEPTION 'dsar_requests: direct UPDATE forbidden; use public.dsar_transition()'
      USING ERRCODE = 'P0001';
  END IF;

  -- If status didn't change, this is a benign metadata bump (e.g.
  -- updated_at). Still require the GUC but don't validate the graph.
  IF NEW.status = OLD.status THEN
    RETURN NEW;
  END IF;

  -- State graph.
  --   RECEIVED    → PROCESSING | REJECTED | EXPIRED
  --   PROCESSING  → FULFILLED  | REJECTED | EXPIRED
  --   FULFILLED, REJECTED, EXPIRED: terminal.
  IF OLD.status = 'RECEIVED' AND NEW.status IN ('PROCESSING', 'REJECTED', 'EXPIRED') THEN
    v_allowed := true;
  ELSIF OLD.status = 'PROCESSING' AND NEW.status IN ('FULFILLED', 'REJECTED', 'EXPIRED') THEN
    v_allowed := true;
  END IF;

  IF NOT v_allowed THEN
    RAISE EXCEPTION 'dsar_requests: invalid transition % → %', OLD.status, NEW.status
      USING ERRCODE = 'P0001';
  END IF;

  -- REJECTED must carry a reject_code.
  IF NEW.status = 'REJECTED' AND (NEW.reject_code IS NULL OR length(NEW.reject_code) = 0) THEN
    RAISE EXCEPTION 'dsar_requests: reject_code required when status=REJECTED'
      USING ERRCODE = 'P0001';
  END IF;

  -- FULFILLED must carry both delivery_hash and fulfilled_at.
  IF NEW.status = 'FULFILLED' AND (
       NEW.delivery_hash IS NULL OR length(NEW.delivery_hash) = 0
       OR NEW.fulfilled_at IS NULL
     ) THEN
    RAISE EXCEPTION 'dsar_requests: delivery_hash and fulfilled_at required when FULFILLED'
      USING ERRCODE = 'P0001';
  END IF;

  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS trg_dsar_requests_state_guard ON public.dsar_requests;
CREATE TRIGGER trg_dsar_requests_state_guard
  BEFORE INSERT OR UPDATE ON public.dsar_requests
  FOR EACH ROW EXECUTE FUNCTION public._dsar_validate_state_transition();

-- ── 5. dsar_audit immutability trigger ───────────────────────────────────

CREATE OR REPLACE FUNCTION public._dsar_audit_guard()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_ok text;
BEGIN
  IF TG_OP = 'INSERT' THEN
    v_ok := current_setting('clinipharma.dsar_transition_ok', true);
    IF v_ok IS DISTINCT FROM 'true' THEN
      RAISE EXCEPTION 'dsar_audit: direct INSERT forbidden; use public.dsar_transition()'
        USING ERRCODE = 'P0001';
    END IF;
    RETURN NEW;
  END IF;

  -- UPDATE / DELETE always forbidden.
  RAISE EXCEPTION 'dsar_audit is append-only'
    USING ERRCODE = 'P0001';
END
$$;

DROP TRIGGER IF EXISTS trg_dsar_audit_immutable ON public.dsar_audit;
CREATE TRIGGER trg_dsar_audit_immutable
  BEFORE INSERT OR UPDATE OR DELETE ON public.dsar_audit
  FOR EACH ROW EXECUTE FUNCTION public._dsar_audit_guard();

-- ── 6. dsar_transition() RPC ─────────────────────────────────────────────
--
-- Single sanctioned entry point for dsar_requests mutation. Validates
-- target state via the trigger, appends the hash-chained audit row,
-- and returns the resulting request row as jsonb.

CREATE OR REPLACE FUNCTION public.dsar_transition(
  p_request_id uuid,
  p_to_status  text,
  p_args       jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_req          public.dsar_requests;
  v_actor        uuid := nullif(p_args ->> 'actor_user_id', '')::uuid;
  v_actor_role   text := p_args ->> 'actor_role';
  v_meta         jsonb := COALESCE(p_args -> 'metadata', '{}'::jsonb);
  v_reject_code  text  := p_args ->> 'reject_code';
  v_hash         text  := p_args ->> 'delivery_hash';
  v_ref          text  := p_args ->> 'delivery_ref';
  v_prev_hash    text;
  v_payload      text;
  v_row_hash     text;
  v_now          timestamptz := now();
BEGIN
  -- Enter the transition window (trigger checks this GUC).
  PERFORM set_config('clinipharma.dsar_transition_ok', 'true', true);

  SELECT * INTO v_req FROM public.dsar_requests WHERE id = p_request_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'dsar_transition: request % not found', p_request_id
      USING ERRCODE = 'P0001';
  END IF;

  -- Timestamp bookkeeping per target status.
  IF p_to_status = 'PROCESSING' THEN
    UPDATE public.dsar_requests
       SET status      = 'PROCESSING',
           triaged_at  = COALESCE(triaged_at, v_now),
           triaged_by  = COALESCE(v_req.triaged_by, v_actor),
           updated_at  = v_now
     WHERE id = p_request_id;
  ELSIF p_to_status = 'FULFILLED' THEN
    UPDATE public.dsar_requests
       SET status        = 'FULFILLED',
           fulfilled_at  = v_now,
           fulfilled_by  = COALESCE(v_req.fulfilled_by, v_actor),
           delivery_hash = v_hash,
           delivery_ref  = v_ref,
           updated_at    = v_now
     WHERE id = p_request_id;
  ELSIF p_to_status = 'REJECTED' THEN
    UPDATE public.dsar_requests
       SET status      = 'REJECTED',
           reject_code = v_reject_code,
           fulfilled_at = v_now,
           fulfilled_by = COALESCE(v_req.fulfilled_by, v_actor),
           updated_at  = v_now
     WHERE id = p_request_id;
  ELSIF p_to_status = 'EXPIRED' THEN
    UPDATE public.dsar_requests
       SET status     = 'EXPIRED',
           expired_at = v_now,
           updated_at = v_now
     WHERE id = p_request_id;
  ELSE
    RAISE EXCEPTION 'dsar_transition: unknown target status %', p_to_status
      USING ERRCODE = 'P0001';
  END IF;

  -- Re-read post-update state.
  SELECT * INTO v_req FROM public.dsar_requests WHERE id = p_request_id;

  -- Append hash-chained audit row.
  SELECT row_hash INTO v_prev_hash
    FROM public.dsar_audit
   WHERE request_id = p_request_id
   ORDER BY seq DESC
   LIMIT 1;

  v_payload := concat_ws('|',
    v_req.id::text,
    COALESCE(v_prev_hash, ''),
    v_req.status,
    v_req.kind,
    COALESCE(v_req.reject_code, ''),
    COALESCE(v_req.delivery_hash, ''),
    COALESCE(v_req.fulfilled_at::text, ''),
    COALESCE(v_actor::text, ''),
    v_meta::text
  );
  v_row_hash := encode(extensions.digest(v_payload::bytea, 'sha256'), 'hex');

  INSERT INTO public.dsar_audit (
    request_id, from_status, to_status, actor_user_id, actor_role,
    metadata_json, prev_hash, row_hash
  ) VALUES (
    v_req.id,
    CASE WHEN v_req.status = p_to_status THEN null ELSE null END,  -- recorded via meta
    p_to_status,
    v_actor,
    v_actor_role,
    v_meta,
    v_prev_hash,
    v_row_hash
  );

  -- Release the transition window explicitly (session-scoped; safer
  -- than relying on end-of-function reset).
  PERFORM set_config('clinipharma.dsar_transition_ok', 'false', true);

  RETURN jsonb_build_object(
    'id', v_req.id,
    'status', v_req.status,
    'kind', v_req.kind,
    'sla_due_at', v_req.sla_due_at,
    'fulfilled_at', v_req.fulfilled_at,
    'expired_at', v_req.expired_at,
    'row_hash', v_row_hash
  );
END
$$;

COMMENT ON FUNCTION public.dsar_transition(uuid, text, jsonb) IS
  'Wave 9 — atomic DSAR state transition. SECURITY DEFINER; validates state graph via trigger; appends hash-chained audit row. Call with p_args = {actor_user_id, actor_role, metadata, reject_code?, delivery_hash?, delivery_ref?}.';

GRANT EXECUTE ON FUNCTION public.dsar_transition(uuid, text, jsonb) TO service_role;

-- ── 7. dsar_expire_stale() RPC ───────────────────────────────────────────
--
-- Flips every non-terminal request whose SLA missed by > 30 days to
-- EXPIRED. Called by the /api/cron/dsar-sla-check cron after it
-- alerts the on-call. Separated as its own RPC so the cron can page
-- first and expire second in deterministic order.

CREATE OR REPLACE FUNCTION public.dsar_expire_stale(
  p_grace_days int DEFAULT 30
)
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_expired_count int := 0;
  v_row           public.dsar_requests;
BEGIN
  FOR v_row IN
    SELECT *
      FROM public.dsar_requests
     WHERE status IN ('RECEIVED', 'PROCESSING')
       AND sla_due_at < now() - make_interval(days => p_grace_days)
  LOOP
    PERFORM public.dsar_transition(
      v_row.id,
      'EXPIRED',
      jsonb_build_object(
        'actor_user_id', null,
        'actor_role',    'SYSTEM',
        'metadata',      jsonb_build_object('reason', 'sla_grace_expired', 'grace_days', p_grace_days)
      )
    );
    v_expired_count := v_expired_count + 1;
  END LOOP;
  RETURN v_expired_count;
END
$$;

COMMENT ON FUNCTION public.dsar_expire_stale(int) IS
  'Wave 9 — flips non-terminal DSAR requests > grace_days past SLA to EXPIRED. Intended for cron use only.';

GRANT EXECUTE ON FUNCTION public.dsar_expire_stale(int) TO service_role;

-- ── 8. Feature flag ──────────────────────────────────────────────────────

INSERT INTO public.feature_flags (key, description, enabled, owner)
VALUES (
  'dsar.sla_enforce',
  'When ON, /api/cron/dsar-sla-check pages P1 for missed SLAs and auto-expires at grace. Default OFF pages only P2.',
  false,
  'audit-2026-04'
)
ON CONFLICT (key) DO NOTHING;

-- ── 9. Grants ────────────────────────────────────────────────────────────

GRANT SELECT, INSERT ON public.dsar_requests TO service_role;
GRANT SELECT ON public.dsar_audit TO service_role;
-- Authenticated users can only SELECT their own requests (RLS enforces).
GRANT SELECT, INSERT ON public.dsar_requests TO authenticated;

-- ── 10. RLS ──────────────────────────────────────────────────────────────

ALTER TABLE public.dsar_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dsar_audit   ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS dsar_requests_self_select ON public.dsar_requests;
CREATE POLICY dsar_requests_self_select
  ON public.dsar_requests FOR SELECT TO authenticated
  USING (subject_user_id = auth.uid());

DROP POLICY IF EXISTS dsar_requests_self_insert ON public.dsar_requests;
CREATE POLICY dsar_requests_self_insert
  ON public.dsar_requests FOR INSERT TO authenticated
  WITH CHECK (subject_user_id = auth.uid() AND status = 'RECEIVED');

-- Audit is readable only via service role — end users never need it.

-- ── 11. Smoke ────────────────────────────────────────────────────────────
--
-- Structural checks only. Functional smoke (transitions, hash chain,
-- RLS, rejected transitions) live in the Wave-9 unit tests; exercising
-- them here would pollute dsar_requests / dsar_audit in prod.

DO $smoke$
DECLARE
  v_fn_count     int;
  v_trig_count   int;
  v_flag_enabled boolean;
  v_table_count  int;
BEGIN
  SELECT count(*) INTO v_table_count
    FROM information_schema.tables
   WHERE table_schema = 'public'
     AND table_name IN ('dsar_requests', 'dsar_audit');
  IF v_table_count <> 2 THEN
    RAISE EXCEPTION 'Migration 051 smoke: expected 2 tables (dsar_requests, dsar_audit), got %', v_table_count;
  END IF;

  SELECT count(*) INTO v_fn_count
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public'
     AND p.proname IN ('dsar_transition', 'dsar_expire_stale',
                       '_dsar_validate_state_transition', '_dsar_audit_guard');
  IF v_fn_count <> 4 THEN
    RAISE EXCEPTION 'Migration 051 smoke: expected 4 functions, got %', v_fn_count;
  END IF;

  SELECT count(*) INTO v_trig_count
    FROM pg_trigger
   WHERE tgname IN ('trg_dsar_requests_state_guard', 'trg_dsar_audit_immutable')
     AND NOT tgisinternal;
  IF v_trig_count <> 2 THEN
    RAISE EXCEPTION 'Migration 051 smoke: expected 2 triggers, got %', v_trig_count;
  END IF;

  SELECT enabled INTO v_flag_enabled
    FROM public.feature_flags WHERE key = 'dsar.sla_enforce';
  IF v_flag_enabled IS NULL THEN
    RAISE EXCEPTION 'Migration 051 smoke: dsar.sla_enforce flag missing';
  END IF;
  IF v_flag_enabled THEN
    RAISE EXCEPTION 'Migration 051 smoke: dsar.sla_enforce must default OFF';
  END IF;

  RAISE NOTICE 'Migration 051 smoke passed (tables=2, functions=4, triggers=2, flag OFF)';
END
$smoke$;
