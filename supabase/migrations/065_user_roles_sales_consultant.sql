-- Migration 065: extend user_roles.role check constraint to include
-- SALES_CONSULTANT.
--
-- Why
-- ---
-- Migration 004 introduced the `sales_consultants` table and rolled out
-- the consultant onboarding flow (services/consultants.ts), which
-- writes `user_roles(user_id, role='SALES_CONSULTANT')` so the user
-- ends up with a consultant dashboard. But the `user_roles_role_check`
-- CHECK constraint was never expanded — its valid set has always been
-- {SUPER_ADMIN, PLATFORM_ADMIN, CLINIC_ADMIN, DOCTOR, PHARMACY_ADMIN}.
-- Every consultant created via the UI was therefore failing on the
-- upsert with `23514 check_violation`, and the operator was getting
-- "Erro ao atribuir papel ao consultor" with no actionable detail.
-- Migration 047 (fine-grained permissions) referenced
-- `role_permissions(role='SALES_CONSULTANT', permission=...)` which
-- coexisted fine because that table has its own roles list.
--
-- This migration synchronises the CHECK constraint with the documented
-- role set and the data already inserted by 047.
--
-- Idempotent: drops and recreates the constraint by name. Re-applying
-- this migration is a no-op as long as the role set hasn't drifted
-- elsewhere.
--
-- LGPD: no PII change. Role taxonomy is a public concept.

SET search_path TO public, extensions, pg_temp;

ALTER TABLE public.user_roles
  DROP CONSTRAINT IF EXISTS user_roles_role_check;

ALTER TABLE public.user_roles
  ADD CONSTRAINT user_roles_role_check
  CHECK (role = ANY (ARRAY[
    'SUPER_ADMIN',
    'PLATFORM_ADMIN',
    'CLINIC_ADMIN',
    'DOCTOR',
    'PHARMACY_ADMIN',
    'SALES_CONSULTANT'
  ]::text[]));

COMMENT ON CONSTRAINT user_roles_role_check ON public.user_roles IS
  'Migration 065 — closes the gap between role_permissions (already had SALES_CONSULTANT in migration 047) and the CHECK on user_roles. Without this, services/consultants.ts could never finish provisioning a consultant account.';

-- ── Smoke ─────────────────────────────────────────────────────────────────
DO $smoke$
DECLARE
  v_def text;
BEGIN
  SELECT pg_get_constraintdef(c.oid)
    INTO v_def
    FROM pg_constraint c
    JOIN pg_class    t ON t.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
   WHERE n.nspname = 'public'
     AND t.relname = 'user_roles'
     AND c.conname = 'user_roles_role_check';

  IF v_def IS NULL THEN
    RAISE EXCEPTION 'Migration 065 smoke: user_roles_role_check missing';
  END IF;

  IF position('SALES_CONSULTANT' IN v_def) = 0 THEN
    RAISE EXCEPTION 'Migration 065 smoke: SALES_CONSULTANT not in user_roles_role_check';
  END IF;

  RAISE NOTICE 'Migration 065 smoke passed';
END
$smoke$;
