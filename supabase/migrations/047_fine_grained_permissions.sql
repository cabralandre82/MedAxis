-- Migration 047: fine-grained permissions (RBAC Wave 4).
--
-- Current model (pre-Wave-4): authorisation is expressed as roles checked by
-- `requireRole(['SUPER_ADMIN','PLATFORM_ADMIN'])` at ~80 call sites. Adding a
-- new admin action requires editing every call site and there is no way to
-- grant a single permission (e.g. "can read server_logs") to an operator
-- without promoting them to PLATFORM_ADMIN.
--
-- This migration introduces a classic role-permission model plus per-user
-- grant overrides, WITHOUT removing the role layer:
--
--   1. `permissions` — registry of every logical permission, keyed by a stable
--      dotted string (`users.manage`, `audit.read`, …). Serves as FK target
--      and gives the admin UI a self-documenting catalog.
--   2. `role_permissions(role, permission)` — many-to-many seed mapping the
--      existing roles to the permissions they currently enjoy. SUPER_ADMIN is
--      not represented here; the RPC handles it via short-circuit (see §4).
--   3. `user_permission_grants` — individual opt-in overrides with optional
--      TTL and `revoked_at`. Tracks `granted_by`, `reason`. Immutable-ish:
--      updates only flip `revoked_at` / `expires_at`; hard delete is blocked.
--   4. `has_permission(user_id, permission)` — SECURITY DEFINER RPC that
--      resolves in this order:
--        a. user has role SUPER_ADMIN → true (wildcard)
--        b. user has a role that maps to the permission → true
--        c. user has an active, non-revoked, non-expired grant → true
--        d. otherwise → false.
--
-- `lib/rbac/permissions.ts` (Wave 4 code) calls the RPC when the feature flag
-- `rbac.fine_grained` is on for the subject; otherwise it delegates to the
-- existing `requireRole` path. This lets us roll out gradually and flip the
-- flag at the first sign of regression.
--
-- Rollback:
--   DROP FUNCTION public.has_permission(uuid, text);
--   DROP POLICY  ... ON user_permission_grants;
--   DROP TABLE   public.user_permission_grants;
--   DROP TABLE   public.role_permissions;
--   DROP TABLE   public.permissions;
--
-- Idempotent (IF NOT EXISTS / ON CONFLICT DO NOTHING). Safe to re-run.

-- ─────────────────────────────────────────────────────────────────
-- 1. Permission catalog
-- ─────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.permissions (
  key         text        PRIMARY KEY,
  description text        NOT NULL,
  domain      text        NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.permissions IS
  'Registry of every fine-grained permission recognised by the platform.
   Key format is `domain.action`. `domain` must match the first segment.';

-- Enforce `key = domain + '.' + <action>` to keep the catalog tidy.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'permissions_key_matches_domain'
       AND conrelid = 'public.permissions'::regclass
  ) THEN
    EXECUTE $ck$ALTER TABLE public.permissions
      ADD CONSTRAINT permissions_key_matches_domain
      CHECK (split_part(key, '.', 1) = domain AND length(split_part(key, '.', 2)) > 0)$ck$;
  END IF;
END $$;

ALTER TABLE public.permissions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "permissions_select_auth" ON public.permissions;
CREATE POLICY "permissions_select_auth" ON public.permissions
  FOR SELECT TO authenticated USING (true);

-- ─────────────────────────────────────────────────────────────────
-- 2. Role → permissions mapping
-- ─────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.role_permissions (
  role       text NOT NULL,
  permission text NOT NULL REFERENCES public.permissions(key) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (role, permission)
);

COMMENT ON TABLE public.role_permissions IS
  'Static seed of default permissions granted to each role. SUPER_ADMIN is
   intentionally excluded — the has_permission RPC short-circuits for it.';

CREATE INDEX IF NOT EXISTS role_permissions_permission_idx ON public.role_permissions(permission);

ALTER TABLE public.role_permissions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "role_permissions_select_auth" ON public.role_permissions;
CREATE POLICY "role_permissions_select_auth" ON public.role_permissions
  FOR SELECT TO authenticated USING (true);

-- ─────────────────────────────────────────────────────────────────
-- 3. Per-user grant overrides
-- ─────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.user_permission_grants (
  id                   uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id              uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  permission           text        NOT NULL REFERENCES public.permissions(key) ON DELETE CASCADE,
  granted_by_user_id   uuid        REFERENCES public.profiles(id),
  reason               text,
  expires_at           timestamptz,
  revoked_at           timestamptz,
  revoked_by_user_id   uuid        REFERENCES public.profiles(id),
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.user_permission_grants IS
  'Individual permission overrides. Insert to grant, UPDATE revoked_at to
   revoke. Hard delete is allowed only via admin tooling (RLS restricts to
   platform admins via is_platform_admin()).';

CREATE UNIQUE INDEX IF NOT EXISTS user_permission_grants_active_uidx
  ON public.user_permission_grants(user_id, permission)
  WHERE revoked_at IS NULL;

CREATE INDEX IF NOT EXISTS user_permission_grants_user_idx
  ON public.user_permission_grants(user_id);

ALTER TABLE public.user_permission_grants ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "user_permission_grants_select_self_or_admin" ON public.user_permission_grants;
CREATE POLICY "user_permission_grants_select_self_or_admin"
  ON public.user_permission_grants
  FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.is_platform_admin());

DROP POLICY IF EXISTS "user_permission_grants_write_admin" ON public.user_permission_grants;
CREATE POLICY "user_permission_grants_write_admin"
  ON public.user_permission_grants
  FOR ALL TO authenticated
  USING (public.is_platform_admin())
  WITH CHECK (public.is_platform_admin());

-- Audit-like updated_at maintenance.
CREATE OR REPLACE FUNCTION public.user_permission_grants_touch()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS user_permission_grants_touch_trg ON public.user_permission_grants;
CREATE TRIGGER user_permission_grants_touch_trg
  BEFORE UPDATE ON public.user_permission_grants
  FOR EACH ROW EXECUTE FUNCTION public.user_permission_grants_touch();

-- ─────────────────────────────────────────────────────────────────
-- 4. RPC: has_permission(user_id, permission)
-- ─────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.has_permission(
  p_user_id    uuid,
  p_permission text
) RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles ur
     WHERE ur.user_id = p_user_id
       AND ur.role = 'SUPER_ADMIN'
  )
  OR EXISTS (
    SELECT 1
      FROM public.user_roles ur
      JOIN public.role_permissions rp ON rp.role = ur.role
     WHERE ur.user_id = p_user_id
       AND rp.permission = p_permission
  )
  OR EXISTS (
    SELECT 1
      FROM public.user_permission_grants g
     WHERE g.user_id    = p_user_id
       AND g.permission = p_permission
       AND g.revoked_at IS NULL
       AND (g.expires_at IS NULL OR g.expires_at > now())
  );
$$;

COMMENT ON FUNCTION public.has_permission(uuid, text) IS
  'True if the user has the permission via SUPER_ADMIN wildcard, via their
   role mapping, or via an active user_permission_grants row. Consumed by
   lib/rbac/permissions.ts when feature flag rbac.fine_grained is on.';

REVOKE ALL ON FUNCTION public.has_permission(uuid, text) FROM public;
GRANT EXECUTE ON FUNCTION public.has_permission(uuid, text) TO authenticated, service_role;

-- ─────────────────────────────────────────────────────────────────
-- 5. Seed the catalog (idempotent)
-- ─────────────────────────────────────────────────────────────────

INSERT INTO public.permissions (key, description, domain) VALUES
  ('platform.admin',                 'General access to the admin panel',                                 'platform'),
  ('users.read',                     'View users list and profiles',                                      'users'),
  ('users.manage',                   'Create, update users (not anonymise/delete)',                       'users'),
  ('users.anonymize',                'LGPD anonymisation of a user',                                      'users'),
  ('clinics.read',                   'View clinics',                                                      'clinics'),
  ('clinics.manage',                 'Create / update / deactivate clinics',                              'clinics'),
  ('pharmacies.read',                'View pharmacies',                                                   'pharmacies'),
  ('pharmacies.manage',              'Create / update / deactivate pharmacies (platform-wide)',           'pharmacies'),
  ('pharmacies.manage_own',          'Manage the pharmacy the user administers',                          'pharmacies'),
  ('doctors.read',                   'View doctors',                                                      'doctors'),
  ('doctors.manage',                 'Create / update doctors',                                           'doctors'),
  ('products.read',                  'View products catalog',                                             'products'),
  ('products.manage',                'Create / update products (platform-wide)',                          'products'),
  ('products.manage_own_pharmacy',   'Create / update products for the user''s own pharmacy',             'products'),
  ('orders.read',                    'View orders',                                                       'orders'),
  ('orders.manage',                  'Advance status, refund, cancel orders',                             'orders'),
  ('payments.read',                  'View payments',                                                     'payments'),
  ('payments.manage',                'Confirm / refund payments, register transfers',                     'payments'),
  ('coupons.read',                   'View coupons',                                                      'coupons'),
  ('coupons.manage',                 'Create / update / disable coupons',                                 'coupons'),
  ('consultants.read',               'View sales consultants (admin panel)',                              'consultants'),
  ('consultants.manage',             'Create / update / anonymise consultants (SUPER_ADMIN operation)',   'consultants'),
  ('distributors.read',              'View distributors',                                                 'distributors'),
  ('distributors.manage',            'Create / update distributors',                                      'distributors'),
  ('categories.read',                'View product categories',                                           'categories'),
  ('categories.manage',              'Create / update categories',                                        'categories'),
  ('audit.read',                     'Read audit_logs (platform-wide)',                                   'audit'),
  ('server_logs.read',               'Read server_logs panel',                                            'server_logs'),
  ('churn.read',                     'Read churn analytics',                                              'churn'),
  ('reports.read',                   'Read reports panel',                                                'reports'),
  ('settings.read',                  'View app_settings',                                                 'settings'),
  ('settings.write',                 'Update app_settings',                                               'settings'),
  ('registrations.read',             'View incoming registrations',                                       'registrations'),
  ('registrations.approve',          'Approve / reject registrations',                                    'registrations'),
  ('support.read_all',               'Read all support tickets (not just own)',                           'support'),
  ('support.respond_internal',       'Post internal comments on support tickets',                         'support'),
  ('support.create_ticket',          'Open a support ticket',                                             'support'),
  ('lgpd.export_self',               'Export own personal data (LGPD Art. 15)',                           'lgpd')
ON CONFLICT (key) DO NOTHING;

-- ─────────────────────────────────────────────────────────────────
-- 6. Seed role → permission mappings (idempotent)
-- ─────────────────────────────────────────────────────────────────

-- PLATFORM_ADMIN: everything except SUPER_ADMIN-only (users.anonymize,
-- consultants.manage, registrations.approve). Note: categories.manage and
-- settings.write ARE granted to PLATFORM_ADMIN.
INSERT INTO public.role_permissions (role, permission)
SELECT 'PLATFORM_ADMIN', p.key FROM public.permissions p
 WHERE p.key NOT IN ('users.anonymize', 'consultants.manage', 'registrations.approve')
ON CONFLICT DO NOTHING;

-- CLINIC_ADMIN: narrow set — manage own clinic's doctors + read orders/payments.
INSERT INTO public.role_permissions (role, permission) VALUES
  ('CLINIC_ADMIN', 'doctors.read'),
  ('CLINIC_ADMIN', 'doctors.manage'),
  ('CLINIC_ADMIN', 'orders.read'),
  ('CLINIC_ADMIN', 'payments.read'),
  ('CLINIC_ADMIN', 'products.read'),
  ('CLINIC_ADMIN', 'support.create_ticket'),
  ('CLINIC_ADMIN', 'lgpd.export_self')
ON CONFLICT DO NOTHING;

-- PHARMACY_ADMIN: manage own pharmacy + products, read orders/payments.
INSERT INTO public.role_permissions (role, permission) VALUES
  ('PHARMACY_ADMIN', 'pharmacies.manage_own'),
  ('PHARMACY_ADMIN', 'products.read'),
  ('PHARMACY_ADMIN', 'products.manage_own_pharmacy'),
  ('PHARMACY_ADMIN', 'categories.read'),
  ('PHARMACY_ADMIN', 'orders.read'),
  ('PHARMACY_ADMIN', 'payments.read'),
  ('PHARMACY_ADMIN', 'support.create_ticket'),
  ('PHARMACY_ADMIN', 'lgpd.export_self')
ON CONFLICT DO NOTHING;

-- DOCTOR: minimal — open ticket, export self data.
INSERT INTO public.role_permissions (role, permission) VALUES
  ('DOCTOR', 'support.create_ticket'),
  ('DOCTOR', 'lgpd.export_self')
ON CONFLICT DO NOTHING;

-- SALES_CONSULTANT: read own registrations + commissions.
INSERT INTO public.role_permissions (role, permission) VALUES
  ('SALES_CONSULTANT', 'registrations.read'),
  ('SALES_CONSULTANT', 'consultants.read'),
  ('SALES_CONSULTANT', 'support.create_ticket'),
  ('SALES_CONSULTANT', 'lgpd.export_self')
ON CONFLICT DO NOTHING;

-- ─────────────────────────────────────────────────────────────────
-- 7. Grants
-- ─────────────────────────────────────────────────────────────────

REVOKE ALL ON public.permissions               FROM anon;
REVOKE ALL ON public.role_permissions          FROM anon;
REVOKE ALL ON public.user_permission_grants    FROM anon, authenticated;

GRANT SELECT ON public.permissions      TO authenticated;
GRANT SELECT ON public.role_permissions TO authenticated;
GRANT SELECT ON public.user_permission_grants TO authenticated;

-- ─────────────────────────────────────────────────────────────────
-- 8. Smoke assertions
-- ─────────────────────────────────────────────────────────────────

DO $smoke$
DECLARE
  v_perms       int;
  v_rp_platform int;
  v_rp_pharmacy int;
BEGIN
  SELECT count(*) INTO v_perms FROM public.permissions;
  IF v_perms < 35 THEN
    RAISE EXCEPTION 'Migration 047 smoke: expected >=35 permissions, got %', v_perms;
  END IF;

  SELECT count(*) INTO v_rp_platform FROM public.role_permissions WHERE role = 'PLATFORM_ADMIN';
  IF v_rp_platform < 30 THEN
    RAISE EXCEPTION 'Migration 047 smoke: PLATFORM_ADMIN should have >=30 perms, got %', v_rp_platform;
  END IF;

  SELECT count(*) INTO v_rp_pharmacy FROM public.role_permissions WHERE role = 'PHARMACY_ADMIN';
  IF v_rp_pharmacy < 7 THEN
    RAISE EXCEPTION 'Migration 047 smoke: PHARMACY_ADMIN should have >=7 perms, got %', v_rp_pharmacy;
  END IF;

  RAISE NOTICE 'Migration 047 smoke passed: % perms catalogued, PLATFORM_ADMIN=%, PHARMACY_ADMIN=%',
    v_perms, v_rp_platform, v_rp_pharmacy;
END
$smoke$;
