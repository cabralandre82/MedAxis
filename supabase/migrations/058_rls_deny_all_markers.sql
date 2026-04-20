-- ============================================================================
-- 058_rls_deny_all_markers.sql
-- ----------------------------------------------------------------------------
-- Documents the 6 public-schema tables that are **intentionally** deny-all
-- (no CREATE POLICY, only service_role / admin RPC access).
--
-- Context:
--   Migration 057 installed an event trigger that auto-enables RLS on
--   every new `public` table. Combined with the claims-audit verifier
--   `check-rls-policy-coverage`, we want a **deliberate, reviewable**
--   distinction between:
--
--     (a) "I forgot to write a policy" (a bug — deny-all by silence)
--     (b) "This table is an audit/ledger/admin-only store; deny-all is
--          the correct posture; only service_role / SECURITY DEFINER
--          RPCs touch it" (intent — deny-all by design)
--
--   Each prior migration already carried prose like "No policies on
--   purpose — service_role only". This file formalizes that prose
--   into a machine-readable `@rls-policy(table_name):` marker the
--   verifier understands, AND a SQL-level `COMMENT ON TABLE` so the
--   intent survives into the running database (visible in psql,
--   dashboards, `\d+`, and schema inspection tools).
--
-- Marker format: `-- @rls-policy(table_name): justification`
--   Values used below:
--     service_role-only   — cron writes, SUPER_ADMIN reads, no user access
--     admin-only-via-rpc  — SECURITY DEFINER RPC gates all access
--
-- The `COMMENT ON TABLE` statements below are idempotent — they replace
-- any previous comment on the table.
-- ============================================================================

-- ── backup_runs ───────────────────────────────────────────────────────────
-- @rls-policy(backup_runs): service_role-only (ledger written by cron, read by DPO via RPC)
--
-- Declared in migration 053. Ledger for backup/restore-drill outcomes with
-- hash chain. Only `service_role` writes (the cron handler); only SUPER_ADMIN
-- reads via `public.backup_latest_view` and `public.backup_verify_chain()`.
-- No authenticated/anon access — deny-all is the correct posture.
COMMENT ON TABLE public.backup_runs IS
  'Backup/restore-drill ledger with hash chain. [rls-policy: service_role-only] '
  'Written only by /api/backups/record (service_role). Read only by SUPER_ADMIN '
  'via backup_latest_view / backup_verify_chain(). See migration 053.';

-- ── rate_limit_violations ─────────────────────────────────────────────────
-- @rls-policy(rate_limit_violations): service_role-only (append-only via RPC; IPs SHA-256 hashed)
--
-- Declared in migration 052. Append-only log of denied requests with
-- SHA-256-hashed IPs (never plaintext). Inserted by the SECURITY DEFINER
-- RPC `rate_limit_record`. Read only by SUPER_ADMIN for abuse triage
-- (see docs/runbooks/rate-limit-abuse.md).
COMMENT ON TABLE public.rate_limit_violations IS
  'Append-only rate-limit denial log (IP SHA-256 hashed, never plaintext). '
  '[rls-policy: service_role-only] Written only by rate_limit_record() SECURITY '
  'DEFINER RPC. Read only by SUPER_ADMIN. See migration 052.';

-- ── rls_canary_log ────────────────────────────────────────────────────────
-- @rls-policy(rls_canary_log): service_role-only (canary run history; user data is never stored)
--
-- Declared in migration 055. Stores the outcome of every `rls-canary` cron
-- run: whether a probe from a non-affiliated user as service_role "saw"
-- any tenant data it shouldn't have. Contains no PII, only counts and
-- timestamps. Only the cron (service_role) writes; only SUPER_ADMIN reads.
COMMENT ON TABLE public.rls_canary_log IS
  'Canary results from rls-canary cron. No PII — only counts and timestamps. '
  '[rls-policy: service_role-only] Written only by the canary cron. Read only '
  'by SUPER_ADMIN. See migration 055.';

-- ── legal_holds ───────────────────────────────────────────────────────────
-- @rls-policy(legal_holds): admin-only-via-rpc (DPO-level; SECURITY DEFINER gates apply + release)
--
-- Declared in migration 054. Active/released preservation orders (ANPD,
-- judicial, MPF, etc.). DPO-level sensitivity. Applied and released only
-- via SECURITY DEFINER RPCs that check caller role; `authenticated`/`anon`
-- have zero access even on SELECT.
COMMENT ON TABLE public.legal_holds IS
  'ANPD / judicial / MPF preservation orders. [rls-policy: admin-only-via-rpc] '
  'Applied/released via apply_legal_hold() and release_legal_hold() SECURITY '
  'DEFINER RPCs (DPO-level). No direct authenticated access. See migration 054.';

-- ── dsar_audit ────────────────────────────────────────────────────────────
-- @rls-policy(dsar_audit): service_role-only (DSAR state transitions; plaintext PII redacted at write)
--
-- Declared in migration 051. Audit trail of every DSAR state transition
-- (RECEIVED → IN_REVIEW → FULFILLED etc.). Written by the DSAR worker
-- under service_role. Read by SUPER_ADMIN for ANPD audits. No direct
-- subject access (the subject reads their own `dsar_requests` row
-- through a dedicated RLS policy).
COMMENT ON TABLE public.dsar_audit IS
  'DSAR state-transition audit trail. [rls-policy: service_role-only] Written '
  'only by the DSAR worker (service_role). Read only by SUPER_ADMIN for ANPD '
  'audits. Subjects read dsar_requests directly via RLS. See migration 051.';

-- ── secret_rotations ──────────────────────────────────────────────────────
-- @rls-policy(secret_rotations): service_role-only (append-only ledger; hash-chained rotations)
--
-- Declared in migration 056. Hash-chained ledger of every secret rotation
-- event. Written by the `rotate-secrets` cron (service_role). Read by
-- SUPER_ADMIN for compliance audits. No authenticated access.
COMMENT ON TABLE public.secret_rotations IS
  'Hash-chained secret-rotation ledger. [rls-policy: service_role-only] Written '
  'by rotate-secrets cron (service_role). Read only by SUPER_ADMIN. See '
  'migration 056.';

-- ── Smoke test ────────────────────────────────────────────────────────────
-- Assert that (a) all 6 tables still exist, (b) RLS is still enabled on
-- each (the event trigger should have handled that when they were first
-- created — we verify the event trigger didn't get reverted), and (c) the
-- COMMENT ON TABLE statements landed.
DO $smoke$
DECLARE
  v_table text;
  v_rls_enabled boolean;
  v_has_comment boolean;
  v_target_tables text[] := ARRAY[
    'backup_runs',
    'rate_limit_violations',
    'rls_canary_log',
    'legal_holds',
    'dsar_audit',
    'secret_rotations'
  ];
BEGIN
  FOREACH v_table IN ARRAY v_target_tables LOOP
    -- Table exists + RLS on?
    SELECT c.relrowsecurity INTO v_rls_enabled
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public'
       AND c.relname = v_table
       AND c.relkind = 'r';

    IF v_rls_enabled IS NULL THEN
      RAISE EXCEPTION '058 smoke: expected table public.% but it is missing', v_table;
    END IF;
    IF NOT v_rls_enabled THEN
      RAISE EXCEPTION '058 smoke: expected RLS enabled on public.% but it is not', v_table;
    END IF;

    -- Comment landed?
    SELECT obj_description(
      (SELECT c.oid FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = 'public' AND c.relname = v_table),
      'pg_class'
    ) IS NOT NULL
    INTO v_has_comment;

    IF NOT v_has_comment THEN
      RAISE EXCEPTION '058 smoke: COMMENT ON TABLE public.% did not land', v_table;
    END IF;
  END LOOP;

  RAISE NOTICE 'Migration 058 smoke passed (6 tables RLS-enabled + commented)';
END;
$smoke$ LANGUAGE plpgsql;
