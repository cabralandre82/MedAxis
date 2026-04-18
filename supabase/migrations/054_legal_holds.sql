-- Migration 054: legal holds — retention override for investigations (Wave 13).
--
-- Purpose
-- -------
-- When the platform receives a formal preservation order (ANPD
-- investigation, judicial subpoena, CDC regulator inquiry, internal
-- compliance probe), every retention job that would otherwise
-- purge / anonymise data touching the subject of the order must
-- immediately back off. Today the retention story is:
--
--   * Wave 3  audit_logs: append-only, BUT purged at 5y for non-
--             financial entities via audit_purge_retention.
--   * Wave 9  LGPD DSAR ERASURE: anonymises profile + wipes PII.
--   * Wave    enforce-retention: monthly, anonymises profiles
--             inactive > 5y, purges notifications, trims audit_logs.
--   * Various purge crons (server_logs, drafts, revoked_tokens).
--
-- None of them ask "is this subject under investigation?" before
-- deleting. A misfired DSAR or a monthly cron can destroy evidence
-- the regulator explicitly ordered preserved — which, per Lei
-- 13.709/2018 Art. 48 and Art. 52, turns into a sanção administrativa
-- grave (fine up to 2 % of revenue, capped at R$ 50 M/infraction).
--
-- This migration introduces:
--
--   1. public.legal_holds — one row per preservation order, scoped
--      to (subject_type, subject_id). Status machine is active →
--      released | expired. Append-only audit via trigger: only the
--      released_at / released_by / release_reason columns can ever
--      transition. Everything else is write-once.
--
--   2. public.legal_hold_is_active(subject_type, subject_id)
--      helper. SECURITY DEFINER, IMMUTABLE within a transaction;
--      called from purge paths via a thin plpgsql wrapper so the
--      retention jobs don't need direct SELECT privilege on the
--      hold table (RLS keeps hold reasons out of reach for
--      non-DPO roles).
--
--   3. public.legal_hold_apply(subject_type, subject_id,
--      reason_code, reason, expires_at, placed_by, document_refs)
--      SECURITY DEFINER RPC. Writes through validation: a subject
--      may have multiple concurrent holds (CRIMINAL + ANPD are
--      independent); each gets a distinct row. Protects against
--      duplicate open holds with the same (subject, reason_code,
--      document_refs) tuple via a partial unique index.
--
--   4. public.legal_hold_release(hold_id, release_reason,
--      released_by) SECURITY DEFINER RPC. Only transitions from
--      active → released; the audit history is kept forever.
--
--   5. public.legal_hold_expire_stale() — sweeps expires_at rows
--      past their deadline and flips them to 'expired'. Called by
--      the existing enforce-retention cron so we don't need a new
--      schedule slot.
--
--   6. Integration with retention paths:
--        - audit_purge_retention(): adds a legal-hold exclusion
--          on audit_logs.user_id / audit_logs.entity_id.
--        - The app-side retention policy reads
--          legal_hold_is_active() before mutating profiles/
--          notifications.
--        - DSAR transition to FULFILLED of an ERASURE is rejected
--          when any active hold exists for the subject.
--
-- Rollback
-- --------
--   DROP FUNCTION IF EXISTS public.legal_hold_expire_stale();
--   DROP FUNCTION IF EXISTS public.legal_hold_release(uuid, text, uuid);
--   DROP FUNCTION IF EXISTS public.legal_hold_apply(text, uuid, text, text, timestamptz, uuid, jsonb);
--   DROP FUNCTION IF EXISTS public.legal_hold_is_active(text, uuid);
--   DROP VIEW IF EXISTS public.legal_holds_active_view;
--   DROP TRIGGER IF EXISTS trg_legal_holds_immutable ON public.legal_holds;
--   DROP FUNCTION IF EXISTS public._legal_holds_guard();
--   DROP TABLE IF EXISTS public.legal_holds;
--   -- Revert audit_purge_retention by re-running migration 046's definition.

SET search_path TO public, extensions, pg_temp;

-- ─── holds table ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.legal_holds (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  subject_type      text NOT NULL
                      CHECK (subject_type IN ('user', 'order', 'document', 'pharmacy', 'payment')),
  subject_id        uuid NOT NULL,
  reason_code       text NOT NULL
                      CHECK (reason_code IN (
                        'ANPD_INVESTIGATION',   -- inquérito ANPD
                        'CDC_INVESTIGATION',    -- PROCON / DPDC
                        'JUDICIAL_SUBPOENA',    -- ofício judicial
                        'CRIMINAL_PROBE',       -- MPF / PF
                        'CIVIL_LITIGATION',     -- ação civil pública
                        'INTERNAL_AUDIT',       -- auditoria interna / SOX-like
                        'REGULATOR_REQUEST',    -- ANVISA / outro
                        'OTHER'
                      )),
  reason            text NOT NULL CHECK (length(reason) BETWEEN 10 AND 2000),
  document_refs     jsonb NOT NULL DEFAULT '[]'::jsonb,
  -- Optional absolute deadline. NULL = indefinite (typical for
  -- open judicial orders until formal revocation). Holds past
  -- expires_at are swept to status='expired' but their history is
  -- preserved.
  expires_at        timestamptz,
  placed_at         timestamptz NOT NULL DEFAULT now(),
  placed_by         uuid NOT NULL,
  status            text NOT NULL DEFAULT 'active'
                      CHECK (status IN ('active', 'released', 'expired')),
  released_at       timestamptz,
  released_by       uuid,
  release_reason    text,
  -- Snapshot of who issued the order, kept free-form because
  -- subpoena metadata varies wildly between jurisdictions.
  requestor         jsonb NOT NULL DEFAULT '{}'::jsonb,
  CONSTRAINT legal_holds_released_consistency CHECK (
    (status = 'active'   AND released_at IS NULL AND released_by IS NULL AND release_reason IS NULL) OR
    (status = 'released' AND released_at IS NOT NULL AND released_by IS NOT NULL) OR
    (status = 'expired'  AND released_at IS NOT NULL)
  )
);

COMMENT ON TABLE public.legal_holds IS
  'Wave 13 — formal preservation orders. Every retention path must join against this table and skip rows where legal_hold_is_active() returns true.';

-- Query hot paths. The partial index is the one retention jobs hit
-- every run, so keep it cheap and index-only when possible.
CREATE INDEX IF NOT EXISTS legal_holds_subject_idx
  ON public.legal_holds (subject_type, subject_id);
CREATE INDEX IF NOT EXISTS legal_holds_active_subject_idx
  ON public.legal_holds (subject_type, subject_id)
  WHERE status = 'active';
CREATE INDEX IF NOT EXISTS legal_holds_expires_at_idx
  ON public.legal_holds (expires_at)
  WHERE status = 'active' AND expires_at IS NOT NULL;

-- Prevent accidental duplicate active holds for the same subject
-- + reason_code. A second judicial order on the same subject
-- should either reuse the first row (documented in document_refs)
-- or use a different reason_code.
CREATE UNIQUE INDEX IF NOT EXISTS legal_holds_unique_active_idx
  ON public.legal_holds (subject_type, subject_id, reason_code)
  WHERE status = 'active';

-- ─── append-only trigger ────────────────────────────────────────────────
-- Only columns linked to the release transition are mutable; all
-- the others are write-once. DELETE is rejected outright.
CREATE OR REPLACE FUNCTION public._legal_holds_guard()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_allowed boolean := false;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'legal_holds: rows are append-only (id=%)', OLD.id
      USING ERRCODE = 'P0001';
  END IF;

  IF TG_OP = 'UPDATE' THEN
    -- Whitelist only the release/expire columns. Any mutation of
    -- subject / reason_code / reason / placed_by / placed_at is
    -- rejected — forge detection.
    IF NEW.id           IS DISTINCT FROM OLD.id           OR
       NEW.subject_type IS DISTINCT FROM OLD.subject_type OR
       NEW.subject_id   IS DISTINCT FROM OLD.subject_id   OR
       NEW.reason_code  IS DISTINCT FROM OLD.reason_code  OR
       NEW.reason       IS DISTINCT FROM OLD.reason       OR
       NEW.document_refs IS DISTINCT FROM OLD.document_refs OR
       NEW.placed_at    IS DISTINCT FROM OLD.placed_at    OR
       NEW.placed_by    IS DISTINCT FROM OLD.placed_by    OR
       NEW.requestor    IS DISTINCT FROM OLD.requestor    THEN
      RAISE EXCEPTION 'legal_holds: immutable column mutated (id=%)', OLD.id
        USING ERRCODE = 'P0001';
    END IF;

    -- Valid state transitions: active→released, active→expired.
    IF OLD.status = 'active' AND NEW.status IN ('released', 'expired') THEN
      v_allowed := true;
    ELSIF OLD.status = NEW.status THEN
      v_allowed := true;
    END IF;

    IF NOT v_allowed THEN
      RAISE EXCEPTION 'legal_holds: invalid transition % → % (id=%)',
        OLD.status, NEW.status, OLD.id
        USING ERRCODE = 'P0001';
    END IF;
  END IF;

  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS trg_legal_holds_immutable ON public.legal_holds;
CREATE TRIGGER trg_legal_holds_immutable
  BEFORE UPDATE OR DELETE ON public.legal_holds
  FOR EACH ROW EXECUTE FUNCTION public._legal_holds_guard();

-- ─── is_active helper ───────────────────────────────────────────────────
-- Stable (not IMMUTABLE: hold state changes with wall-clock time when
-- expires_at elapses, even without new writes). Heavy callers (the
-- retention crons) cache the result per (subject_type, subject_id)
-- within a single cron run; no materialised view needed at this
-- volume.
CREATE OR REPLACE FUNCTION public.legal_hold_is_active(
  p_subject_type text,
  p_subject_id   uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.legal_holds
     WHERE subject_type = p_subject_type
       AND subject_id   = p_subject_id
       AND status       = 'active'
       AND (expires_at IS NULL OR expires_at > now())
  );
$$;

REVOKE ALL ON FUNCTION public.legal_hold_is_active(text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.legal_hold_is_active(text, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.legal_hold_is_active(text, uuid) TO authenticated;

-- ─── apply RPC ──────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.legal_hold_apply(
  p_subject_type  text,
  p_subject_id    uuid,
  p_reason_code   text,
  p_reason        text,
  p_placed_by     uuid,
  p_expires_at    timestamptz DEFAULT NULL,
  p_document_refs jsonb       DEFAULT '[]'::jsonb,
  p_requestor     jsonb       DEFAULT '{}'::jsonb
)
RETURNS public.legal_holds
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_row public.legal_holds%ROWTYPE;
BEGIN
  IF p_placed_by IS NULL THEN
    RAISE EXCEPTION 'legal_hold_apply: placed_by is required'
      USING ERRCODE = 'P0001';
  END IF;
  IF p_expires_at IS NOT NULL AND p_expires_at <= now() THEN
    RAISE EXCEPTION 'legal_hold_apply: expires_at must be in the future'
      USING ERRCODE = 'P0001';
  END IF;

  INSERT INTO public.legal_holds
    (subject_type, subject_id, reason_code, reason,
     document_refs, expires_at, placed_by, requestor, status)
  VALUES
    (p_subject_type, p_subject_id, p_reason_code, p_reason,
     COALESCE(p_document_refs, '[]'::jsonb),
     p_expires_at, p_placed_by,
     COALESCE(p_requestor, '{}'::jsonb),
     'active')
  RETURNING * INTO v_row;

  RETURN v_row;
EXCEPTION
  WHEN unique_violation THEN
    -- Duplicate active hold for the same (subject, reason_code).
    -- Return the existing row so callers can idempotently retry
    -- without ambiguity about which one "won".
    SELECT * INTO v_row
      FROM public.legal_holds
     WHERE subject_type = p_subject_type
       AND subject_id   = p_subject_id
       AND reason_code  = p_reason_code
       AND status       = 'active';
    RETURN v_row;
END
$$;

REVOKE ALL ON FUNCTION public.legal_hold_apply(text, uuid, text, text, uuid, timestamptz, jsonb, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.legal_hold_apply(text, uuid, text, text, uuid, timestamptz, jsonb, jsonb) TO service_role;

-- ─── release RPC ────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.legal_hold_release(
  p_hold_id        uuid,
  p_release_reason text,
  p_released_by    uuid
)
RETURNS public.legal_holds
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_row public.legal_holds%ROWTYPE;
BEGIN
  IF p_released_by IS NULL THEN
    RAISE EXCEPTION 'legal_hold_release: released_by is required'
      USING ERRCODE = 'P0001';
  END IF;
  IF p_release_reason IS NULL OR length(p_release_reason) < 10 THEN
    RAISE EXCEPTION 'legal_hold_release: release_reason (>=10 chars) required'
      USING ERRCODE = 'P0001';
  END IF;

  UPDATE public.legal_holds
     SET status         = 'released',
         released_at    = now(),
         released_by    = p_released_by,
         release_reason = p_release_reason
   WHERE id = p_hold_id
     AND status = 'active'
  RETURNING * INTO v_row;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'legal_hold_release: hold % not found or not active', p_hold_id
      USING ERRCODE = 'P0001';
  END IF;

  RETURN v_row;
END
$$;

REVOKE ALL ON FUNCTION public.legal_hold_release(uuid, text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.legal_hold_release(uuid, text, uuid) TO service_role;

-- ─── expire stale RPC ───────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.legal_hold_expire_stale()
RETURNS TABLE (expired_count bigint)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_count bigint;
BEGIN
  WITH updated AS (
    UPDATE public.legal_holds
       SET status      = 'expired',
           released_at = now(),
           release_reason = COALESCE(release_reason, 'expired_automatically')
     WHERE status = 'active'
       AND expires_at IS NOT NULL
       AND expires_at <= now()
     RETURNING id
  )
  SELECT count(*) INTO v_count FROM updated;
  expired_count := v_count;
  RETURN NEXT;
END
$$;

REVOKE ALL ON FUNCTION public.legal_hold_expire_stale() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.legal_hold_expire_stale() TO service_role;

-- ─── convenience view ───────────────────────────────────────────────────
CREATE OR REPLACE VIEW public.legal_holds_active_view AS
SELECT
  id, subject_type, subject_id, reason_code, reason,
  document_refs, expires_at, placed_at, placed_by, requestor
FROM public.legal_holds
WHERE status = 'active'
  AND (expires_at IS NULL OR expires_at > now());

GRANT SELECT ON public.legal_holds_active_view TO service_role;

-- ─── RLS ────────────────────────────────────────────────────────────────
ALTER TABLE public.legal_holds ENABLE ROW LEVEL SECURITY;
-- No policies on purpose — only service_role (cron, admin routes
-- operating under admin client) can touch the table. DPO UI goes
-- through the admin API which runs as service_role.

-- ─── integrate with audit_purge_retention ──────────────────────────────
-- Wave 3 (migration 046) defined this function as
--   RETURNS TABLE(purged_count bigint, checkpoint_id bigint)
-- We extend the return shape with `held_count` so the retention
-- cron can surface a metric, and we add a NOT-purged filter on any
-- row whose (actor_user_id | entity_id::uuid) is under active
-- legal hold.
--
-- PostgreSQL disallows return-type changes via CREATE OR REPLACE,
-- so we DROP first. Wrapped in the single-transaction migration,
-- failures roll back cleanly.
DROP FUNCTION IF EXISTS public.audit_purge_retention(timestamptz, text[]);

CREATE FUNCTION public.audit_purge_retention(
  p_cutoff                timestamptz,
  p_exclude_entity_types  text[] DEFAULT ARRAY['PAYMENT','COMMISSION','TRANSFER','CONSULTANT_TRANSFER']
)
RETURNS TABLE (purged_count bigint, checkpoint_id bigint, held_count bigint)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_count          bigint := 0;
  v_held           bigint := 0;
  v_last_hash      bytea;
  v_new_seq        bigint;
  v_new_hash       bytea;
  v_checkpoint_id  bigint;
BEGIN
  -- One-shot permission for the Wave-3 DELETE trigger.
  PERFORM set_config('clinipharma.audit_allow_delete', 'on', true);

  -- Rows that WOULD be purged except for an active legal hold.
  -- `entity_id` is TEXT (migration 046), so we defensively cast —
  -- rows with non-uuid entity_id are treated as "no id to match"
  -- which is the conservative default.
  SELECT count(*) INTO v_held
    FROM public.audit_logs a
   WHERE a.created_at < p_cutoff
     AND a.entity_type <> ALL(p_exclude_entity_types)
     AND (
       (a.actor_user_id IS NOT NULL
         AND public.legal_hold_is_active('user', a.actor_user_id))
       OR (
         a.entity_id IS NOT NULL
         AND a.entity_id ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
         AND public.legal_hold_is_active(
               CASE upper(a.entity_type)
                 WHEN 'PAYMENT'  THEN 'payment'
                 WHEN 'ORDER'    THEN 'order'
                 WHEN 'PHARMACY' THEN 'pharmacy'
                 ELSE 'document'
               END,
               a.entity_id::uuid)
       )
     );

  -- Capture the last row_hash that will be deleted (for forensic trail).
  SELECT row_hash INTO v_last_hash
    FROM public.audit_logs
   WHERE created_at < p_cutoff
     AND entity_type <> ALL(p_exclude_entity_types)
     AND NOT (
       (actor_user_id IS NOT NULL
         AND public.legal_hold_is_active('user', actor_user_id))
       OR (
         entity_id IS NOT NULL
         AND entity_id ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
         AND public.legal_hold_is_active(
               CASE upper(entity_type)
                 WHEN 'PAYMENT'  THEN 'payment'
                 WHEN 'ORDER'    THEN 'order'
                 WHEN 'PHARMACY' THEN 'pharmacy'
                 ELSE 'document'
               END,
               entity_id::uuid)
       )
     )
   ORDER BY seq DESC
   LIMIT 1;

  WITH deleted AS (
    DELETE FROM public.audit_logs
     WHERE created_at < p_cutoff
       AND entity_type <> ALL(p_exclude_entity_types)
       AND NOT (
         (actor_user_id IS NOT NULL
           AND public.legal_hold_is_active('user', actor_user_id))
         OR (
           entity_id IS NOT NULL
           AND entity_id ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
           AND public.legal_hold_is_active(
                 CASE upper(entity_type)
                   WHEN 'PAYMENT'  THEN 'payment'
                   WHEN 'ORDER'    THEN 'order'
                   WHEN 'PHARMACY' THEN 'pharmacy'
                   ELSE 'document'
                 END,
                 entity_id::uuid)
         )
       )
     RETURNING id
  )
  SELECT count(*) INTO v_count FROM deleted;

  IF v_count > 0 THEN
    SELECT seq, row_hash
      INTO v_new_seq, v_new_hash
      FROM public.audit_logs
     ORDER BY seq ASC
     LIMIT 1;

    INSERT INTO public.audit_chain_checkpoints
      (reason, cutoff_before, purged_count, last_hash_before,
       new_genesis_seq, new_genesis_hash, notes)
    VALUES
      ('retention_purge', p_cutoff, v_count, v_last_hash,
       v_new_seq, v_new_hash,
       format('Purged %s rows (held %s via legal_hold), excluded types: %s',
              v_count, v_held, p_exclude_entity_types::text))
    RETURNING id INTO v_checkpoint_id;
  END IF;

  purged_count   := v_count;
  checkpoint_id  := v_checkpoint_id;
  held_count     := v_held;
  RETURN NEXT;
END
$$;

REVOKE ALL ON FUNCTION public.audit_purge_retention(timestamptz, text[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.audit_purge_retention(timestamptz, text[]) TO service_role;

-- ─── feature flags ─────────────────────────────────────────────────────
-- Both default OFF: retention jobs will still *count* potential
-- blocks via metrics, but only actually skip purges once the flag
-- flips ON. Same philosophy as dsar.sla_enforce in Wave 9.
INSERT INTO public.feature_flags (key, description, enabled, owner)
VALUES
  ('legal_hold.block_purge',
   'Wave 13 — when ON, enforce-retention + purge crons skip rows under active legal hold. When OFF, legal_hold_blocked_purge_total is emitted but the DELETE still runs.',
   false, 'dpo'),
  ('legal_hold.block_dsar_erasure',
   'Wave 13 — when ON, DSAR ERASURE transition to FULFILLED is rejected if the subject has any active legal hold. When OFF, only an alert is raised.',
   false, 'dpo')
ON CONFLICT (key) DO NOTHING;

-- ─── smoke test ─────────────────────────────────────────────────────────
DO $$
DECLARE
  v_uid    uuid := gen_random_uuid();
  v_sub    uuid := gen_random_uuid();
  v_row    public.legal_holds%ROWTYPE;
  v_active boolean;
  v_dup    public.legal_holds%ROWTYPE;
  v_exp    bigint;
BEGIN
  -- apply
  v_row := public.legal_hold_apply(
    'user', v_sub, 'ANPD_INVESTIGATION',
    'Processo SMOKE-054 — auditoria W13',
    v_uid,
    NULL,
    '[{"ref":"SEI/ANPD/0000"}]'::jsonb,
    '{"org":"ANPD"}'::jsonb
  );
  ASSERT v_row.status = 'active', 'apply: row must be active';
  ASSERT v_row.placed_by = v_uid, 'apply: placed_by must match';

  -- is_active → true
  v_active := public.legal_hold_is_active('user', v_sub);
  ASSERT v_active = true, 'is_active: must detect active hold';

  -- is_active for unrelated subject → false
  v_active := public.legal_hold_is_active('user', gen_random_uuid());
  ASSERT v_active = false, 'is_active: must be false for unrelated subject';

  -- duplicate apply returns existing row (idempotent)
  v_dup := public.legal_hold_apply(
    'user', v_sub, 'ANPD_INVESTIGATION',
    'Processo SMOKE-054 — auditoria W13 DUP',
    v_uid, NULL, '[]'::jsonb, '{}'::jsonb
  );
  ASSERT v_dup.id = v_row.id, 'apply: duplicate must return the same row';

  -- immutable UPDATE of placed_by rejected
  BEGIN
    UPDATE public.legal_holds SET placed_by = gen_random_uuid() WHERE id = v_row.id;
    RAISE EXCEPTION 'SMOKE FAIL: immutable update should have been blocked';
  EXCEPTION WHEN OTHERS THEN
    IF SQLSTATE <> 'P0001' THEN
      RAISE;
    END IF;
  END;

  -- release
  v_row := public.legal_hold_release(
    v_row.id, 'Processo arquivado — smoke test', v_uid
  );
  ASSERT v_row.status = 'released', 'release: must flip status';
  ASSERT v_row.released_by = v_uid, 'release: released_by must match';

  -- is_active → false after release
  v_active := public.legal_hold_is_active('user', v_sub);
  ASSERT v_active = false, 'is_active: must be false after release';

  -- expire stale should run without error even with 0 matches
  SELECT expired_count INTO v_exp FROM public.legal_hold_expire_stale();
  ASSERT v_exp >= 0, 'expire_stale: must return a count';

  -- Clean the smoke row. Bypass the append-only trigger (we just
  -- created it; no production forensics to preserve).
  SET LOCAL session_replication_role = 'replica';
  DELETE FROM public.legal_holds WHERE id = v_row.id;
  SET LOCAL session_replication_role = 'origin';

  RAISE NOTICE 'legal_holds smoke OK';
END
$$;
