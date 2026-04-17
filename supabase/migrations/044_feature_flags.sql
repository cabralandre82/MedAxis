-- Migration 044: feature_flags — runtime feature toggles
--
-- Purpose:
--   Enable server-side feature flags with per-role and per-entity targeting,
--   percentage rollouts, kill-switch, and audit of who changed what.
--
-- Consumer:
--   lib/features/index.ts exposes `isFeatureEnabled(key, ctx?)`.
--
-- Rollback:
--   DROP TABLE public.feature_flag_audit;
--   DROP TABLE public.feature_flags;
--
-- Idempotency:
--   All CREATE statements use IF NOT EXISTS. Safe to re-run.

CREATE TABLE IF NOT EXISTS public.feature_flags (
  key              text        PRIMARY KEY,
  description      text        NOT NULL DEFAULT '',
  -- Master switch. When false the flag always resolves to false regardless of
  -- targeting rules. Acts as kill-switch.
  enabled          boolean     NOT NULL DEFAULT false,
  -- Percentage rollout 0-100. Evaluated against a stable hash(key || subjectId)
  -- so a given subject keeps the same result across invocations.
  rollout_percent  int         NOT NULL DEFAULT 0 CHECK (rollout_percent BETWEEN 0 AND 100),
  -- Optional targeting: explicit allow-lists. If non-empty, ONLY subjects matching
  -- one of these receive the feature (superset of rollout_percent).
  target_roles     text[]      NOT NULL DEFAULT '{}',
  target_user_ids  uuid[]      NOT NULL DEFAULT '{}',
  target_clinic_ids uuid[]     NOT NULL DEFAULT '{}',
  target_pharmacy_ids uuid[]   NOT NULL DEFAULT '{}',
  -- Optional variant payload for A/B/n-tests. When null, flag is boolean only.
  -- Example: {"control": 50, "treatment": 50}
  variants         jsonb,
  -- Metadata
  owner            text,          -- team or individual responsible
  ticket_url       text,          -- link to issue/RFC
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  updated_by       uuid           -- auth.users.id of last updater
);

CREATE INDEX IF NOT EXISTS idx_feature_flags_enabled
  ON public.feature_flags (enabled)
  WHERE enabled = true;

-- Audit: every change goes here. append-only.
CREATE TABLE IF NOT EXISTS public.feature_flag_audit (
  id           bigserial   PRIMARY KEY,
  key          text        NOT NULL,
  action       text        NOT NULL CHECK (action IN ('created', 'updated', 'deleted')),
  old_value    jsonb,
  new_value    jsonb,
  changed_by   uuid,
  changed_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_feature_flag_audit_key
  ON public.feature_flag_audit (key, changed_at DESC);

-- Trigger: keep updated_at fresh on updates
CREATE OR REPLACE FUNCTION public.feature_flags_touch_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_feature_flags_touch ON public.feature_flags;
CREATE TRIGGER trg_feature_flags_touch
  BEFORE UPDATE ON public.feature_flags
  FOR EACH ROW EXECUTE FUNCTION public.feature_flags_touch_updated_at();

-- Trigger: mirror all changes to audit table
CREATE OR REPLACE FUNCTION public.feature_flags_audit_changes()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.feature_flag_audit(key, action, new_value, changed_by)
    VALUES (NEW.key, 'created', to_jsonb(NEW), NEW.updated_by);
    RETURN NEW;
  ELSIF TG_OP = 'UPDATE' THEN
    INSERT INTO public.feature_flag_audit(key, action, old_value, new_value, changed_by)
    VALUES (NEW.key, 'updated', to_jsonb(OLD), to_jsonb(NEW), NEW.updated_by);
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    INSERT INTO public.feature_flag_audit(key, action, old_value, changed_by)
    VALUES (OLD.key, 'deleted', to_jsonb(OLD), OLD.updated_by);
    RETURN OLD;
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_feature_flags_audit ON public.feature_flags;
CREATE TRIGGER trg_feature_flags_audit
  AFTER INSERT OR UPDATE OR DELETE ON public.feature_flags
  FOR EACH ROW EXECUTE FUNCTION public.feature_flags_audit_changes();

-- RLS: flags are read by the server (service_role) via lib/features. Only
-- SUPER_ADMIN / PLATFORM_ADMIN may read/write via app UI.
ALTER TABLE public.feature_flags ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.feature_flag_audit ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "admins_read_feature_flags" ON public.feature_flags;
CREATE POLICY "admins_read_feature_flags"
  ON public.feature_flags FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.user_roles ur
      WHERE ur.user_id = auth.uid()
        AND ur.role IN ('SUPER_ADMIN', 'PLATFORM_ADMIN')
    )
  );

DROP POLICY IF EXISTS "admins_write_feature_flags" ON public.feature_flags;
CREATE POLICY "admins_write_feature_flags"
  ON public.feature_flags FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.user_roles ur
      WHERE ur.user_id = auth.uid()
        AND ur.role IN ('SUPER_ADMIN', 'PLATFORM_ADMIN')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.user_roles ur
      WHERE ur.user_id = auth.uid()
        AND ur.role IN ('SUPER_ADMIN', 'PLATFORM_ADMIN')
    )
  );

DROP POLICY IF EXISTS "admins_read_feature_flag_audit" ON public.feature_flag_audit;
CREATE POLICY "admins_read_feature_flag_audit"
  ON public.feature_flag_audit FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.user_roles ur
      WHERE ur.user_id = auth.uid()
        AND ur.role IN ('SUPER_ADMIN', 'PLATFORM_ADMIN')
    )
  );

-- Seed a handful of flags that subsequent waves will consume.
-- All start disabled — safe by default.
INSERT INTO public.feature_flags (key, description, enabled, owner)
VALUES
  ('rbac.fine_grained',
   'Route authorization through lib/rbac/permissions instead of requireRole (Wave 4).',
   false,
   'audit-2026-04'),
  ('orders.atomic_rpc',
   'Use create_order_atomic RPC instead of multi-query service flow (Wave 10).',
   false,
   'audit-2026-04'),
  ('coupons.atomic_rpc',
   'Use apply_coupon_atomic RPC with row-level locks (Wave 11).',
   false,
   'audit-2026-04'),
  ('payments.atomic_confirm',
   'Use confirm_payment_atomic RPC with lock_version (Wave 11).',
   false,
   'audit-2026-04'),
  ('money.cents_read',
   'Read money values from *_cents bigint columns instead of numeric (Wave 9).',
   false,
   'audit-2026-04'),
  ('observability.deep_health',
   'Enable /api/health/deep external-service probes (Wave 6).',
   false,
   'audit-2026-04'),
  ('security.csrf_enforce',
   'Enforce double-submit CSRF token on mutating routes (Wave 5).',
   false,
   'audit-2026-04')
ON CONFLICT (key) DO NOTHING;

COMMENT ON TABLE public.feature_flags IS
  'Runtime feature flags with targeting (roles, subjects), percentage rollout, kill-switch and audit. Consumed by lib/features/index.ts.';
COMMENT ON TABLE public.feature_flag_audit IS
  'Append-only audit of every change to feature_flags. Populated by trigger.';
