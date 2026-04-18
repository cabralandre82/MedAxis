-- Migration 055: RLS canary — proof harness for tenant isolation (Wave 14).
--
-- Purpose
-- -------
-- After 13 waves of hardening we have **63 tables with RLS** and a
-- careful policy matrix. None of that means anything if a future PR
-- silently weakens a policy or adds `USING (true)` to fix a bug. The
-- platform has zero internal proof that today, *right now*, an
-- unaffiliated user cannot read another tenant's orders.
--
-- This migration introduces a runtime canary that, every day, asks
-- the database the simplest possible question: **"if I am a random
-- person who is not a member of any clinic / pharmacy / consultant
-- account, how many rows of `orders` (and 30+ other tenant-scoped
-- tables) can I see?"** The answer must be **zero** every single
-- day or we page the security team.
--
-- Wire diagram
-- ------------
--   Cron (/api/cron/rls-canary) runs nightly 04:30 BRT.
--      │
--      │ 1. generate fresh canary UUID
--      │ 2. forge JWT with { sub: canary, role: 'authenticated',
--      │    iat, exp, iss: 'rls-canary' } signed with the project
--      │    JWT_SECRET fetched from Supabase Postgrest config.
--      │ 3. open a *new* supabase-js client with that JWT in the
--      │    Authorization header (NOT service_role).
--      │
--      ▼
--   PostgREST resolves role = authenticated, sets
--   `request.jwt.claims` GUC, calls public.rls_canary_assert(uuid).
--      │
--      │ The function is SECURITY INVOKER, so it runs as
--      │ `authenticated`. Every `SELECT count(*) FROM public.<t>`
--      │ inside is filtered by RLS for the canary subject.
--      │
--      ▼
--   Function returns one row per checked table with
--   visible_rows / violated. The cron aggregates, then writes
--   the run summary to `rls_canary_log` via service_role using
--   `rls_canary_record(...)` (SECURITY DEFINER, hash-chained).
--
-- Why SECURITY INVOKER (not DEFINER)
-- ----------------------------------
-- PostgreSQL forbids `SET ROLE` inside SECURITY DEFINER functions
-- (error 42501). The whole point of the canary is to run with RLS
-- *on*, which requires a non-bypass role. The cleanest way to get
-- there is to be the caller — and have the cron present the canary
-- as `authenticated` via JWT.
--
-- Tables EXCLUDED from the matrix (intentionally world-readable
-- or otherwise not tenant-scoped):
--     products, product_variants, product_categories, product_images,
--     product_associations  — public catalogue.
--     feature_flags, permissions, role_permissions, sla_configs —
--                              client-side config.
--     app_settings           — partial RLS (some keys public).
--     cron_runs, cron_locks  — service_role only, never user-readable.
--     rate_limit_violations  — service_role only.
--     audit_chain_checkpoints, feature_flag_audit — admin-only ledgers
--                              already covered by audit_logs predicate.
--     order_tracking_tokens  — token-based auth, not subject-based.
--
-- Rollback
-- --------
--   DROP FUNCTION IF EXISTS public.rls_canary_record(uuid, int, int, jsonb);
--   DROP FUNCTION IF EXISTS public.rls_canary_assert(uuid);
--   DROP TRIGGER IF EXISTS trg_rls_canary_log_immutable ON public.rls_canary_log;
--   DROP FUNCTION IF EXISTS public._rls_canary_log_guard();
--   DROP TABLE IF EXISTS public.rls_canary_log;

SET search_path TO public, extensions, pg_temp;

-- ─── BUG FIX surfaced by the canary itself ────────────────────────────
-- The very first run of the smoke test exposed a real production bug:
--
--   ERROR 42P17: infinite recursion detected in policy for relation
--   "clinic_members"
--
-- The offending policy is `clinic_members_select`, which says:
--
--   USING (is_platform_admin()
--          OR user_id = auth.uid()
--          OR EXISTS (SELECT 1 FROM clinic_members cm
--                      WHERE cm.clinic_id = clinic_members.clinic_id
--                        AND cm.user_id = auth.uid()))
--
-- The third branch queries `clinic_members` from inside its own
-- SELECT policy — Postgres re-applies the policy to the inner
-- SELECT, which queries `clinic_members` again, forever. The
-- engine detects the loop and aborts the entire query. Worse,
-- because *every* tenant table (orders, order_items, payments,
-- coupons, contracts, …) joins through `clinic_members` in its
-- own policy, the recursion explodes the moment an authenticated
-- user issues virtually any read. Production is currently shielded
-- only because the app reads via service_role from server actions
-- (BYPASSRLS). The first user that hits a route which uses an
-- authenticated PostgREST client would have errored out.
--
-- Fix: split the predicate into a SECURITY DEFINER helper that
-- bypasses the recursive policy lookup. Same pattern as
-- `is_platform_admin()`. We also add `is_pharmacy_member()` for
-- symmetry — pharmacy_members today only lets users see their own
-- row, but we want a single helper future policies can call
-- without re-introducing the same trap.

CREATE OR REPLACE FUNCTION public.is_clinic_member(
  p_clinic_id uuid,
  p_user_id   uuid DEFAULT auth.uid()
) RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.clinic_members
     WHERE clinic_id = p_clinic_id
       AND user_id   = p_user_id
  );
$$;

REVOKE ALL ON FUNCTION public.is_clinic_member(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_clinic_member(uuid, uuid)
  TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.is_pharmacy_member(
  p_pharmacy_id uuid,
  p_user_id     uuid DEFAULT auth.uid()
) RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.pharmacy_members
     WHERE pharmacy_id = p_pharmacy_id
       AND user_id     = p_user_id
  );
$$;

REVOKE ALL ON FUNCTION public.is_pharmacy_member(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_pharmacy_member(uuid, uuid)
  TO authenticated, service_role;

-- Replace the recursive policy. We keep semantics identical:
-- "you can see clinic_members rows of clinics you belong to, plus
-- your own row, plus everything if you're a platform admin".
DROP POLICY IF EXISTS clinic_members_select ON public.clinic_members;
CREATE POLICY clinic_members_select
  ON public.clinic_members
  FOR SELECT
  USING (
    public.is_platform_admin()
    OR user_id = auth.uid()
    OR public.is_clinic_member(clinic_id, auth.uid())
  );

-- ─── BUG FIX #2: doctors ↔ doctor_clinic_links cross-recursion ────────
-- The canary surfaced a second cycle:
--   `doctors_select` does EXISTS(... FROM doctor_clinic_links JOIN
--   clinic_members ...), which triggers `doctor_clinic_links_select`,
--   which itself does EXISTS(... FROM doctors ...) → triggers
--   `doctors_select` again → recursion.
--
-- Fix: SECURITY DEFINER helpers that bypass RLS for the lookup, then
-- rewrite both policies to use the helpers. Same intent, different
-- wiring.

CREATE OR REPLACE FUNCTION public.is_doctor_for_user(
  p_doctor_id uuid,
  p_user_id   uuid DEFAULT auth.uid()
) RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  -- A doctor is "for" a user when the doctor's e-mail matches the
  -- user's profile e-mail. This mirrors the original predicate.
  SELECT EXISTS (
    SELECT 1
      FROM public.doctors d
      JOIN public.profiles p ON p.email = d.email
     WHERE d.id = p_doctor_id
       AND p.id = p_user_id
  );
$$;

REVOKE ALL ON FUNCTION public.is_doctor_for_user(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_doctor_for_user(uuid, uuid)
  TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.doctor_visible_to_clinic_member(
  p_doctor_id uuid,
  p_user_id   uuid DEFAULT auth.uid()
) RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  -- A doctor is visible to a user iff some doctor_clinic_link exists
  -- for that doctor and the user is a member of the linked clinic.
  SELECT EXISTS (
    SELECT 1
      FROM public.doctor_clinic_links dcl
      JOIN public.clinic_members cm ON cm.clinic_id = dcl.clinic_id
     WHERE dcl.doctor_id = p_doctor_id
       AND cm.user_id    = p_user_id
  );
$$;

REVOKE ALL ON FUNCTION public.doctor_visible_to_clinic_member(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.doctor_visible_to_clinic_member(uuid, uuid)
  TO authenticated, service_role;

DROP POLICY IF EXISTS doctor_clinic_links_select ON public.doctor_clinic_links;
CREATE POLICY doctor_clinic_links_select
  ON public.doctor_clinic_links
  FOR SELECT
  USING (
    public.is_platform_admin()
    OR public.is_doctor_for_user(doctor_id, auth.uid())
    OR public.is_clinic_member(clinic_id, auth.uid())
  );

DROP POLICY IF EXISTS doctors_select ON public.doctors;
CREATE POLICY doctors_select
  ON public.doctors
  FOR SELECT
  USING (
    public.is_platform_admin()
    OR email = (
         SELECT p.email FROM public.profiles p WHERE p.id = auth.uid()
       )
    OR public.doctor_visible_to_clinic_member(id, auth.uid())
  );

-- ─── ledger table ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.rls_canary_log (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ran_at          timestamptz NOT NULL DEFAULT now(),
  subject_uuid    uuid NOT NULL,
  tables_checked  int  NOT NULL CHECK (tables_checked >= 0),
  violations      int  NOT NULL CHECK (violations >= 0),
  details         jsonb NOT NULL DEFAULT '[]'::jsonb,
  -- Hash chain — same shape as audit_logs / backup_runs.
  prev_hash       text,
  row_hash        text NOT NULL
);

COMMENT ON TABLE public.rls_canary_log IS
  'Wave 14 — daily proof that an unaffiliated subject cannot read tenant rows. Append-only via _rls_canary_log_guard.';

CREATE INDEX IF NOT EXISTS rls_canary_log_ran_at_idx
  ON public.rls_canary_log (ran_at DESC);
CREATE INDEX IF NOT EXISTS rls_canary_log_violations_idx
  ON public.rls_canary_log (ran_at DESC) WHERE violations > 0;

ALTER TABLE public.rls_canary_log ENABLE ROW LEVEL SECURITY;
-- No policies: only service_role (the recorder) can read/write.

-- ─── append-only trigger ────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public._rls_canary_log_guard()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'rls_canary_log: append-only (id=%)', OLD.id
      USING ERRCODE = 'P0001';
  END IF;
  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION 'rls_canary_log: append-only (id=%)', OLD.id
      USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS trg_rls_canary_log_immutable ON public.rls_canary_log;
CREATE TRIGGER trg_rls_canary_log_immutable
  BEFORE UPDATE OR DELETE ON public.rls_canary_log
  FOR EACH ROW EXECUTE FUNCTION public._rls_canary_log_guard();

-- ─── assert RPC (SECURITY INVOKER) ─────────────────────────────────────
-- Returns one row per checked table. `violated=true` means the
-- canary subject saw at least one row that should have been hidden
-- by RLS. The cron aggregates these into the ledger.
--
-- IMPORTANT: this function MUST run with RLS enabled (i.e. as a
-- non-bypass role). The cron achieves this by calling the function
-- via PostgREST with a forged JWT for the canary user, which makes
-- PostgREST set role = authenticated. If you call the function from
-- psql as `postgres` or via service_role, RLS is bypassed and every
-- row will appear visible — that's a SAFETY BUG, not the canary's
-- fault. The migration smoke test below shows the right invocation
-- pattern using `SET LOCAL ROLE authenticated`.
DROP FUNCTION IF EXISTS public.rls_canary_assert(uuid);

CREATE OR REPLACE FUNCTION public.rls_canary_assert(
  p_subject_uuid uuid
)
RETURNS TABLE (
  table_name    text,
  bucket        text,
  visible_rows  bigint,
  expected_max  bigint,
  violated      boolean,
  error_message text
)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_count bigint;
  v_err   text;
  v_t     record;
  v_matrix CONSTANT jsonb := jsonb_build_array(
    -- ── tenant: business data, member-only visibility ────────────
    jsonb_build_object('t','orders',                   'b','tenant'),
    jsonb_build_object('t','order_items',              'b','tenant'),
    jsonb_build_object('t','order_documents',          'b','tenant'),
    jsonb_build_object('t','order_status_history',     'b','tenant'),
    jsonb_build_object('t','order_operational_updates','b','tenant'),
    jsonb_build_object('t','order_item_prescriptions', 'b','tenant'),
    jsonb_build_object('t','order_templates',          'b','tenant'),
    jsonb_build_object('t','payments',                 'b','tenant'),
    jsonb_build_object('t','commissions',              'b','tenant'),
    jsonb_build_object('t','transfers',                'b','tenant'),
    jsonb_build_object('t','consultant_commissions',   'b','tenant'),
    jsonb_build_object('t','consultant_transfers',     'b','tenant'),
    jsonb_build_object('t','coupons',                  'b','tenant'),
    jsonb_build_object('t','contracts',                'b','tenant'),
    jsonb_build_object('t','nfse_records',             'b','tenant'),
    jsonb_build_object('t','support_tickets',          'b','tenant'),
    jsonb_build_object('t','support_messages',         'b','tenant'),
    jsonb_build_object('t','pharmacy_products',        'b','tenant'),
    jsonb_build_object('t','product_pharmacy_cost_history','b','tenant'),
    jsonb_build_object('t','product_price_history',    'b','tenant'),
    jsonb_build_object('t','clinic_members',           'b','tenant'),
    jsonb_build_object('t','pharmacy_members',         'b','tenant'),
    jsonb_build_object('t','doctor_clinic_links',      'b','tenant'),
    jsonb_build_object('t','clinic_churn_scores',      'b','tenant'),
    -- ── self: per-user data ──────────────────────────────────────
    jsonb_build_object('t','notifications',            'b','self'),
    jsonb_build_object('t','dsar_requests',            'b','self'),
    jsonb_build_object('t','fcm_tokens',               'b','self'),
    jsonb_build_object('t','user_permission_grants',   'b','self'),
    jsonb_build_object('t','registration_drafts',      'b','self'),
    -- ── admin: privileged ledgers ────────────────────────────────
    jsonb_build_object('t','audit_logs',               'b','admin'),
    jsonb_build_object('t','dsar_audit',               'b','admin'),
    jsonb_build_object('t','legal_holds',              'b','admin'),
    jsonb_build_object('t','backup_runs',              'b','admin'),
    jsonb_build_object('t','rls_canary_log',           'b','admin'),
    jsonb_build_object('t','rate_limit_violations',    'b','admin'),
    jsonb_build_object('t','server_logs',              'b','admin'),
    jsonb_build_object('t','webhook_events',           'b','admin'),
    jsonb_build_object('t','access_logs',              'b','admin'),
    jsonb_build_object('t','registration_requests',    'b','admin'),
    jsonb_build_object('t','registration_documents',   'b','admin')
  );
BEGIN
  -- Defensive: re-stamp the impersonation context. PostgREST
  -- already sets `request.jwt.claims` from the bearer JWT, but a
  -- caller that uses raw psql or `SET LOCAL ROLE authenticated`
  -- needs us to populate `auth.uid()` ourselves.
  PERFORM set_config(
    'request.jwt.claims',
    jsonb_build_object('sub', p_subject_uuid::text, 'role', 'authenticated')::text,
    true
  );
  PERFORM set_config('request.jwt.claim.sub', p_subject_uuid::text, true);

  FOR v_t IN SELECT * FROM jsonb_to_recordset(v_matrix)
                       AS x(t text, b text)
  LOOP
    BEGIN
      EXECUTE format('SELECT count(*) FROM public.%I', v_t.t)
        INTO v_count;
      v_err := NULL;
    EXCEPTION WHEN OTHERS THEN
      v_count := -1;
      v_err   := SQLERRM;
    END;

    table_name    := v_t.t;
    bucket        := v_t.b;
    visible_rows  := v_count;
    expected_max  := 0;
    -- Permission denied is *expected* when policies forbid SELECT
    -- entirely (e.g. tables with no policies). We translate
    -- "permission denied for table X" into visible_rows=0,
    -- violated=false, because the contract being verified is
    -- "stranger reads zero rows", and 'permission denied' is the
    -- strongest possible enforcement. Any OTHER error (relation
    -- missing, syntax) is a real violation.
    IF v_err IS NOT NULL AND v_err ILIKE 'permission denied%' THEN
      visible_rows  := 0;
      violated      := false;
      error_message := NULL;
    ELSE
      violated      := (v_count IS NULL OR v_count > 0 OR v_err IS NOT NULL);
      error_message := v_err;
    END IF;
    RETURN NEXT;
  END LOOP;
END
$$;

REVOKE ALL ON FUNCTION public.rls_canary_assert(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.rls_canary_assert(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.rls_canary_assert(uuid) TO service_role;

-- ─── record RPC (SECURITY DEFINER, hash-chained) ───────────────────────
-- Persists a run summary into the ledger. Called by the cron via
-- the service_role admin client AFTER the canary assertion has
-- been collected from the (separate) authenticated session.
CREATE OR REPLACE FUNCTION public.rls_canary_record(
  p_subject_uuid    uuid,
  p_tables_checked  int,
  p_violations      int,
  p_details         jsonb
)
RETURNS public.rls_canary_log
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_prev_hash text;
  v_row_hash  text;
  v_payload   text;
  v_now       timestamptz := now();
  v_row       public.rls_canary_log%ROWTYPE;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('rls_canary'));

  SELECT row_hash INTO v_prev_hash
    FROM public.rls_canary_log
   ORDER BY ran_at DESC, id DESC
   LIMIT 1;

  v_payload := COALESCE(v_prev_hash, '') ||
               '|' || v_now::text ||
               '|' || p_subject_uuid::text ||
               '|' || p_tables_checked::text ||
               '|' || p_violations::text ||
               '|' || COALESCE(p_details::text, 'null');
  v_row_hash := encode(extensions.digest(v_payload, 'sha256'), 'hex');

  INSERT INTO public.rls_canary_log
    (ran_at, subject_uuid, tables_checked, violations, details, prev_hash, row_hash)
  VALUES
    (v_now, p_subject_uuid, p_tables_checked, p_violations,
     COALESCE(p_details, '[]'::jsonb), v_prev_hash, v_row_hash)
  RETURNING * INTO v_row;

  RETURN v_row;
END
$$;

REVOKE ALL ON FUNCTION public.rls_canary_record(uuid, int, int, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.rls_canary_record(uuid, int, int, jsonb) TO service_role;

-- ─── feature flag ──────────────────────────────────────────────────────
INSERT INTO public.feature_flags (key, description, enabled, owner)
VALUES (
  'rls_canary.page_on_violation',
  'Wave 14 — when ON, /api/cron/rls-canary pages on any violation. When OFF, only logs warning + emits metric. Default OFF for the first 30 days while we observe matrix coverage.',
  false, 'security'
)
ON CONFLICT (key) DO NOTHING;

-- ─── smoke test ────────────────────────────────────────────────────────
-- Synthetic UUID guaranteed not to exist anywhere. We invoke the
-- assert under `SET LOCAL ROLE authenticated` so RLS actually
-- evaluates — without the role switch the migration runner
-- (postgres / supabase_admin) would BYPASS RLS and the smoke would
-- be meaningless.
DO $$
DECLARE
  v_violations int := 0;
  v_total      int := 0;
  v_first_bad  text;
  r RECORD;
  v_canary uuid := '00000000-0000-4000-8000-cafe14000001'::uuid;
  v_log    public.rls_canary_log%ROWTYPE;
BEGIN
  -- DO blocks run with caller's role; SET LOCAL ROLE is permitted
  -- here (unlike inside SECURITY DEFINER functions).
  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claim.sub', v_canary::text, true);
  PERFORM set_config('request.jwt.claims',
    jsonb_build_object('sub', v_canary::text, 'role', 'authenticated')::text,
    true);

  FOR r IN SELECT * FROM public.rls_canary_assert(v_canary) LOOP
    v_total := v_total + 1;
    IF r.violated THEN
      v_violations := v_violations + 1;
      IF v_first_bad IS NULL THEN
        v_first_bad := format('%s (visible=%s err=%s)',
                              r.table_name, r.visible_rows,
                              COALESCE(r.error_message, '<none>'));
      END IF;
    END IF;
  END LOOP;

  RESET ROLE;

  IF v_violations > 0 THEN
    RAISE EXCEPTION 'SMOKE FAIL: % of % tables violated RLS canary. First: %',
      v_violations, v_total, v_first_bad;
  END IF;

  -- Record the smoke run as the genesis of the chain (uses
  -- service_role privileges via SECURITY DEFINER).
  v_log := public.rls_canary_record(
    v_canary, v_total, 0,
    jsonb_build_object('source', 'migration_055_smoke')
  );

  RAISE NOTICE 'rls_canary smoke OK — % tables, 0 violations, ledger genesis=%',
    v_total, v_log.id;
END
$$;
