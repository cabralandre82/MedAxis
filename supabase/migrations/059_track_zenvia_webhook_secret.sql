-- Migration 059: Track ZENVIA_WEBHOOK_SECRET in the secret-rotation manifest.
--
-- Context
-- -------
-- Wave 15 (migration 056) introduced the append-only rotation ledger
-- and the `secret_rotation_overdue()` RPC with a manifest of 19
-- secrets. After 056 shipped, the Zenvia delivery-status webhook was
-- added (see `app/api/notifications/zenvia/route.ts`, subscription
-- c2a89116-9c2c-424d-81fd-8e94664924d9, commit 7991d52 on 2026-04-18)
-- and it authenticates inbound requests via a shared secret sent as
-- `X-Clinipharma-Zenvia-Secret`. That secret was deployed to Vercel
-- (production + preview, `type=sensitive`) but never registered in the
-- rotation manifest — an explicit "adiado para PR dedicado" noted at
-- the time in `docs/infra/vercel-projects-topology.md`.
--
-- This migration closes that gap. It adds `ZENVIA_WEBHOOK_SECRET` as
-- Tier B (same as every other webhook-HMAC / shared-secret paired
-- with a provider portal). After this migration the cron at
-- `/api/cron/rotate-secrets` will include it in overdue reports, the
-- deep-health endpoint surfaces it, and Grafana SLO-12 monitors its
-- age alongside the others.
--
-- Mechanics
-- ---------
-- The RPC body in 056 embeds the manifest as a jsonb literal, so
-- adding one secret requires `CREATE OR REPLACE FUNCTION` of the
-- whole function with the expanded literal. This is deliberately
-- idempotent and safe to re-run. We also seed a single genesis row
-- for the new secret (same pattern as 056's genesis DO block) so the
-- cron has a baseline and doesn't page on first read.
--
-- Parity with the runtime manifest in `lib/secrets/manifest.ts` is
-- enforced by `tests/unit/lib/secrets-manifest.test.ts`. That test
-- was updated in the same PR to (a) expect 20 entries and (b) treat
-- the LATEST `CREATE OR REPLACE FUNCTION secret_rotation_overdue`
-- as authoritative and the union of all genesis DO blocks as the
-- seeding set — that way future migrations that add a secret only
-- need to ship the new function body + one genesis row, not re-ship
-- the entire manifest twice.

-- ─── overdue RPC — re-defined with 20-entry manifest ───────────────
-- Body is identical to 056 except the `v_manifest` array gains one
-- new entry for ZENVIA_WEBHOOK_SECRET. `CREATE OR REPLACE` atomically
-- swaps the function; any in-flight calls running against the old
-- body complete before the new one takes effect.
CREATE OR REPLACE FUNCTION public.secret_rotation_overdue(
  p_max_age_days int DEFAULT 90
)
RETURNS TABLE (
  secret_name text,
  tier        text,
  provider    text,
  age_days    int,
  last_rotated_at timestamptz,
  status      text
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
    jsonb_build_object('n','ZENVIA_WEBHOOK_SECRET',    't','B','p','zenvia-portal'),
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
  v_entry jsonb;
  v_name  text;
  v_tier  text;
  v_prov  text;
  v_inv   record;
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

-- ─── genesis seed — ZENVIA_WEBHOOK_SECRET only ─────────────────────
-- The secret was first deployed on 2026-04-18 (commits 7991d52,
-- b630376, 1554cee). Treating the rotation baseline as "today" gives
-- operators the standard 90-day Tier B fuse before any alert fires,
-- consistent with how 056's genesis treated existing secrets.
-- Idempotent: only inserts if no successful rotation row exists yet.
DO $$
DECLARE
  v_existing int;
BEGIN
  SELECT COUNT(*) INTO v_existing
    FROM public.secret_rotations
   WHERE secret_name = 'ZENVIA_WEBHOOK_SECRET' AND success = true;

  IF v_existing = 0 THEN
    PERFORM public.secret_rotation_record(
      'ZENVIA_WEBHOOK_SECRET', 'B', 'zenvia-portal',
      'genesis', 'migration:059', true, NULL,
      jsonb_build_object(
        'seeded_by', 'migration_059',
        'note', 'baseline at wave 18 — Zenvia delivery-status webhook auth secret',
        'subscription_id', 'c2a89116-9c2c-424d-81fd-8e94664924d9'
      )
    );
  END IF;
END
$$;

-- ─── smoke test ────────────────────────────────────────────────────
-- Prove that (a) the new RPC body returns the expected set, (b) the
-- genesis row exists, (c) the hash chain is still intact after the
-- new row was appended.
-- Pull the same jsonb-array-based manifest we defined in the RPC
-- body so we have exactly one source of truth per migration.
DO $$
DECLARE
  v_rpc_count    int;
  v_inv_count    int;
  v_overdue      int;
  v_chain_breaks int;
BEGIN
  -- (a) RPC returns 20 secrets when age is infinite, exactly 1 of
  -- which has status='never-rotated' before we seed. After seeding,
  -- passing a very high threshold returns 0 overdue.
  SELECT COUNT(*) INTO v_rpc_count
    FROM public.secret_rotation_overdue(36500);  -- ~100 years
  IF v_rpc_count > 0 THEN
    RAISE EXCEPTION 'SMOKE FAIL 059: % secrets overdue at 100y threshold (should be 0)', v_rpc_count;
  END IF;

  -- (b) inventory view reflects the new entry (≥ 20 rows).
  SELECT COUNT(*) INTO v_inv_count FROM public.secret_inventory;
  IF v_inv_count < 20 THEN
    RAISE EXCEPTION 'SMOKE FAIL 059: secret_inventory has only % rows (expected ≥ 20 after genesis)', v_inv_count;
  END IF;

  -- (c) overdue at the standard 90-day window is still 0 right after
  -- seeding (we just wrote last_rotated_at = now()).
  SELECT COUNT(*) INTO v_overdue FROM public.secret_rotation_overdue(90);
  IF v_overdue > 0 THEN
    RAISE EXCEPTION 'SMOKE FAIL 059: % secrets overdue at 90d window immediately after seed', v_overdue;
  END IF;

  -- (d) hash chain intact — seq-ordered prev_hash must equal the
  -- previous row's row_hash.
  WITH ordered AS (
    SELECT row_hash, prev_hash,
           LAG(row_hash) OVER (ORDER BY seq) AS expected_prev
      FROM public.secret_rotations
  )
  SELECT COUNT(*) INTO v_chain_breaks
    FROM ordered
   WHERE prev_hash IS DISTINCT FROM expected_prev
     AND expected_prev IS NOT NULL;
  IF v_chain_breaks > 0 THEN
    RAISE EXCEPTION 'SMOKE FAIL 059: % hash chain break(s) after genesis of ZENVIA_WEBHOOK_SECRET', v_chain_breaks;
  END IF;

  RAISE NOTICE 'Migration 059 smoke OK — inventory=%, overdue=%, chain_breaks=%',
    v_inv_count, v_overdue, v_chain_breaks;
END
$$;
