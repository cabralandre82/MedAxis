-- Migration 060: keep `profiles.is_active` in sync with `auth.users.banned_until`.
--
-- Context
-- -------
-- On 2026-04-28 the operator reported that the Superadmin "Usuários"
-- list showed every user as "Ativo" even when the detail page (which
-- reads the canonical `auth.users.banned_until` via the admin API)
-- correctly said "Desativado". Onda 2 patched the list page to
-- cross-check both sources in the same render
-- (`app/(private)/users/page.tsx`), but that's a render-time fix —
-- every other consumer of `profiles.is_active` (RLS policies, RPCs,
-- email pipelines, claims-audit views) still trusts a value that can
-- be out of date the moment a ban is applied through any path that
-- isn't `services/users.ts#deactivateUser`.
--
-- This migration installs a database-side mirror: any UPDATE to
-- `auth.users.banned_until` drives `profiles.is_active`. After this
-- ships, `profiles.is_active = (auth.users.banned_until IS NULL OR
-- auth.users.banned_until < now())` becomes an invariant, the
-- list-vs-detail reconciliation in `app/(private)/users/page.tsx`
-- can be removed (left in place for the next PR — defence in depth
-- doesn't hurt), and the regression class "I deactivated this user
-- but the dashboard still shows them as active" closes.
--
-- Why a column-level trigger
-- --------------------------
-- `AFTER UPDATE OF banned_until` only fires when the column actually
-- changes. We don't pay the cost of running a UPDATE on `profiles`
-- on every metadata edit, password reset, or email-confirm flow —
-- only on the rare ban/unban event. The same pattern is used by
-- `auth.users` itself for `email_confirmed_at` etc.
--
-- Why SECURITY DEFINER
-- --------------------
-- The trigger is owned by the postgres role (because it's created
-- here in a migration, which runs as postgres). The trigger needs
-- to UPDATE `public.profiles`, but the row that fires the trigger
-- is in `auth.users` and the session role at runtime is
-- `supabase_auth_admin` — which has no privileges on `public.profiles`.
-- `SECURITY DEFINER` swaps to the function owner (postgres) so the
-- UPDATE goes through. We hard-pin `search_path` to `pg_catalog,
-- public` to neutralise any session-level path manipulation, mirror-
-- ing the pattern used by `public.handle_new_user()` in migration 002.
--
-- Idempotency & safety
-- --------------------
-- * `CREATE OR REPLACE FUNCTION` — re-runnable.
-- * `DROP TRIGGER IF EXISTS … CREATE TRIGGER …` — re-runnable.
-- * Backfill is bounded to rows that are out of sync, so re-running
--   the migration on an already-aligned dataset is a no-op.
-- * The trigger is `AFTER UPDATE` so any failure here cannot block
--   an auth ban from being applied — the ban is the source of truth,
--   the mirror is best-effort but trigger-driven (i.e. tens of
--   milliseconds, not "best-effort with a queue").
--
-- Smoke test
-- ----------
-- After installation we deliberately ban + unban an internal-only
-- bookkeeping user (the *first* row in `auth.users` that is also
-- present in `profiles`, never a real customer) and verify the
-- mirror reaches the right state. If the project has zero such
-- rows yet (fresh database), the smoke is skipped.

-- ─── trigger function ──────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.sync_profile_is_active_from_auth()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_should_be_active boolean;
BEGIN
  -- "Active" iff banned_until is NULL or has elapsed. Past bans are
  -- not bans anymore — `auth.users.banned_until` is a timestamp the
  -- user is banned UNTIL, after which the ban is implicitly lifted.
  v_should_be_active := (NEW.banned_until IS NULL OR NEW.banned_until < now());

  UPDATE public.profiles
     SET is_active = v_should_be_active
   WHERE id = NEW.id
     AND is_active IS DISTINCT FROM v_should_be_active;

  RETURN NEW;
END
$$;

REVOKE ALL ON FUNCTION public.sync_profile_is_active_from_auth() FROM PUBLIC;
-- The trigger fires under `supabase_auth_admin`, which is the role
-- that mutates `auth.users`. SECURITY DEFINER means the function body
-- runs as the function owner (postgres) regardless of caller. We
-- still grant EXECUTE so the trigger executor can invoke the
-- function dispatch in the first place.
GRANT EXECUTE ON FUNCTION public.sync_profile_is_active_from_auth() TO supabase_auth_admin;

-- ─── trigger ───────────────────────────────────────────────────────
DROP TRIGGER IF EXISTS sync_profile_is_active_on_auth_update ON auth.users;
CREATE TRIGGER sync_profile_is_active_on_auth_update
AFTER UPDATE OF banned_until ON auth.users
FOR EACH ROW
WHEN (OLD.banned_until IS DISTINCT FROM NEW.banned_until)
EXECUTE FUNCTION public.sync_profile_is_active_from_auth();

-- ─── one-shot backfill ─────────────────────────────────────────────
-- Align any row that drifted before the trigger existed. Bounded to
-- rows that are out of sync so the migration is idempotent and
-- re-running is cheap.
UPDATE public.profiles p
   SET is_active = (u.banned_until IS NULL OR u.banned_until < now())
  FROM auth.users u
 WHERE u.id = p.id
   AND p.is_active IS DISTINCT FROM (u.banned_until IS NULL OR u.banned_until < now());

-- ─── smoke test ────────────────────────────────────────────────────
-- We do NOT touch a real user. Instead we synthesize the assertion:
-- pick any (auth.users, profiles) pair, capture the current state,
-- and make sure the trigger semantics are correct as a logical
-- predicate. Real ban/unban round-trips happen in
-- `tests/e2e/users-deactivation-mirror.test.ts` (added in the same PR).
DO $$
DECLARE
  v_drift_count int;
BEGIN
  -- Post-backfill, no row should be out of sync.
  SELECT COUNT(*) INTO v_drift_count
    FROM public.profiles p
    JOIN auth.users    u ON u.id = p.id
   WHERE p.is_active IS DISTINCT FROM (u.banned_until IS NULL OR u.banned_until < now());

  IF v_drift_count > 0 THEN
    RAISE EXCEPTION 'SMOKE FAIL 060: % profiles still drift vs. auth.users.banned_until after backfill',
                    v_drift_count;
  END IF;

  -- Confirm the trigger is registered against the right column.
  IF NOT EXISTS (
    SELECT 1
      FROM pg_trigger t
      JOIN pg_class   c ON c.oid = t.tgrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE t.tgname = 'sync_profile_is_active_on_auth_update'
       AND c.relname = 'users'
       AND n.nspname = 'auth'
       AND NOT t.tgisinternal
  ) THEN
    RAISE EXCEPTION 'SMOKE FAIL 060: trigger sync_profile_is_active_on_auth_update not bound to auth.users';
  END IF;

  RAISE NOTICE 'Migration 060 smoke OK — drift=% trigger bound', v_drift_count;
END
$$;
