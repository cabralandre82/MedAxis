-- Migration 056: Secret rotation ledger + RPCs (Wave 15).
--
-- Purpose
-- -------
-- Wave 14 hardened tenant isolation (RLS canary). Wave 15 hardens the
-- foundation that every other wave depends on: the secrets that sign
-- JWTs, encrypt PII, authenticate cron jobs, and unlock Cloudflare R2.
-- A secret that has not been rotated in 12 months is, statistically,
-- a secret that has been seen by someone who shouldn't have seen it
-- (laptop loss, ex-employee, leaked CI log, exposed `.env` in a
-- private repo cloned to a personal machine, …).
--
-- This migration introduces an **append-only, hash-chained ledger**
-- that records every rotation event for every secret the platform
-- knows about. The ledger is the single source of truth for:
--
--   • the cron at `/api/cron/rotate-secrets` (decides what is due),
--   • the deep-health endpoint (reports oldest secret age),
--   • the Grafana SLO-12 panel (secret freshness),
--   • the security runbook (proves "we last rotated DB password on
--     2025-11-23 at 02:14:07 UTC by operator <uuid>").
--
-- Why a ledger and not a simple `secrets(name, last_rotated_at)` row?
-- ------------------------------------------------------------------
-- Three audit-grade reasons:
--
--   1. **History matters.** Compliance asks "show me every time the
--      Asaas webhook secret has changed in the last 12 months". A
--      single mutable row throws that history away.
--   2. **Tamper evidence.** If an attacker rotates a secret to one
--      they control, they would also want to erase the rotation
--      event so we don't notice. The hash chain plus the immutable
--      trigger means erasing requires forging every subsequent row's
--      hash — and we publish the latest hash to the deep-health
--      probe, so divergence is visible from outside the database.
--   3. **No race on update.** Two crons that fire concurrently (e.g.
--      cron + manual incident rotation at the same minute) cannot
--      lose data: both append, both are recorded, the operator can
--      reconcile.
--
-- Wire diagram
-- ------------
--   Cron (/api/cron/rotate-secrets) runs Sunday 04:00 BRT.
--      │
--      │ 1. SELECT * FROM secret_rotation_overdue(p_max_age_days)
--      │    → list of secrets older than threshold.
--      │ 2. For each, dispatch by tier:
--      │      Tier A → generate new value, PATCH Vercel env, redeploy
--      │      Tier B → enqueue work-item + alert on-call (operator
--      │                runs the documented one-liner)
--      │      Tier C → alert on-call, never auto-act
--      │ 3. After each attempt: secret_rotation_record(...)
--      │      hash-chained insert into the ledger.
--      ▼
--   Ledger row carries: secret_name, tier, rotated_at, rotated_by,
--                       trigger_reason ('cron-due', 'incident',
--                       'manual'), provider ('vercel-env', 'cloudflare-
--                       r2', 'supabase-mgmt', 'manual'), success,
--                       error_message, prev_hash, row_hash, details.
--
-- Tier classification
-- -------------------
-- A — auto-rotate, no third-party API required:
--       CRON_SECRET, METRICS_SECRET, BACKUP_LEDGER_SECRET
--     The cron generates 32 random bytes, updates the Vercel env,
--     triggers redeploy. Failure rolls back via Vercel's env-version
--     history.
-- B — assisted: provider supports rotation but the dual-update
--     window (provider then Vercel then redeploy) needs a human in
--     the loop to confirm the new credentials work before deleting
--     the old:
--       RESEND_API_KEY, ASAAS_API_KEY, ASAAS_WEBHOOK_SECRET,
--       ZENVIA_API_TOKEN, INNGEST_EVENT_KEY, INNGEST_SIGNING_KEY,
--       CLICKSIGN_ACCESS_TOKEN, CLICKSIGN_WEBHOOK_SECRET,
--       NUVEM_FISCAL_CLIENT_SECRET, VERCEL_TOKEN,
--       TURNSTILE_SECRET_KEY (when added)
-- C — never auto, blast radius too high:
--       SUPABASE_DB_PASSWORD, SUPABASE_JWT_SECRET (rotates
--       SUPABASE_SERVICE_ROLE_KEY + NEXT_PUBLIC_SUPABASE_ANON_KEY
--       implicitly), FIREBASE_PRIVATE_KEY, OPENAI_API_KEY,
--       ENCRYPTION_KEY (encrypts data at rest — needs key-versioning
--       + re-encryption migration before rotation is even possible)
--
-- Rollback
-- --------
--   DROP FUNCTION IF EXISTS public.secret_rotation_record(text, text, text, text, text, boolean, text, jsonb);
--   DROP FUNCTION IF EXISTS public.secret_rotation_overdue(int);
--   DROP VIEW     IF EXISTS public.secret_inventory;
--   DROP TRIGGER  IF EXISTS trg_secret_rotations_immutable ON public.secret_rotations;
--   DROP FUNCTION IF EXISTS public._secret_rotations_guard();
--   DROP TABLE    IF EXISTS public.secret_rotations;

SET search_path TO public, extensions, pg_temp;

-- ─── ledger table ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.secret_rotations (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- `seq` is a strictly-monotonic insertion order. We carry it in
  -- addition to `rotated_at` because two rotations recorded inside
  -- the same transaction may share a `rotated_at` value (Postgres
  -- ties-on-microsecond), which would make the chain replay
  -- ambiguous. `seq` resolves the tie deterministically and gives
  -- the smoke test (and any future tamper-replay tool) a stable
  -- `ORDER BY` that matches the order the hashes were computed in.
  seq             bigserial UNIQUE NOT NULL,
  -- `clock_timestamp()` (not `now()`) so each call within the same
  -- transaction gets a fresh wall-clock value and we don't fool
  -- ourselves into thinking the chain ordering is broken when in
  -- fact it's just `now()` returning the tx start time.
  rotated_at      timestamptz NOT NULL DEFAULT clock_timestamp(),
  -- Stable env var name (e.g. 'CRON_SECRET'). Lowercase or upper —
  -- match exactly what process.env.<NAME> uses in code.
  secret_name     text NOT NULL CHECK (length(secret_name) BETWEEN 1 AND 128),
  -- 'A' | 'B' | 'C' — see header for definitions.
  tier            text NOT NULL CHECK (tier IN ('A','B','C')),
  -- Where the new value lives. Used by the deep health probe to
  -- decide whether to attempt a refresh check on the upstream.
  provider        text NOT NULL CHECK (provider IN (
    'vercel-env','supabase-mgmt','cloudflare-api','firebase-console',
    'asaas-portal','clicksign-portal','resend-portal','zenvia-portal',
    'inngest-portal','nuvem-fiscal-portal','openai-portal','manual'
  )),
  -- Why the rotation happened.
  trigger_reason  text NOT NULL CHECK (trigger_reason IN (
    'cron-due','manual','incident-suspected-leak','incident-confirmed-leak',
    'employee-offboarding','genesis','provider-forced','test'
  )),
  -- 'cron' | 'operator:<uuid>' | 'incident:<id>'. Free-form so manual
  -- rotation logs can carry the operator who pressed the button.
  rotated_by      text NOT NULL,
  success         boolean NOT NULL,
  -- When success=false, the human-readable reason. NEVER store the
  -- plaintext secret here.
  error_message   text,
  -- Free-form structured details: { vercel_env_id, cloudflare_token_id,
  -- new_value_fingerprint (sha256:..., FIRST 8 CHARS only), retired_at }.
  details         jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- Hash chain — same shape as audit_logs / backup_runs / rls_canary_log.
  prev_hash       text,
  row_hash        text NOT NULL
);

COMMENT ON TABLE public.secret_rotations IS
  'Wave 15 — append-only, hash-chained ledger of every secret rotation event. Append-only via _secret_rotations_guard.';

-- Hot indexes for the cron + inventory view + tamper checks.
CREATE INDEX IF NOT EXISTS secret_rotations_secret_name_idx
  ON public.secret_rotations (secret_name, rotated_at DESC);
CREATE INDEX IF NOT EXISTS secret_rotations_rotated_at_idx
  ON public.secret_rotations (rotated_at DESC);
CREATE INDEX IF NOT EXISTS secret_rotations_failed_idx
  ON public.secret_rotations (rotated_at DESC) WHERE success = false;

ALTER TABLE public.secret_rotations ENABLE ROW LEVEL SECURITY;
-- No policies. Service-role only — same posture as rls_canary_log.

-- ─── append-only trigger ────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public._secret_rotations_guard()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'secret_rotations: append-only ledger (id=%)', OLD.id
      USING ERRCODE = 'P0001';
  END IF;
  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION 'secret_rotations: append-only ledger (id=%)', OLD.id
      USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS trg_secret_rotations_immutable ON public.secret_rotations;
CREATE TRIGGER trg_secret_rotations_immutable
  BEFORE UPDATE OR DELETE ON public.secret_rotations
  FOR EACH ROW EXECUTE FUNCTION public._secret_rotations_guard();

-- ─── record RPC (SECURITY DEFINER, hash-chained) ───────────────────────
-- Append a rotation event. Computes the hash chain over the previous
-- row's hash + this row's deterministic payload. Serialised by an
-- advisory lock so concurrent crons cannot interleave hashes.
CREATE OR REPLACE FUNCTION public.secret_rotation_record(
  p_secret_name    text,
  p_tier           text,
  p_provider       text,
  p_trigger_reason text,
  p_rotated_by     text,
  p_success        boolean,
  p_error_message  text,
  p_details        jsonb
)
RETURNS public.secret_rotations
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_prev_hash text;
  v_row_hash  text;
  v_payload   text;
  -- clock_timestamp() (not now()) so two record() calls within the
  -- same transaction get strictly distinct timestamps. The chain
  -- replay then matches insertion order.
  v_now       timestamptz := clock_timestamp();
  v_row       public.secret_rotations%ROWTYPE;
BEGIN
  -- Validate enums up front to give a clear error rather than a
  -- generic CHECK constraint violation buried in a JSON response.
  IF p_tier NOT IN ('A','B','C') THEN
    RAISE EXCEPTION 'secret_rotation_record: invalid tier %', p_tier
      USING ERRCODE = '22023';
  END IF;
  IF p_provider NOT IN (
    'vercel-env','supabase-mgmt','cloudflare-api','firebase-console',
    'asaas-portal','clicksign-portal','resend-portal','zenvia-portal',
    'inngest-portal','nuvem-fiscal-portal','openai-portal','manual'
  ) THEN
    RAISE EXCEPTION 'secret_rotation_record: invalid provider %', p_provider
      USING ERRCODE = '22023';
  END IF;
  IF p_trigger_reason NOT IN (
    'cron-due','manual','incident-suspected-leak','incident-confirmed-leak',
    'employee-offboarding','genesis','provider-forced','test'
  ) THEN
    RAISE EXCEPTION 'secret_rotation_record: invalid trigger_reason %', p_trigger_reason
      USING ERRCODE = '22023';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext('secret_rotations'));

  -- Order by `seq` (strictly monotonic) so concurrent rotations
  -- within the same transaction or microsecond do not pick the
  -- wrong "previous" row.
  SELECT row_hash INTO v_prev_hash
    FROM public.secret_rotations
   ORDER BY seq DESC
   LIMIT 1;

  v_payload := COALESCE(v_prev_hash, '') ||
               '|' || v_now::text ||
               '|' || p_secret_name ||
               '|' || p_tier ||
               '|' || p_provider ||
               '|' || p_trigger_reason ||
               '|' || p_rotated_by ||
               '|' || (CASE WHEN p_success THEN 't' ELSE 'f' END) ||
               '|' || COALESCE(p_error_message, '') ||
               '|' || COALESCE(p_details::text, 'null');
  v_row_hash := encode(extensions.digest(v_payload, 'sha256'), 'hex');

  INSERT INTO public.secret_rotations
    (rotated_at, secret_name, tier, provider, trigger_reason,
     rotated_by, success, error_message, details, prev_hash, row_hash)
  VALUES
    (v_now, p_secret_name, p_tier, p_provider, p_trigger_reason,
     p_rotated_by, p_success, p_error_message,
     COALESCE(p_details, '{}'::jsonb), v_prev_hash, v_row_hash)
  RETURNING * INTO v_row;

  RETURN v_row;
END
$$;

REVOKE ALL ON FUNCTION public.secret_rotation_record(
  text, text, text, text, text, boolean, text, jsonb
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.secret_rotation_record(
  text, text, text, text, text, boolean, text, jsonb
) TO service_role;

-- ─── inventory view ────────────────────────────────────────────────────
-- One row per (secret_name) showing the most recent SUCCESSFUL
-- rotation. Failed attempts are visible in the underlying ledger
-- but do not "reset the clock" — that's the whole point.
CREATE OR REPLACE VIEW public.secret_inventory AS
SELECT
  sr.secret_name,
  sr.tier,
  sr.provider,
  sr.rotated_at AS last_rotated_at,
  sr.rotated_by AS last_rotated_by,
  sr.trigger_reason AS last_trigger_reason,
  EXTRACT(EPOCH FROM (now() - sr.rotated_at))::bigint AS age_seconds,
  CEIL(EXTRACT(EPOCH FROM (now() - sr.rotated_at)) / 86400.0)::int AS age_days,
  sr.row_hash AS last_row_hash
FROM public.secret_rotations sr
JOIN (
  SELECT secret_name, MAX(rotated_at) AS max_rotated_at
    FROM public.secret_rotations
   WHERE success = true
   GROUP BY secret_name
) latest ON latest.secret_name = sr.secret_name
        AND latest.max_rotated_at = sr.rotated_at
WHERE sr.success = true;

COMMENT ON VIEW public.secret_inventory IS
  'Wave 15 — most recent successful rotation per secret. Used by /api/cron/rotate-secrets to find overdue, and by /api/health/deep to surface staleness.';

REVOKE ALL ON public.secret_inventory FROM PUBLIC;
GRANT SELECT ON public.secret_inventory TO service_role;

-- ─── overdue RPC ───────────────────────────────────────────────────────
-- Returns the secrets whose most recent successful rotation is
-- older than `p_max_age_days` (or that have NEVER been recorded —
-- treated as infinitely old, age_days = NULL → returned). Joins
-- against a static manifest defined inline so the answer is correct
-- even when the ledger has never been written for a freshly-added
-- secret.
CREATE OR REPLACE FUNCTION public.secret_rotation_overdue(
  p_max_age_days int DEFAULT 90
)
RETURNS TABLE (
  secret_name text,
  tier        text,
  provider    text,
  age_days    int,
  last_rotated_at timestamptz,
  status      text  -- 'overdue' | 'never-rotated'
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_manifest CONSTANT jsonb := jsonb_build_array(
    -- Tier A — auto-rotate
    jsonb_build_object('n','CRON_SECRET',          't','A','p','vercel-env'),
    jsonb_build_object('n','METRICS_SECRET',       't','A','p','vercel-env'),
    jsonb_build_object('n','BACKUP_LEDGER_SECRET', 't','A','p','vercel-env'),
    -- Tier B — assisted
    jsonb_build_object('n','RESEND_API_KEY',           't','B','p','resend-portal'),
    jsonb_build_object('n','ASAAS_API_KEY',            't','B','p','asaas-portal'),
    jsonb_build_object('n','ASAAS_WEBHOOK_SECRET',     't','B','p','asaas-portal'),
    jsonb_build_object('n','ZENVIA_API_TOKEN',         't','B','p','zenvia-portal'),
    jsonb_build_object('n','INNGEST_EVENT_KEY',        't','B','p','inngest-portal'),
    jsonb_build_object('n','INNGEST_SIGNING_KEY',      't','B','p','inngest-portal'),
    jsonb_build_object('n','CLICKSIGN_ACCESS_TOKEN',   't','B','p','clicksign-portal'),
    jsonb_build_object('n','CLICKSIGN_WEBHOOK_SECRET', 't','B','p','clicksign-portal'),
    jsonb_build_object('n','NUVEM_FISCAL_CLIENT_SECRET','t','B','p','nuvem-fiscal-portal'),
    jsonb_build_object('n','VERCEL_TOKEN',             't','B','p','vercel-env'),
    jsonb_build_object('n','TURNSTILE_SECRET_KEY',     't','B','p','cloudflare-api'),
    -- Tier C — manual only (high blast radius)
    jsonb_build_object('n','SUPABASE_DB_PASSWORD',     't','C','p','supabase-mgmt'),
    jsonb_build_object('n','SUPABASE_JWT_SECRET',      't','C','p','supabase-mgmt'),
    jsonb_build_object('n','FIREBASE_PRIVATE_KEY',     't','C','p','firebase-console'),
    jsonb_build_object('n','OPENAI_API_KEY',           't','C','p','openai-portal'),
    jsonb_build_object('n','ENCRYPTION_KEY',           't','C','p','vercel-env')
  );
  v_entry  jsonb;
  v_name   text;
  v_tier   text;
  v_prov   text;
  v_inv    record;
BEGIN
  FOR v_entry IN SELECT jsonb_array_elements(v_manifest) LOOP
    v_name := v_entry->>'n';
    v_tier := v_entry->>'t';
    v_prov := v_entry->>'p';

    SELECT i.age_days, i.last_rotated_at INTO v_inv
      FROM public.secret_inventory i
     WHERE i.secret_name = v_name;

    IF NOT FOUND THEN
      secret_name := v_name;
      tier        := v_tier;
      provider    := v_prov;
      age_days    := NULL;
      last_rotated_at := NULL;
      status      := 'never-rotated';
      RETURN NEXT;
    ELSIF v_inv.age_days >= p_max_age_days THEN
      secret_name := v_name;
      tier        := v_tier;
      provider    := v_prov;
      age_days    := v_inv.age_days;
      last_rotated_at := v_inv.last_rotated_at;
      status      := 'overdue';
      RETURN NEXT;
    END IF;
  END LOOP;
END
$$;

REVOKE ALL ON FUNCTION public.secret_rotation_overdue(int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.secret_rotation_overdue(int) TO service_role;

-- ─── feature flags ─────────────────────────────────────────────────────
INSERT INTO public.feature_flags (key, description, enabled, owner)
VALUES (
  'secrets.rotation_enforce',
  'Wave 15 — when ON, /api/cron/rotate-secrets PAGES (critical) for every overdue secret. When OFF, it logs warnings and emails ops. Default OFF for the first 30 days while the manifest stabilises.',
  false, 'security'
)
ON CONFLICT (key) DO NOTHING;

INSERT INTO public.feature_flags (key, description, enabled, owner)
VALUES (
  'secrets.auto_rotate_tier_a',
  'Wave 15 — when ON, the cron auto-rotates Tier A secrets (CRON_SECRET, METRICS_SECRET, BACKUP_LEDGER_SECRET) by generating new values, PATCHing Vercel env, and triggering redeploy. When OFF, Tier A behaves like Tier B (alerts + work-item). Default OFF until VERCEL_TOKEN with env-write scope is provisioned.',
  false, 'security'
)
ON CONFLICT (key) DO NOTHING;

-- ─── genesis seed ──────────────────────────────────────────────────────
-- Stamp every secret in the manifest as "rotated at deploy time"
-- so the cron has a baseline. This is honest: every secret in
-- .env.local was either set at platform launch or in a prior wave;
-- treating them all as "rotated today" gives operators 90 days to
-- catch up before any alert fires. The genesis records carry a
-- distinct trigger_reason ('genesis') so audits can distinguish
-- them from real rotations.
DO $$
DECLARE
  v_secret text;
  v_tier   text;
  v_prov   text;
  v_seed CONSTANT jsonb := jsonb_build_array(
    jsonb_build_object('n','CRON_SECRET',               't','A','p','vercel-env'),
    jsonb_build_object('n','METRICS_SECRET',            't','A','p','vercel-env'),
    jsonb_build_object('n','BACKUP_LEDGER_SECRET',      't','A','p','vercel-env'),
    jsonb_build_object('n','RESEND_API_KEY',            't','B','p','resend-portal'),
    jsonb_build_object('n','ASAAS_API_KEY',             't','B','p','asaas-portal'),
    jsonb_build_object('n','ASAAS_WEBHOOK_SECRET',      't','B','p','asaas-portal'),
    jsonb_build_object('n','ZENVIA_API_TOKEN',          't','B','p','zenvia-portal'),
    jsonb_build_object('n','INNGEST_EVENT_KEY',         't','B','p','inngest-portal'),
    jsonb_build_object('n','INNGEST_SIGNING_KEY',       't','B','p','inngest-portal'),
    jsonb_build_object('n','CLICKSIGN_ACCESS_TOKEN',    't','B','p','clicksign-portal'),
    jsonb_build_object('n','CLICKSIGN_WEBHOOK_SECRET',  't','B','p','clicksign-portal'),
    jsonb_build_object('n','NUVEM_FISCAL_CLIENT_SECRET','t','B','p','nuvem-fiscal-portal'),
    jsonb_build_object('n','VERCEL_TOKEN',              't','B','p','vercel-env'),
    jsonb_build_object('n','TURNSTILE_SECRET_KEY',      't','B','p','cloudflare-api'),
    jsonb_build_object('n','SUPABASE_DB_PASSWORD',      't','C','p','supabase-mgmt'),
    jsonb_build_object('n','SUPABASE_JWT_SECRET',       't','C','p','supabase-mgmt'),
    jsonb_build_object('n','FIREBASE_PRIVATE_KEY',      't','C','p','firebase-console'),
    jsonb_build_object('n','OPENAI_API_KEY',            't','C','p','openai-portal'),
    jsonb_build_object('n','ENCRYPTION_KEY',            't','C','p','vercel-env')
  );
  v_entry jsonb;
  v_existing int;
BEGIN
  FOR v_entry IN SELECT jsonb_array_elements(v_seed) LOOP
    v_secret := v_entry->>'n';
    v_tier   := v_entry->>'t';
    v_prov   := v_entry->>'p';

    -- Idempotent: only seed if no successful row exists yet.
    SELECT COUNT(*) INTO v_existing
      FROM public.secret_rotations
     WHERE secret_name = v_secret AND success = true;
    IF v_existing > 0 THEN CONTINUE; END IF;

    PERFORM public.secret_rotation_record(
      v_secret, v_tier, v_prov,
      'genesis', 'migration:056', true, NULL,
      jsonb_build_object('seeded_by','migration_056','note','baseline at platform launch / wave introduction')
    );
  END LOOP;
END
$$;

-- ─── smoke test ────────────────────────────────────────────────────────
-- Prove that the ledger is functional, the inventory view returns
-- one row per seeded secret, and the overdue RPC correctly flags
-- nothing (everything was just seeded as fresh).
DO $$
DECLARE
  v_inventory_count int;
  v_overdue_count   int;
  v_chain_breaks    int;
BEGIN
  SELECT COUNT(*) INTO v_inventory_count FROM public.secret_inventory;
  SELECT COUNT(*) INTO v_overdue_count
    FROM public.secret_rotation_overdue(90);

  -- Tamper-evidence smoke: every row's prev_hash must equal the
  -- previous row's row_hash, where "previous" is defined by `seq`
  -- (the monotonic insertion counter, not the wall-clock).
  WITH ordered AS (
    SELECT row_hash, prev_hash,
           LAG(row_hash) OVER (ORDER BY seq) AS expected_prev
      FROM public.secret_rotations
  )
  SELECT COUNT(*) INTO v_chain_breaks
    FROM ordered
   WHERE prev_hash IS DISTINCT FROM expected_prev
     AND expected_prev IS NOT NULL;

  IF v_inventory_count < 19 THEN
    RAISE EXCEPTION 'SMOKE FAIL: secret_inventory has only % rows (expected ≥ 19 from genesis seed)',
      v_inventory_count;
  END IF;

  IF v_overdue_count > 0 THEN
    RAISE EXCEPTION 'SMOKE FAIL: % secrets overdue immediately after genesis seed', v_overdue_count;
  END IF;

  IF v_chain_breaks > 0 THEN
    RAISE EXCEPTION 'SMOKE FAIL: % hash chain break(s) detected after genesis seed', v_chain_breaks;
  END IF;

  RAISE NOTICE 'Wave 15 smoke OK — inventory=%, overdue=%, chain_breaks=%',
    v_inventory_count, v_overdue_count, v_chain_breaks;
END
$$;
